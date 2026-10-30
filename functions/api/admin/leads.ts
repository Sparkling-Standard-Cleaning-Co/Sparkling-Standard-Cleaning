import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, requireActor, type AdminActor } from '../../../src/lib/admin/operations.ts';

interface Env extends AdminDbEnv {}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
function scoped(actor: AdminActor): { sql: string; bind: unknown[] } {
  if (actor.role === 'owner') return { sql: '', bind: [] };
  if (!actor.branchId) return { sql: ' AND 1 = 0', bind: [] };
  return { sql: ' AND l.branch_id = ?', bind: [actor.branchId] };
}
function payload(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value) return {};
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
}
export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'lead.read');
    const url = new URL(context.request.url);
    const id = (url.searchParams.get('id') ?? '').trim();
    if (id) {
      const lead = await db.prepare(
        `SELECT l.*, c.first_name, c.last_name,
                (SELECT value FROM customer_contacts WHERE customer_id = c.id AND kind = 'email' LIMIT 1) AS email,
                (SELECT value FROM customer_contacts WHERE customer_id = c.id AND kind = 'phone' LIMIT 1) AS phone
         FROM leads l LEFT JOIN customers c ON c.id = l.customer_id
         WHERE l.id = ? LIMIT 1`,
      ).bind(id).first<Record<string, unknown>>();
      if (!lead) return json({ ok: false, error: 'lead_not_found' }, 404);
      const scope = scoped(actor);
      if (scope.sql && lead.branch_id !== actor.branchId) return json({ ok: false, error: 'forbidden' }, 403);
      return json({ ok: true, lead: { ...lead, payload: payload(lead.payload_json) } });
    }
    const status = (url.searchParams.get('status') ?? '').trim();
    const scope = scoped(actor);
    const rows = await db.prepare(
      `SELECT l.id, l.request_type, l.status, l.source, l.quote_reference, l.delivery_status,
              l.outstanding_requirement, l.branch_id, l.created_at,
              c.id AS customer_id, c.first_name, c.last_name,
              (SELECT value FROM customer_contacts WHERE customer_id = c.id AND kind = 'email' LIMIT 1) AS email,
              (SELECT value FROM customer_contacts WHERE customer_id = c.id AND kind = 'phone' LIMIT 1) AS phone
       FROM leads l LEFT JOIN customers c ON c.id = l.customer_id
       WHERE (? = '' OR l.status = ?) ${scope.sql}
       ORDER BY l.created_at DESC LIMIT 100`,
    ).bind(status, status, ...scope.bind).all();
    return json({ ok: true, leads: rows.results ?? [] });
  } catch (error) {
    const code = error instanceof AdminAuthError ? error.code : 'leads_failed';
    const status = error instanceof AdminAuthError ? error.status : 500;
    return json({ ok: false, error: code }, status);
  }
}
