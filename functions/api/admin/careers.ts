import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, audit, requireActor, requireCsrf } from '../../../src/lib/admin/operations.ts';
import { CAREER_STATUSES } from '../../../src/lib/careers.ts';

interface R2Object {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
}
interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
}
interface Env extends AdminDbEnv {
  DOCUMENTS_BUCKET?: R2Bucket;
  PHOTOS_BUCKET?: R2Bucket;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'admin.manage');
    if (actor.role !== 'owner') return json({ ok: false, error: 'owner_required' }, 403);
    const url = new URL(context.request.url);
    const id = text(url.searchParams.get('id'), 120);
    const view = text(url.searchParams.get('view'), 30) || 'list';
    if (view === 'resume' && id) {
      const row = await db.prepare('SELECT resume_key, resume_name, resume_type FROM career_applications WHERE id = ? LIMIT 1').bind(id).first<{ resume_key: string; resume_name: string; resume_type: string }>();
      if (!row?.resume_key) return json({ ok: false, error: 'resume_not_found' }, 404);
      const bucket = context.env.DOCUMENTS_BUCKET ?? context.env.PHOTOS_BUCKET;
      if (!bucket) return json({ ok: false, error: 'resume_storage_not_configured' }, 503);
      const object = await bucket.get(row.resume_key);
      if (!object) return json({ ok: false, error: 'resume_not_found' }, 404);
      await audit(db, { actorUserId: actor.id, action: 'careers.resume_downloaded', entityType: 'career_application', entityId: id }).catch(() => undefined);
      const filename = (row.resume_name || 'resume').replace(/["\r\n]/g, '');
      return new Response(object.body, { headers: {
        'Content-Type': object.httpMetadata?.contentType || row.resume_type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      } });
    }
    if (view === 'detail' && id) {
      const application = await db.prepare('SELECT * FROM career_applications WHERE id = ? LIMIT 1').bind(id).first<Record<string, unknown>>();
      if (!application) return json({ ok: false, error: 'application_not_found' }, 404);
      return json({ ok: true, application });
    }
    const status = text(url.searchParams.get('status'), 30);
    const branch = text(url.searchParams.get('branch'), 40);
    const q = text(url.searchParams.get('q'), 120);
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? 25)));
    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));
    const sorts: Record<string, string> = {
      created_at: 'created_at DESC, id ASC',
      name: 'name ASC, created_at DESC, id ASC',
      status: 'status ASC, created_at DESC, id ASC',
    };
    const sortKey = sorts[url.searchParams.get('sort') ?? ''] ? String(url.searchParams.get('sort')) : 'created_at';
    const filters = `WHERE (? = '' OR status = ?)
       AND (? = '' OR branch_preference = ?)
       AND (? = '' OR name LIKE ? OR email LIKE ? OR reference LIKE ? OR desired_role LIKE ?)`;
    const filterBind = [status, status, branch, branch, q, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`];
    const rows = await db.prepare(
      `SELECT id, reference, created_at, name, email, phone, experience_level, desired_role,
              branch_preference, availability, transportation, resume_key, status, notes,
              hiring_notified_at, applicant_notified_at
       FROM career_applications ${filters}
       ORDER BY ${sorts[sortKey]} LIMIT ? OFFSET ?`,
    ).bind(...filterBind, limit, offset).all<Record<string, unknown>>();
    const total = await db.prepare(`SELECT COUNT(*) AS count FROM career_applications ${filters}`)
      .bind(...filterBind).first<{ count: number }>();
    return json({ ok: true, applications: rows.results ?? [], total: Number(total?.count ?? 0), limit, offset, sort: sortKey });
  } catch (error) {
    return json({ ok: false, error: error instanceof AdminAuthError ? error.code : 'careers_failed' }, error instanceof AdminAuthError ? error.status : 500);
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'admin.manage');
    requireCsrf(context.request, actor);
    if (actor.role !== 'owner') return json({ ok: false, error: 'owner_required' }, 403);
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = text(body.action, 40);
    const id = text(body.applicationId, 120);
    if (!id) return json({ ok: false, error: 'application_required' }, 400);
    if (action === 'update') {
      const status = text(body.status, 30);
      if (!CAREER_STATUSES.includes(status as typeof CAREER_STATUSES[number])) return json({ ok: false, error: 'status_invalid' }, 400);
      await db.prepare('UPDATE career_applications SET status = ?, notes = ?, updated_at = ? WHERE id = ?')
        .bind(status, text(body.notes, 3000), new Date().toISOString(), id).run();
      await audit(db, { actorUserId: actor.id, action: 'careers.status_updated', entityType: 'career_application', entityId: id, detail: status });
      return json({ ok: true });
    }
    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return json({ ok: false, error: error instanceof AdminAuthError ? error.code : 'careers_failed' }, error instanceof AdminAuthError ? error.status : 500);
  }
}
