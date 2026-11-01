// Owner-controlled Documents & Agreements center.
// Policy changes are owner-only; managers may send and verify paperwork.
import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, requireActor, requireCsrf } from '../../../src/lib/admin/operations.ts';
import {
  addBundleItem,
  approveTemplate,
  createBundle,
  createSigningRequest,
  createTemplate,
  getSignatureForDownload,
  getSigningRequestDetails,
  listBundleItems,
  listBundles,
  listSigningRequests,
  listTemplates,
  removeBundleItem,
  retireTemplate,
  rotateSigningRequestToken,
  sendSigningEmail,
  updateBundle,
  verifySignature,
  type DocumentSubjectContext,
} from '../../../src/lib/documents/service.ts';

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
  PUBLIC_SITE_URL?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function text(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function ownerOnly(actor: { role: string }): void {
  if (actor.role !== 'owner') throw new AdminAuthError(403, 'owner_required');
}

function contextFrom(body: Record<string, unknown>): DocumentSubjectContext {
  const optional = (key: string, max: number): Record<string, string> => {
    const value = text(body[key], max);
    return value ? { [key]: value } : {};
  };
  return {
    subjectType: body.subjectType === 'employee' ? 'employee' : 'customer',
    serviceCode: text(body.serviceCode, 80),
    frequency: text(body.frequency, 20),
    accessAuthorization: body.accessAuthorization === true,
    customerProducts: body.customerProducts === true,
    role: text(body.role, 40),
    ...optional('customerId', 100),
    ...optional('teamMemberId', 100),
    ...optional('propertyId', 100),
    ...optional('bookingRequestId', 100),
    ...optional('appointmentId', 100),
    ...optional('recurringPlanId', 100),
    ...optional('bookingReference', 120),
    ...optional('email', 200),
  };
}

function emailEnv(env: Env): { RESEND_API_KEY?: string; RESEND_FROM_EMAIL?: string; PUBLIC_SITE_URL?: string } {
  return {
    ...(env.RESEND_API_KEY ? { RESEND_API_KEY: env.RESEND_API_KEY } : {}),
    ...(env.RESEND_FROM_EMAIL ? { RESEND_FROM_EMAIL: env.RESEND_FROM_EMAIL } : {}),
    ...(env.PUBLIC_SITE_URL ? { PUBLIC_SITE_URL: env.PUBLIC_SITE_URL } : {}),
  };
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'job.read');
    if (!['owner', 'manager'].includes(actor.role)) {
      return json({ ok: false, error: 'forbidden' }, 403);
    }
    const url = new URL(context.request.url);
    const view = url.searchParams.get('view') ?? 'templates';
    if (view === 'templates') return json({ ok: true, templates: await listTemplates(db) });
    if (view === 'bundles') return json({ ok: true, bundles: await listBundles(db) });
    if (view === 'items') {
      return json({ ok: true, items: await listBundleItems(db, url.searchParams.get('bundleId') ?? '') });
    }
    if (view === 'requests') {
      return json({
        ok: true,
        requests: await listSigningRequests(db, {
          ...(url.searchParams.get('customerId') ? { customerId: url.searchParams.get('customerId')! } : {}),
          ...(url.searchParams.get('teamMemberId') ? { teamMemberId: url.searchParams.get('teamMemberId')! } : {}),
          ...(url.searchParams.get('bookingReference')
            ? { bookingReference: url.searchParams.get('bookingReference')! }
            : {}),
        }),
      });
    }
    if (view === 'request') {
      return json({ ok: true, request: await getSigningRequestDetails(db, url.searchParams.get('id') ?? '') });
    }
    if (view === 'download') {
      const signature = await getSignatureForDownload(db, url.searchParams.get('signatureId') ?? '');
      if (!signature) return json({ ok: false, error: 'signature_not_found' }, 404);
      const key = String(signature.r2_key || signature.template_r2_key || '');
      if (key && context.env.DOCUMENTS_BUCKET?.get) {
        const object = await context.env.DOCUMENTS_BUCKET.get(key);
        if (object) {
          const body = object.body ?? (object.arrayBuffer ? await object.arrayBuffer() : null);
          if (body) {
            return new Response(body as BodyInit, {
              headers: {
                'Content-Type': object.httpMetadata?.contentType || 'application/pdf',
                'Content-Disposition': `attachment; filename="${String(signature.title ?? 'signed-document').replace(/[^a-zA-Z0-9._-]/g, '_')}.pdf"`,
                'Cache-Control': 'private, no-store',
                'X-Content-Type-Options': 'nosniff',
              },
            });
          }
        }
      }
      const content = String(signature.signed_content_text ?? '');
      if (!content) return json({ ok: false, error: 'document_unavailable' }, 404);
      return new Response(content, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="${String(signature.title ?? 'signed-document').replace(/[^a-zA-Z0-9._-]/g, '_')}.txt"`,
          'Cache-Control': 'private, no-store',
        },
      });
    }
    return json({ ok: false, error: 'invalid_view' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'documents_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request);
    if (!['owner', 'manager'].includes(actor.role)) {
      return json({ ok: false, error: 'forbidden' }, 403);
    }
    requireCsrf(context.request, actor);
    const contentType = context.request.headers.get('Content-Type') ?? '';
    const form = contentType.includes('multipart/form-data')
      ? await context.request.formData().catch(() => null)
      : null;
    const body = form
      ? Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === 'string'))
      : ((await context.request.json().catch(() => ({}))) as Record<string, unknown>);
    const action = text(body.action, 60);

    if (action === 'upload_template') {
      ownerOnly(actor);
      const file = form?.get('file');
      if (!(file instanceof File)) return json({ ok: false, error: 'document_file_required' }, 400);
      if (file.size <= 0 || file.size > 15 * 1024 * 1024) {
        return json({ ok: false, error: 'document_file_size_invalid' }, 400);
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
        return json({ ok: false, error: 'document_pdf_required' }, 400);
      }
      const bucket = context.env.DOCUMENTS_BUCKET;
      if (!bucket?.put) return json({ ok: false, error: 'document_storage_not_configured' }, 503);
      const templateId = `doc_${crypto.randomUUID()}`;
      const key = `documents/templates/${templateId}.pdf`;
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      await bucket.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' } });
      const created = await createTemplate(db, actor.id, {
        title: text(body.title, 200),
        category: text(body.category, 80),
        version: text(body.version, 40),
        sourceKind: 'pdf',
        contentSha256: hash,
        r2Key: key,
        signerParty: body.signerParty === 'employee' ? 'employee' : body.signerParty === 'both' ? 'both' : 'customer',
        requiresCountersignature: body.requiresCountersignature === 'true',
        requiresVerification: body.requiresVerification === 'true',
      });
      return json({ ok: true, ...created });
    }

    if (action === 'create_template') {
      ownerOnly(actor);
      return json({
        ok: true,
        ...(await createTemplate(db, actor.id, {
          title: text(body.title, 200),
          category: text(body.category, 80),
          version: text(body.version, 40),
          contentText: text(body.contentText, 200_000),
          signerParty: body.signerParty === 'employee' ? 'employee' : body.signerParty === 'both' ? 'both' : 'customer',
          requiresCountersignature: body.requiresCountersignature === true,
          requiresVerification: body.requiresVerification === true,
        })),
      });
    }
    if (action === 'approve_template') {
      ownerOnly(actor);
      await approveTemplate(db, actor.id, text(body.templateId, 100));
      return json({ ok: true });
    }
    if (action === 'retire_template') {
      ownerOnly(actor);
      await retireTemplate(db, actor.id, text(body.templateId, 100));
      return json({ ok: true });
    }
    if (action === 'create_bundle') {
      ownerOnly(actor);
      return json({ ok: true, ...(await createBundle(db, actor.id, body)) });
    }
    if (action === 'update_bundle') {
      ownerOnly(actor);
      await updateBundle(db, actor.id, text(body.bundleId, 100), body);
      return json({ ok: true });
    }
    if (action === 'add_item') {
      ownerOnly(actor);
      await addBundleItem(db, actor.id, body);
      return json({ ok: true });
    }
    if (action === 'remove_item') {
      ownerOnly(actor);
      await removeBundleItem(db, actor.id, text(body.bundleId, 100), text(body.templateId, 100));
      return json({ ok: true });
    }
    if (action === 'send_request') {
      const documentContext = contextFrom(body);
      const created = await createSigningRequest(db, documentContext, {
        createdByAdminUserId: actor.id,
      });
      if (!created.required || !created.token) {
        return json({ ok: true, required: false, message: 'No active required documents for this context.' });
      }
      const recipient = text(body.email, 200);
      const emailSent = recipient
        ? await sendSigningEmail(
            emailEnv(context.env),
            recipient,
            created.token,
            created.bundleCode ?? 'documents',
            `documents-${created.requestId}-${created.token.slice(0, 12)}`,
          )
        : false;
      return json({
        ok: true,
        required: true,
        requestId: created.requestId,
        token: created.token,
        expiresAt: created.expiresAt,
        bundleCode: created.bundleCode,
        emailSent,
        signingUrl: `/document-sign/?token=${encodeURIComponent(created.token)}`,
      });
    }
    if (action === 'resend_request') {
      const rotated = await rotateSigningRequestToken(db, actor.id, text(body.requestId, 100));
      const recipient = text(body.email, 200) || rotated.email;
      const emailSent = recipient
        ? await sendSigningEmail(
            emailEnv(context.env),
            recipient,
            rotated.token,
            rotated.bundleCode || 'documents',
            `documents-resend-${text(body.requestId, 100)}-${rotated.token.slice(0, 12)}`,
          )
        : false;
      return json({
        ok: true,
        token: rotated.token,
        expiresAt: rotated.expiresAt,
        emailSent,
        signingUrl: `/document-sign/?token=${encodeURIComponent(rotated.token)}`,
      });
    }
    if (action === 'verify_signature' || action === 'reject_signature') {
      await verifySignature(
        db,
        actor.id,
        text(body.signatureId, 100),
        action === 'verify_signature',
        text(body.reason, 500),
      );
      return json({ ok: true });
    }
    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'documents_update_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
