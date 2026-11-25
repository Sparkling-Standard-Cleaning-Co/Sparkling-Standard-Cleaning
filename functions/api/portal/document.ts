import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { getExecutedCopy, getSignatureForDownload } from '../../../src/lib/documents/service.ts';
import { readPortalSession } from '../../../src/lib/portal/service.ts';

interface R2Object {
  body?: ReadableStream | null;
  arrayBuffer?: () => Promise<ArrayBuffer>;
  httpMetadata?: { contentType?: string };
}

interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
}

interface Env extends AdminDbEnv {
  DOCUMENTS_BUCKET?: R2Bucket;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function safeFilename(value: unknown, fallback: string): string {
  return String(value ?? '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80) || fallback;
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const session = await readPortalSession(db, context.request);
    if (!session) return json({ ok: false, error: 'authentication_required' }, 401);
    const url = new URL(context.request.url);
    const kind = url.searchParams.get('kind') ?? '';
    const id = (url.searchParams.get('id') ?? '').trim().slice(0, 120);
    if (!id) return json({ ok: false, error: 'document_id_required' }, 400);

    if (kind === 'executed') {
      const owned = await db
        .prepare("SELECT customer_id FROM signing_requests WHERE id = ? AND status = 'signed' LIMIT 1")
        .bind(id)
        .first<{ customer_id: string | null }>();
      if (!owned || owned.customer_id !== session.customerId) {
        return json({ ok: false, error: 'document_not_found' }, 404);
      }
      const executed = await getExecutedCopy(db, id);
      if (!executed) return json({ ok: false, error: 'document_not_available' }, 404);
      await db
        .prepare('INSERT INTO customer_portal_audit (id, customer_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(`paud_${crypto.randomUUID()}`, session.customerId, 'portal.document_downloaded', `executed:${id}`, new Date().toISOString())
        .run()
        .catch(() => undefined);
      return new Response(executed.text, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="executed-${safeFilename(id, 'document')}.txt"`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          'X-Executed-SHA256': executed.sha256,
        },
      });
    }

    if (kind === 'signature') {
      const signature = await getSignatureForDownload(db, id);
      if (!signature) return json({ ok: false, error: 'document_not_found' }, 404);
      if (!['signed', 'verified'].includes(String(signature.status))) {
        return json({ ok: false, error: 'document_not_available' }, 404);
      }
      const owned = await db
        .prepare('SELECT customer_id FROM signing_requests WHERE id = ? LIMIT 1')
        .bind(String(signature.signing_request_id ?? ''))
        .first<{ customer_id: string | null }>();
      if (!owned || owned.customer_id !== session.customerId) {
        return json({ ok: false, error: 'document_not_found' }, 404);
      }
      const key = String(signature.r2_key || signature.template_r2_key || '');
      if (!key || !context.env.DOCUMENTS_BUCKET) {
        return json({ ok: false, error: 'document_storage_not_configured' }, 503);
      }
      const object = await context.env.DOCUMENTS_BUCKET.get(key);
      if (!object) return json({ ok: false, error: 'document_not_available' }, 404);
      const body = object.body ?? (object.arrayBuffer ? await object.arrayBuffer() : null);
      if (!body) return json({ ok: false, error: 'document_not_available' }, 404);
      await db
        .prepare('INSERT INTO customer_portal_audit (id, customer_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(`paud_${crypto.randomUUID()}`, session.customerId, 'portal.document_downloaded', `signature:${id}`, new Date().toISOString())
        .run()
        .catch(() => undefined);
      return new Response(body as BodyInit, {
        headers: {
          'Content-Type': object.httpMetadata?.contentType || 'application/pdf',
          'Content-Disposition': `attachment; filename="${safeFilename(signature.title, 'signed-document')}.pdf"`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    return json({ ok: false, error: 'document_kind_invalid' }, 400);
  } catch {
    return json({ ok: false, error: 'document_download_failed' }, 500);
  }
}
