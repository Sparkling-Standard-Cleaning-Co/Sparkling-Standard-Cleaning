// POST /api/lead — serverless lead relay (Cloudflare Pages Functions).
//
// Responsibilities:
//  - Server-side validation and sanitization (never trust the client).
//  - Optional Cloudflare Turnstile verification when configured.
//  - Authoritative reservation quote verification: priced reservation requests
//    are recalculated server-side from the structured fields (the browser
//    price, travel cost, distance, duration and coordinates are ignored), and
//    the owner notification carries an explicit match/mismatch verdict.
//  - Forward the lead to the configured form provider using the SERVER-side
//    access key. Secrets never appear in client bundles.
//
// The static site falls back to a direct provider submission when this
// function is not deployed (local preview) — see src/lib/forms/submit.ts.
//
// Returns:
//   200 { ok: true }
//   400 { ok: false, error: 'invalid_request' | 'verification_failed' }
//   502 { ok: false, error: 'provider_failed' }
//   503 { ok: false, error: 'not_configured' }   → client uses the fallback

import {
  isPricedReservation,
  verifyReservationQuote,
  type QuoteVerificationEnv,
} from '../../src/lib/estimate/verify.ts';

interface Env extends QuoteVerificationEnv {
  WEB3FORMS_ACCESS_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  WEB3FORMS_ENDPOINT?: string;
  /** Explicit preview marker; set on a Cloudflare Pages preview environment. */
  PREVIEW_TEST_MODE?: string;
  /** The branch that serves production. Defaults to `main`. */
  PRODUCTION_BRANCH?: string;
  /** Cloudflare Pages injects the deployed branch automatically. */
  CF_PAGES_BRANCH?: string;
}

/**
 * True when this deployment is NOT the production branch. Cloudflare Pages
 * injects CF_PAGES_BRANCH on every deployment, so preview environments are
 * marked automatically without configuration; PREVIEW_TEST_MODE=true forces
 * the marker anywhere else. Every preview submission is then labeled as a
 * test in the subject and body so it can never be mistaken for a real lead.
 */
function isPreviewDeployment(env: Env): boolean {
  if (env.PREVIEW_TEST_MODE === 'true') return true;
  const branch = env.CF_PAGES_BRANCH?.trim();
  if (!branch) return false;
  return branch !== (env.PRODUCTION_BRANCH?.trim() || 'main');
}

export const PREVIEW_TEST_PREFIX = '[PREVIEW TEST — NOT A REAL BOOKING] ';
export const PREVIEW_TEST_NOTE =
  'YES — this submission came from a preview/test environment. It is NOT a real cleaning request; do not schedule it or treat it as a customer lead.';

// The estimator sends structured scope + quote + attribution fields; the cap
// stays bounded (a hard server-side limit) while fitting the full request.
const MAX_FIELDS = 60;
const MAX_VALUE_LENGTH = 2000;
const MAX_SUBJECT_LENGTH = 200;
const SAFE_KEY = /^[a-z0-9_]{1,40}$/i;

/** Fields the server owns; any client-supplied copy is discarded. */
const SERVER_OWNED_KEYS = new Set([
  'quote_verified',
  'verified_price',
  'client_price',
  'verified_range',
  'verification_note',
  'verification_path',
  'verification_status',
  'received_at',
  'server_config_version',
  'config_version_match',
  'quote_reference_valid',
  'quote_valid_through',
  'preferred_date_note',
  'pin_check',
  'pin_distance_from_geocode_meters',
  'base_price',
  'extras_subtotal',
  'extras_detail',
  'addon_incentive',
  'discount_amount',
  'rounding_adjustment',
  'proposed_total',
  'estimated_labor_hours',
  'applied_rate_per_labor_hour',
  'pricing_category',
  'minimum_job_applied',
  'travel_method',
  'travel_provider',
  'travel_distance_miles',
  'travel_duration_minutes',
  'travel_verified',
  'travel_destination_source',
  'preview_test',
  'preview_branch',
]);

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Drops a preferred date that is malformed, in the past (beyond a one-day
 * grace) or more than a year ahead, and records why. Never rejects the lead.
 */
function sanitizePreferredDate(fields: Record<string, string>): void {
  const raw = fields.preferred_date;
  if (!raw) return;
  const match = ISO_DATE.exec(raw);
  const parsed = match ? Date.parse(`${raw}T12:00:00Z`) : Number.NaN;
  const now = Date.now();
  const oneDayMs = 86_400_000;
  const valid =
    Boolean(match) &&
    Number.isFinite(parsed) &&
    parsed >= now - oneDayMs &&
    parsed <= now + 366 * oneDayMs;
  if (!valid) {
    delete fields.preferred_date;
    fields.preferred_date_note = 'submitted preferred date was invalid or out of range and was discarded';
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function verifyTurnstile(secret: string, token: string, remoteIp: string | null): Promise<boolean> {
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (remoteIp) form.append('remoteip', remoteIp);
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    });
    if (!response.ok) return false;
    const data = (await response.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

export async function onRequestPost(context: {
  request: Request;
  env: Env;
}): Promise<Response> {
  const { request, env } = context;

  let payload: { subject?: unknown; fields?: unknown; turnstileToken?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }

  const subject =
    typeof payload.subject === 'string' ? payload.subject.trim().slice(0, MAX_SUBJECT_LENGTH) : '';
  if (!subject || typeof payload.fields !== 'object' || payload.fields === null) {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }
  const previewTest = isPreviewDeployment(env);

  // Sanitize: flat string values, safe keys, bounded counts and lengths.
  // Client-supplied server-owned fields (e.g. quote_verified) are dropped here.
  const clean: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of Object.entries(payload.fields as Record<string, unknown>)) {
    if (count >= MAX_FIELDS) break;
    if (!SAFE_KEY.test(key) || SERVER_OWNED_KEYS.has(key)) continue;
    if (typeof value !== 'string') continue;
    const trimmed = value.trim().slice(0, MAX_VALUE_LENGTH);
    if (!trimmed) continue;
    clean[key] = trimmed;
    count += 1;
  }

  // Honeypot must remain empty (defense in depth — the client strips it too).
  if (clean.company_website) return json({ ok: false, error: 'invalid_request' }, 400);

  // Require at least one contact channel.
  if (!clean.phone && !clean.email) {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }

  // Turnstile verification when the secret is configured.
  if (env.TURNSTILE_SECRET_KEY) {
    const token = typeof payload.turnstileToken === 'string' ? payload.turnstileToken : '';
    if (!token) return json({ ok: false, error: 'verification_failed' }, 400);
    const remoteIp = request.headers.get('CF-Connecting-IP');
    const verified = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, token, remoteIp);
    if (!verified) return json({ ok: false, error: 'verification_failed' }, 400);
  }

  if (!env.WEB3FORMS_ACCESS_KEY) {
    // Tell the client to use its static fallback (public key) instead.
    return json({ ok: false, error: 'not_configured' }, 503);
  }

  // Sanitize the preferred date: a hostile/typo date must never reach the
  // owner as a real scheduling request. Invalid or out-of-range dates are
  // discarded with a note; the rest of the request is still delivered.
  sanitizePreferredDate(clean);

  // Server receipt timestamp — the authoritative clock for response-time
  // documentation (the one-hour response guarantee, when enabled).
  clean.received_at = new Date().toISOString();
  clean.verification_path = 'server_relay';
  clean.verification_status = 'not_priced';

  // Authoritative quote verification for priced reservation requests. The
  // customer's browser price/travel values are ignored; the server resolves
  // the destination, routes from the private origin and recalculates. A
  // verification failure never discards the request — it is marked so the
  // owner reviews it manually.
  let clientVerification: { status: string; travel_verified: boolean; travel_method: string; config_match: string } | null =
    null;
  if (isPricedReservation(clean)) {
    try {
      const verification = await verifyReservationQuote(clean, env);
      clean.verification_status = 'authoritative';
      clean.quote_verified = verification.status;
      clean.client_price = verification.clientPrice !== null ? String(verification.clientPrice) : '';
      if (verification.verifiedPrice !== null) clean.verified_price = String(verification.verifiedPrice);
      if (verification.verifiedRange) {
        clean.verified_range = `$${verification.verifiedRange.low}–$${verification.verifiedRange.high}`;
      }
      clean.server_config_version = verification.configVersion;
      clean.config_version_match = verification.configMatch;
      clean.quote_reference_valid = String(verification.referenceValid);
      clean.pin_check = verification.pinCheck;
      if (verification.pinDistanceMeters !== null) {
        clean.pin_distance_from_geocode_meters = String(verification.pinDistanceMeters);
      }
      clean.quote_valid_through = verification.validThrough;
      clean.travel_method = verification.travel.method;
      clean.travel_provider = verification.travel.provider;
      if (verification.travel.oneWayMiles !== null) {
        clean.travel_distance_miles = String(verification.travel.oneWayMiles);
      }
      if (verification.travel.durationMinutes !== null) {
        clean.travel_duration_minutes = String(verification.travel.durationMinutes);
      }
      clean.travel_verified = String(verification.travel.verified);
      clean.travel_destination_source = verification.travel.destinationSource;
      clean.verification_note = verification.note;

      // The full transparent calculator breakdown the owner needs.
      const breakdown = verification.breakdown;
      if (breakdown) {
        clean.base_price = breakdown.basePrice.toFixed(2);
        clean.extras_subtotal = breakdown.extrasSubtotal.toFixed(2);
        clean.extras_detail =
          breakdown.selectedExtras.length > 0
            ? breakdown.selectedExtras.map((extra) => `${extra.label} $${extra.charge.toFixed(2)}`).join('; ')
            : 'None';
        if (breakdown.discount) {
          clean.addon_incentive = breakdown.discount.label;
          clean.discount_amount = breakdown.discount.amount.toFixed(2);
        } else {
          clean.addon_incentive = 'None';
        }
        clean.rounding_adjustment = breakdown.roundingAdjustment.toFixed(2);
        clean.proposed_total = (breakdown.subtotal + breakdown.roundingAdjustment).toFixed(2);
        clean.estimated_labor_hours = String(breakdown.totalLaborHours);
        clean.applied_rate_per_labor_hour = String(breakdown.ratePerLaborHour);
        clean.pricing_category = breakdown.pricingCategory;
        if (breakdown.minimumApplied) clean.minimum_job_applied = 'true';
      }

      // The customer-facing receipt carries the verdict (no prices) so the
      // browser can never imply an unverified price was accepted.
      clientVerification = {
        status: verification.status,
        travel_verified: verification.travel.verified,
        travel_method: verification.travel.method,
        config_match: verification.configMatch,
      };
    } catch {
      clean.verification_status = 'authoritative_error';
      clean.quote_verified = 'unverifiable';
      clean.verification_note =
        'Server verification could not complete; review the submitted price manually before confirming anything.';
      clientVerification = {
        status: 'unverifiable',
        travel_verified: false,
        travel_method: 'none',
        config_match: 'unknown',
      };
    }
  }

  // Preview/test deployments: make the test unmistakable in BOTH the subject
  // and the body before the provider ever sees it. Production (branch main)
  // is never marked and never altered.
  if (previewTest) {
    clean.preview_test = PREVIEW_TEST_NOTE;
    clean.preview_branch = (env.CF_PAGES_BRANCH ?? env.PRODUCTION_BRANCH ?? 'unknown').slice(0, 60);
  }
  const forwardedSubject =
    previewTest && !subject.startsWith('[PREVIEW TEST')
      ? `${PREVIEW_TEST_PREFIX}${subject}`.slice(0, MAX_SUBJECT_LENGTH)
      : subject;

  const endpoint = env.WEB3FORMS_ENDPOINT ?? 'https://api.web3forms.com/submit';
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        access_key: env.WEB3FORMS_ACCESS_KEY,
        subject: forwardedSubject,
        botcheck: '',
        ...clean,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as { success?: boolean };
    if (response.ok && data.success === true) {
      return json({
        ok: true,
        ...(clientVerification ? { verification: clientVerification } : {}),
      });
    }
    return json({ ok: false, error: 'provider_failed' }, 502);
  } catch {
    return json({ ok: false, error: 'provider_failed' }, 502);
  }
}

export async function onRequestGet(): Promise<Response> {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
