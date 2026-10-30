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
    const actor = await requireActor(db, context.request, 'booking.read');
    const requestScope = scoped(actor, 'r.branch_id');
    const appointmentScope = scoped(actor, 'a.branch_id');
    const leadScope = scoped(actor, 'l.branch_id');
    const [requests, appointments, reservationLeads] = await Promise.all([
      db.prepare(
        `SELECT r.id, r.status, r.quote_reference, r.requested_date, r.start_at, r.end_at,
                r.duration_minutes, r.created_at, c.first_name, c.last_name,
                p.line1, p.city, p.state, p.postal_code
         FROM booking_requests r
         LEFT JOIN customers c ON c.id = r.customer_id
         LEFT JOIN properties p ON p.id = r.property_id
         WHERE 1 = 1 ${requestScope.sql}
         ORDER BY r.created_at DESC LIMIT 100`,
      ).bind(...requestScope.bind).all(),
      db.prepare(
        `SELECT a.id, a.status, a.start_at, a.end_at, a.reference, a.crew_size, a.source,
                c.first_name, c.last_name, p.line1, p.city
         FROM appointments a
         LEFT JOIN customers c ON c.id = a.customer_id
         LEFT JOIN properties p ON p.id = a.property_id
         WHERE 1 = 1 ${appointmentScope.sql}
         ORDER BY a.start_at ASC LIMIT 100`,
      ).bind(...appointmentScope.bind).all(),
      db.prepare(
        `SELECT l.id, l.status, l.quote_reference, l.created_at, c.first_name, c.last_name
         FROM leads l LEFT JOIN customers c ON c.id = l.customer_id
         WHERE l.request_type = 'reservation_request' ${leadScope.sql}
         ORDER BY l.created_at DESC LIMIT 100`,
      ).bind(...leadScope.bind).all(),
    ]);
    return json({ ok: true, requests: requests.results ?? [], appointments: appointments.results ?? [], reservationLeads: reservationLeads.results ?? [] });
  } catch (error) {
    const code = error instanceof AdminAuthError ? error.code : 'requests_failed';
    const status = error instanceof AdminAuthError ? error.status : 500;
    return json({ ok: false, error: code }, status);
  }
}
