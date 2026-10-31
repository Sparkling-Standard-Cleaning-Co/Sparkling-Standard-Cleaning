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
  isConfirmedPropertyPin,
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
import { legalTerms } from '../../src/config/legal.ts';
import { customerEmailProblem, normalizeCustomerEmail } from '../../src/lib/forms/contact-email.ts';
import { calculateServiceTax, type ServiceTaxResult } from '../../src/lib/tax/engine.ts';
import type { ReceiptData, ReceiptLine } from '../../src/lib/payments/receipt.ts';
import {
  commitGiftReservation,
  giftBucket,
  lookupGiftCertificate,
  releaseGiftReservation,
  remainingCents,
  reserveGiftCredit,
} from '../../src/lib/gift/ledger.ts';
import { isGiftActive } from '../../src/lib/gift/activation.ts';
import { sendCustomerReceipt } from '../../src/lib/forms/customer-receipt.ts';
import {
  normalizePhotoEntries,
  photoKeyBelongsToRequest,
  sanitizePhotoRequestRef,
} from '../../src/lib/photos.ts';
import { bookingStore, getBookingHold, holdIsActive } from '../../src/lib/booking/holds.ts';

interface Env extends QuoteVerificationEnv, PaymentStorageEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  WEB3FORMS_ACCESS_KEY?: string;
  WEB3FORMS_ENDPOINT?: string;
  PUBLIC_SITE_URL?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  GIFT_LEDGER?: LedgerBucket;
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
  /** Tax and itemized amounts captured when the verified session was created. */
  tax?: ServiceTaxResult;
  cleaningAmountCents?: number;
  quotedTotalCents?: number;
  /** Server-owned line data for the customer receipt. */
  receipt?: {
    service: string;
    serviceLocation: string;
    customerName?: string;
    customerEmail: string;
    lines: ReceiptLine[];
    subtotalCents: number;
    taxCents: number;
    taxRatePercent: number | null;
    taxJurisdiction: string | null;
    totalCents: number;
  };
  /** Gift credit applied to this checkout, if any. */
  gift?: {
    code: string;
    reservationId: string;
    appliedCents: number;
    totalCents: number;
    paidByGift: boolean;
  };
  /** Amount the card is charged after gift credit (0 for gift-covered orders). */
  chargeAmountCents?: number;
  /** Idempotency fingerprint used to return a gift-only order result. */
  attempt?: string;
  /** Whether the customer still owes required photos before confirmation. */
  photosOutstanding?: boolean;
  /** Result of automatic confirmation for a paid, complete booking. */
  bookingStatus?: 'confirmed' | 'pending_owner_review';
  bookingEventId?: string;
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
  /** Total the customer will be charged, including verified tax. */
  amountCents: number;
  /** Server cleaning/travel amount before tax. */
  cleaningAmountCents: number;
  /** The amount the browser displayed for the cleaning portion. */
  quotedCents: number;
  /** The browser's displayed all-in total, when supplied. */
  quotedTotalCents: number | null;
  reference: string;
  serviceType: string;
  tax: ServiceTaxResult;
  receipt: {
    service: string;
    serviceLocation: string;
    customerName?: string;
    customerEmail: string;
    lines: ReceiptLine[];
    subtotalCents: number;
    taxCents: number;
    taxRatePercent: number | null;
    taxJurisdiction: string | null;
    totalCents: number;
  };
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


async function authoritativePhotosOutstanding(
  fields: Record<string, string>,
  env: Env,
): Promise<boolean> {
  const photoBucket = env.PHOTOS_BUCKET as unknown as
    | { head?: (key: string) => Promise<unknown> }
    | undefined;
  if (!photoBucket?.head) return false;
  const requestRef = sanitizePhotoRequestRef(fields.photo_request_ref ?? '');
  const claimed = normalizePhotoEntries(fields.photo_keys ?? '', requestRef);
  if (claimed.length === 0) return true;
  for (const photo of claimed) {
    if (!photoKeyBelongsToRequest(photo.key, requestRef)) continue;
    try {
      if (await photoBucket.head(photo.key)) return false;
    } catch {
      // Treat a failed head as unverified, never as proof of a photo.
    }
  }
  return true;
}

async function expireCheckoutSession(env: Env, sessionId: string): Promise<void> {
  if (!env.STRIPE_SECRET_KEY?.trim() || !sessionId) return;
  await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY.trim()}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}
async function authoritativeHoldId(
  fields: Record<string, string>,
  env: Env,
): Promise<{ ok: true; holdId: string } | { ok: false; error: string }> {
  const holdId = (fields.booking_hold_id ?? '').trim();
  if (!holdId) return { ok: true, holdId: '' };
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}__[a-f0-9-]{36}$/.test(holdId)) {
    return { ok: false, error: 'booking_hold_invalid' };
  }
  const store = bookingStore(env);
  if (!store) return { ok: false, error: 'booking_hold_unavailable' };
  const hold = await getBookingHold(store, holdId).catch(() => null);
  if (!hold || !holdIsActive(hold)) return { ok: false, error: 'booking_hold_expired' };
  if (hold.reference !== (fields.quote_reference ?? '').trim()) {
    return { ok: false, error: 'booking_hold_mismatch' };
  }
  return { ok: true, holdId };
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

async function notifyOwnerGiftOrder(
  env: Env,
  subject: string,
  fields: Record<string, string>,
): Promise<boolean> {
  if (!env.WEB3FORMS_ACCESS_KEY) return false;
  try {
    const response = await fetch(env.WEB3FORMS_ENDPOINT ?? 'https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        access_key: env.WEB3FORMS_ACCESS_KEY,
        subject,
        from_name: 'Sparkling Standard Website',
        botcheck: '',
        ...fields,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await response.json().catch(() => ({}))) as { success?: boolean };
    return response.ok && data.success === true;
  } catch {
    return false;
  }
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

function receiptLocation(fields: Record<string, string>): string {
  return [fields.service_address, fields.address_city, fields.address_state, fields.zip]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

function sumLines(lines: ReceiptLine[]): number {
  return lines.reduce((sum, line) => sum + line.amountCents, 0);
}

function reconcileReceiptLines(lines: ReceiptLine[], expectedCents: number): ReceiptLine[] {
  const difference = expectedCents - sumLines(lines);
  if (difference === 0) return lines;
  return [
    ...lines,
    {
      label: 'Adjustment',
      amountCents: difference,
      kind: difference < 0 ? 'discount' : 'charge',
    },
  ];
}

function residentialReceiptLines(
  verification: QuoteVerification,
  service: string,
  totalCents: number,
): ReceiptLine[] {
  const breakdown = verification.breakdown;
  if (!breakdown) {
    return [{ label: `Cleaning service — ${service}`, amountCents: totalCents, kind: 'charge' }];
  }
  const lines: ReceiptLine[] = [
    {
      label: `Cleaning service — ${service}`,
      amountCents: cents(breakdown.basePrice) + cents(breakdown.roundingAdjustment),
      kind: 'charge',
    },
  ];
  for (const extra of breakdown.selectedExtras) {
    lines.push({ label: extra.label, amountCents: cents(extra.charge), kind: 'charge' });
  }
  if (breakdown.discount && breakdown.discount.amount > 0) {
    lines.push({
      label: breakdown.discount.label,
      amountCents: -cents(breakdown.discount.amount),
      kind: 'discount',
    });
  }
  if (breakdown.travelAdjustment > 0) {
    lines.push({
      label: 'Travel adjustment',
      amountCents: cents(breakdown.travelAdjustment),
      kind: 'travel',
    });
  }
  if (breakdown.globalFactor !== 1 && breakdown.globalAdjustment !== 0) {
    lines.push({
      label: 'Estimate calibration adjustment',
      amountCents: cents(breakdown.globalAdjustment),
      kind: breakdown.globalAdjustment < 0 ? 'discount' : 'charge',
    });
  }
  return reconcileReceiptLines(lines, totalCents);
}

function facilityReceiptLines(
  verification: { expectedCleaning: number | null; discountAmount: number | null; discountLabel: string | null },
  service: string,
  totalCents: number,
): ReceiptLine[] {
  const cleaningAfterDiscount = cents(verification.expectedCleaning ?? 0);
  const discount = cents(verification.discountAmount ?? 0);
  const lines: ReceiptLine[] = [
    {
      label: `Cleaning service — ${service}`,
      amountCents: cleaningAfterDiscount + discount,
      kind: 'charge',
    },
  ];
  if (discount > 0) {
    lines.push({
      label: verification.discountLabel ?? 'Discount',
      amountCents: -discount,
      kind: 'discount',
    });
  }
  return reconcileReceiptLines(lines, totalCents);
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
  if (destination.source !== 'address_geocode') return { ok: false, reason: 'quote_not_verified' };
  const route = await resolveRoute(env, origin, destination).catch(() => null);
  if (
    !route ||
    !route.verified ||
    !Number.isFinite(route.oneWayMiles) ||
    route.oneWayMiles <= 0 ||
    route.durationMinutes === null ||
    route.durationMinutes <= 0
  ) {
    return { ok: false, reason: 'route_unavailable' };
  }

  const verification = verifyFacilityQuote(fields, {
    routedOneWayMiles: route.oneWayMiles,
    routedTravelVerified: true,
  });
  if (verification.configMatch === 'mismatch') return { ok: false, reason: 'quote_stale' };
  if (verification.status === 'mismatch') return { ok: false, reason: 'price_mismatch' };
  // Tier B is a range (expectedRange != null) and Tier C is not priced at all.
  // The customer UI hides Pay Now for both; the server must enforce the same
  // rule so a direct API call cannot buy a range/custom quote.
  if (verification.expectedRange !== null || verification.expectedTotal === null) {
    return {
      ok: false,
      reason: verification.expectedRange !== null ? 'facility_range' : 'facility_not_verified',
    };
  }
  if (verification.status !== 'verified') return { ok: false, reason: 'facility_not_verified' };

  const serviceType =
    fields.service_type ?? (fields.engine_type === 'church' ? 'church_cleaning' : 'commercial_cleaning');
  const cleaningAmountCents = cents(verification.expectedTotal);
  const quotedCents = cents(quoted);
  if (!withinAcceptance(quotedCents, cleaningAmountCents)) {
    return { ok: false, reason: 'price_mismatch' };
  }
  const tax = calculateServiceTax({
    serviceType,
    state: fields.address_state ?? null,
    zip: fields.zip ?? null,
    taxableBase: verification.expectedTotal,
  });
  if (!tax.canCharge) return { ok: false, reason: `tax_${tax.reviewReason ?? 'review_required'}` };
  const amountCents = cents((verification.expectedTotal ?? 0) + (tax.taxAmount ?? 0));
  const reference = await facilityReference(fields, amountCents);
  const quotedTotalRaw = Number(fields.quoted_total);
  const quotedTotalCents =
    Number.isFinite(quotedTotalRaw) && quotedTotalRaw > 0 ? cents(quotedTotalRaw) : null;
  return {
    ok: true,
    amountCents,
    cleaningAmountCents,
    quotedCents,
    quotedTotalCents,
    reference,
    serviceType,
    tax,
    receipt: {
      service: serviceLabel(fields),
      serviceLocation: receiptLocation(fields),
      ...(fields.name?.trim() ? { customerName: fields.name.trim() } : {}),
      customerEmail: fields.email?.trim() ?? '',
      lines: facilityReceiptLines(verification, serviceLabel(fields), cleaningAmountCents),
      subtotalCents: cleaningAmountCents,
      taxCents: cents(tax.taxAmount ?? 0),
      taxRatePercent: tax.ratePercent,
      taxJurisdiction: tax.jurisdictionLabel,
      totalCents: amountCents,
    },
    priceChanged:
      needsExplicitAcceptance(quotedCents, cleaningAmountCents) ||
      (quotedTotalCents !== null && needsExplicitAcceptance(quotedTotalCents, amountCents)),
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

  // A verified payment requires a real route to a confirmed destination. An
  // exact geocoder address or an explicitly customer-confirmed property pin
  // both qualify; a preliminary ZIP centroid or unadjusted street pin does not.
  const confirmedPropertyPin = isConfirmedPropertyPin(fields);
  const structurallyVerified =
    verification.travel.verified &&
    (verification.travel.destinationSource === 'address_geocode' ||
      (confirmedPropertyPin && verification.travel.destinationSource === 'customer_pin')) &&
    verification.travel.durationMinutes !== null &&
    (verification.travel.durationMinutes > 0 ||
      (verification.travel.durationMinutes === 0 && verification.travel.oneWayMiles === 0)) &&
    verification.pinCheck === 'ok' &&
    verification.configMatch === 'match';
  if (!structurallyVerified) return { ok: false, reason: 'quote_not_verified' };

  const serviceType = fields.service_type ?? 'standard';
  const cleaningAmountCents = cents(verification.verifiedPrice);
  const quotedCents = cents(quoted);
  if (!withinAcceptance(quotedCents, cleaningAmountCents)) {
    return { ok: false, reason: 'price_mismatch' };
  }
  const tax = calculateServiceTax({
    serviceType,
    state: fields.address_state ?? null,
    zip: fields.zip ?? null,
    taxableBase: verification.verifiedPrice,
  });
  if (!tax.canCharge) return { ok: false, reason: `tax_${tax.reviewReason ?? 'review_required'}` };
  const amountCents = cents(verification.verifiedPrice + (tax.taxAmount ?? 0));
  const quotedTotalRaw = Number(fields.quoted_total);
  const quotedTotalCents =
    Number.isFinite(quotedTotalRaw) && quotedTotalRaw > 0 ? cents(quotedTotalRaw) : null;
  return {
    ok: true,
    amountCents,
    cleaningAmountCents,
    quotedCents,
    quotedTotalCents,
    reference: await residentialReference(verification, fields, amountCents),
    serviceType,
    tax,
    receipt: {
      service: serviceLabel(fields),
      serviceLocation: receiptLocation(fields),
      ...(fields.name?.trim() ? { customerName: fields.name.trim() } : {}),
      customerEmail: fields.email?.trim() ?? '',
      lines: residentialReceiptLines(verification, serviceLabel(fields), cleaningAmountCents),
      subtotalCents: cleaningAmountCents,
      taxCents: cents(tax.taxAmount ?? 0),
      taxRatePercent: tax.ratePercent,
      taxJurisdiction: tax.jurisdictionLabel,
      totalCents: amountCents,
    },
    priceChanged:
      needsExplicitAcceptance(quotedCents, cleaningAmountCents) ||
      (quotedTotalCents !== null && needsExplicitAcceptance(quotedTotalCents, amountCents)),
  };
}

function successUrl(env: Env, sessionId: string): string {
  return `${siteOrigin(env)}/estimate/payment-success/?session_id=${encodeURIComponent(sessionId)}`;
}

async function releaseCheckoutGift(env: Env, record: CheckoutRecord): Promise<void> {
  if (!record.gift || record.gift.paidByGift) return;
  const ledger = giftBucket(env);
  if (!ledger) return;
  await releaseGiftReservation(ledger, record.gift.code, record.gift.reservationId).catch(
    () => undefined,
  );
}

async function existingCheckoutResponse(
  env: Env,
  bucket: LedgerBucket,
  key: string,
  record: CheckoutRecord,
): Promise<Response | null> {
  if (record.gift?.paidByGift && record.status === 'completed' && record.attempt) {
    return json({
      ok: true,
      giftOrder: true,
      pricePaidByGift: record.amountCents / 100,
      reference: record.reference,
      url: `${siteOrigin(env)}/estimate/payment-success/?gift_order=${encodeURIComponent(record.attempt)}`,
    });
  }
  if (record.status === 'creating') {
    const age = Date.now() - Date.parse(record.createdAt);
    if (Number.isFinite(age) && age < CHECKOUT_CLAIM_STALE_MS) {
      return json({ ok: false, error: 'checkout_in_progress' }, 409);
    }
    await releaseCheckoutGift(env, record);
    await deleteLedgerKey(bucket, key);
    return null;
  }
  if (record.status === 'failed') {
    await releaseCheckoutGift(env, record);
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
    await releaseCheckoutGift(env, record);
    await deleteLedgerKey(bucket, key);
    return null;
  }
  return json({ ok: false, error: 'stripe_unavailable' }, 503);
}

async function fulfillGiftOnlyOrder(
  env: Env,
  bucket: LedgerBucket,
  key: string,
  input: {
    record: CheckoutRecord;
    candidate: CandidateSuccess;
    giftCode: string;
    reservationId: string;
    email: string;
    attempt: string;
  },
): Promise<Response> {
  const giftLedger = giftBucket(env);
  if (!giftLedger) return json({ ok: false, error: 'gift_ledger_not_configured' }, 503);
  const paidAt = new Date().toISOString();
  const snapshot = input.record.receipt;
  const completed: CheckoutRecord = {
    ...input.record,
    status: 'completed',
    updatedAt: paidAt,
    chargeAmountCents: 0,
    attempt: input.attempt,
    gift: {
      code: input.giftCode,
      reservationId: input.reservationId,
      appliedCents: input.candidate.amountCents,
      totalCents: input.candidate.amountCents,
      paidByGift: true,
    },
  };
  try {
    await writeLedgerJson(bucket, key, completed);
  } catch (error) {
    console.error('[estimate-checkout] gift_order_write_failed', {
      name: error instanceof Error ? error.name : 'unknown',
    });
    await releaseGiftReservation(giftLedger, input.giftCode, input.reservationId).catch(
      () => undefined,
    );
    await deleteLedgerKey(bucket, key).catch(() => undefined);
    return json({ ok: false, error: 'storage_unavailable' }, 503);
  }
  const committed = await commitGiftReservation(
    giftLedger,
    input.giftCode,
    input.reservationId,
    `Gift certificate applied to cleaning ${input.candidate.reference}`,
  );
  if (!committed.ok) {
    console.error('[estimate-checkout] gift_commit_failed', { error: committed.error });
    await releaseGiftReservation(giftLedger, input.giftCode, input.reservationId).catch(
      () => undefined,
    );
    await deleteLedgerKey(bucket, key).catch(() => undefined);
    return json({ ok: false, error: 'gift_commit_failed' }, 502);
  }
  const receipt: ReceiptData | null = snapshot
    ? {
        receiptNumber: `SSR-${input.candidate.reference}`,
        reference: input.candidate.reference,
        paidAt,
        service: snapshot.service,
        ...(snapshot.serviceLocation ? { serviceLocation: snapshot.serviceLocation } : {}),
        ...(snapshot.customerName ? { customerName: snapshot.customerName } : {}),
        customerEmail: input.email,
        lines: snapshot.lines,
        subtotalCents: snapshot.subtotalCents,
        taxCents: snapshot.taxCents,
        taxRatePercent: snapshot.taxRatePercent,
        taxJurisdiction: snapshot.taxJurisdiction,
        totalCents: snapshot.totalCents,
        paidCents: snapshot.totalCents,
        balanceCents: 0,
        paymentStatus: 'paid',
        notes:
          'Paid in full with a Sparkling Standard gift certificate. This receipt is not a confirmed appointment; Sparkling Standard confirms the date and scope personally.',
      }
    : null;
  let receiptStatus = 'not_available';
  if (receipt) {
    const outcome = await sendCustomerReceipt(receipt, env, `gift-order-${input.attempt}`);
    receiptStatus = outcome.status;
  }
  const notified = await notifyOwnerGiftOrder(
    env,
    `PAID BY GIFT — ${input.candidate.reference}`,
    {
      'Payment status': 'PAID IN FULL BY GIFT CERTIFICATE',
      'Gift code': input.giftCode,
      'Amount covered by gift': `$${(input.candidate.amountCents / 100).toFixed(2)}`,
      'Quote reference': input.candidate.reference,
      Service: serviceLabel({ service_type: input.candidate.serviceType }),
      Customer: snapshot?.customerName ?? 'name unavailable',
      Email: input.email,
      'Photos outstanding': input.record.photosOutstanding ? 'yes — confirm after photos' : 'no',
      'Customer receipt': receiptStatus,
      Note:
        'The gift balance was committed. Confirm the requested date, scope and final details personally before scheduling.',
    },
  );
  if (!notified) console.error('[estimate-checkout] gift_order_owner_notification_failed');
  return json({
    ok: true,
    giftOrder: true,
    pricePaidByGift: input.candidate.amountCents / 100,
    reference: input.candidate.reference,
    url: `${siteOrigin(env)}/estimate/payment-success/?gift_order=${encodeURIComponent(input.attempt)}`,
  });
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
  if (fields.terms_accepted !== 'yes' || fields.terms_version !== legalTerms.termsVersion) {
    return json({ ok: false, error: 'terms_required' }, 400);
  }
  const returnPath =
    typeof payload.returnPath === 'string' && RETURN_PATHS.has(payload.returnPath)
      ? payload.returnPath
      : '/estimate/';

  const photosOutstanding = await authoritativePhotosOutstanding(fields, env);
  fields.photos_outstanding = photosOutstanding ? 'yes' : 'no';
  const hold = await authoritativeHoldId(fields, env);
  if (!hold.ok) return json({ ok: false, error: hold.error }, 400);
  if (hold.holdId) fields.booking_hold_id = hold.holdId;
  else delete fields.booking_hold_id;

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
        cleaningAmount: candidate.cleaningAmountCents / 100,
        tax: candidate.tax,
        reference: candidate.reference,
        serviceType: candidate.serviceType,
      },
      409,
    );
  }

  const emailProblem = customerEmailProblem(fields.email);
  if (emailProblem) return json({ ok: false, error: emailProblem }, 400);
  const email = normalizeCustomerEmail(fields.email);

  const totalCents = candidate.amountCents;
  const giftCode = (fields.gift_code ?? '').trim().toUpperCase();
  let giftAppliedCents = 0;
  let giftLedger: ReturnType<typeof giftBucket> = null;
  if (giftCode) {
    if (!/^SSGC-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(giftCode)) {
      return json({ ok: false, error: 'gift_invalid_code' }, 400);
    }
    giftLedger = giftBucket(env);
    if (!giftLedger) return json({ ok: false, error: 'gift_ledger_not_configured' }, 503);
    const giftRecord = await lookupGiftCertificate(giftLedger, giftCode);
    if (!giftRecord) return json({ ok: false, error: 'gift_not_found' }, 404);
    if (giftRecord.status !== 'active' || !isGiftActive(giftRecord)) {
      return json({ ok: false, error: 'gift_inactive' }, 409);
    }
    const available = remainingCents(giftRecord);
    if (available <= 0) return json({ ok: false, error: 'gift_no_balance' }, 409);
    const requestedRaw = Number(fields.gift_apply_amount);
    const requested = Number.isFinite(requestedRaw) && requestedRaw > 0
      ? Math.round(requestedRaw * 100)
      : available;
    giftAppliedCents = Math.min(totalCents, available, requested);
    if (giftAppliedCents <= 0) return json({ ok: false, error: 'gift_no_balance' }, 409);
  }
  let chargeAmountCents = totalCents - giftAppliedCents;
  if (chargeAmountCents > 0 && chargeAmountCents < 50) {
    giftAppliedCents = totalCents - 50;
    chargeAmountCents = 50;
  }

  const attemptFingerprint = await paymentHash(
    [
      candidate.reference,
      String(candidate.amountCents),
      email,
      candidate.serviceType,
      fields.quote_config_version ?? '',
      fields.preferred_date ?? '',
      giftCode,
      String(giftAppliedCents),
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
    cleaningAmountCents: candidate.cleaningAmountCents,
    ...(candidate.quotedTotalCents !== null ? { quotedTotalCents: candidate.quotedTotalCents } : {}),
    tax: candidate.tax,
    photosOutstanding,
    receipt: { ...candidate.receipt, customerEmail: email },
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

  let gift:
    | { code: string; reservationId: string; appliedCents: number; totalCents: number; paidByGift: boolean }
    | undefined;
  if (giftCode && giftAppliedCents > 0 && giftLedger) {
    const reserved = await reserveGiftCredit(
      giftLedger,
      giftCode,
      giftAppliedCents,
      candidate.reference,
      { ttlMinutes: 120 },
    );
    if (!reserved.ok) {
      await deleteLedgerKey(bucket, key).catch(() => undefined);
      return json({ ok: false, error: `gift_${reserved.error}` }, 409);
    }
    gift = {
      code: giftCode,
      reservationId: reserved.reservation.id,
      appliedCents: giftAppliedCents,
      totalCents,
      paidByGift: chargeAmountCents === 0,
    };
    try {
      await writeLedgerJson(bucket, key, {
        ...claim,
        chargeAmountCents,
        attempt: attemptFingerprint,
        gift,
      });
    } catch (error) {
      console.error('[estimate-checkout] gift_record_write_failed', {
        name: error instanceof Error ? error.name : 'unknown',
      });
      await releaseGiftReservation(giftLedger, giftCode, reserved.reservation.id).catch(
        () => undefined,
      );
      await deleteLedgerKey(bucket, key).catch(() => undefined);
      return json({ ok: false, error: 'storage_unavailable' }, 503);
    }
    if (chargeAmountCents === 0) {
      return fulfillGiftOnlyOrder(env, bucket, key, {
        record: { ...claim, chargeAmountCents, attempt: attemptFingerprint, gift },
        candidate,
        giftCode,
        reservationId: reserved.reservation.id,
        email,
        attempt: attemptFingerprint,
      });
    }
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
  body.set('line_items[0][price_data][unit_amount]', String(chargeAmountCents));
  body.set(
    'line_items[0][price_data][product_data][name]',
    `${estimatePaymentConfig.productLabel} — ${serviceLabel(fields)}`,
  );
  body.set('line_items[0][price_data][product_data][description]', estimatePaymentConfig.checkoutNote);
  body.set('metadata[checkout_kind]', 'estimate_payment');
  body.set('metadata[quote_reference]', candidate.reference);
  body.set('metadata[service_type]', candidate.serviceType);
  body.set('metadata[checkout_attempt]', attemptFingerprint);
  body.set('metadata[total_amount_cents]', String(totalCents));
  body.set('metadata[gift_applied_cents]', String(giftAppliedCents));
  body.set('metadata[cleaning_amount_cents]', String(candidate.cleaningAmountCents));
  body.set('metadata[tax_amount_cents]', String(cents(candidate.tax.taxAmount ?? 0)));
  body.set('metadata[tax_treatment]', candidate.tax.treatment);
  body.set('metadata[tax_rate_percent]', String(candidate.tax.ratePercent ?? ''));
  body.set('metadata[tax_jurisdiction]', candidate.tax.jurisdictionKey ?? '');
  if (fields.booking_hold_id) body.set('metadata[booking_hold_id]', fields.booking_hold_id);
  body.set('metadata[photos_outstanding]', photosOutstanding ? 'yes' : 'no');
  if (gift) body.set('expires_at', String(Math.floor(Date.now() / 1000) + 31 * 60));
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
      if (gift && giftLedger) {
        await releaseGiftReservation(giftLedger, gift.code, gift.reservationId).catch(
          () => undefined,
        );
      }
      await deleteLedgerKey(bucket, key).catch(() => undefined);
      return json({ ok: false, error: 'stripe_unavailable' }, 502);
    }
    const record: CheckoutRecord = {
      ...claim,
      status: 'open',
      chargeAmountCents,
      attempt: attemptFingerprint,
      ...(gift ? { gift } : {}),
      sessionId: data.id,
      sessionUrl: data.url,
      updatedAt: new Date().toISOString(),
    };
    let persisted = false;
    for (let attempt = 0; attempt < 3 && !persisted; attempt += 1) {
      try {
        await writeLedgerJson(bucket, key, record);
        persisted = true;
      } catch (error) {
        console.error('[estimate-checkout] ledger_write_retry', {
          attempt: attempt + 1,
          name: error instanceof Error ? error.name : 'unknown',
        });
      }
    }
    if (!persisted) {
      await expireCheckoutSession(env, data.id);
      if (gift && giftLedger) {
        await releaseGiftReservation(giftLedger, gift.code, gift.reservationId).catch(
          () => undefined,
        );
      }
      console.error('[estimate-checkout] checkout_state_uncertain', { sessionId: data.id });
      return json({ ok: false, error: 'checkout_state_uncertain' }, 502);
    }
    return json({ ok: true, url: data.url });
  } catch (error) {
    if (gift && giftLedger) {
      await releaseGiftReservation(giftLedger, gift.code, gift.reservationId).catch(
        () => undefined,
      );
    }
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
  const giftOrder = url.searchParams.get('gift_order')?.trim() ?? '';

  if (giftOrder) {
    if (!/^[a-f0-9]{64}$/i.test(giftOrder)) return json({ ok: false, error: 'invalid_request' }, 400);
    const bucket = paymentLedger(env);
    if (!bucket) return json({ ok: false, error: 'payment_not_ready' }, 503);
    const stored = await readLedgerJson<CheckoutRecord>(
      bucket,
      ledgerKey('checkouts', giftOrder.toLowerCase()),
    ).catch(() => null);
    const record = stored?.value;
    if (!record || record.status !== 'completed' || record.gift?.paidByGift !== true) {
      return json({ ok: false, error: 'gift_order_not_found' }, 404);
    }
    return json({
      ok: true,
      paid: true,
      giftOrder: true,
      amount: 0,
      giftApplied: (record.gift?.appliedCents ?? 0) / 100,
      photosOutstanding: record.photosOutstanding === true,
      reference: record.reference,
      serviceType: record.serviceType,
    });
  }

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
  const bookingBucket = paymentLedger(env);
  const bookingRecord =
    bookingBucket && session.metadata?.checkout_attempt
      ? await readLedgerJson<CheckoutRecord>(
          bookingBucket,
          ledgerKey('checkouts', session.metadata.checkout_attempt),
        ).catch(() => null)
      : null;
  return json({
    ok: true,
    paid: session.payment_status === 'paid',
    bookingStatus: bookingRecord?.value.bookingStatus ?? null,
    status: session.status ?? 'unknown',
    paymentStatus: session.payment_status ?? 'unknown',
    amount: typeof session.amount_total === 'number' ? session.amount_total / 100 : null,
    cleaningAmount:
      typeof session.metadata?.cleaning_amount_cents === 'string'
        ? Number(session.metadata.cleaning_amount_cents) / 100
        : null,
    taxAmount:
      typeof session.metadata?.tax_amount_cents === 'string'
        ? Number(session.metadata.tax_amount_cents) / 100
        : null,
    taxRatePercent:
      typeof session.metadata?.tax_rate_percent === 'string' && session.metadata.tax_rate_percent !== ''
        ? Number(session.metadata.tax_rate_percent)
        : null,
    taxJurisdiction: session.metadata?.tax_jurisdiction || null,
    photosOutstanding: session.metadata?.photos_outstanding === 'yes',
    reference: session.metadata?.quote_reference ?? '',
    serviceType: session.metadata?.service_type ?? '',
    livemode: session.livemode ?? null,
  });
}
