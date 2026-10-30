import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, audit, requireActor, requireCsrf } from '../../../src/lib/admin/operations.ts';
import { employeeProfile, employeeRoleAllowed } from '../../../src/lib/employee/server.ts';

interface Env extends AdminDbEnv {}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request);
    if (!employeeRoleAllowed(actor)) return json({ ok: false, error: 'employee_portal_not_available_for_role' }, 403);
    requireCsrf(context.request, actor);
    const profile = await employeeProfile(db, actor.id);
    if (!profile) return json({ ok: false, error: 'employee_profile_missing' }, 403);
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const message = typeof body.message === 'string' ? body.message.trim().slice(0, 1000) : '';
    const intervalId = typeof body.intervalId === 'string' ? body.intervalId.trim().slice(0, 120) : '';
    if (!message) return json({ ok: false, error: 'message_required' }, 400);
    if (intervalId) {
      const owns = await db
        .prepare('SELECT id FROM time_intervals WHERE id = ? AND admin_user_id = ? LIMIT 1')
        .bind(intervalId, actor.id)
        .first();
      if (!owns) return json({ ok: false, error: 'interval_not_found' }, 404);
    }
    const start = typeof body.requestedStartedAt === 'string' ? body.requestedStartedAt.slice(0, 40) : null;
    const end = typeof body.requestedEndedAt === 'string' ? body.requestedEndedAt.slice(0, 40) : null;
    const id = `tcr_${crypto.randomUUID()}`;
    await db
      .prepare(
        `INSERT INTO time_correction_requests
         (id, interval_id, admin_user_id, requested_started_at, requested_ended_at, message)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, intervalId || null, actor.id, start, end, message)
      .run();
    await audit(db, {
      actorUserId: actor.id,
      action: 'employee.correction_requested',
      entityType: 'time_correction',
      entityId: id,
      detail: intervalId,
    });
    return json({ ok: true, id });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'correction_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
