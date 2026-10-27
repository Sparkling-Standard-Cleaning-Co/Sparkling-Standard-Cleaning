// POST /api/estimate-checkout — starts a Stripe-hosted Checkout Session for
// an instant residential/STR quote or an exact Tier A facility quote.
//
// Security:
//  - The amount is ALWAYS recalculated server-side from the same shared
//    estimator configuration. A client price is only compared, never charged.
//  - Residential/STR travel is re-resolved and re-routed by the server.
//  - Facility payments require an exact Tier A total and a server route.
//  - Only Stripe-hosted Checkout is used; no card data touches this site.
//  - The request itself is delivered by /api/lead before this endpoint is
//    called. A checkout failure never discards the cleaning request.
//
// GET returns configuration status, or the payment status for a Checkout
// Session id supplied by Stripe's success URL.

import { estimatePaymentConfig } from '../../src/config/payments.ts';
import {
  verifyReservationQuote,
  resolveServerDestination,
  type QuoteVerificationEnv,
} from '../../src/lib/estimate/verify.ts';
import { verifyFacilityQuote } from '../../src/lib/estimate/facility-verify.ts';
import { parseLatLng, resolveRoute } from '../../src/lib/travel/server-routing.ts';

interface Env extends QuoteVerificationEnv {
  STRIPE_SECRET_KEY?: string;
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
const hits = new Map<string, { count: number; reset: number }>();

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
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : '';
}

function hashKey(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash.toString(36).toUpperCase().padStart(7, '0');
}

function siteOrigin(env: Env): string {
  return (env.PUBLIC_SITE_URL?.trim() || 'https://sparkling-standard.com').replace(/\/+$/, '');
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

interface VerifiedPayment {
  amount: number;
  reference: string;
  serviceType: string;
}

async function verifyFacilityPayment(
  fields: Record<string, string>,
  env: Env,
): Promise<VerifiedPayment | null> {
  const clientPrice = Number(fields.quoted_price);
  if (!Number.isFinite(clientPrice) || clientPrice <= 0) return null;

  const destination = await resolveServerDestination(fields, env).catch(() => null);
  const origin = parseLatLng(env.TRAVEL_ORIGIN);
  let oneWayMiles: number | null = null;
  if (origin && destination) {
    const route = await resolveRoute(env, origin, destination).catch(() => null);
    oneWayMiles = route?.oneWayMiles ?? null;
  }

  const verification = verifyFacilityQuote(fields, { routedOneWayMiles: oneWayMiles });
  if (
    !verification.pricingEnabled ||
    verification.expectedTotal === null ||
    verification.expectedRange !== null ||
    verification.status === 'mismatch' ||
    verification.status === 'unverifiable' ||
    verification.status === 'pricing_disabled' ||
    verification.configMatch === 'mismatch'
  ) {
    return null;
  }

  const amount = Math.round(verification.expectedTotal * 100) / 100;
  if (Math.abs(clientPrice - amount) > 0.01) return null;

  const reference =
    fields.quote_reference?.trim() ||
    `FAC-${fields.engine_type === 'church' ? 'CH' : 'CO'}-${hashKey(`${fields.organization}|${amount}|${fields.preferred_date ?? ''}`)}`;

  return {
    amount,
    reference,
    serviceType: fields.service_type ?? (fields.engine_type === 'church' ? 'church_cleaning' : 'commercial_cleaning'),
  };
}

async function verifyResidentialPayment(
  fields: Record<string, string>,
  env: Env,
): Promise<VerifiedPayment | null> {
  const verification = await verifyReservationQuote(fields, env);
  if (
    verification.verifiedPrice === null ||
    verification.clientPrice === null ||
    verification.status === 'mismatch' ||
    verification.status === 'unverifiable'
  ) {
    return null;
  }
  if (verification.initialDeepClean.required && !verification.initialDeepClean.acknowledged) {
    return null;
  }
  const amount = Math.round(verification.verifiedPrice * 100) / 100;
  if (Math.abs(verification.clientPrice - amount) > 0.01) return null;

  return {
    amount,
    reference: fields.quote_reference?.trim() || `EST-${hashKey(`${fields.service_type}|${amount}|${fields.zip ?? ''}`)}`,
    serviceType: fields.service_type ?? 'standard',
  };
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (throttled(request)) return json({ ok: false, error: 'rate_limited' }, 429);
  if (!estimatePaymentConfig.enabled) return json({ ok: false, error: 'not_enabled' }, 403);
  if (!env.STRIPE_SECRET_KEY?.trim()) return json({ ok: false, error: 'not_configured' }, 503);

  let payload: { fields?: unknown; returnPath?: unknown };
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

  let verified: VerifiedPayment | null = null;
  if (fields.request_type === 'facility_estimate') {
    verified = await verifyFacilityPayment(fields, env);
  } else {
    verified = await verifyResidentialPayment(fields, env);
  }
  if (!verified) return json({ ok: false, error: 'quote_not_payable' }, 400);

  const site = siteOrigin(env);
  const amountCents = Math.round(verified.amount * 100);
  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('success_url', `${site}/estimate/payment-success/?session_id={CHECKOUT_SESSION_ID}`);
  body.set('cancel_url', `${site}${returnPath}?canceled=1`);
  body.set('payment_method_types[0]', 'card');
  body.set('line_items[0][quantity]', '1');
  body.set('line_items[0][price_data][currency]', 'usd');
  body.set('line_items[0][price_data][unit_amount]', String(amountCents));
  body.set(
    'line_items[0][price_data][product_data][name]',
    `${estimatePaymentConfig.productLabel} — ${serviceLabel(fields)}`,
  );
  body.set('line_items[0][price_data][product_data][description]', estimatePaymentConfig.checkoutNote);
  body.set('metadata[checkout_kind]', 'estimate_payment');
  body.set('metadata[quote_reference]', verified.reference);
  body.set('metadata[service_type]', verified.serviceType);
  const email = emailFrom(fields);
  if (email) body.set('customer_email', email);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY.trim()}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  const idempotency = `estimate-${hashKey(`${verified.reference}|${amountCents}|${email}`)}`;
  headers['Idempotency-Key'] = idempotency;

  try {
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await response.json().catch(() => ({}))) as { url?: string };
    if (!response.ok || !data.url) return json({ ok: false, error: 'provider_failed' }, 502);
    return json({ ok: true, url: data.url });
  } catch {
    return json({ ok: false, error: 'provider_failed' }, 502);
  }
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session_id')?.trim() ?? '';

  if (!sessionId) {
    return json({
      ok: true,
      enabled: estimatePaymentConfig.enabled && Boolean(env.STRIPE_SECRET_KEY?.trim()),
    });
  }
  if (!env.STRIPE_SECRET_KEY?.trim()) return json({ ok: false, error: 'not_configured' }, 503);
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return json({ ok: false, error: 'invalid_request' }, 400);

  try {
    const response = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      {
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY.trim()}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    const data = (await response.json().catch(() => ({}))) as {
      payment_status?: string;
      status?: string;
      amount_total?: number;
      metadata?: Record<string, string>;
    };
    if (!response.ok) return json({ ok: false, error: 'provider_failed' }, 502);
    if (data.metadata?.checkout_kind !== 'estimate_payment') {
      return json({ ok: false, error: 'invalid_request' }, 400);
    }
    return json({
      ok: true,
      paid: data.payment_status === 'paid',
      status: data.status ?? 'unknown',
      amount: typeof data.amount_total === 'number' ? data.amount_total / 100 : null,
    });
  } catch {
    return json({ ok: false, error: 'provider_failed' }, 502);
  }
}
