/**
 * Payroll calculation and approval. No disbursement, tax withholding or paid
 * payroll service is performed here. Gross wages are derived from the approved
 * timekeeping intervals and their captured rate snapshots.
 */
import type { D1Database } from '../admin/d1.ts';
import { AdminAuthError, audit, type AdminActor } from '../admin/operations.ts';
import { addDays, zonedTimeToUtc } from '../booking/time.ts';

export interface PayrollInterval {
  id: string;
  team_member_id: string;
  kind: string;
  rate_type: string;
  rate_cents: number;
  paid: number;
  started_at: string;
  ended_at: string | null;
  status: string;
}

export interface PayrollEntryResult {
  teamMemberId: string;
  regularMinutes: number;
  overtimeMinutes: number;
  regularCents: number;
  overtimeCents: number;
  adjustmentsCents: number;
  grossCents: number;
  weeks: Record<string, { regularMinutes: number; overtimeMinutes: number }>;
  intervals: number;
}

function localDate(instant: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant));
}

function weekKey(instant: string): string {
  const date = localDate(instant);
  const [year, month, day] = date.split('-').map(Number);
  const noon = new Date(Date.UTC(year!, (month ?? 1) - 1, day ?? 1, 12));
  const weekday = noon.getUTCDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  return new Date(noon.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
}

function minutes(interval: PayrollInterval): number {
  if (!interval.ended_at) return 0;
  const start = Date.parse(interval.started_at);
  const end = Date.parse(interval.ended_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60_000);
}

export function calculatePayrollEntries(
  intervals: PayrollInterval[],
  adjustments: Array<{ team_member_id: string; amount_cents: number }>,
): Map<string, PayrollEntryResult> {
  const byMember = new Map<
    string,
    Array<PayrollInterval & { minutes: number; week: string }>
  >();
  for (const interval of intervals) {
    if (Number(interval.paid) !== 1) continue;
    if (interval.kind !== 'work') continue;
    if (!['closed', 'corrected'].includes(interval.status)) continue;
    const length = minutes(interval);
    if (length <= 0) continue;
    const list = byMember.get(interval.team_member_id) ?? [];
    list.push({ ...interval, minutes: length, week: weekKey(interval.started_at) });
    byMember.set(interval.team_member_id, list);
  }
  const result = new Map<string, PayrollEntryResult>();
  for (const [teamMemberId, list] of byMember) {
    list.sort((a, b) => a.started_at.localeCompare(b.started_at));
    const perWeek = new Map<string, number>();
    let regularMinutes = 0;
    let overtimeMinutes = 0;
    let regularCents = 0;
    let overtimeCents = 0;
    for (const interval of list) {
      const used = perWeek.get(interval.week) ?? 0;
      const regular = Math.max(0, Math.min(interval.minutes, 2400 - used));
      const overtime = interval.minutes - regular;
      perWeek.set(interval.week, used + regular);
      regularMinutes += regular;
      overtimeMinutes += overtime;
      regularCents += Math.round((interval.rate_cents * regular) / 60);
      overtimeCents += Math.round((interval.rate_cents * 1.5 * overtime) / 60);
    }
    const adjustmentCents = adjustments
      .filter((entry) => entry.team_member_id === teamMemberId)
      .reduce((sum, entry) => sum + Number(entry.amount_cents || 0), 0);
    result.set(teamMemberId, {
      teamMemberId,
      regularMinutes,
      overtimeMinutes,
      regularCents,
      overtimeCents,
      adjustmentsCents: adjustmentCents,
      grossCents: Math.max(0, regularCents + overtimeCents + adjustmentCents),
      weeks: Object.fromEntries(
        [...perWeek.entries()].map(([week, regular]) => [
          week,
          {
            regularMinutes: regular,
            overtimeMinutes: list
              .filter((entry) => entry.week === week)
              .reduce((sum, entry) => sum + entry.minutes, 0) - regular,
          },
        ]),
      ),
      intervals: list.length,
    });
  }
  // A member may have only adjustments in a period.
  for (const adjustment of adjustments) {
    if (result.has(adjustment.team_member_id)) continue;
    const amount = Number(adjustment.amount_cents || 0);
    result.set(adjustment.team_member_id, {
      teamMemberId: adjustment.team_member_id,
      regularMinutes: 0,
      overtimeMinutes: 0,
      regularCents: 0,
      overtimeCents: 0,
      adjustmentsCents: amount,
      grossCents: Math.max(0, amount),
      weeks: {},
      intervals: 0,
    });
  }
  return result;
}

function periodValid(start: string, end: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(start) &&
    /^\d{4}-\d{2}-\d{2}$/.test(end) &&
    end >= start
  );
}

export async function createPayrollPeriod(
  db: D1Database,
  actor: AdminActor,
  input: { periodStart: string; periodEnd: string; notes?: string },
): Promise<{ id: string }> {
  if (!['owner', 'manager'].includes(actor.role)) throw new AdminAuthError(403, 'admin_required');
  if (!periodValid(input.periodStart, input.periodEnd)) {
    throw new AdminAuthError(400, 'payroll_period_invalid');
  }
  const id = `payroll_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO payroll_periods
       (id, period_start, period_end, notes, created_by_admin_user_id)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, input.periodStart, input.periodEnd, String(input.notes ?? '').slice(0, 1000), actor.id)
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'payroll.period_created',
    entityType: 'payroll_period',
    entityId: id,
    detail: `${input.periodStart}..${input.periodEnd}`,
  });
  return { id };
}

export async function calculatePayrollPeriod(
  db: D1Database,
  actor: AdminActor,
  periodId: string,
): Promise<{ entries: number; grossCents: number }> {
  const period = await db
    .prepare('SELECT * FROM payroll_periods WHERE id = ? LIMIT 1')
    .bind(periodId)
    .first<{ id: string; period_start: string; period_end: string; status: string }>();
  if (!period) throw new AdminAuthError(404, 'payroll_period_not_found');
  if (period.status === 'approved') throw new AdminAuthError(409, 'payroll_period_approved');
  if (period.status === 'void') throw new AdminAuthError(409, 'payroll_period_void');
  const startIso = zonedTimeToUtc(period.period_start, '00:00', 'America/Chicago').toISOString();
  const endExclusive = zonedTimeToUtc(
    addDays(period.period_end, 1),
    '00:00',
    'America/Chicago',
  ).toISOString();
  const intervals = await db
    .prepare(
      `SELECT id, team_member_id, kind, rate_type, rate_cents, paid, started_at, ended_at, status
       FROM time_intervals
       WHERE started_at >= ? AND started_at < ? AND ended_at IS NOT NULL
       ORDER BY started_at`,
    )
    .bind(startIso, endExclusive)
    .all<PayrollInterval>();
  const adjustments = await db
    .prepare('SELECT team_member_id, amount_cents FROM payroll_adjustments WHERE period_id = ?')
    .bind(periodId)
    .all<{ team_member_id: string; amount_cents: number }>();
  const entries = calculatePayrollEntries(intervals.results ?? [], adjustments.results ?? []);
  let gross = 0;
  for (const entry of entries.values()) {
    gross += entry.grossCents;
    await db
      .prepare(
        `INSERT INTO payroll_entries
         (id, period_id, team_member_id, regular_minutes, overtime_minutes,
          regular_cents, overtime_cents, adjustments_cents, gross_cents, rate_snapshot_json, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'calculated')
         ON CONFLICT(period_id, team_member_id) DO UPDATE SET
           regular_minutes = excluded.regular_minutes,
           overtime_minutes = excluded.overtime_minutes,
           regular_cents = excluded.regular_cents,
           overtime_cents = excluded.overtime_cents,
           adjustments_cents = excluded.adjustments_cents,
           gross_cents = excluded.gross_cents,
           rate_snapshot_json = excluded.rate_snapshot_json,
           status = 'calculated',
           updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(
        `payentry_${crypto.randomUUID()}`,
        periodId,
        entry.teamMemberId,
        entry.regularMinutes,
        entry.overtimeMinutes,
        entry.regularCents,
        entry.overtimeCents,
        entry.adjustmentsCents,
        entry.grossCents,
        JSON.stringify({ weeks: entry.weeks, intervals: entry.intervals }),
      )
      .run();
  }
  await db
    .prepare(
      "UPDATE payroll_periods SET status = 'calculated', calculated_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
    .bind(new Date().toISOString(), periodId)
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'payroll.period_calculated',
    entityType: 'payroll_period',
    entityId: periodId,
    detail: `${entries.size} entries; gross ${gross}`,
  });
  return { entries: entries.size, grossCents: gross };
}

export async function approvePayrollPeriod(
  db: D1Database,
  actor: AdminActor,
  periodId: string,
): Promise<void> {
  if (actor.role !== 'owner') throw new AdminAuthError(403, 'owner_required');
  const period = await db
    .prepare('SELECT status FROM payroll_periods WHERE id = ? LIMIT 1')
    .bind(periodId)
    .first<{ status: string }>();
  if (!period) throw new AdminAuthError(404, 'payroll_period_not_found');
  if (period.status !== 'calculated') throw new AdminAuthError(409, 'payroll_period_not_calculated');
  await db
    .prepare(
      `UPDATE payroll_periods SET status = 'approved', approved_at = ?,
         approved_by_admin_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
    .bind(new Date().toISOString(), actor.id, periodId)
    .run();
  await db
    .prepare("UPDATE payroll_entries SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE period_id = ?")
    .bind(periodId)
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'payroll.period_approved',
    entityType: 'payroll_period',
    entityId: periodId,
  });
}

export async function addPayrollAdjustment(
  db: D1Database,
  actor: AdminActor,
  input: {
    periodId: string;
    teamMemberId: string;
    kind: string;
    label: string;
    amountCents: number;
  },
): Promise<{ id: string }> {
  if (!['owner', 'manager'].includes(actor.role)) throw new AdminAuthError(403, 'admin_required');
  const period = await db
    .prepare('SELECT status FROM payroll_periods WHERE id = ? LIMIT 1')
    .bind(input.periodId)
    .first<{ status: string }>();
  if (!period) throw new AdminAuthError(404, 'payroll_period_not_found');
  if (period.status === 'approved') throw new AdminAuthError(409, 'payroll_period_approved');
  const kind = ['travel', 'bonus', 'deduction', 'adjustment'].includes(input.kind)
    ? input.kind
    : 'adjustment';
  const label = String(input.label ?? '').trim().slice(0, 200);
  if (!label) throw new AdminAuthError(400, 'payroll_adjustment_label_required');
  const amount = Math.round(Number(input.amountCents));
  if (!Number.isFinite(amount) || amount === 0) {
    throw new AdminAuthError(400, 'payroll_adjustment_amount_invalid');
  }
  const id = `payadj_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO payroll_adjustments
       (id, period_id, team_member_id, kind, label, amount_cents, created_by_admin_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.periodId, input.teamMemberId, kind, label, amount, actor.id)
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'payroll.adjustment_added',
    entityType: 'payroll_period',
    entityId: input.periodId,
    detail: `${kind}:${amount}`,
  });
  return { id };
}

export async function listPayrollPeriods(
  db: D1Database,
): Promise<Array<Record<string, unknown>>> {
  const rows = await db
    .prepare(
      `SELECT p.*, (SELECT COALESCE(SUM(gross_cents),0) FROM payroll_entries e WHERE e.period_id = p.id) AS gross_cents,
              (SELECT COUNT(*) FROM payroll_entries e WHERE e.period_id = p.id) AS employee_count
       FROM payroll_periods p ORDER BY p.period_start DESC LIMIT 100`,
    )
    .all<Record<string, unknown>>();
  return rows.results ?? [];
}

export async function getPayrollPeriod(
  db: D1Database,
  periodId: string,
): Promise<{
  period: Record<string, unknown>;
  entries: Array<Record<string, unknown>>;
  adjustments: Array<Record<string, unknown>>;
}> {
  const period = await db
    .prepare('SELECT * FROM payroll_periods WHERE id = ? LIMIT 1')
    .bind(periodId)
    .first<Record<string, unknown>>();
  if (!period) throw new AdminAuthError(404, 'payroll_period_not_found');
  const [entries, adjustments] = await Promise.all([
    db
      .prepare(
        `SELECT e.*, tm.display_name, tm.email
         FROM payroll_entries e JOIN team_members tm ON tm.id = e.team_member_id
         WHERE e.period_id = ? ORDER BY tm.display_name`,
      )
      .bind(periodId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT a.*, tm.display_name FROM payroll_adjustments a
         JOIN team_members tm ON tm.id = a.team_member_id
         WHERE a.period_id = ? ORDER BY a.created_at`,
      )
      .bind(periodId)
      .all<Record<string, unknown>>(),
  ]);
  return {
    period,
    entries: entries.results ?? [],
    adjustments: adjustments.results ?? [],
  };
}

export function payrollCsv(
  period: Record<string, unknown>,
  entries: Array<Record<string, unknown>>,
): string {
  const header = [
    'Period Start',
    'Period End',
    'Employee',
    'Email',
    'Regular Hours',
    'Overtime Hours',
    'Regular Pay',
    'Overtime Pay',
    'Adjustments',
    'Gross Pay',
    'Status',
  ];
  const lines = entries.map((entry) => [
    String(period.period_start ?? ''),
    String(period.period_end ?? ''),
    String(entry.display_name ?? ''),
    String(entry.email ?? ''),
    (Number(entry.regular_minutes ?? 0) / 60).toFixed(2),
    (Number(entry.overtime_minutes ?? 0) / 60).toFixed(2),
    (Number(entry.regular_cents ?? 0) / 100).toFixed(2),
    (Number(entry.overtime_cents ?? 0) / 100).toFixed(2),
    (Number(entry.adjustments_cents ?? 0) / 100).toFixed(2),
    (Number(entry.gross_cents ?? 0) / 100).toFixed(2),
    String(entry.status ?? ''),
  ]);
  return [header, ...lines]
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
    .join('\n');
}
