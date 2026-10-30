import { adminDb, type AdminDbEnv, type D1Database } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, audit, requireActor, requireCsrf, type AdminActor } from '../../../src/lib/admin/operations.ts';
import { managerOrOwner } from '../../../src/lib/employee/server.ts';
import { inviteAdmin } from '../../../src/lib/admin/accounts.ts';
import { buildOpsInvitationEmail, sendAdminEmail } from '../../../src/lib/admin/email.ts';
import {
  DEFAULT_RATES_CENTS,
  formatMinutes,
  formatMoney,
  isMissingClockOut,
  normaliseRateType,
  summarizeIntervals,
  workweekBounds,
  type TimeIntervalLike,
} from '../../../src/lib/employee/timekeeping.ts';

interface Env extends AdminDbEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  PUBLIC_SITE_URL?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function text(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function iso(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : '';
}

function validDateKey(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function branchScope(actor: AdminActor, column: string): { sql: string; bind: unknown[] } {
  if (actor.role === 'owner') return { sql: '', bind: [] };
  if (!actor.branchId) return { sql: ' AND 1 = 0', bind: [] };
  return { sql: ` AND ${column} = ?`, bind: [actor.branchId] };
}

async function weekPayload(
  db: D1Database,
  actor: AdminActor,
  weekStartInput: string,
): Promise<Record<string, unknown>> {
  const current = workweekBounds(new Date());
  const start = weekStartInput || current.startDate;
  const bounds = workweekBounds(new Date(`${start}T12:00:00Z`));
  const scope = branchScope(actor, 'tm.branch_id');
  const members = await db
    .prepare(
      `SELECT tm.id, tm.display_name, tm.email, tm.status, tm.admin_user_id, tm.branch_id,
              tm.default_rate_type, tm.pay_rate_regular_cents, tm.pay_rate_lead_cents, tm.pay_rate_solo_cents
       FROM team_members tm WHERE tm.status <> 'inactive' ${scope.sql} ORDER BY tm.display_name`,
    )
    .bind(...scope.bind)
    .all<Record<string, unknown>>();
  const intervals = await db
    .prepare(
      `SELECT ti.*, tm.display_name FROM time_intervals ti
       JOIN team_members tm ON tm.id = ti.team_member_id
       WHERE ti.started_at >= ? AND ti.started_at < ? ${scope.sql}
       ORDER BY ti.started_at`,
    )
    .bind(bounds.startIso, bounds.endIso, ...scope.bind)
    .all<Record<string, unknown>>();
  const events = await db
    .prepare(
      `SELECT te.id, te.admin_user_id, te.team_member_id, te.appointment_id, te.action, te.occurred_at,
              te.lat, te.lng, te.accuracy_m, te.location_status, tm.display_name
       FROM time_events te JOIN team_members tm ON tm.id = te.team_member_id
       WHERE te.occurred_at >= ? AND te.occurred_at < ? ${scope.sql}
       ORDER BY te.occurred_at DESC LIMIT 500`,
    )
    .bind(bounds.startIso, bounds.endIso, ...scope.bind)
    .all<Record<string, unknown>>();
  const corrections = await db
    .prepare(
      `SELECT tcr.id, tcr.interval_id, tcr.admin_user_id, tcr.requested_started_at, tcr.requested_ended_at,
              tcr.message, tcr.status, tcr.created_at, tm.display_name
       FROM time_correction_requests tcr
       JOIN team_members tm ON tm.admin_user_id = tcr.admin_user_id
       WHERE tcr.created_at >= ? AND tcr.status = 'pending' ${scope.sql}
       ORDER BY tcr.created_at DESC LIMIT 100`,
    )
    .bind(bounds.startIso, ...scope.bind)
    .all<Record<string, unknown>>();
  const now = new Date();
  const employees = (members.results ?? []).map((member) => {
    const rows = (intervals.results ?? []).filter((interval) => interval.team_member_id === member.id);
    const totals = summarizeIntervals(rows as unknown as TimeIntervalLike[], now);
    return {
      ...member,
      intervals: rows,
      totals: {
        ...totals,
        workLabel: formatMinutes(totals.workMinutes),
        breakLabel: formatMinutes(totals.breakMinutes),
        mealLabel: formatMinutes(totals.mealMinutes),
        overtimeLabel: formatMinutes(totals.overtimeMinutes),
        grossLabel: formatMoney(totals.grossCents),
      },
      openInterval: rows.find((interval) => !interval.ended_at) ?? null,
      missingClockOut: rows.some((interval) => isMissingClockOut(interval as unknown as TimeIntervalLike, now)),
    };
  });
  return {
    weekStart: bounds.startDate,
    weekEnd: bounds.endDate,
    employees,
    events: events.results ?? [],
    corrections: corrections.results ?? [],
  };
}

function csvCell(value: unknown): string {
  const raw = String(value ?? '');
  return /[",\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request);
    if (!managerOrOwner(actor)) return json({ ok: false, error: 'forbidden' }, 403);
    const url = new URL(context.request.url);
    const payload = await weekPayload(db, actor, validDateKey(url.searchParams.get('weekStart')));
    if (url.searchParams.get('export') === 'csv') {
      const lines = ['Employee,Started (UTC),Ended (UTC),Kind,Rate,Paid,Minutes,Gross USD,Status,Corrected reason'];
      for (const employee of payload.employees as Array<Record<string, unknown>>) {
        for (const interval of employee.intervals as Array<Record<string, unknown>>) {
          const totals = summarizeIntervals([interval as unknown as TimeIntervalLike], new Date());
          lines.push(
            [
              employee.display_name,
              interval.started_at,
              interval.ended_at ?? '',
              interval.kind,
              interval.rate_type,
              Number(interval.paid) ? 'yes' : 'no',
              totals.workMinutes + totals.breakMinutes + totals.mealMinutes,
              (totals.grossCents / 100).toFixed(2),
              interval.status,
              interval.correction_reason ?? '',
            ]
              .map(csvCell)
              .join(','),
          );
        }
      }
      return new Response(lines.join('\n'), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="sparkling-standard-timecards-${payload.weekStart}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    return json({ ok: true, ...payload });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'timekeeping_load_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request);
    if (!managerOrOwner(actor)) return json({ ok: false, error: 'forbidden' }, 403);
    requireCsrf(context.request, actor);
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = text(body.action, 40);

    if (action === 'correct_interval') {
      const intervalId = text(body.intervalId, 120);
      const row = await db
        .prepare(
          `SELECT ti.*, tm.branch_id FROM time_intervals ti
           LEFT JOIN team_members tm ON tm.id = ti.team_member_id
           WHERE ti.id = ? LIMIT 1`,
        )
        .bind(intervalId)
        .first<Record<string, unknown>>();
      if (!row) return json({ ok: false, error: 'interval_not_found' }, 404);
      const scope = branchScope(actor, 'tm.branch_id');
      if (scope.sql && row.branch_id !== actor.branchId) return json({ ok: false, error: 'forbidden' }, 403);
      const started = iso(body.startedAt);
      const ended = iso(body.endedAt);
      const kind = text(body.kind, 10);
      const rateType = normaliseRateType(body.rateType) ?? normaliseRateType(row.rate_type) ?? 'regular';
      const reason = text(body.reason, 500);
      if (!started || !ended || Date.parse(ended) <= Date.parse(started)) {
        return json({ ok: false, error: 'invalid_interval' }, 400);
      }
      if (!['work', 'break', 'meal'].includes(kind)) return json({ ok: false, error: 'invalid_kind' }, 400);
      if (!reason) return json({ ok: false, error: 'correction_reason_required' }, 400);
      const paid = body.paid === undefined ? Number(row.paid) : body.paid === true ? 1 : 0;
      const rateCents =
        Number(body.rateCents) > 0
          ? Math.round(Number(body.rateCents))
          : rateType === 'lead'
            ? Number(row.rate_cents) || DEFAULT_RATES_CENTS.lead
            : rateType === 'solo'
              ? Number(row.rate_cents) || DEFAULT_RATES_CENTS.solo
              : Number(row.rate_cents) || DEFAULT_RATES_CENTS.regular;
      await db
        .prepare(
          `UPDATE time_intervals SET started_at = ?, ended_at = ?, kind = ?, rate_type = ?, rate_cents = ?,
             paid = ?, status = 'corrected', corrected_by_admin_user_id = ?, correction_reason = ?,
             updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        )
        .bind(started, ended, kind, rateType, rateCents, paid, actor.id, reason, intervalId)
        .run();
      await db
        .prepare(
          `INSERT INTO time_entry_corrections (id, interval_id, before_json, after_json, reason, corrected_by_admin_user_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          `tcorr_${crypto.randomUUID()}`,
          intervalId,
          JSON.stringify({
            started_at: row.started_at,
            ended_at: row.ended_at,
            kind: row.kind,
            rate_type: row.rate_type,
            paid: row.paid,
          }),
          JSON.stringify({ started_at: started, ended_at: ended, kind, rate_type: rateType, paid }),
          reason,
          actor.id,
        )
        .run();
      await audit(db, {
        actorUserId: actor.id,
        action: 'timekeeping.interval_corrected',
        entityType: 'time_interval',
        entityId: intervalId,
        detail: reason,
      });
      return json({ ok: true });
    }

    if (action === 'review_correction') {
      const id = text(body.correctionId, 120);
      const status = body.approve === true ? 'approved' : 'declined';
      const row = await db
        .prepare('SELECT id FROM time_correction_requests WHERE id = ? LIMIT 1')
        .bind(id)
        .first();
      if (!row) return json({ ok: false, error: 'correction_not_found' }, 404);
      await db
        .prepare('UPDATE time_correction_requests SET status = ?, reviewed_by_admin_user_id = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(status, actor.id, id)
        .run();
      await audit(db, {
        actorUserId: actor.id,
        action: `timekeeping.correction_${status}`,
        entityType: 'time_correction',
        entityId: id,
      });
      return json({ ok: true, status });
    }

    if (action === 'link_member') {
      const teamMemberId = text(body.teamMemberId, 100);
      const email = text(body.email, 200).toLowerCase();
      const adminUserId = text(body.adminUserId, 100);
      const user = email
        ? await db
            .prepare("SELECT id, role_id FROM admin_users WHERE lower(email) = ? AND status = 'active' LIMIT 1")
            .bind(email)
            .first<{ id: string; role_id: string }>()
        : await db
            .prepare("SELECT id, role_id FROM admin_users WHERE id = ? AND status = 'active' LIMIT 1")
            .bind(adminUserId)
            .first<{ id: string; role_id: string }>();
      if (!user) return json({ ok: false, error: 'admin_not_found' }, 404);
      if (!['cleaner', 'manager'].includes(user.role_id)) {
        return json({ ok: false, error: 'employee_role_required' }, 400);
      }
      const member = await db.prepare('SELECT id FROM team_members WHERE id = ? LIMIT 1').bind(teamMemberId).first();
      if (!member) return json({ ok: false, error: 'team_member_not_found' }, 404);
      await db.prepare('UPDATE team_members SET admin_user_id = NULL WHERE admin_user_id = ? AND id <> ?').bind(adminUserId, teamMemberId).run();
      await db
        .prepare('UPDATE team_members SET admin_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(adminUserId, teamMemberId)
        .run();
      await audit(db, {
        actorUserId: actor.id,
        action: 'timekeeping.member_linked',
        entityType: 'team_member',
        entityId: teamMemberId,
        detail: adminUserId,
      });
      return json({ ok: true });
    }

    if (action === 'set_rate') {
      if (actor.role !== 'owner') return json({ ok: false, error: 'owner_required' }, 403);
      const teamMemberId = text(body.teamMemberId, 100);
      const rateType = normaliseRateType(body.rateType);
      const hourlyCents = Math.round(Number(body.hourlyCents));
      const effectiveFrom = text(body.effectiveFrom, 10) || new Date().toISOString().slice(0, 10);
      if (!rateType || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || !Number.isFinite(hourlyCents) || hourlyCents < 0 || hourlyCents > 100_000) {
        return json({ ok: false, error: 'rate_invalid' }, 400);
      }
      const member = await db.prepare('SELECT id FROM team_members WHERE id = ? LIMIT 1').bind(teamMemberId).first();
      if (!member) return json({ ok: false, error: 'team_member_not_found' }, 404);
      const column = rateType === 'lead' ? 'pay_rate_lead_cents' : rateType === 'solo' ? 'pay_rate_solo_cents' : 'pay_rate_regular_cents';
      await db.prepare(`UPDATE team_members SET ${column} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(hourlyCents, teamMemberId).run();
      await db
        .prepare(
          `INSERT INTO employee_rate_history (id, team_member_id, rate_type, hourly_cents, effective_from, created_by_admin_user_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(`rate_${crypto.randomUUID()}`, teamMemberId, rateType, hourlyCents, effectiveFrom, actor.id)
        .run();
      await audit(db, {
        actorUserId: actor.id,
        action: 'timekeeping.rate_updated',
        entityType: 'team_member',
        entityId: teamMemberId,
        detail: `${rateType}:${hourlyCents}:${effectiveFrom}`,
      });
      return json({ ok: true });
    }

    if (action === 'invite_employee') {
      const email = text(body.email, 200).toLowerCase();
      const branchId = text(body.branchId, 80) || actor.branchId || null;
      if (!email) return json({ ok: false, error: 'email_required' }, 400);
      const result = await inviteAdmin(db, actor, { email, role: 'cleaner', branchId });
      const origin = context.env.PUBLIC_SITE_URL?.trim() || new URL(context.request.url).origin;
      const emailSent = await sendAdminEmail(
        {
          ...(context.env.RESEND_API_KEY ? { RESEND_API_KEY: context.env.RESEND_API_KEY } : {}),
          ...(context.env.RESEND_FROM_EMAIL ? { RESEND_FROM_EMAIL: context.env.RESEND_FROM_EMAIL } : {}),
          PUBLIC_SITE_URL: origin,
        },
        email,
        buildOpsInvitationEmail({ PUBLIC_SITE_URL: origin }, result.token, 'cleaner'),
        `employee-invite-${result.token.slice(0, 16)}`,
      );
      return json({ ok: true, ...result, emailSent });
    }

    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'timekeeping_update_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
