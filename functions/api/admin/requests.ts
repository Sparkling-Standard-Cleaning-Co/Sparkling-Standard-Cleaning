import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, requireActor, requireCsrf, type AdminActor } from '../../../src/lib/admin/operations.ts';
import { assertRequestConfirmable, attachCalendarEvent, confirmRequest, updateRequestStatus } from '../../../src/lib/admin/scheduling.ts';
import type { BookingEnv } from '../../../src/lib/booking/service.ts';
import { onRequestPost as bookingAdminPost } from '../booking-admin.ts';

interface Env extends AdminDbEnv, BookingEnv {
  BOOKING_OWNER_TOKEN?: string;
}

async function bookingAction(
  context: { request: Request; env: Env },
  payload: Record<string, unknown>,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const token = context.env.BOOKING_OWNER_TOKEN?.trim();
  if (!token) return { status: 503, data: { ok: false, error: 'booking_admin_not_configured' } };
  const request = new Request(context.request.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const response = await bookingAdminPost({ request, env: context.env as never });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, data };
}
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
                r.duration_minutes, r.payload_json, r.created_at, c.first_name, c.last_name,
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

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'booking.write');
    requireCsrf(context.request, actor);
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? '');
    const requestId = String(body.requestId ?? '');
    if (action === 'confirm') {
      await assertRequestConfirmable(db, actor, requestId);
      const calendar = await bookingAction(context, { id: requestId, action: 'confirm' });
      if (!calendar.data.ok) {
        return json(
          { ok: false, error: calendar.data.error ?? 'calendar_confirm_failed', calendarStatus: calendar.status },
          calendar.status === 200 ? 502 : calendar.status,
        );
      }
      const teamMemberIds = Array.isArray(body.teamMemberIds)
        ? body.teamMemberIds.map((value) => String(value)).filter(Boolean).slice(0, 12)
        : [];
      try {
        const result = await confirmRequest(db, actor, requestId, teamMemberIds);
        const eventId = String(calendar.data.eventId ?? '');
        if (eventId) await attachCalendarEvent(db, result.appointmentId, eventId);
        return json({ ok: true, ...result, calendarEventId: eventId || null });
      } catch (error) {
        return json(
          {
            ok: false,
            error: error instanceof AdminAuthError ? error.code : 'd1_confirm_failed',
            calendarConfirmed: true,
            calendarEventId: calendar.data.eventId ?? null,
          },
          error instanceof AdminAuthError ? error.status : 502,
        );
      }
    }
    if (action === 'status') {
      const status = String(body.status ?? '');
      if (status === 'declined' || status === 'released') {
        const calendar = await bookingAction(context, {
          id: requestId,
          action: status === 'declined' ? 'decline' : 'release',
        });
        if (!calendar.data.ok) {
          return json(
            { ok: false, error: calendar.data.error ?? 'calendar_release_failed', calendarStatus: calendar.status },
            calendar.status === 200 ? 502 : calendar.status,
          );
        }
      }
      await updateRequestStatus(db, actor, requestId, status);
      return json({ ok: true });
    }
    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'request_update_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}