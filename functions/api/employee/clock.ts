import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, audit, requireActor, requireCsrf } from '../../../src/lib/admin/operations.ts';
import {
  assignmentFor,
  employeeProfile,
  employeeRoleAllowed,
  normalizeLocation,
  openInterval,
  recordTimeEvent,
} from '../../../src/lib/employee/server.ts';
import {
  centralDateKey,
  centralMidnightUtc,
  formatMinutes,
  formatMoney,
  normaliseRateType,
  soloRateAllowed,
  summarizeIntervals,
  workweekBounds,
  type RateType,
  type TimeIntervalLike,
} from '../../../src/lib/employee/timekeeping.ts';

interface Env extends AdminDbEnv {}

type ClockAction = 'clock_in' | 'start_break' | 'end_break' | 'start_meal' | 'end_meal' | 'clock_out';
const ACTIONS: ClockAction[] = ['clock_in', 'start_break', 'end_break', 'start_meal', 'end_meal', 'clock_out'];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function text(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function rateFor(profile: { rates: Record<RateType, number> }, type: RateType): number {
  return profile.rates[type] ?? profile.rates.regular;
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
    if (profile.status !== 'active') return json({ ok: false, error: 'employee_profile_inactive' }, 403);

    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = text(body.action, 30) as ClockAction;
    if (!ACTIONS.includes(action)) return json({ ok: false, error: 'invalid_action' }, 400);

    const now = new Date();
    const open = await openInterval(db, actor.id);
    const currentId = open ? String(open.id) : '';
    const closeOpen = async (eventId: string): Promise<void> => {
      if (!currentId) return;
      await db
        .prepare(
          "UPDATE time_intervals SET ended_at = ?, status = 'closed', end_event_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(now.toISOString(), eventId, currentId)
        .run();
    };
    const openWork = async (input: {
      eventId: string;
      appointmentId: string | null;
      rateType: RateType;
      rateCents: number;
    }): Promise<void> => {
      await db
        .prepare(
          `INSERT INTO time_intervals
           (id, admin_user_id, team_member_id, appointment_id, kind, rate_type, rate_cents, paid,
            started_at, status, start_event_id)
           VALUES (?, ?, ?, ?, 'work', ?, ?, 1, ?, 'open', ?)`,
        )
        .bind(
          `tint_${crypto.randomUUID()}`,
          actor.id,
          profile.teamMemberId,
          input.appointmentId,
          input.rateType,
          input.rateCents,
          now.toISOString(),
          input.eventId,
        )
        .run();
    };

    if (action === 'clock_in') {
      if (open) return json({ ok: false, error: 'already_clocked_in' }, 409);
      const appointmentId = text(body.appointmentId, 100) || null;
      let rateType = normaliseRateType(body.rateType) ?? profile.defaultRateType;
      if (rateType === 'solo') {
        if (!appointmentId) return json({ ok: false, error: 'solo_rate_requires_job' }, 400);
        const assignment = await assignmentFor(db, profile.teamMemberId, appointmentId);
        if (!assignment.ok) return json({ ok: false, error: 'job_not_assigned' }, 403);
        if (!soloRateAllowed(assignment.crewSize, assignment.assigned)) {
          return json({ ok: false, error: 'solo_rate_not_allowed' }, 400);
        }
      } else if (appointmentId) {
        const assignment = await assignmentFor(db, profile.teamMemberId, appointmentId);
        if (!assignment.ok) return json({ ok: false, error: 'job_not_assigned' }, 403);
      }
      if (rateType === 'lead' && actor.role === 'cleaner' && profile.defaultRateType !== 'lead') {
        // A cleaner cannot self-assign the lead rate; a manager must set the
        // default or correct the timecard.
        rateType = profile.defaultRateType;
      }
      const location = normalizeLocation(body.location as Record<string, unknown> | undefined);
      const event = await recordTimeEvent(db, {
        userId: actor.id,
        teamMemberId: profile.teamMemberId,
        action,
        appointmentId,
        request: context.request,
        location,
      });
      try {
        await openWork({ eventId: event.id, appointmentId, rateType, rateCents: rateFor(profile, rateType) });
      } catch {
        return json({ ok: false, error: 'already_clocked_in' }, 409);
      }
      await audit(db, {
        actorUserId: actor.id,
        action: 'employee.clock_in',
        entityType: 'time_event',
        entityId: event.id,
        detail: `${rateType}${appointmentId ? `:${appointmentId}` : ''}:${location.status}`,
      });
    } else {
      if (!open) return json({ ok: false, error: 'not_clocked_in' }, 409);
      const kind = String(open.kind ?? 'work');
      if (action === 'start_break' && kind !== 'work') return json({ ok: false, error: 'invalid_state' }, 409);
      if (action === 'end_break' && kind !== 'break') return json({ ok: false, error: 'invalid_state' }, 409);
      if (action === 'start_meal' && kind !== 'work') return json({ ok: false, error: 'invalid_state' }, 409);
      if (action === 'end_meal' && kind !== 'meal') return json({ ok: false, error: 'invalid_state' }, 409);

      const appointmentId = open.appointment_id ? String(open.appointment_id) : null;
      const rateType = (normaliseRateType(open.rate_type) ?? profile.defaultRateType) as RateType;
      const rateCents = Number(open.rate_cents) > 0 ? Number(open.rate_cents) : rateFor(profile, rateType);
      const location = normalizeLocation(body.location as Record<string, unknown> | undefined);
      const event = await recordTimeEvent(db, {
        userId: actor.id,
        teamMemberId: profile.teamMemberId,
        action,
        appointmentId,
        request: context.request,
        location,
      });
      await closeOpen(event.id);

      if (action === 'start_break') {
        await db
          .prepare(
            `INSERT INTO time_intervals
             (id, admin_user_id, team_member_id, appointment_id, kind, rate_type, rate_cents, paid,
              started_at, status, start_event_id)
             VALUES (?, ?, ?, ?, 'break', ?, ?, 1, ?, 'open', ?)`,
          )
          .bind(
            `tint_${crypto.randomUUID()}`,
            actor.id,
            profile.teamMemberId,
            appointmentId,
            rateType,
            rateCents,
            now.toISOString(),
            event.id,
          )
          .run();
      } else if (action === 'start_meal') {
        await db
          .prepare(
            `INSERT INTO time_intervals
             (id, admin_user_id, team_member_id, appointment_id, kind, rate_type, rate_cents, paid,
              started_at, status, start_event_id)
             VALUES (?, ?, ?, ?, 'meal', ?, ?, 0, ?, 'open', ?)`,
          )
          .bind(
            `tint_${crypto.randomUUID()}`,
            actor.id,
            profile.teamMemberId,
            appointmentId,
            rateType,
            rateCents,
            now.toISOString(),
            event.id,
          )
          .run();
      } else if (action === 'end_break' || action === 'end_meal') {
        await openWork({ eventId: event.id, appointmentId, rateType, rateCents });
      }
      await audit(db, {
        actorUserId: actor.id,
        action: `employee.${action}`,
        entityType: 'time_event',
        entityId: event.id,
        detail: location.status,
      });
    }

    const week = workweekBounds(now);
    const todayKey = centralDateKey(now);
    const tomorrowKey = new Date(Date.parse(`${todayKey}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const [weekRows, todayRows, next] = await Promise.all([
      db
        .prepare('SELECT * FROM time_intervals WHERE admin_user_id = ? AND started_at >= ? AND started_at < ?')
        .bind(actor.id, week.startIso, week.endIso)
        .all<Record<string, unknown>>(),
      db
        .prepare('SELECT * FROM time_intervals WHERE admin_user_id = ? AND started_at >= ? AND started_at < ?')
        .bind(actor.id, centralMidnightUtc(todayKey).toISOString(), centralMidnightUtc(tomorrowKey).toISOString())
        .all<Record<string, unknown>>(),
      openInterval(db, actor.id),
    ]);
    const weekTotals = summarizeIntervals((weekRows.results ?? []) as unknown as TimeIntervalLike[], now);
    const todayTotals = summarizeIntervals((todayRows.results ?? []) as unknown as TimeIntervalLike[], now);
    return json({
      ok: true,
      clock: next
        ? { state: String(next.kind ?? 'work'), since: String(next.started_at ?? ''), appointmentId: next.appointment_id ?? null }
        : { state: 'out', since: null, appointmentId: null },
      today: { ...todayTotals, workLabel: formatMinutes(todayTotals.workMinutes), grossLabel: formatMoney(todayTotals.grossCents) },
      week: { ...weekTotals, workLabel: formatMinutes(weekTotals.workMinutes), overtimeLabel: formatMinutes(weekTotals.overtimeMinutes) },
    });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'clock_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
