// POST /api/estimate-checkout — starts a Stripe-hosted Checkout Session for
// an exact, server-verified residential/STR quote or an exact Tier A facility
// quote.
//
// Reliability rules:
//  - The amount is ALWAYS recalculated server-side from the shared estimator.
//  - Payment is offered only when the quote is structurally verified (a live
//    route, confirmed destination, current config, and acknowledged first-visit
//    Deep Cleaning where required). Preliminary/custom/range quotes remain
//    reservation-only.
//  - A small server/client price variance is never silently charged. The
//    server returns the authoritative amount and requires explicit customer
//    acceptance before creating checkout.
//  - Checkout attempts and webhook events use a durable R2 ledger, not isolate
//    memory. A full SHA-256 attempt key plus Stripe Idempotency-Key prevents
//    double sessions from repeated clicks/retries.
//  - No card data ever touches this site.

import { estimatePaymentConfig } from '../../src/config/payments.ts';
import {
  QUOTE_MATCH_TOLERANCE,
  resolveServerDestination,
  verifyReservationQuote,
  type QuoteVerification,
  type QuoteVerificationEnv,
} from '../../src/lib/estimate/verify.ts';
import { verifyFacilityQuote } from '../../src/lib/estimate/facility-verify.ts';
import {
  createLedgerJson,
  deleteLedgerKey,
  ledgerKey,
  paymentHash,
  paymentLedger,
  readLedgerJson,
  writeLedgerJson,
  type LedgerBucket,
  type PaymentStorageEnv,
} from '../../src/lib/payments/ledger.ts';
import { parseLatLng, resolveRoute } from '../../src/lib/travel/server-routing.ts';

interface Env extends QuoteVerificationEnv, PaymentStorageEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  WEB3FORMS_ACCESS_KEY?: string;
  PUBLIC_SITE_URL?: string;
}

const RETURN_PATHS = new Set([
  '/estimate/residential/',
  '/estimate/str/',
  '/estimate/commercial/',
  '/estimate/church/',
]);

const WINDOW_MS = 60_000;
const PER_IP_PER_MINUTE = 8;
const CHECKOUT_CLAIM_STALE_MS = 2 * 60_000;
const WEBHOOK_PROBE_TTL_MS = 5 * 60_000;
const hits = new Map<string, { count: number; reset: number }>();
let webhookProbeCache: { fingerprint: string; at: number; result: boolean | null } | null = null;

interface CheckoutRecord {
  version: 1;
  status: 'creating' | 'open' | 'completed' | 'failed';
  generation: number;
  createdAt: string;
  updatedAt: string;
  reference: string;
  amountCents: number;
  serviceType: string;
  sessionId?: string;
  sessionUrl?: string;
}

interface StripeSession {
  id?: string;
  url?: string | null;
  status?: string;
  payment_status?: string;
  amount_total?: number;
  metadata?: Record<string, string>;
  livemode?: boolean;
}

interface VerifiedCandidate {
  amountCents: number;
  quotedCents: number;
  reference: string;
  serviceType: string;
  priceChanged: boolean;
}

interface CandidateFailure {
  ok: false;
  reason: string;
}

interface CandidateSuccess extends VerifiedCandidate {
  ok: true;
}

type CandidateResult = CandidateSuccess | CandidateFailure;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function throttled(request: Request): boolean {
  const now = Date.now();
  const ip =
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('x-forwarded-for') ??
    'unknown';
  const entry = hits.get(ip);
  if (!entry || entry.reset < now) {
    hits.set(ip, { count: 1, reset: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > PER_IP_PER_MINUTE;
}

function sanitizeFields(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  const clean: Record<string, string> = {};
  let count = 0;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (count >= 100) break;
    if (!/^[a-z0-9_]{1,40}$/i.test(key) || typeof raw !== 'string') continue;
    const text = raw.trim().slice(0, 2000);
    if (!text) continue;
    clean[key] = text;
    count += 1;
  }
  return clean;
}

function emailFrom(fields: Record<string, string>): string {
  const email = (fields.email ?? '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email.toLowerCase() : '';
}

function siteOrigin(env: Env): string {
  return (env.PUBLIC_SITE_URL?.trim() || 'https://sparkling-standard.com').replace(/\/+$/, '');
}

function keyMode(secret: string | undefined): 'live' | 'test' | 'unknown' {
  if (!secret) return 'unknown';
  if (secret.startsWith('sk_live_') || secret.startsWith('rk_live_')) return 'live';
  if (secret.startsWith('sk_test_') || secret.startsWith('rk_test_')) return 'test';
  return 'unknown';
}

function serviceLabel(fields: Record<string, string>): string {
  const raw = fields.service_type ?? fields.engine_type ?? 'cleaning';
  const labels: Record<string, string> = {
    standard: 'Residential Cleaning',
    deep: 'Deep Cleaning',
    move_in_out: 'Move-In / Move-Out Cleaning',
    str_turnover: 'Short-Term Rental Turnover',
    commercial_cleaning: 'Commercial Cleaning',
    church_cleaning: 'Church Cleaning',
  };
  return labels[raw] ?? 'Cleaning';
}

function cents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100);
}

function withinAcceptance(quotedCents: number, amountCents: number): boolean {
  return Math.abs(quotedCents - amountCents) <= Math.round(QUOTE_MATCH_TOLERANCE * 100);
}

function needsExplicitAcceptance(quotedCents: number, amountCents: number): boolean {
  return quotedCents !== amountCents;
}

async function stripeSession(env: Env, sessionId: string): Promise<StripeSession | null> {
  if (!env.STRIPE_SECRET_KEY?.trim()) return null;
  try {
    const response = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      {
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY.trim()}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) return null;
    return (await response.json().catch(() => ({}))) as StripeSession;
  } catch {
    return null;
  }
}

async function webhookEndpointConfigured(env: Env): Promise<boolean | null> {
  const secret = env.STRIPE_SECRET_KEY?.trim();
  if (!secret) return false;
  const fingerprint = await paymentHash(secret).catch(() => 'unknown');
  const now = Date.now();
  if (
    webhookProbeCache &&
    webhookProbeCache.fingerprint === fingerprint &&
    now - webhookProbeCache.at < WEBHOOK_PROBE_TTL_MS
  ) {
    return webhookProbeCache.result;
  }

  let result: boolean | null = null;
  try {
    const response = await fetch('https://api.stripe.com/v1/webhook_endpoints?limit=100', {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401 || response.status === 403) {
      result = false;
    } else if (response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        data?: Array<{
          url?: string;
          status?: string;
          enabled_events?: string[];
        }>;
      };
      const expected = `${siteOrigin(env)}/api/stripe-webhook`;
      result = Array.isArray(data.data)
        ? data.data.some(
            (endpoint) =>
              endpoint.url === expected &&
              endpoint.status === 'enabled' &&
              (endpoint.enabled_events?.includes('checkout.session.completed') ||
                endpoint.enabled_events?.includes('*')),
          )
        : false;
    }
  } catch {
    result = null;
  }
  webhookProbeCache = { fingerprint, at: now, result };
  return result;
}

export async function paymentReadiness(env: Env): Promise<{
  enabled: boolean;
  mode: 'live' | 'test' | 'unknown';
  checks: {
    stripe_key: boolean;
    webhook_secret: boolean;
    webhook_endpoint: boolean | null;
    ledger: boolean;
    notification: boolean;
    mode_allowed: boolean;
  };
}> {
  const secret = env.STRIPE_SECRET_KEY?.trim();
  const mode = keyMode(secret);
  const production = siteOrigin(env) === 'https://sparkling-standard.com';
  const modeAllowed = mode === 'live' || (mode === 'test' && !production);
  const checks = {
    stripe_key: Boolean(secret),
    webhook_secret: Boolean(env.STRIPE_WEBHOOK_SECRET?.trim()),
    webhook_endpoint: null as boolean | null,
    ledger: Boolean(paymentLedger(env)),
    notification: Boolean(env.WEB3FORMS_ACCESS_KEY?.trim()),
    mode_allowed: modeAllowed,
  };

  if (secret && checks.webhook_secret && checks.ledger && checks.notification && modeAllowed) {
    checks.webhook_endpoint = await webhookEndpointConfigured(env);
  } else if (!secret || !checks.webhook_secret || !checks.ledger || !checks.notification) {
    checks.webhook_endpoint = false;
  }

  return {
    enabled:
      estimatePaymentConfig.enabled &&
      checks.stripe_key &&
      checks.webhook_secret &&
      checks.webhook_endpoint === true &&
      checks.ledger &&
      checks.notification &&
      checks.mode_allowed,
    mode,
    checks,
  };
}

async function residentialReference(
  verification: QuoteVerification,
  fields: Record<string, string>,
  amountCents: number,
): Promise<string> {
  if (verification.referenceValid && verification.clientReference) return verification.clientReference;
  const hash = await paymentHash(
    `${fields.service_type ?? 'standard'}|${amountCents}|${fields.zip ?? ''}|${fields.email ?? ''}`,
  );
  return `EST-${hash.slice(0, 16).toUpperCase()}`;
}

async function facilityReference(
  fields: Record<string, string>,
  amountCents: number,
): Promise<string> {
  const hash = await paymentHash(
    `${fields.engine_type ?? 'commercial'}|${amountCents}|${fields.organization ?? ''}|${fields.preferred_date ?? ''}`,
  );
  return `FAC-${fields.engine_type === 'church' ? 'CH' : 'CO'}-${hash.slice(0, 16).toUpperCase()}`;
}

async function verifyFacilityPayment(
  fields: Record<string, string>,
  env: Env,
): Promise<CandidateResult> {
  const quoted = Number(fields.quoted_price);
  if (!Number.isFinite(quoted) || quoted <= 0) return { ok: false, reason: 'quote_missing' };
  if ((fields.service_address ?? '').trim().length < 5) return { ok: false, reason: 'address_required' };
  const destination = await resolveServerDestination(fields, env).catch(() => null);
  const origin = parseLatLng(env.TRAVEL_ORIGIN);
  if (!origin || !destination) return { ok: false, reason: 'route_unavailable' };
  const route = await resolveRoute(env, origin, destination).catch(() => null);
  if (!route || !route.verified || !Number.isFinite(route.oneWayMiles) || route.oneWayMiles <= 0) {
    return { ok: false, reason: 'route_unavailable' };
  }

  const verification = verifyFacilityQuote(fields, {
    routedOneWayMiles: route.oneWayMiles,
    routedTravelVerified: true,
  });
  if (verification.configMatch === 'mismatch') return { ok: false, reason: 'quote_stale' };
  if (verification.status === 'mismatch') return { ok: false, reason: 'price_mismatch' };
  if (verification.status !== 'verified' || verification.expectedTotal === null) {
    return {
      ok: false,
      reason: verification.expectedRange !== null ? 'facility_range' : 'facility_not_verified',
    };
  }

  const amountCents = cents(verification.expectedTotal);
  const quotedCents = cents(quoted);
  if (!withinAcceptance(quotedCents, amountCents)) return { ok: false, reason: 'price_mismatch' };
  const reference = await facilityReference(fields, amountCents);
  return {
    ok: true,
    amountCents,
    quotedCents,
    reference,
    serviceType:
      fields.service_type ?? (fields.engine_type === 'church' ? 'church_cleaning' : 'commercial_cleaning'),
    priceChanged: needsExplicitAcceptance(quotedCents, amountCents),
  };
}

async function verifyResidentialPayment(
  fields: Record<string, string>,
  env: Env,
): Promise<CandidateResult> {
  const quoted = Number(fields.quoted_price);
  if (!Number.isFinite(quoted) || quoted <= 0) return { ok: false, reason: 'quote_missing' };

  const verification = await verifyReservationQuote(fields, env);
  if (verification.configMatch === 'mismatch') return { ok: false, reason: 'quote_stale' };
  if (verification.verifiedPrice === null) return { ok: false, reason: 'quote_not_verified' };
  if (verification.status === 'mismatch' || verification.status === 'unverifiable') {
    return { ok: false, reason: verification.status };
  }
  if (verification.initialDeepClean.required && !verification.initialDeepClean.acknowledged) {
    return { ok: false, reason: 'initial_deep_clean_required' };
  }

  // A verified payment requires a real route to a precise, confirmed address.
  // A preliminary quote (ZIP centroid, approximate pin, moved/unknown pin, or
  // missing route duration) remains reservation-only.
  const structurallyVerified =
    verification.travel.verified &&
    verification.travel.destinationSource === 'address_geocode' &&
    verification.pinCheck === 'ok' &&
    verification.configMatch === 'match';
  if (!structurallyVerified) return { ok: false, reason: 'quote_not_verified' };

  const amountCents = cents(verification.verifiedPrice);
  const quotedCents = cents(quoted);
  if (!withinAcceptance(quotedCents, amountCents)) return { ok: false, reason: 'price_mismatch' };
  return {
    ok: true,
    amountCents,
    quotedCents,
    reference: await residentialReference(verification, fields, amountCents),
    serviceType: fields.service_type ?? 'standard',
    priceChanged: needsExplicitAcceptance(quotedCents, amountCents),
  };
}

function successUrl(env: Env, sessionId: string): string {
  return `${siteOrigin(env)}/estimate/payment-success/?session_id=${encodeURIComponent(sessionId)}`;
}

async function existingCheckoutResponse(
  env: Env,
  bucket: LedgerBucket,
  key: string,
  record: CheckoutRecord,
): Promise<Response | null> {
  if (record.status === 'creating') {
    const age = Date.now() - Date.parse(record.createdAt);
    if (Number.isFinite(age) && age < CHECKOUT_CLAIM_STALE_MS) {
      return json({ ok: false, error: 'checkout_in_progress' }, 409);
    }
    await deleteLedgerKey(bucket, key);
    return null;
  }
  if (record.status === 'failed') {
    await deleteLedgerKey(bucket, key);
    return null;
  }
  if (!record.sessionId) return null;

  const session = await stripeSession(env, record.sessionId);
  if (!session) return json({ ok: false, error: 'stripe_unavailable' }, 503);
  if (session.status === 'open' && (record.sessionUrl || session.url)) {
    return json({ ok: true, url: record.sessionUrl ?? session.url });
  }
  if (session.status === 'complete') {
    if (record.status !== 'completed') {
      await writeLedgerJson(bucket, key, {
        ...record,
        status: 'completed',
        updatedAt: new Date().toISOString(),
      }).catch(() => undefined);
    }
    return json({ ok: true, url: successUrl(env, record.sessionId) });
  }
  if (session.status === 'expired') {
    await deleteLedgerKey(bucket, key);
    return null;
  }
  return json({ ok: false, error: 'stripe_unavailable' }, 503);
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (throttled(request)) return json({ ok: false, error: 'rate_limited' }, 429);

  let payload: {
    fields?: unknown;
    returnPath?: unknown;
    acceptRecalculated?: unknown;
    acceptedAmount?: unknown;
  };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }

  const fields = sanitizeFields(payload.fields);
  if (Object.keys(fields).length === 0) return json({ ok: false, error: 'invalid_request' }, 400);
  const returnPath =
    typeof payload.returnPath === 'string' && RETURN_PATHS.has(payload.returnPath)
      ? payload.returnPath
      : '/estimate/';

  const ready = await paymentReadiness(env);
  if (!ready.enabled) {
    console.error('[estimate-checkout] payment_not_ready', {
      mode: ready.mode,
      checks: ready.checks,
    });
    return json({ ok: false, error: 'payment_not_ready', reason: 'configuration' }, 503);
  }

  const candidate =
    fields.request_type === 'facility_estimate'
      ? await verifyFacilityPayment(fields, env)
      : await verifyResidentialPayment(fields, env);

  if (!candidate.ok) {
    return json(
      { ok: false, error: 'quote_not_payable', reason: candidate.reason },
      400,
    );
  }

  const acceptedAmount =
    typeof payload.acceptedAmount === 'number' ? payload.acceptedAmount : Number(payload.acceptedAmount);
  const explicitAcceptance =
    payload.acceptRecalculated === true &&
    Number.isFinite(acceptedAmount) &&
    cents(acceptedAmount) === candidate.amountCents;
  if (candidate.priceChanged && !explicitAcceptance) {
    return json(
      {
        ok: false,
        error: 'quote_changed',
        amount: candidate.amountCents / 100,
        quotedAmount: candidate.quotedCents / 100,
        reference: candidate.reference,
        serviceType: candidate.serviceType,
      },
      409,
    );
  }

  const email = emailFrom(fields);
  if (!email) return json({ ok: false, error: 'email_required' }, 400);
  const attemptFingerprint = await paymentHash(
    [
      candidate.reference,
      String(candidate.amountCents),
      email,
      candidate.serviceType,
      fields.quote_config_version ?? '',
      fields.preferred_date ?? '',
    ].join('|'),
  );
  const bucket = paymentLedger(env);
  if (!bucket) return json({ ok: false, error: 'payment_not_ready' }, 503);
  const key = ledgerKey('checkouts', attemptFingerprint);

  const existing = await readLedgerJson<CheckoutRecord>(bucket, key).catch(() => null);
  if (existing) {
    const response = await existingCheckoutResponse(env, bucket, key, existing.value);
    if (response) return response;
  }

  const generation = (existing?.value.generation ?? 0) + 1;
  const now = new Date().toISOString();
  const claim: CheckoutRecord = {
    version: 1,
    status: 'creating',
    generation,
    createdAt: now,
    updatedAt: now,
    reference: candidate.reference,
    amountCents: candidate.amountCents,
    serviceType: candidate.serviceType,
  };
  const claimed = await createLedgerJson(bucket, key, claim).catch((error) => {
    console.error('[estimate-checkout] ledger_claim_failed', {
      name: error instanceof Error ? error.name : 'unknown',
    });
    return false;
  });
  if (!claimed) {
    const current = await readLedgerJson<CheckoutRecord>(bucket, key).catch(() => null);
    if (current) {
      const response = await existingCheckoutResponse(env, bucket, key, current.value);
      if (response) return response;
    }
    return json({ ok: false, error: 'checkout_in_progress' }, 409);
  }

  const site = siteOrigin(env);
  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('success_url', `${site}/estimate/payment-success/?session_id={CHECKOUT_SESSION_ID}`);
  body.set(
    'cancel_url',
    `${site}/estimate/payment-canceled/?reference=${encodeURIComponent(candidate.reference)}&return=${encodeURIComponent(returnPath)}`,
  );
  body.set('payment_method_types[0]', 'card');
  body.set('line_items[0][quantity]', '1');
  body.set('line_items[0][price_data][currency]', 'usd');
  body.set('line_items[0][price_data][unit_amount]', String(candidate.amountCents));
  body.set(
    'line_items[0][price_data][product_data][name]',
    `${estimatePaymentConfig.productLabel} — ${serviceLabel(fields)}`,
  );
  body.set('line_items[0][price_data][product_data][description]', estimatePaymentConfig.checkoutNote);
  body.set('metadata[checkout_kind]', 'estimate_payment');
  body.set('metadata[quote_reference]', candidate.reference);
  body.set('metadata[service_type]', candidate.serviceType);
  body.set('metadata[checkout_attempt]', attemptFingerprint);
  body.set('customer_email', email);

  try {
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY?.trim()}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `ss-estimate-${attemptFingerprint}-${generation}`,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await response.json().catch(() => ({}))) as {
      id?: string;
      url?: string;
      error?: { code?: string; type?: string };
    };
    if (!response.ok || !data.url || !data.id) {
      console.error('[estimate-checkout] stripe_session_failed', {
        status: response.status,
        code: data.error?.code ?? 'unknown',
        type: data.error?.type ?? 'unknown',
      });
      await deleteLedgerKey(bucket, key).catch(() => undefined);
      return json({ ok: false, error: 'stripe_unavailable' }, 502);
    }
    const record: CheckoutRecord = {
      ...claim,
      status: 'open',
      sessionId: data.id,
      sessionUrl: data.url,
      updatedAt: new Date().toISOString(),
    };
    await writeLedgerJson(bucket, key, record).catch((error) => {
      console.error('[estimate-checkout] ledger_write_failed', {
        name: error instanceof Error ? error.name : 'unknown',
      });
    });
    return json({ ok: true, url: data.url });
  } catch (error) {
    await deleteLedgerKey(bucket, key).catch(() => undefined);
    console.error('[estimate-checkout] stripe_transport_failed', {
      name: error instanceof Error ? error.name : 'unknown',
    });
    return json({ ok: false, error: 'stripe_unavailable' }, 502);
  }
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session_id')?.trim() ?? '';

  if (!sessionId) {
    const ready = await paymentReadiness(env);
    return json({
      ok: true,
      enabled: ready.enabled,
      mode: ready.mode,
      checks: ready.checks,
    });
  }
  if (!env.STRIPE_SECRET_KEY?.trim()) return json({ ok: false, error: 'not_configured' }, 503);
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return json({ ok: false, error: 'invalid_request' }, 400);

  const session = await stripeSession(env, sessionId);
  if (!session) return json({ ok: false, error: 'stripe_unavailable' }, 502);
  if (session.metadata?.checkout_kind !== 'estimate_payment') {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }
  return json({
    ok: true,
    paid: session.payment_status === 'paid',
    status: session.status ?? 'unknown',
    paymentStatus: session.payment_status ?? 'unknown',
    amount: typeof session.amount_total === 'number' ? session.amount_total / 100 : null,
    reference: session.metadata?.quote_reference ?? '',
    serviceType: session.metadata?.service_type ?? '',
    livemode: session.livemode ?? null,
  });
}
