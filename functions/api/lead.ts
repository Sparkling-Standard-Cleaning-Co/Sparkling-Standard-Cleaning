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
  verifyReservationQuote,
  type QuoteVerificationEnv,
} from '../../src/lib/estimate/verify.ts';
import { requiresInitialDeepClean } from '../../src/lib/estimate/frequency.ts';
import { verifyFacilityQuote, stripFacilityPricingFields } from '../../src/lib/estimate/facility-verify.ts';
import { taxPresentationForService } from '../../src/lib/estimate/tax.ts';
import type { Frequency } from '../../src/lib/estimate/types.ts';
import { buildLeadNotification } from '../../src/lib/forms/lead-notification.ts';
import { describeCustomerEmailOutcome, sendCustomerConfirmation } from '../../src/lib/forms/customer-email.ts';
import { schedulingConfig } from '../../src/config/scheduling.ts';
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

interface R2ObjectLike {
  arrayBuffer?(): Promise<ArrayBuffer>;
  body?: ReadableStream;
  size?: number;
  httpMetadata?: { contentType?: string };
}
interface R2BucketLike {
  head?(key: string): Promise<unknown | null>;
  get?(key: string): Promise<R2ObjectLike | null>;
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
  PHOTO_OWNER_TOKEN?: string;
  PHOTO_LINK_TTL_DAYS?: string;
  OWNER_NOTIFICATION_EMAIL?: string;
}

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
  'discount_label',
  'global_factor',
  'global_adjustment',
  'tax_status',
  'tax_note',
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
  'travel_verified',
  'travel_destination_source',
  'initial_deep_clean_required',
  'first_visit_total',
  'ongoing_price_per_visit',
  'ongoing_frequency',
  'photo_count',
  'photo_note',
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

  // Require at least one contact channel.
  if (!clean.phone && !clean.email) {
    return json({ ok: false, error: 'invalid_request' }, 400);
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
    const facility = verifyFacilityQuote(clean);
    if (!facility.pricingEnabled) stripFacilityPricingFields(clean);
    clean.facility_quote_verified = facility.status;
    clean.facility_config_match = facility.configMatch;
    clean.facility_travel_status = facility.travelStatus;
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
        clean.ongoing_price_per_visit = String(verification.ongoing.perVisitPrice);
        clean.ongoing_frequency = verification.ongoing.frequency;
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

  // Owner notification presentation: the flat field map becomes an ordered,
  // readable summary. The customer's email is set as the provider reply-to and
  // is also shown in the Contact section; every other collected value is
  // preserved (mapped or under "More details").
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

  // Photo leads use Resend for the owner notification because it supports real
  // attachments on the existing free plan. Web3Forms remains the lead fallback
  // whenever Resend is unavailable or rejects every attachment email.
  if (verifiedPhotos.length > 0 && attachments.length > 0) {
    if (env.RESEND_API_KEY) {
      const messages = buildOwnerEmailMessages({
        notification,
        subject,
        requestId: attachmentRequestId,
        attachments,
        ...(env.RESEND_FROM_EMAIL?.trim() ? { from: env.RESEND_FROM_EMAIL.trim() } : {}),
        ...(env.OWNER_NOTIFICATION_EMAIL?.trim() ? { to: env.OWNER_NOTIFICATION_EMAIL.trim() } : {}),
        ...(replyTo ? { replyTo } : {}),
      });
      const ownerEmail = await sendOwnerEmailMessages(messages, {
        RESEND_API_KEY: env.RESEND_API_KEY,
        ...(env.RESEND_FROM_EMAIL ? { RESEND_FROM_EMAIL: env.RESEND_FROM_EMAIL } : {}),
      });
      if (ownerEmail.status === 'accepted' || ownerEmail.status === 'partial') {
        ownerDelivered = true;
        attachmentDelivery = ownerEmail.status === 'accepted' ? 'attached' : 'partial';
        if (ownerEmail.status === 'partial') console.error(describeOwnerEmailOutcome(ownerEmail));
      } else {
        console.error(describeOwnerEmailOutcome(ownerEmail));
        notification['Photos - Attachment delivery'] =
          ownerEmail.status === 'not_configured'
            ? 'NOT CONFIGURED — email attachments were not sent. Use the private links below.'
            : 'FAILED — the email provider did not accept the attachment email(s). Use the private links below.';
      }
    } else {
      notification['Photos - Attachment delivery'] =
        'NOT CONFIGURED — RESEND_API_KEY is not set, so attachments were not sent. Use the private links below.';
    }
  } else if (verifiedPhotos.length > 0) {
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
        return json({ ok: false, error: 'provider_failed' }, 502);
      }
      ownerDelivered = true;
    } catch {
      return json({ ok: false, error: 'provider_failed' }, 502);
    }
  }

  if (!ownerDelivered) return json({ ok: false, error: 'provider_failed' }, 502);

  // The owner notification was accepted (not necessarily inbox-delivered).
  // The customer confirmation is a best-effort second path; its failure never
  // turns a successful lead into a failed submission.
  const customerEmail = await sendCustomerConfirmation(clean, env);
  if (customerEmail.status === 'failed') {
    console.error(describeCustomerEmailOutcome(customerEmail));
  }
  return json({
    ok: true,
    ...(verifiedPhotos.length > 0 ? { photoCount: verifiedPhotos.length, photoDelivery: attachmentDelivery } : {}),
    ...(clientVerification ? { verification: clientVerification } : {}),
  });
}

export async function onRequestGet(): Promise<Response> {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}