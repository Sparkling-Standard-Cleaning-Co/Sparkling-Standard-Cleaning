import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, requireActor, type AdminActor } from '../../../src/lib/admin/operations.ts';

interface Env extends AdminDbEnv {}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
function scoped(actor: AdminActor, column: string): { sql: string; bind: unknown[] } {
  if (actor.role === 'owner') return { sql: '', bind: [] };
  if (!actor.branchId) return { sql: ' AND 1 = 0', bind: [] };
  return { sql: ` AND ${column} = ?`, bind: [actor.branchId] };
}
export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'customer.read');
    const url = new URL(context.request.url);
    const id = (url.searchParams.get('id') ?? '').trim();
    if (id) {
      const customer = await db.prepare(
        `SELECT c.id, c.first_name, c.last_name, c.company_name, c.status, c.source, c.notes_summary,
                c.primary_branch_id, b.name AS branch_name, c.created_at, c.updated_at
         FROM customers c LEFT JOIN branches b ON b.id = c.primary_branch_id
         WHERE c.id = ? LIMIT 1`,
      ).bind(id).first();
      if (!customer) return json({ ok: false, error: 'customer_not_found' }, 404);
      const scope = scoped(actor, 'primary_branch_id');
      if (scope.sql && (customer as Record<string, unknown>).primary_branch_id !== actor.branchId) {
        return json({ ok: false, error: 'forbidden' }, 403);
      }
      const [contacts, properties, leads, estimates, appointments] = await Promise.all([
        db.prepare('SELECT kind, value, is_primary, verified_at FROM customer_contacts WHERE customer_id = ? ORDER BY is_primary DESC').bind(id).all(),
        db.prepare('SELECT id, label, line1, line2, city, state, postal_code, access_notes, parking_notes, is_primary, status FROM properties WHERE customer_id = ? ORDER BY is_primary DESC, created_at DESC').bind(id).all(),
        db.prepare('SELECT id, request_type, status, source, quote_reference, outstanding_requirement, created_at FROM leads WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50').bind(id).all(),
        db.prepare('SELECT id, service_code, status, quote_reference, total_cents, created_at FROM estimates WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50').bind(id).all(),
        db.prepare('SELECT id, status, start_at, end_at, reference, crew_size, source FROM appointments WHERE customer_id = ? ORDER BY start_at DESC LIMIT 50').bind(id).all(),
      ]);
      return json({ ok: true, customer, contacts: contacts.results ?? [], properties: properties.results ?? [], leads: leads.results ?? [], estimates: estimates.results ?? [], appointments: appointments.results ?? [] });
    }
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
    const scope = scoped(actor, 'c.primary_branch_id');
    const like = `%${q.replaceAll('%', '').replaceAll('_', '')}%`;
    const rows = await db.prepare(
      `SELECT c.id, c.first_name, c.last_name, c.company_name, c.status, c.created_at,
              (SELECT value FROM customer_contacts WHERE customer_id = c.id AND kind = 'email' LIMIT 1) AS email,
              (SELECT value FROM customer_contacts WHERE customer_id = c.id AND kind = 'phone' LIMIT 1) AS phone,
              (SELECT COUNT(*) FROM properties WHERE customer_id = c.id AND status = 'active') AS property_count
       FROM customers c
       WHERE c.status = 'active'
         AND (? = '' OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.company_name LIKE ?
              OR EXISTS (SELECT 1 FROM customer_contacts cc WHERE cc.customer_id = c.id AND cc.normalized_value LIKE ?))
         ${scope.sql}
       ORDER BY c.updated_at DESC LIMIT 100`,
    ).bind(q, like, like, like, like.toLowerCase(), ...scope.bind).all();
    return json({ ok: true, customers: rows.results ?? [], query: q });
  } catch (error) {
    const status = error instanceof AdminAuthError ? error.status : 500;
    const code = error instanceof AdminAuthError ? error.code : 'customers_failed';
    return json({ ok: false, error: code }, status);
  }
}
