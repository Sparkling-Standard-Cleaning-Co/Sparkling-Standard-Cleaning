// Public, token-authorized document review and signing endpoint.
// The token is single-purpose, expiring and never grants access to any other
// customer, employee or request.
import { adminDb, type AdminDbEnv } from '../../src/lib/admin/d1.ts';
import { AdminAuthError } from '../../src/lib/admin/operations.ts';
import {
  ESIGN_CONSENT_VERSION,
  getExecutedAgreementPdf,
  getSigningRequestByToken,
  loadDocumentVariables,
  signSigningRequest,
  type DocumentSubjectContext,
  type RequirementSnapshot,
} from '../../src/lib/documents/service.ts';
import {
  normalizeSigningFieldValues,
  signingFieldsForRequest,
} from '../../src/lib/documents/signing-fields.ts';
import { findInternalContentProblems } from '../../src/lib/documents/rich-text.ts';
import {
  executedCopyKey,
  resolveSigningDownload,
} from '../../src/lib/documents/signing-download.ts';
import {
  processExecutedDocumentOutbox,
  queueExecutedDocumentEmail,
} from '../../src/lib/documents/notifications.ts';
import { autoConfirmPaidBooking } from '../../src/lib/booking/auto-confirm.ts';
import type { BookingEnv } from '../../src/lib/booking/service.ts';
import { readCheckoutIntent } from '../../src/lib/documents/checkout-intent.ts';

interface DocumentsBucket {
  get?: (key: string) => Promise<{
    body?: ReadableStream | null;
    arrayBuffer?: () => Promise<ArrayBuffer>;
    httpMetadata?: { contentType?: string };
  } | null>;
  put?: (
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ) => Promise<unknown>;
}

interface Env extends AdminDbEnv {
  DOCUMENTS_BUCKET?: DocumentsBucket;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  OWNER_NOTIFICATION_EMAIL?: string;
  PUBLIC_SITE_URL?: string;
  PAYMENT_LEDGER?: import('../../src/lib/payments/ledger.ts').LedgerBucket;
  PHOTOS_BUCKET?: import('../../src/lib/payments/ledger.ts').LedgerBucket;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string;
  GOOGLE_CALENDAR_ID?: string;
  TRAVEL_ORIGIN?: string;
  ROUTES_PROVIDER?: string;
  ROUTES_API_KEY?: string;
  GOOGLE_MAPS_SERVER_API_KEY?: string;
  MAPMAP_BASE?: string;
  EIA_API_KEY?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function sha256Bytes(value: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = new Uint8Array(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function storeExecutedPdf(
  env: Env,
  db: NonNullable<Env['DB']>,
  requestId: string,
): Promise<string | null> {
  const bucket = env.DOCUMENTS_BUCKET;
  if (!bucket?.put) return null;
  const artifact = await getExecutedAgreementPdf(db, requestId).catch(() => null);
  if (!artifact) return null;
  const defaultKey = `documents/executed/${requestId}.pdf`;
  let key = defaultKey;
  const existing = bucket.get ? await bucket.get(defaultKey).catch(() => null) : null;
  if (existing) {
    const existingBytes = existing.arrayBuffer ? await existing.arrayBuffer() : null;
    if (existingBytes && (await sha256Bytes(existingBytes)) !== artifact.sha256) {
      key = `documents/executed/${requestId}-${artifact.sha256}.pdf`;
    }
  }
  await bucket.put(key, artifact.pdf, {
    httpMetadata: { contentType: 'application/pdf' },
  });
  await db
    .prepare(
      "UPDATE document_signatures SET r2_key = ? WHERE signing_request_id = ? AND status IN ('signed','awaiting_verification','verified') AND TRIM(signed_content_text) <> ''",
    )
    .bind(key, requestId)
    .run()
    .catch(() => undefined);
  return key;
}

async function confirmPaidAfterSigning(
  env: Env,
  db: NonNullable<Env['DB']>,
  requestId: string,
): Promise<'confirmed' | 'pending' | 'not_applicable'> {
  const request = await db
    .prepare('SELECT booking_request_id, booking_reference FROM signing_requests WHERE id = ? LIMIT 1')
    .bind(requestId)
    .first<{ booking_request_id: string | null; booking_reference: string | null }>()
    .catch(() => null);
  if (!request?.booking_request_id) return 'not_applicable';
  const booking = await db
    .prepare(
      'SELECT id, hold_id, quote_reference, payment_status, payload_json FROM booking_requests WHERE id = ? LIMIT 1',
    )
    .bind(request.booking_request_id)
    .first<{
      id: string;
      hold_id: string;
      quote_reference: string;
      payment_status: string | null;
      payload_json: string;
    }>()
    .catch(() => null);
  if (!booking?.hold_id) return 'not_applicable';
  if (!String(booking.payment_status ?? '').startsWith('paid')) return 'not_applicable';
  let fields: Record<string, string> = {};
  try {
    const parsed = JSON.parse(booking.payload_json || '{}') as Record<string, unknown>;
    fields = Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === 'string'),
    ) as Record<string, string>;
  } catch {
    fields = {};
  }
  const result = await autoConfirmPaidBooking(
    env as unknown as BookingEnv,
    booking.hold_id,
    booking.quote_reference || request.booking_reference || '',
    {
      customerName: fields.name ?? '',
      customerEmail: fields.email ?? '',
      serviceCode: fields.service_type ?? 'residential-cleaning',
      frequency: fields.ongoing_frequency ?? fields.frequency ?? '',
      ongoingPriceCents: Math.round(Number(fields.ongoing_price_per_visit || 0) * 100),
      ...(Number(fields.ongoing_duration_minutes) > 0
        ? { ongoingDurationMinutes: Number(fields.ongoing_duration_minutes) }
        : {}),
      termsVersion: fields.terms_version ?? '',
    },
  ).catch(() => null);
  if (result?.ok) {
    await db
      .prepare("UPDATE booking_requests SET payment_status = 'paid_confirmed', updated_at = ? WHERE id = ? AND payment_status LIKE 'paid%'")
      .bind(new Date().toISOString(), booking.id)
      .run()
      .catch(() => undefined);
    return 'confirmed';
  }
  return 'pending';
}

function publicRequirement(
  requirement: RequirementSnapshot,
  latest: Map<string, { attempt: number; status: string }>,
  token: string,
) {
  const state = latest.get(requirement.templateId);
  const status = state?.status ?? '';
  return {
    templateId: requirement.templateId,
    title: requirement.title,
    version: requirement.version,
    contentSha256: requirement.contentSha256,
    contentText: requirement.contentText,
    sourceKind: requirement.contentText ? 'text' : 'pdf',
    signerParty: requirement.signerParty,
    required: requirement.required,
    stage: requirement.stage,
    signed: status === 'signed' || status === 'awaiting_verification' || status === 'verified',
    canResign: status === 'rejected',
    signatureStatus: status,
    downloadUrl: requirement.r2Key
      ? `/api/document-sign?token=${encodeURIComponent(token)}&download=${encodeURIComponent(requirement.templateId)}`
      : '',
  };
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  const url = new URL(context.request.url);
  const token = url.searchParams.get('token') ?? '';
  try {
    const resolved = await getSigningRequestByToken(db, token);
    if (!resolved) return json({ ok: false, error: 'signing_link_invalid' }, 404);
    const { request, requirements, signatures } = resolved;
    if (requirements.some((requirement) => findInternalContentProblems(requirement.contentText).length > 0)) {
      return json({ ok: false, error: 'document_content_internal_notice' }, 409);
    }
    const latest = new Map<string, { attempt: number; status: string }>();
    for (const row of signatures) {
      const templateId = String(row.template_id ?? '');
      const attempt = Number(row.attempt) || 1;
      const current = latest.get(templateId);
      if (!current || attempt > current.attempt) {
        latest.set(templateId, { attempt, status: String(row.status ?? '') });
      }
    }
    const signed = new Set(
      [...latest.entries()]
        .filter(([, state]) => ['signed', 'awaiting_verification', 'verified'].includes(state.status))
        .map(([templateId]) => templateId),
    );
    const allRequiredSigned = requirements
      .filter((requirement) => requirement.required)
      .every((requirement) => signed.has(requirement.templateId));
    const executedPrefix = `documents/executed/${String(request.id)}`;
    const executedRow = [...signatures].reverse().find((row) =>
      String(row.r2_key ?? '').startsWith(executedPrefix),
    );
    const executedKey = executedRow ? String(executedRow.r2_key) : executedCopyKey(String(request.id));
    const downloadId = url.searchParams.get('download') ?? '';
    if (downloadId) {
      const target = resolveSigningDownload(downloadId, String(request.id), requirements, allRequiredSigned, executedKey);
      if ('error' in target) {
        const status =
          target.error === 'signing_incomplete'
            ? 409
            : target.error === 'invalid_download'
              ? 400
              : 404;
        return json({ ok: false, error: target.error }, status);
      }
      const bucket = context.env.DOCUMENTS_BUCKET;
      if (!bucket?.get) return json({ ok: false, error: 'document_storage_not_configured' }, 503);
      const object = await bucket.get(target.key);
      if (!object) return json({ ok: false, error: 'document_not_found' }, 404);
      const body = object.body ?? (object.arrayBuffer ? await object.arrayBuffer() : null);
      if (!body) return json({ ok: false, error: 'document_unavailable' }, 503);
      return new Response(body as BodyInit, {
        headers: {
          'Content-Type': object.httpMetadata?.contentType || 'application/pdf',
          'Content-Disposition': `inline; filename="${target.filename}"`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    const executedReady = allRequiredSigned && Boolean(executedRow);
    const resumeToken = url.searchParams.get('resume') ?? '';
    let resumeCheckoutUrl = '';
    if (allRequiredSigned && resumeToken) {
      const store = context.env.PAYMENT_LEDGER ?? context.env.PHOTOS_BUCKET;
      const intent = store ? await readCheckoutIntent(store, resumeToken).catch(() => null) : null;
      if (intent?.record.signingRequestId === String(request.id)) {
        resumeCheckoutUrl = `/estimate/payment-resume/?token=${encodeURIComponent(resumeToken)}`;
      }
    }
    const documentContext: DocumentSubjectContext = {
      subjectType: request.subject_type,
      ...(request.customer_id ? { customerId: String(request.customer_id) } : {}),
      ...(request.team_member_id ? { teamMemberId: String(request.team_member_id) } : {}),
      ...(request.property_id ? { propertyId: String(request.property_id) } : {}),
      ...(request.booking_request_id ? { bookingRequestId: String(request.booking_request_id) } : {}),
      ...(request.appointment_id ? { appointmentId: String(request.appointment_id) } : {}),
      ...(request.recurring_plan_id ? { recurringPlanId: String(request.recurring_plan_id) } : {}),
      ...(request.booking_reference ? { bookingReference: String(request.booking_reference) } : {}),
      ...(request.service_code ? { serviceCode: String(request.service_code) } : {}),
    };
    let variables: Record<string, string> = {};
    try {
      variables = await loadDocumentVariables(db, documentContext);
    } catch {
      variables = {};
    }
    const fieldDefinitions = signingFieldsForRequest({
      bundleCode: request.bundle_code,
      subjectType: request.subject_type,
    });
    let customerFieldValues: Record<string, string> = {};
    try {
      const storedFields = JSON.parse(
        String((request as Record<string, unknown>).customer_fields_json ?? '{}'),
      ) as unknown;
      if (storedFields && typeof storedFields === 'object' && !Array.isArray(storedFields)) {
        customerFieldValues = Object.fromEntries(
          Object.entries(storedFields as Record<string, unknown>)
            .filter(([, value]) => typeof value === 'string')
            .map(([key, value]) => [key, String(value).slice(0, 2000)]),
        );
      }
    } catch {
      customerFieldValues = {};
    }
    return json({
      ok: true,
      request: {
        id: request.id,
        bundleCode: request.bundle_code,
        bundleName: String((request as Record<string, unknown>).packet_name ?? ''),
        bundleVersion: request.bundle_version,
        subjectType: request.subject_type,
        status: request.status,
        expiresAt: request.token_expires_at,
        instructions: String((request as Record<string, unknown>).packet_instructions ?? ''),
      },
      context: {
        customerName: variables['customer.legal_name'] ?? '',
        customerEmail: variables['customer.email'] ?? '',
        propertyAddress: variables['property.address'] ?? '',
        bookingReference: variables['booking.reference'] ?? '',
        serviceCode: variables['service.code'] ?? '',
        serviceDate: variables['service.date'] ?? '',
        arrivalWindow: variables['service.arrival_window'] ?? '',
        priceSummary: variables['price.summary'] ?? '',
        paymentTerms: variables['payment.terms'] ?? '',
      },
      customerFields: {
        definitions: fieldDefinitions,
        values: customerFieldValues,
      },
      documents: requirements.map((requirement) => publicRequirement(requirement, latest, token)),
      signedTemplateIds: [...signed],
      consentVersion: ESIGN_CONSENT_VERSION,
      ...(executedReady
        ? {
            executedDownloadUrl: `/api/document-sign?token=${encodeURIComponent(token)}&download=executed`,
          }
        : {}),
      ...(resumeCheckoutUrl ? { resumeCheckoutUrl } : {}),
    });
  } catch {
    return json({ ok: false, error: 'signing_load_failed' }, 500);
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const signatures =
      body.signatures && typeof body.signatures === 'object'
        ? (body.signatures as Record<string, { value: string; initials?: string; type?: string; imageData?: string }>)
        : {};
    const token = typeof body.token === 'string' ? body.token : '';
    const resolved = await getSigningRequestByToken(db, token);
    if (!resolved) return json({ ok: false, error: 'signing_link_invalid' }, 404);
    const fieldDefinitions = signingFieldsForRequest({
      bundleCode: resolved.request.bundle_code,
      subjectType: resolved.request.subject_type,
    });
    let customerFields: Record<string, string> | undefined;
    if (fieldDefinitions.length > 0) {
      const normalized = normalizeSigningFieldValues(fieldDefinitions, body.customerFields);
      if (normalized.errors.length > 0) {
        return json(
          {
            ok: false,
            error: 'signing_fields_invalid',
            fields: normalized.errors,
          },
          400,
        );
      }
      customerFields = normalized.values;
    }
    const result = await signSigningRequest(db, token, {
      signerName: typeof body.signerName === 'string' ? body.signerName : '',
      signerEmail: typeof body.signerEmail === 'string' ? body.signerEmail : '',
      consent: body.consent === true,
      signatures,
      ...(customerFields ? { customerFields } : {}),
      request: context.request,
    });
    if (result.status === 'signed') {
      const executedPdf = await storeExecutedPdf(context.env, db, result.requestId).catch(() => false);
      await queueExecutedDocumentEmail(db, result.requestId).catch(() => undefined);
      await processExecutedDocumentOutbox(db, context.env, {
        requestId: result.requestId,
      }).catch(() => undefined);
      const bookingStatus = await confirmPaidAfterSigning(
        context.env,
        db,
        result.requestId,
      ).catch(() => 'pending' as const);
      return json({ ok: true, ...result, executedPdf, bookingStatus });
    }
    return json({ ok: true, ...result });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'signing_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
