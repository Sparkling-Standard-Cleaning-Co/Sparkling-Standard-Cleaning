// Public, token-authorized document review and signing endpoint.
// The token is single-purpose, expiring and never grants access to any other
// customer, employee or request.
import { adminDb, type AdminDbEnv } from '../../src/lib/admin/d1.ts';
import { AdminAuthError } from '../../src/lib/admin/operations.ts';
import {
  getExecutedAgreementPdf,
  getSigningRequestByToken,
  signSigningRequest,
  type RequirementSnapshot,
} from '../../src/lib/documents/service.ts';
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

async function storeExecutedPdf(
  env: Env,
  db: NonNullable<Env['DB']>,
  requestId: string,
): Promise<boolean> {
  const bucket = env.DOCUMENTS_BUCKET;
  if (!bucket?.put) return false;
  const artifact = await getExecutedAgreementPdf(db, requestId).catch(() => null);
  if (!artifact) return false;
  const key = `documents/executed/${requestId}.pdf`;
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
  return true;
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
      ? `/api/document-sign?token=${encodeURIComponent('__TOKEN__')}&download=${encodeURIComponent(requirement.templateId)}`
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
    const downloadId = url.searchParams.get('download') ?? '';
    if (downloadId) {
      const requirement = requirements.find((item) => item.templateId === downloadId);
      if (!requirement || !requirement.r2Key) return json({ ok: false, error: 'document_not_found' }, 404);
      const bucket = context.env.DOCUMENTS_BUCKET;
      if (!bucket?.get) return json({ ok: false, error: 'document_storage_not_configured' }, 503);
      const object = await bucket.get(requirement.r2Key);
      if (!object) return json({ ok: false, error: 'document_not_found' }, 404);
      const body = object.body ?? (object.arrayBuffer ? await object.arrayBuffer() : null);
      if (!body) return json({ ok: false, error: 'document_unavailable' }, 503);
      return new Response(body as BodyInit, {
        headers: {
          'Content-Type': object.httpMetadata?.contentType || 'application/pdf',
          'Content-Disposition': `inline; filename="${requirement.title.replace(/[^a-zA-Z0-9._-]/g, '_')}.pdf"`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    const allRequiredSigned = requirements
      .filter((requirement) => requirement.required)
      .every((requirement) => signed.has(requirement.templateId));
    const resumeToken = url.searchParams.get('resume') ?? '';
    let resumeCheckoutUrl = '';
    if (allRequiredSigned && resumeToken) {
      const store = context.env.PAYMENT_LEDGER ?? context.env.PHOTOS_BUCKET;
      const intent = store ? await readCheckoutIntent(store, resumeToken).catch(() => null) : null;
      if (intent?.record.signingRequestId === String(request.id)) {
        resumeCheckoutUrl = `/estimate/payment-resume/?token=${encodeURIComponent(resumeToken)}`;
      }
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
      documents: requirements.map((requirement) => {
        const item = publicRequirement(requirement, latest);
        item.downloadUrl = item.downloadUrl.replace('__TOKEN__', token);
        return item;
      }),
      signedTemplateIds: [...signed],
      consentVersion: '2026-11-01.esign-consent.v1',
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
    const token = typeof body.token === 'string' ? body.token : '';
    const signatures =
      body.signatures && typeof body.signatures === 'object'
        ? (body.signatures as Record<string, { value: string; initials?: string }>)
        : {};
    const result = await signSigningRequest(db, token, {
      signerName: typeof body.signerName === 'string' ? body.signerName : '',
      signerEmail: typeof body.signerEmail === 'string' ? body.signerEmail : '',
      consent: body.consent === true,
      signatures,
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
