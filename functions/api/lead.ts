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
//   403 { ok: false, error: 'spam_rejected' }
//   502 { ok: false, error: 'provider_failed' }
//   503 { ok: false, error: 'not_configured' }   → client uses the fallback

import {
  isPricedReservation,
  resolveServerDestination,
  verifyReservationQuote,
  type QuoteVerificationEnv,
} from '../../src/lib/estimate/verify.ts';
import { requiresInitialDeepClean } from '../../src/lib/estimate/frequency.ts';
import { verifyFacilityQuote, stripFacilityPricingFields } from '../../src/lib/estimate/facility-verify.ts';
import { taxPresentationForService } from '../../src/lib/estimate/tax.ts';
import { calculateServiceTax } from '../../src/lib/tax/engine.ts';
import type { Frequency } from '../../src/lib/estimate/types.ts';
import { buildLeadNotification } from '../../src/lib/forms/lead-notification.ts';
import { leadNotificationEvent } from '../../src/lib/forms/lead-routing.ts';
import { buildLeadReadiness } from '../../src/lib/forms/delivery-readiness.ts';
import { customerEmailProblem, normalizeCustomerEmail } from '../../src/lib/forms/contact-email.ts';
import {
  DEFAULT_CUSTOMER_EMAIL_REPLY_TO,
  describeCustomerEmailOutcome,
  sendCustomerConfirmation,
} from '../../src/lib/forms/customer-email.ts';
import {
  DEPARTMENT_ADDRESSES,
  defaultCommunicationSettings,
  notificationRecipients,
  readCommunicationSettings,
  recordNotificationDelivery,
  sendOperationalNotification,
  type CommunicationEnv,
} from '../../src/lib/admin/communications.ts';
import { EMAIL_ROUTING } from '../../src/config/email-routing.ts';
import { schedulingConfig } from '../../src/config/scheduling.ts';
import { legalTerms } from '../../src/config/legal.ts';
import {
  normalizePhotoEntries,
  photoKeysField,
  sanitizePhotoRequestRef,
  PHOTO_MAX_FILE_BYTES,
  type PhotoCategory,
} from '../../src/lib/photos.ts';
import {
  buildOwnerEmailMessages,
  bytesToBase64,
  describeOwnerEmailOutcome,
  ownerAttachmentFilename,
  sendOwnerEmailMessages,
  type OwnerEmailAttachment,
} from '../../src/lib/forms/owner-email.ts';
import { buildPhotoViewUrl } from './photo-auth.ts';
import { createPendingBookingRequest } from '../../src/lib/booking/requests.ts';
import type { BookingHold } from '../../src/lib/booking/holds.ts';
import { paymentLedger, type LedgerBucket } from '../../src/lib/payments/ledger.ts';
import { parseLatLng, resolveRoute } from '../../src/lib/travel/server-routing.ts';
import type { D1Database } from '../../src/lib/admin/d1.ts';
import { persistLeadSubmission, updateLeadDelivery } from '../../src/lib/admin/lead-persistence.ts';
import { requestPricingConfig } from '../../src/lib/pricing/server.ts';
import { resolveServiceBranchStrict } from '../../src/lib/branches/registry.ts';
import { reverseGeocode } from '../../src/lib/location/server-geocode.ts';
import {
  PUBLIC_RATE_LIMITS,
  checkPublicRateLimit,
  clientIp,
  consumePublicRateLimit,
} from '../../src/lib/public-rate-limit.ts';

interface R2ObjectLike {
  arrayBuffer?(): Promise<ArrayBuffer>;
  text?(): Promise<string>;
  body?: ReadableStream;
  size?: number;
  httpMetadata?: { contentType?: string };
}
interface R2BucketLike {
  head?(key: string): Promise<unknown | null>;
  get?(key: string): Promise<R2ObjectLike | null>;
  put?(key: string, value: string): Promise<unknown>;
}
interface Env extends QuoteVerificationEnv {
  WEB3FORMS_ACCESS_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  WEB3FORMS_ENDPOINT?: string;
  // Customer confirmation email (Resend). Server-side only; never public.
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  RESEND_REPLY_TO?: string;
  // Customer photo storage (Smart Estimate directive, Part 2). The R2 bucket
  // binding and the owner viewing token exist only in the function env.
  PHOTOS_BUCKET?: R2BucketLike;
  PAYMENT_LEDGER?: LedgerBucket;
  PHOTO_OWNER_TOKEN?: string;
  PHOTO_LINK_TTL_DAYS?: string;
  OWNER_NOTIFICATION_EMAIL?: string;
  DB?: D1Database;
}

// The estimator sends structured scope + quote + attribution fields; the cap
// stays bounded (a hard server-side limit) while fitting the full request.
const MAX_FIELDS = 80;
const MAX_VALUE_LENGTH = 2000;
const MAX_SUBJECT_LENGTH = 200;
const SAFE_KEY = /^[a-z0-9_]{1,40}$/i;

/** Fields the server owns; any client-supplied copy is discarded. */
const SERVER_OWNED_KEYS = new Set([
  'gift_code',
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
  'discount_label',
  'global_factor',
  'global_adjustment',
  'tax_status',
  'tax_note',
  'tax_category',
  'tax_jurisdiction',
  'tax_jurisdiction_label',
  'tax_rate',
  'tax_amount',
  'tax_source',
  'tax_review_reason',
  'taxable_subtotal',
  'total_due',
  'tax_effective_from',
  'tax_effective_through',
  'promotion_source',
  'rounding_adjustment',
  'facility_quote_verified',
  'facility_config_match',
  'facility_travel_status',
  'verified_cleaning_price',
  'verified_labor_hours',
  'verified_church_discount',
  'proposed_total',
  'estimated_labor_hours',
  'applied_rate_per_labor_hour',
  'pricing_category',
  'minimum_job_applied',
  'travel_method',
  'travel_provider',
  'travel_distance_miles',
  'travel_duration_minutes',
  'travel_one_way_miles',
  'travel_verified',
  'travel_qualification',
  'travel_destination_source',
  'initial_deep_clean_required',
  'first_visit_total',
  'ongoing_regular_price_per_visit',
  'ongoing_price_per_visit',
  'ongoing_frequency',
  'ongoing_discount_label',
  'ongoing_discount_amount',
  'photo_count',
  'photo_note',
  'photos_outstanding',
  'photo_storage',
  'booking_hold_status',
  'preferred_slot_start',
  'preferred_slot_end',
  'terms_accepted_at',
  'policy_version',
  'terms_acceptance_id',
  'terms_record_status',
  'booking_request_id',
  'booking_request_status',
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
    parsed <= now + (schedulingConfig.advanceReservationDays + 1) * oneDayMs;
  if (!valid) {
    delete fields.preferred_date;
    fields.preferred_date_note =
      'submitted preferred date was invalid or out of range (beyond the 60-day scheduling window) and was discarded';
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/**
 * Persist the server-verified acceptance in the private customer bucket. The
 * owner email still carries the same identifiers, but a durable record lets us
 * prove which terms version was accepted even after delivery is gone.
 */
async function recordTermsAcceptance(
  env: Env,
  fields: Record<string, string>,
  acceptedAt: string,
  acceptanceId: string,
): Promise<'durable' | 'email_record_only' | 'storage_failed'> {
  if (!env.PHOTOS_BUCKET?.put) return 'email_record_only';
  const day = acceptedAt.slice(0, 10);
  const key = `legal/acceptances/${day}/${acceptanceId}.json`;
  const record = {
    acceptanceId,
    acceptedAt,
    termsVersion: fields.terms_version,
    policyVersion: fields.policy_version,
    requestType: fields.request_type ?? '',
    quoteReference: fields.quote_reference ?? '',
    email: fields.email ?? '',
    serviceType: fields.service_type ?? '',
  };
  try {
    await env.PHOTOS_BUCKET.put(key, JSON.stringify(record));
    return 'durable';
  } catch {
    return 'storage_failed';
  }
}

/**
 * Server-owned service-location tax. The browser never supplies a rate or a
 * tax amount that survives: this recomputes from the confirmed service
 * address and the verified cleaning total.
 */
function applyServiceTax(
  clean: Record<string, string>,
  taxableBase: number | null,
  jurisdiction: { state?: string | null; zip?: string | null } = {},
): void {
  if (taxableBase === null || !Number.isFinite(taxableBase)) {
    clean.tax_status = 'review_required';
    clean.tax_review_reason = 'quote_unpriced';
    clean.tax_note =
      'Tax is confirmed with the final quote for the confirmed service address.';
    return;
  }
  const tax = calculateServiceTax({
    serviceType: clean.service_type ?? '',
    state: jurisdiction.state ?? null,
    zip: jurisdiction.zip ?? null,
    taxableBase,
  });
  clean.tax_status = tax.treatment;
  clean.tax_category = tax.category;
  clean.tax_note = tax.note;
  if (tax.jurisdictionKey) clean.tax_jurisdiction = tax.jurisdictionKey;
  if (tax.jurisdictionLabel) clean.tax_jurisdiction_label = tax.jurisdictionLabel;
  if (tax.ratePercent !== null) clean.tax_rate = String(tax.ratePercent);
  if (tax.taxAmount !== null) clean.tax_amount = tax.taxAmount.toFixed(2);
  if (tax.total !== null) clean.total_due = tax.total.toFixed(2);
  if (tax.source) clean.tax_source = tax.source;
  if (tax.reviewReason) clean.tax_review_reason = tax.reviewReason;
  if (tax.effectiveFrom) clean.tax_effective_from = tax.effectiveFrom;
  if (tax.effectiveThrough) clean.tax_effective_through = tax.effectiveThrough;
  if (tax.taxableBase >= 0) clean.taxable_subtotal = tax.taxableBase.toFixed(2);
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
  const pricingConfig = await requestPricingConfig(env.DB);
  const ip = clientIp(request);
  const ipStatus = await checkPublicRateLimit(env.DB, 'lead', ip, PUBLIC_RATE_LIMITS.leadIp);
  if (ipStatus.limited) {
    return json({ ok: false, error: 'rate_limited', retryAfterSeconds: ipStatus.retryAfterSeconds }, 429);
  }
  await consumePublicRateLimit(env.DB, 'lead', ip, PUBLIC_RATE_LIMITS.leadIp);

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

  // Honeypot: a hidden off-screen trap field no human sees or fills. Bots fill
  // it and are rejected with the distinct spam error. The field name avoids
  // autofill heuristics (no "company"/"website"/"url") and the client never
  // sends it; a browser autofilling a normal field can no longer cost a real
  // customer their submission.
  if (clean.extra_ref) return json({ ok: false, error: 'spam_rejected' }, 403);

  // Owner decision: a valid customer email is mandatory on every submission,
  // including contact messages and reservations. Phone-only is no longer a
  // submission path; a syntactically valid email is not proof of ownership.
  const emailProblem = customerEmailProblem(clean.email);
  if (emailProblem) return json({ ok: false, error: emailProblem }, 400);
  clean.email = normalizeCustomerEmail(clean.email);
  const emailStatus = await checkPublicRateLimit(
    env.DB,
    'lead-email',
    clean.email,
    PUBLIC_RATE_LIMITS.leadEmail,
  );
  if (emailStatus.limited) {
    return json({ ok: false, error: 'rate_limited', retryAfterSeconds: emailStatus.retryAfterSeconds }, 429);
  }
  await consumePublicRateLimit(env.DB, 'lead-email', clean.email, PUBLIC_RATE_LIMITS.leadEmail);

  // Owner requirement: a cleaning request or reservation must carry a
  // server-verified acceptance of the current terms and applicable policies.
  // Contact-form messages are not transactional and are exempt.
  const transactionalRequest = new Set([
    'reservation_request',
    'residential_estimate',
    'facility_estimate',
  ]).has(clean.request_type ?? '');
  let branchZip = (clean.zip ?? '').trim();
  if (!/^\d{5}$/.test(branchZip)) {
    const lat = Number(clean.pin_latitude);
    const lng = Number(clean.pin_longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const reverse = await reverseGeocode(env, lat, lng).catch(() => null);
      branchZip = reverse?.zip?.trim() ?? '';
    }
  }
  const resolution = await resolveServiceBranchStrict(env.DB ?? null, {
    requestedBranchId: clean.branch_id ?? null,
    zip: branchZip || null,
    state: branchZip ? null : clean.address_state ?? null,
  });
  let branch = resolution.branch;
  if (!branch && resolution.reason === 'location_missing' && !transactionalRequest) {
    // Legacy contact messages without an address keep the Pensacola inbox.
    // Transactional requests must carry a resolvable service location.
    branch = (
      await resolveServiceBranchStrict(env.DB ?? null, {
        requestedBranchId: 'branch_pensacola',
      })
    ).branch;
  }
  if (!branch) {
    return json(
      {
        ok: false,
        error: 'service_area_inquiry_required',
        reason: resolution.reason,
        message:
          'This address is outside the current online service area. Please request a personal service-area review and we will confirm whether we can help.',
      },
      409,
    );
  }
  clean.branch_id = branch.id;
  if (transactionalRequest && !branch.bookable) {
    return json(
      {
        ok: false,
        error: 'branch_not_available',
        message:
          'Online booking for this service area is not active yet. Please request a personal service-area review.',
      },
      409,
    );
  }
  if (!transactionalRequest && !branch.capabilities.inquiries) {
    return json({ ok: false, error: 'branch_inquiries_unavailable' }, 409);
  }
  const commercialInquiry = ['commercial_account', 'church_facility', 'property_management', 'str_opportunity', 'realtor_partner'].includes(clean.inquiry_type ?? '');
  if (commercialInquiry && !branch.capabilities.commercialLeads) {
    return json({ ok: false, error: 'branch_commercial_inquiries_unavailable' }, 409);
  }
  if (transactionalRequest) {
    if (clean.terms_accepted !== 'yes') {
      return json({ ok: false, error: 'terms_required' }, 400);
    }
    if (clean.terms_version !== legalTerms.termsVersion) {
      return json({ ok: false, error: 'terms_outdated' }, 400);
    }
    clean.terms_version = legalTerms.termsVersion;
    clean.policy_version = legalTerms.policyVersion;
    clean.terms_accepted_at = new Date().toISOString();
    clean.terms_acceptance_id = crypto.randomUUID();
    const recordStatus = await recordTermsAcceptance(
      env,
      clean,
      clean.terms_accepted_at,
      clean.terms_acceptance_id,
    );
    if (recordStatus === 'storage_failed') {
      return json({ ok: false, error: 'acceptance_storage_failed' }, 503);
    }
    clean.terms_record_status = recordStatus;
  }

  // Sales-tax presentation: server-derived from the service type, never from
  // a client amount. No rate is invented; the final invoice confirms any tax.
  if (clean.service_type) {
    const tax = taxPresentationForService(clean.service_type);
    clean.tax_status = tax.treatment;
    clean.tax_note = tax.note;
  }

  // Owner policy (2026-10-19): a new recurring residential maintenance
  // arrangement must begin with a Deep Cleaning. The server derives the policy
  // from the sanitized scope and fails closed when the customer did not
  // acknowledge it.
  if (
    requiresInitialDeepClean(
      clean.service_type ?? '',
      (clean.frequency ?? 'one_time') as Frequency,
    )
  ) {
    if (clean.initial_deep_clean_acknowledged !== 'yes') {
      return json({ ok: false, error: 'deep_clean_required' }, 400);
    }
    clean.initial_deep_clean_required = 'yes';
  }

  // Facility estimates (commercial/church): the server rebuilds the workload
  // and cleaning price from the submitted scope facts. The browser price is
  // never trusted; a mismatch is flagged for owner review rather than rejected.
  // When the owner switch is off, every client-supplied price field is removed
  // and the request is recorded as a scope review only.
  if (clean.request_type === 'facility_estimate') {
    // Do not trust the client's travel fields. Re-resolve and re-route the
    // facility destination server-side; the verified flag is only true for an
    // exact geocoded address with a live route and a real driving duration.
    const facilityDestination = await resolveServerDestination(clean, env).catch(() => null);
    const facilityOrigin = parseLatLng(env.TRAVEL_ORIGIN);
    const facilityRoute =
      facilityOrigin && facilityDestination
        ? await resolveRoute(env, facilityOrigin, facilityDestination).catch(() => null)
        : null;
    const facilityTravelVerified =
      Boolean(facilityDestination && facilityDestination.source === 'address_geocode') &&
      facilityRoute?.verified === true &&
      typeof facilityRoute.durationMinutes === 'number' &&
      facilityRoute.durationMinutes > 0;
    const facility = verifyFacilityQuote(clean, {
      routedOneWayMiles: facilityRoute?.oneWayMiles ?? null,
      routedTravelVerified: facilityTravelVerified,
      pricingConfig,
    });
    if (!facility.pricingEnabled) stripFacilityPricingFields(clean);
    clean.facility_quote_verified = !facilityTravelVerified
      ? 'unverifiable'
      : facility.status === 'verified' && facility.expectedRange === null
        ? 'verified'
        : 'preliminary';
    clean.facility_config_match = facility.configMatch;
    clean.facility_travel_status = facilityTravelVerified ? facility.travelStatus : 'manual_review';
    clean.travel_method = facilityRoute?.method ?? 'none';
    clean.travel_provider = facilityRoute?.provider ?? 'none';
    clean.travel_verified = String(facilityTravelVerified);
    clean.travel_qualification = facilityTravelVerified ? 'verified_route' : 'manual_review';
    clean.travel_one_way_miles = facilityRoute ? String(Math.round(facilityRoute.oneWayMiles * 10) / 10) : '';
    if (facilityRoute) {
      clean.travel_distance_miles = String(Math.round(facilityRoute.oneWayMiles * 10) / 10);
      if (facilityRoute.durationMinutes !== null) {
        clean.travel_duration_minutes = String(Math.round(facilityRoute.durationMinutes));
      }
    }
    clean.estimate_status =
      facility.pricingEnabled && facility.expectedCleaning !== null
        ? 'estimated'
        : 'custom_confirmation_required';
    if (facility.expectedCleaning !== null) clean.verified_cleaning_price = String(facility.expectedCleaning);
    if (facility.laborHours !== null) clean.verified_labor_hours = String(facility.laborHours);
    if (facility.discountAmount !== null) clean.verified_church_discount = String(facility.discountAmount);
    if (facility.discountLabel) {
      clean.discount_label = facility.discountLabel;
      clean.discount_amount = String(facility.discountAmount ?? 0);
    }
    if (facility.globalFactor !== null && facility.globalFactor !== 1) {
      clean.global_factor = String(facility.globalFactor);
      clean.global_adjustment = String(facility.globalAdjustment ?? 0);
    }
    applyServiceTax(clean, facility.expectedTotal, {
      state: facilityDestination?.state ?? null,
      zip: facilityDestination?.zip ?? null,
    });
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
      // P12: the ongoing two-price fields are SERVER-OWNED in the sanitized
      // payload, but the verification still needs the client's claimed
      // ongoing figure to compare it against the server recompute. It rides
      // in from the RAW payload here and never reaches the owner email as a
      // client-asserted value.
      const rawFields = payload.fields as Record<string, unknown>;
      const clientOngoingPrice =
        typeof rawFields.ongoing_price_per_visit === 'string'
          ? rawFields.ongoing_price_per_visit.trim().slice(0, 32)
          : '';
      const verification = await verifyReservationQuote(
        clientOngoingPrice ? { ...clean, ongoing_price_per_visit: clientOngoingPrice } : clean,
        env,
        Date.now(),
        pricingConfig,
      );
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
          clean.discount_label = breakdown.discount.label;
          clean.discount_amount = breakdown.discount.amount.toFixed(2);
          if (breakdown.discount.source) {
            clean.promotion_source = breakdown.discount.source;
          }
        } else {
          clean.addon_incentive = 'None';
        }
        if (breakdown.globalFactor !== 1) {
          clean.global_factor = breakdown.globalFactor.toFixed(2);
          clean.global_adjustment = breakdown.globalAdjustment.toFixed(2);
        }
        clean.rounding_adjustment = breakdown.roundingAdjustment.toFixed(2);
        clean.proposed_total = (breakdown.subtotal + breakdown.roundingAdjustment).toFixed(2);
        clean.estimated_labor_hours = String(breakdown.totalLaborHours);
        clean.applied_rate_per_labor_hour = String(breakdown.ratePerLaborHour);
        clean.pricing_category = breakdown.pricingCategory;
        if (breakdown.minimumApplied) clean.minimum_job_applied = 'true';
      }

      // P12: the server owns the two-price structure. When its recalculation
      // confirms a NEW recurring arrangement, the first-visit total and the
      // ongoing rhythm in the owner email are the SERVER's numbers — the
      // client's copies were already discarded (SERVER_OWNED_KEYS), and a
      // diverging client figure surfaced as a verification uncertainty above.
      if (verification.ongoing) {
        if (verification.verifiedPrice !== null) clean.first_visit_total = String(verification.verifiedPrice);
        clean.ongoing_regular_price_per_visit = String(verification.ongoing.regularPerVisitPrice);
        clean.ongoing_price_per_visit = String(verification.ongoing.perVisitPrice);
        clean.ongoing_frequency = verification.ongoing.frequency;
        const allocation = verification.ongoing.discounts.find(
          (discount) => discount.source === 'supportive',
        );
        if (allocation) {
          clean.ongoing_discount_label = allocation.label;
          clean.ongoing_discount_amount = allocation.amount.toFixed(2);
        }
      }

      const nonTaxableService = ['standard', 'deep', 'move_in_out', 'str_turnover'].includes(
        clean.service_type ?? '',
      );
      applyServiceTax(clean, verification.verifiedPrice, {
        state:
          verification.travel.destinationState ??
          (nonTaxableService ? clean.address_state ?? null : null),
        zip:
          verification.travel.destinationZip ??
          (nonTaxableService ? clean.zip ?? null : null),
      });

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

  // Customer photos: validate every submitted reference against this request's
  // server-generated prefix and confirm the object exists in private storage.
  // A browser can never invent an attachment count or point at another lead.
  const photoRequestRef = sanitizePhotoRequestRef(clean.photo_request_ref ?? '');
  const claimedPhotos = normalizePhotoEntries(clean.photo_keys ?? '', photoRequestRef);
  const verifiedPhotos: Array<{ category: PhotoCategory; key: string }> = [];
  if (claimedPhotos.length > 0) {
    if (env.PHOTOS_BUCKET?.head && env.PHOTO_OWNER_TOKEN) {
      for (const photo of claimedPhotos) {
        try {
          const object = await env.PHOTOS_BUCKET.head(photo.key);
          if (object) verifiedPhotos.push(photo);
        } catch {
          // An unreadable reference is not an attachment; continue with the rest.
        }
      }
    }
    clean.photo_keys = photoKeysField(verifiedPhotos);
    clean.photo_request_ref = photoRequestRef;
    clean.photo_count = String(verifiedPhotos.length);
    if (verifiedPhotos.length === 0) {
      clean.photo_note =
        'Photo references could not be verified in private storage. Ask the customer to re-upload if photos were intended.';
    } else if (verifiedPhotos.length < claimedPhotos.length) {
      clean.photo_note = `Only ${verifiedPhotos.length} of ${claimedPhotos.length} submitted photo(s) were verified in private storage.`;
    }
  }
  // Owner direction (2026-10-29): photos are required before booking
  // confirmation. The customer may still submit/pay and choose "confirm
  // later"; the server records that honestly. Storage availability is always
  // server-derived so an unconfigured bucket never invents an outstanding item.
  clean.photo_storage = env.PHOTOS_BUCKET ? 'available' : 'unavailable';
  clean.photo_count = String(verifiedPhotos.length);
  clean.photos_outstanding =
    env.PHOTOS_BUCKET && verifiedPhotos.length === 0 ? 'yes' : 'no';
  clean.photos_deferred =
    clean.photos_outstanding === 'yes' && clean.photos_deferred === 'yes' ? 'yes' : 'no';

  // Owner notification presentation: the flat field map becomes an ordered,
  // readable summary. The customer's email is set as the provider reply-to and
  // is also shown in the Contact section; every other collected value is
  // preserved (mapped or under "More details").
  // Optional appointment hold: the browser only supplies the opaque hold id.
  // The server reads the durable record and carries its own slot/expiry into
  // the owner notification. A forged/expired hold never becomes authoritative.
  // Use the SAME binding selection as bookingStore/paymentReadiness: a dedicated
  // PAYMENT_LEDGER wins over the photo bucket, so holds cannot be written to one
  // store and read from another.
  const holdBucket = paymentLedger({
    ...(env.PAYMENT_LEDGER ? { PAYMENT_LEDGER: env.PAYMENT_LEDGER } : {}),
    ...(env.PHOTOS_BUCKET
      ? { PHOTOS_BUCKET: env.PHOTOS_BUCKET as unknown as LedgerBucket }
      : {}),
  });
  if (!clean.booking_hold_id) {
    delete clean.booking_slot_start;
    delete clean.booking_slot_end;
    delete clean.booking_hold_expires_at;
  } else {
    const holdId = clean.booking_hold_id;
    delete clean.booking_slot_start;
    delete clean.booking_slot_end;
    delete clean.booking_hold_expires_at;
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}__[a-f0-9-]{36}$/.test(holdId)) {
      clean.booking_hold_status = 'invalid';
    } else if (!holdBucket || !holdBucket.get) {
      clean.booking_hold_status = 'unavailable';
    } else {
      const object = await holdBucket.get(`booking/holds/${holdId}.json`).catch(() => null);
      if (!object) {
        clean.booking_hold_status = 'not_found';
      } else {
        let hold: {
          status?: string;
          start?: string;
          end?: string;
          expiresAt?: string;
          reference?: string;
          crewSize?: number;
          requiredCrewSize?: number;
          staffingPending?: boolean;
        } = {};
        try {
          hold = JSON.parse((await object.text?.()) ?? '{}');
        } catch {
          hold = {};
        }
        if (hold.status !== 'held') clean.booking_hold_status = hold.status ?? 'invalid';
        else if (!hold.expiresAt || Date.parse(hold.expiresAt) <= Date.now()) {
          clean.booking_hold_status = 'expired';
        } else {
          clean.booking_hold_status = 'held';
          if (hold.start) clean.booking_slot_start = hold.start;
          if (hold.end) clean.booking_slot_end = hold.end;
          if (hold.expiresAt) clean.booking_hold_expires_at = hold.expiresAt;
          if (hold.reference) clean.booking_hold_reference = hold.reference;
          if (hold.staffingPending) {
            clean.staffing_pending = 'yes';
            clean.required_crew_size = String(hold.requiredCrewSize ?? hold.crewSize ?? 2);
            clean.staffing_reason =
              'The requested start requires more than one cleaner to finish inside the published operating window.';
          }
          if (hold.status === 'held') {
            try {
              const request = await createPendingBookingRequest(
                holdBucket,
                hold as unknown as BookingHold,
              );
              clean.booking_request_id = request.id;
              clean.booking_request_status = 'pending_owner_review';
            } catch {
              clean.booking_request_status = 'pending_request_storage_failed';
            }
          }
        }
      }
    }
  }

  let persistedLead: Awaited<ReturnType<typeof persistLeadSubmission>> = null;
  if (env.DB) {
    try {
      persistedLead = await persistLeadSubmission(env.DB, clean);
    } catch (error) {
      console.error('[lead] admin_persist_failed', {
        name: error instanceof Error ? error.name : 'unknown',
      });
      return json({ ok: false, error: 'request_storage_failed' }, 503);
    }
  }
  const notification = buildLeadNotification(clean);
  const attachmentRequestId = (clean.quote_reference || (photoRequestRef ? `PHOTO-${photoRequestRef}` : 'request')).trim();
  if (verifiedPhotos.length > 0 && env.PHOTO_OWNER_TOKEN) {
    const origin = new URL(request.url).origin;
    const ttlDays = Math.min(
      365,
      Math.max(1, Number(env.PHOTO_LINK_TTL_DAYS ?? '90') || 90),
    );
    const links: string[] = [];
    for (const photo of verifiedPhotos) {
      links.push(await buildPhotoViewUrl(origin, photo.key, env.PHOTO_OWNER_TOKEN, ttlDays * 86_400));
    }
    notification['Photos - Attached'] = `${verifiedPhotos.length} private photo${verifiedPhotos.length === 1 ? '' : 's'} (metadata stripped)`;
    notification['Photos - Private owner links'] = links.join(' | ');
    notification['Photos - Note'] =
      `Links are time-limited (${ttlDays} days) and open the customer-uploaded photos privately. Do not forward outside Sparkling Standard.`;
  }

  // Read the metadata-stripped bytes from R2 for real MIME email attachments.
  // A failed read is reported, never silently treated as an attachment.
  const attachments: OwnerEmailAttachment[] = [];
  let attachmentReadFailures = 0;
  const attachmentContentTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
  };
  if (verifiedPhotos.length > 0) {
    notification['Photos - Attachment request ID'] = attachmentRequestId;
    if (env.PHOTOS_BUCKET?.get) {
      for (const [index, photo] of verifiedPhotos.entries()) {
        try {
          const object = await env.PHOTOS_BUCKET.get(photo.key);
          if (!object) {
            attachmentReadFailures += 1;
            continue;
          }
          const bytes = object.arrayBuffer
            ? new Uint8Array(await object.arrayBuffer())
            : object.body
              ? new Uint8Array(await new Response(object.body).arrayBuffer())
              : null;
          if (!bytes || bytes.byteLength === 0 || bytes.byteLength > PHOTO_MAX_FILE_BYTES) {
            attachmentReadFailures += 1;
            continue;
          }
          const extension = (photo.key.split('.').pop() ?? 'jpg').toLowerCase();
          const contentType = object.httpMetadata?.contentType?.startsWith('image/')
            ? object.httpMetadata.contentType
            : attachmentContentTypes[extension] ?? 'application/octet-stream';
          attachments.push({
            filename: ownerAttachmentFilename(attachmentRequestId, index, photo.category, photo.key),
            contentType,
            contentBase64: bytesToBase64(bytes),
            rawBytes: bytes.byteLength,
          });
        } catch {
          attachmentReadFailures += 1;
        }
      }
    } else {
      attachmentReadFailures = verifiedPhotos.length;
    }
    if (attachments.length > 0) {
      notification['Photos - Attached files'] = attachments.map((attachment) => attachment.filename).join(', ');
    }
    if (attachmentReadFailures > 0) {
      notification['Photos - Attachment note'] =
        `Only ${attachments.length} of ${verifiedPhotos.length} verified photo(s) could be read for email attachment. Use the private links for every photo.`;
    }
  }
  const replyTo = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email ?? '') ? clean.email : undefined;
  let ownerDelivered = false;
  let attachmentDelivery: 'none' | 'attached' | 'partial' | 'links_only' =
    verifiedPhotos.length > 0 ? 'links_only' : 'none';

  // Operational routing comes from the owner-controlled Communications settings.
  // A booking/reservation reaches Bookings; a contact message reaches Customer
  // Service. The owner address is only a fail-safe when every configured inbox
  // is disabled or no database is available.
  const communicationState = env.DB
    ? await readCommunicationSettings(env.DB).catch(() => null)
    : null;
  const communicationSettings = communicationState?.settings ?? defaultCommunicationSettings();
  const notificationEvent = leadNotificationEvent({
    ...(clean.request_type ? { requestType: clean.request_type } : {}),
    ...(clean.inquiry_type ? { inquiryType: clean.inquiry_type } : {}),
  });
  let recipients = notificationRecipients(communicationSettings, notificationEvent);
  if (recipients.length === 0) {
    recipients = [
      {
        department: 'owner',
        address: env.OWNER_NOTIFICATION_EMAIL?.trim() || EMAIL_ROUTING.owner,
      },
    ];
  }

  if (env.RESEND_API_KEY) {
    let accepted = 0;
    let attempted = 0;
    let providerUnavailable = false;
    for (const recipient of recipients) {
      if (verifiedPhotos.length > 0 && attachments.length === 0) {
        await recordNotificationDelivery(env.DB ?? null, {
          eventKey: notificationEvent,
          department: recipient.department,
          recipient: recipient.address,
          status: 'failed',
          errorCode: 'attachment_unavailable',
          relatedType: 'lead',
          ...(persistedLead?.leadId ? { relatedId: persistedLead.leadId } : {}),
        }).catch(() => undefined);
        continue;
      }
      attempted += 1;
      const messages = buildOwnerEmailMessages({
        notification,
        subject,
        requestId: attachmentRequestId,
        attachments,
        ...(env.RESEND_FROM_EMAIL?.trim() ? { from: env.RESEND_FROM_EMAIL.trim() } : {}),
        to: recipient.address,
        ...(replyTo ? { replyTo } : {}),
        idempotencySuffix: recipient.department,
      });
      const outcome = await sendOwnerEmailMessages(messages, {
        RESEND_API_KEY: env.RESEND_API_KEY,
        ...(env.RESEND_FROM_EMAIL ? { RESEND_FROM_EMAIL: env.RESEND_FROM_EMAIL } : {}),
      });
      const delivered = outcome.status === 'accepted' || outcome.status === 'partial';
      if (delivered) accepted += 1;
      if (outcome.status === 'not_configured') providerUnavailable = true;
      if (outcome.status === 'partial') console.error(describeOwnerEmailOutcome(outcome));
      await recordNotificationDelivery(env.DB ?? null, {
        eventKey: notificationEvent,
        department: recipient.department,
        recipient: recipient.address,
        status: delivered ? 'sent' : outcome.status === 'not_configured' ? 'suppressed' : 'failed',
        errorCode: delivered ? (outcome.status === 'partial' ? 'partial_delivery' : '') : outcome.status,
        relatedType: 'lead',
        ...(persistedLead?.leadId ? { relatedId: persistedLead.leadId } : {}),
      }).catch(() => undefined);
    }
    if (accepted > 0) {
      ownerDelivered = true;
      attachmentDelivery = verifiedPhotos.length > 0
        ? accepted === attempted
          ? 'attached'
          : 'partial'
        : 'none';
    } else {
      notification['Photos - Attachment delivery'] =
        providerUnavailable || !env.RESEND_API_KEY
          ? 'NOT CONFIGURED — department email was not sent. Use the private links below.'
          : 'FAILED — the email provider did not accept the department notification(s). Use the private links below.';
    }
  } else {
    for (const recipient of recipients) {
      await recordNotificationDelivery(env.DB ?? null, {
        eventKey: notificationEvent,
        department: recipient.department,
        recipient: recipient.address,
        status: 'suppressed',
        errorCode: 'resend_not_configured',
        relatedType: 'lead',
        ...(persistedLead?.leadId ? { relatedId: persistedLead.leadId } : {}),
      }).catch(() => undefined);
    }
    if (verifiedPhotos.length > 0) {
      notification['Photos - Attachment delivery'] =
        'NOT CONFIGURED — RESEND_API_KEY is not set, so attachments were not sent. Use the private links below.';
    }
  }
  if (verifiedPhotos.length > 0 && attachments.length === 0) {
    notification['Photos - Attachment delivery'] =
      'FAILED — no photo content could be read for attachment. Use the private links below.';
  }

  if (!ownerDelivered) {
    const endpoint = env.WEB3FORMS_ENDPOINT ?? 'https://api.web3forms.com/submit';
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          access_key: env.WEB3FORMS_ACCESS_KEY,
          subject,
          from_name: 'Sparkling Standard Website',
          ...(replyTo ? { replyto: replyTo } : {}),
          botcheck: '',
          ...notification,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { success?: boolean };
      if (!response.ok || data.success !== true) {
        await updateLeadDelivery(env.DB ?? null, persistedLead?.leadId ?? null, 'failed', 'provider_failed');
        return json({ ok: false, error: 'provider_failed' }, 502);
      }
      ownerDelivered = true;
    } catch {
      return json({ ok: false, error: 'provider_failed' }, 502);
    }
  }

  if (!ownerDelivered) {
    await updateLeadDelivery(env.DB ?? null, persistedLead?.leadId ?? null, 'failed', 'provider_failed');
    return json({ ok: false, error: 'provider_failed' }, 502);
  }
  await updateLeadDelivery(env.DB ?? null, persistedLead?.leadId ?? null, 'sent');

  // A pay-later reservation that needs an additional cleaner is operationally
  // critical even before payment. Notify the owner/admin inboxes through the
  // existing Communications routing. Pay-now reservations emit the same notice
  // when the verified payment commits the booking.
  if (clean.staffing_pending === 'yes' && clean.payment_choice !== 'pay_now') {
    const requiredCrew = clean.required_crew_size ?? '2';
    const when = [clean.preferred_date, clean.preferred_time].filter(Boolean).join(' ') || 'requested time';
    await sendOperationalNotification(env.DB ?? null, env as unknown as CommunicationEnv, {
      eventKey: 'staffing_pending',
      subject: `CRITICAL: additional cleaner required - ${clean.quote_reference || attachmentRequestId}`,
      text: [
        'A pay-later reservation request needs additional cleaning staff.',
        '',
        `Reference: ${clean.quote_reference || attachmentRequestId}`,
        `Customer: ${clean.name || 'Customer'}`,
        `Appointment: ${when}`,
        `Estimated labor: ${clean.estimated_labor_hours || clean.labor_hours || 'not provided'} person-hours`,
        `Required crew: ${requiredCrew}`,
        `Reason: ${clean.staffing_reason || 'The requested start requires more than one cleaner.'}`,
        '',
        'The requested time is saved; payment has not been taken by this website.',
        'Open Admin -> Calendar & Requests and the Job File to assign the missing crew or contact the customer with a reschedule option.',
      ].join('\n'),
      relatedType: 'lead',
      ...(persistedLead?.leadId ? { relatedId: persistedLead.leadId } : {}),
      branchId: clean.branch_id,
      idempotencyKey: `staffing-pending-request/${clean.booking_hold_id || clean.quote_reference || attachmentRequestId}`,
    }).catch(() => undefined);
  }

  // The department notification was accepted (not necessarily inbox-delivered).
  // The customer confirmation is a best-effort second path; its failure never
  // turns a successful lead into a failed submission.
  const bookingReplyTo = communicationState
    ? DEPARTMENT_ADDRESSES[communicationState.settings.replyTo.bookingConfirmations]
    : DEFAULT_CUSTOMER_EMAIL_REPLY_TO;
  const customerEmail = await sendCustomerConfirmation(clean, {
    ...env,
    ...(bookingReplyTo ? { RESEND_REPLY_TO: bookingReplyTo } : {}),
  });
  if (customerEmail.status === 'failed') {
    console.error(describeCustomerEmailOutcome(customerEmail));
  }
  return json({
    ok: true,
    ...(verifiedPhotos.length > 0 ? { photoCount: verifiedPhotos.length, photoDelivery: attachmentDelivery } : {}),
    ...(clientVerification ? { verification: clientVerification } : {}),
  });
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const readiness = buildLeadReadiness({
    owner_email: Boolean(context.env.WEB3FORMS_ACCESS_KEY?.trim()),
    database: Boolean(context.env.DB),
    customer_email: Boolean(context.env.RESEND_API_KEY?.trim()),
    turnstile: Boolean(context.env.TURNSTILE_SECRET_KEY?.trim()),
    photo_storage: Boolean(context.env.PHOTOS_BUCKET),
  });
  return new Response(JSON.stringify(readiness), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}