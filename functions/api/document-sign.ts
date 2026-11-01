// Public, token-authorized document review and signing endpoint.
// The token is single-purpose, expiring and never grants access to any other
// customer, employee or request.
import { adminDb, type AdminDbEnv } from '../../src/lib/admin/d1.ts';
import { AdminAuthError } from '../../src/lib/admin/operations.ts';
import {
  getSigningRequestByToken,
  signSigningRequest,
  type RequirementSnapshot,
} from '../../src/lib/documents/service.ts';

interface DocumentsBucket {
  get?: (key: string) => Promise<{
    body?: ReadableStream | null;
    arrayBuffer?: () => Promise<ArrayBuffer>;
    httpMetadata?: { contentType?: string };
  } | null>;
}

interface Env extends AdminDbEnv {
  DOCUMENTS_BUCKET?: DocumentsBucket;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function publicRequirement(requirement: RequirementSnapshot, signed: Set<string>) {
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
    signed: signed.has(requirement.templateId),
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
    const signed = new Set(signatures.map((row) => String(row.template_id)));
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
    return json({
      ok: true,
      request: {
        id: request.id,
        bundleCode: request.bundle_code,
        bundleVersion: request.bundle_version,
        subjectType: request.subject_type,
        status: request.status,
        expiresAt: request.token_expires_at,
      },
      documents: requirements.map((requirement) => {
        const item = publicRequirement(requirement, signed);
        item.downloadUrl = item.downloadUrl.replace('__TOKEN__', token);
        return item;
      }),
      signedTemplateIds: [...signed],
      consentVersion: '2026-11-01.esign-consent.v1',
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
    return json({ ok: true, ...result });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'signing_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
