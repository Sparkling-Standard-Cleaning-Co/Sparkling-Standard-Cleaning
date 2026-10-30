import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, requireActor } from '../../../src/lib/admin/operations.ts';
import { employeeProfile, employeeRoleAllowed } from '../../../src/lib/employee/server.ts';
import {
  formatMinutes,
  formatMoney,
  summarizeIntervals,
  workweekBounds,
  type TimeIntervalLike,
} from '../../../src/lib/employee/timekeeping.ts';

interface Env extends AdminDbEnv {}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function dateKey(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request);
    if (!employeeRoleAllowed(actor)) return json({ ok: false, error: 'employee_portal_not_available_for_role' }, 403);
    const profile = await employeeProfile(db, actor.id);
    if (!profile) return json({ ok: false, error: 'employee_profile_missing' }, 403);

    const url = new URL(context.request.url);
    const week = workweekBounds(new Date());
    const from = dateKey(url.searchParams.get('from')) || week.startDate;
    const to = dateKey(url.searchParams.get('to')) || week.endDate;
    const fromIso = new Date(`${from}T00:00:00Z`).toISOString();
    const toIso = new Date(`${to}T23:59:59Z`).toISOString();
    if (Date.parse(toIso) - Date.parse(fromIso) > 31 * 86_400_000) {
      return json({ ok: false, error: 'range_too_large' }, 400);
    }
    const rows = await db
      .prepare(
        `SELECT id, appointment_id, kind, rate_type, rate_cents, paid, started_at, ended_at, status,
                correction_reason
         FROM time_intervals
         WHERE admin_user_id = ? AND started_at >= ? AND started_at <= ?
         ORDER BY started_at`,
      )
      .bind(actor.id, fromIso, toIso)
      .all<Record<string, unknown>>();
    const intervals = rows.results ?? [];
    const totals = summarizeIntervals(intervals as unknown as TimeIntervalLike[], new Date());
    const pending = await db
      .prepare(
        "SELECT id, interval_id, message, status, created_at FROM time_correction_requests WHERE admin_user_id = ? ORDER BY created_at DESC LIMIT 20",
      )
      .bind(actor.id)
      .all<Record<string, unknown>>();
    return json({
      ok: true,
      from,
      to,
      intervals,
      totals: {
        ...totals,
        workLabel: formatMinutes(totals.workMinutes),
        breakLabel: formatMinutes(totals.breakMinutes),
        mealLabel: formatMinutes(totals.mealMinutes),
        overtimeLabel: formatMinutes(totals.overtimeMinutes),
        grossLabel: formatMoney(totals.grossCents),
        preliminary: true,
      },
      corrections: pending.results ?? [],
    });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'time_load_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
