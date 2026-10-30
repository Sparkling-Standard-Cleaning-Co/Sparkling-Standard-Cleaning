import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, requireActor } from '../../../src/lib/admin/operations.ts';
import { employeeProfile, employeeRoleAllowed, openInterval } from '../../../src/lib/employee/server.ts';
import {
  centralDateKey,
  centralMidnightUtc,
  employeeJobWindow,
  formatMinutes,
  formatMoney,
  isMissingClockOut,
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

function payloadField(payloadJson: unknown, key: string): string {
  try {
    const payload = JSON.parse(String(payloadJson ?? '{}')) as Record<string, unknown>;
    return typeof payload[key] === 'string' ? String(payload[key]) : '';
  } catch {
    return '';
  }
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request);
    if (!employeeRoleAllowed(actor)) {
      return json({ ok: false, error: 'employee_portal_not_available_for_role' }, 403);
    }
    const profile = await employeeProfile(db, actor.id);
    if (!profile) return json({ ok: false, error: 'employee_profile_missing', actor: { name: actor.name } }, 403);

    const now = new Date();
    const week = workweekBounds(now);
    const window = employeeJobWindow(now);
    const todayKey = centralDateKey(now);
    const todayStart = centralMidnightUtc(todayKey).toISOString();
    const tomorrowStart = centralMidnightUtc(
      new Date(Date.parse(`${todayKey}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10),
    ).toISOString();

    const [weekRows, todayRows, open, jobs, checklists] = await Promise.all([
      db
        .prepare('SELECT * FROM time_intervals WHERE admin_user_id = ? AND started_at >= ? AND started_at < ? ORDER BY started_at')
        .bind(actor.id, week.startIso, week.endIso)
        .all<Record<string, unknown>>(),
      db
        .prepare('SELECT * FROM time_intervals WHERE admin_user_id = ? AND started_at >= ? AND started_at < ? ORDER BY started_at')
        .bind(actor.id, todayStart, tomorrowStart)
        .all<Record<string, unknown>>(),
      openInterval(db, actor.id),
      db
        .prepare(
          `SELECT a.id, a.status, a.start_at, a.end_at, a.duration_minutes, a.crew_size, a.reference, a.notes,
                  p.line1, p.city, p.state, p.postal_code, c.first_name, c.last_name,
                  br.payload_json
           FROM appointments a
           JOIN appointment_resources ar ON ar.appointment_id = a.id AND ar.team_member_id = ?
           LEFT JOIN properties p ON p.id = a.property_id
           LEFT JOIN customers c ON c.id = a.customer_id
           LEFT JOIN booking_requests br ON br.id = a.booking_request_id
           WHERE a.start_at >= ? AND a.start_at < ?
             AND a.status NOT IN ('cancelled', 'no_show')
           ORDER BY a.start_at ASC LIMIT 20`,
        )
        .bind(profile.teamMemberId, window.fromIso, window.toIso)
        .all<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT jc.id AS checklist_id, jc.appointment_id, jc.status AS checklist_status,
                  jci.id AS item_id, jci.label, jci.completed, jci.sort_order
           FROM job_checklists jc
           JOIN appointments a ON a.id = jc.appointment_id
           JOIN appointment_resources ar ON ar.appointment_id = a.id AND ar.team_member_id = ?
           LEFT JOIN job_checklist_items jci ON jci.checklist_id = jc.id
           WHERE a.start_at >= ? AND a.start_at < ?
           ORDER BY jc.id, jci.sort_order`,
        )
        .bind(profile.teamMemberId, window.fromIso, window.toIso)
        .all<Record<string, unknown>>(),
    ]);

    const jobList = jobs.results ?? [];
    const crewRows = jobList.length
      ? await db
          .prepare(
            `SELECT ar.appointment_id, tm.display_name
             FROM appointment_resources ar JOIN team_members tm ON tm.id = ar.team_member_id
             WHERE ar.appointment_id IN (${jobList.map(() => '?').join(',')})`,
          )
          .bind(...jobList.map((job) => String(job.id)))
          .all<Record<string, unknown>>()
      : { results: [] as Array<Record<string, unknown>> };
    const crewByJob = new Map<string, string[]>();
    for (const row of crewRows.results ?? []) {
      const list = crewByJob.get(String(row.appointment_id)) ?? [];
      list.push(String(row.display_name));
      crewByJob.set(String(row.appointment_id), list);
    }
    const checklistByJob = new Map<string, Record<string, unknown>>();
    for (const row of checklists.results ?? []) {
      const key = String(row.appointment_id);
      const entry = checklistByJob.get(key) ?? {
        id: row.checklist_id,
        status: row.checklist_status,
        items: [] as Array<Record<string, unknown>>,
      };
      if (row.item_id) {
        (entry.items as Array<Record<string, unknown>>).push({
          id: row.item_id,
          label: row.label,
          completed: Number(row.completed) === 1,
        });
      }
      checklistByJob.set(key, entry);
    }

    const weekTotals = summarizeIntervals((weekRows.results ?? []) as unknown as TimeIntervalLike[], now);
    const todayTotals = summarizeIntervals((todayRows.results ?? []) as unknown as TimeIntervalLike[], now);

    return json({
      ok: true,
      actor: { name: actor.name, role: actor.role, id: actor.id },
      profile: {
        displayName: profile.displayName || actor.name,
        defaultRateType: profile.defaultRateType,
        rates: profile.rates,
      },
      clock: open
        ? {
            state: String(open.kind ?? 'work'),
            since: String(open.started_at ?? ''),
            appointmentId: open.appointment_id ? String(open.appointment_id) : null,
            rateType: String(open.rate_type ?? 'regular'),
          }
        : { state: 'out', since: null, appointmentId: null, rateType: null },
      today: {
        ...todayTotals,
        workLabel: formatMinutes(todayTotals.workMinutes),
        breakLabel: formatMinutes(todayTotals.breakMinutes),
        mealLabel: formatMinutes(todayTotals.mealMinutes),
        grossLabel: formatMoney(todayTotals.grossCents),
      },
      week: {
        ...weekTotals,
        startDate: week.startDate,
        endDate: week.endDate,
        workLabel: formatMinutes(weekTotals.workMinutes),
        breakLabel: formatMinutes(weekTotals.breakMinutes),
        mealLabel: formatMinutes(weekTotals.mealMinutes),
        overtimeLabel: formatMinutes(weekTotals.overtimeMinutes),
        grossLabel: formatMoney(weekTotals.grossCents),
        preliminary: true,
      },
      missingClockOut: open ? isMissingClockOut(open as unknown as TimeIntervalLike, now) : false,
      jobs: jobList.map((job) => {
        const payload = String(job.payload_json ?? '{}');
        return {
          id: job.id,
          status: job.status,
          startAt: job.start_at,
          endAt: job.end_at,
          durationMinutes: job.duration_minutes,
          crewSize: job.crew_size,
          reference: job.reference,
          service: payloadField(payload, 'service_label') || payloadField(payload, 'serviceType') || 'Cleaning',
          address: [job.line1, job.city, job.state, job.postal_code].filter(Boolean).join(', '),
          customerFirstName: String(job.first_name ?? ''),
          instructions: [job.notes, payloadField(payload, 'special_instructions'), payloadField(payload, 'access_notes')]
            .filter(Boolean)
            .join(' · '),
          crew: crewByJob.get(String(job.id)) ?? [],
          checklist: checklistByJob.get(String(job.id)) ?? null,
        };
      }),
      windowDays: window.days,
    });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'employee_load_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
