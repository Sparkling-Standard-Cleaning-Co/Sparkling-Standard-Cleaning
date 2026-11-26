// Employee self-service: training, earnings, time-off requests and shifts.
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

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function requireEmployee(db: NonNullable<ReturnType<typeof adminDb>>, request: Request) {
  const actor = await requireActor(db, request);
  if (!employeeRoleAllowed(actor)) throw new AdminAuthError(403, 'employee_portal_not_available_for_role');
  const profile = await employeeProfile(db, actor.id);
  if (!profile) throw new AdminAuthError(403, 'employee_profile_missing');
  if (profile.status !== 'active') throw new AdminAuthError(403, 'employee_profile_inactive');
  return { actor, profile };
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const { profile } = await requireEmployee(db, context.request);
    const [training, earnings, timeOff, shifts] = await Promise.all([
      db
        .prepare(
          `SELECT a.id, a.status, a.assigned_at, a.completed_at, a.score, a.notes,
                  m.title, m.category, m.content_text, m.assessment_json, m.version
           FROM training_assignments a JOIN training_modules m ON m.id = a.module_id
           WHERE a.team_member_id = ? AND m.active = 1
           ORDER BY CASE a.status WHEN 'assigned' THEN 0 ELSE 1 END, a.assigned_at DESC`,
        )
        .bind(profile.teamMemberId)
        .all<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT e.id, e.regular_minutes, e.overtime_minutes, e.regular_cents, e.overtime_cents,
                  e.adjustments_cents, e.gross_cents, p.period_start, p.period_end, p.status AS period_status
           FROM payroll_entries e JOIN payroll_periods p ON p.id = e.period_id
           WHERE e.team_member_id = ? AND p.status = 'approved'
           ORDER BY p.period_start DESC LIMIT 24`,
        )
        .bind(profile.teamMemberId)
        .all<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT id, start_at, end_at, reason, status, reviewed_at, created_at
           FROM time_off_requests WHERE team_member_id = ? ORDER BY created_at DESC LIMIT 50`,
        )
        .bind(profile.teamMemberId)
        .all<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT id, work_date, start_time, end_time, available, note
           FROM dispatch_shift_overrides WHERE team_member_id = ? AND work_date >= date('now')
           ORDER BY work_date, start_time LIMIT 60`,
        )
        .bind(profile.teamMemberId)
        .all<Record<string, unknown>>(),
    ]);
    return json({
      ok: true,
      training: training.results ?? [],
      earnings: earnings.results ?? [],
      timeOff: timeOff.results ?? [],
      shifts: shifts.results ?? [],
    });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'employee_requests_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const { actor, profile } = await requireEmployee(db, context.request);
    requireCsrf(context.request, actor);
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = text(body.action, 40);
    if (action === 'complete_training') {
      const assignmentId = text(body.assignmentId, 100);
      const assignment = await db
        .prepare(
          'SELECT id, status FROM training_assignments WHERE id = ? AND team_member_id = ? LIMIT 1',
        )
        .bind(assignmentId, profile.teamMemberId)
        .first<{ id: string; status: string }>();
      if (!assignment) throw new AdminAuthError(404, 'training_assignment_not_found');
      if (assignment.status !== 'completed') {
        await db
          .prepare(
            "UPDATE training_assignments SET status = 'completed', completed_at = ? WHERE id = ?",
          )
          .bind(new Date().toISOString(), assignmentId)
          .run();
        await audit(db, {
          actorUserId: actor.id,
          action: 'employee.training_self_completed',
          entityType: 'training_assignment',
          entityId: assignmentId,
        });
      }
      return json({ ok: true });
    }
    if (action === 'request_time_off') {
      const start = text(body.startAt, 40);
      const end = text(body.endAt, 40);
      const reason = text(body.reason, 1000);
      const startMs = Date.parse(start);
      const endMs = Date.parse(end);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        throw new AdminAuthError(400, 'time_off_dates_invalid');
      }
      if (endMs - startMs > 366 * 86_400_000) {
        throw new AdminAuthError(400, 'time_off_range_too_long');
      }
      const id = `toffreq_${crypto.randomUUID()}`;
      await db
        .prepare(
          `INSERT INTO time_off_requests (id, team_member_id, start_at, end_at, reason)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(id, profile.teamMemberId, new Date(startMs).toISOString(), new Date(endMs).toISOString(), reason)
        .run();
      await audit(db, {
        actorUserId: actor.id,
        action: 'employee.time_off_requested',
        entityType: 'time_off_request',
        entityId: id,
      });
      return json({ ok: true, id });
    }
    if (action === 'cancel_time_off') {
      const id = text(body.id, 100);
      const row = await db
        .prepare(
          "SELECT id FROM time_off_requests WHERE id = ? AND team_member_id = ? AND status = 'pending' LIMIT 1",
        )
        .bind(id, profile.teamMemberId)
        .first();
      if (!row) throw new AdminAuthError(404, 'time_off_request_not_pending');
      await db
        .prepare("UPDATE time_off_requests SET status = 'declined', reviewed_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), id)
        .run();
      return json({ ok: true });
    }
    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'employee_request_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
