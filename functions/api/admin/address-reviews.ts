// Private address review queue for residential/commercial classification requests.
import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, audit, requireActor, requireCsrf } from '../../../src/lib/admin/operations.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export async function onRequestGet(context: { request: Request; env: AdminDbEnv }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'job.read');
    if (!['owner', 'manager'].includes(actor.role)) return json({ ok: false, error: 'manager_required' }, 403);
    const url = new URL(context.request.url);
    const status = text(url.searchParams.get('status'), 20);
    const rows = await db
      .prepare(
        `SELECT * FROM address_review_requests
         WHERE (? = '' OR status = ?) ORDER BY created_at DESC LIMIT 100`,
      )
      .bind(status, status)
      .all<Record<string, unknown>>();
    return json({ ok: true, requests: rows.results ?? [] });
  } catch (error) {
    return json({ ok: false, error: error instanceof AdminAuthError ? error.code : 'address_reviews_failed' }, error instanceof AdminAuthError ? error.status : 500);
  }
}

export async function onRequestPost(context: { request: Request; env: AdminDbEnv }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'job.write');
    requireCsrf(context.request, actor);
    if (!['owner', 'manager'].includes(actor.role)) return json({ ok: false, error: 'manager_required' }, 403);
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = text(body.id, 120);
    const status = text(body.status, 20);
    if (!['new', 'reviewing', 'resolved', 'dismissed'].includes(status)) {
      return json({ ok: false, error: 'status_invalid' }, 400);
    }
    const existing = await db.prepare('SELECT id FROM address_review_requests WHERE id = ? LIMIT 1').bind(id).first();
    if (!existing) return json({ ok: false, error: 'request_not_found' }, 404);
    await db
      .prepare(
        `UPDATE address_review_requests SET status = ?, admin_notes = ?, reviewed_by_admin_user_id = ?,
           reviewed_at = CASE WHEN ? IN ('resolved','dismissed') THEN ? ELSE reviewed_at END,
           updated_at = ? WHERE id = ?`,
      )
      .bind(status, text(body.adminNotes, 3000), actor.id, status, new Date().toISOString(), new Date().toISOString(), id)
      .run();
    await audit(db, { actorUserId: actor.id, action: 'address_review.updated', entityType: 'address_review_request', entityId: id, detail: status });
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, error: error instanceof AdminAuthError ? error.code : 'address_review_update_failed' }, error instanceof AdminAuthError ? error.status : 500);
  }
}
