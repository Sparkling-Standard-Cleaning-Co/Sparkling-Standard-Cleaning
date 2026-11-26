/**
 * Payroll calculation and approval. No disbursement, tax withholding or paid
 * payroll service is performed here. Gross wages are derived from the approved
 * timekeeping intervals and their captured rate snapshots.
 *
 * Overtime follows the FLSA workweek: the regular rate is the weighted average
 * of all straight-time compensation for the workweek (mixed regular/lead/solo
 * rates, compensable travel, paid rest breaks, and nondiscretionary additions).
 * Overtime hours receive an additional half-time premium at that weighted rate.
 * The workweek begins Monday 00:00 in the employee's branch time zone.
 */
import type { D1Database } from '../admin/d1.ts';
import { AdminAuthError, audit, type AdminActor } from '../admin/operations.ts';

export interface PayrollInterval {
  id: string;
  team_member_id: string;
  kind: string;
  is_travel?: number | boolean | null;
  rate_type: string;
  rate_cents: number;
  paid: number;
  started_at: string;
  ended_at: string | null;
  status: string;
  time_zone?: string | null;
}

export interface PayrollAdjustment {
  id?: string;
  team_member_id: string;
  kind?: string;
  label?: string;
  amount_cents: number;
}

export interface PayrollEntryResult {
  teamMemberId: string;
  regularMinutes: number;
  overtimeMinutes: number;
  regularCents: number;
  overtimeCents: number;
  adjustmentsCents: number;
  grossCents: number;
  weeks: Record<
    string,
    {
      regularMinutes: number;
      overtimeMinutes: number;
      totalMinutes: number;
      weightedRegularRateCents: number;
    }
  >;
  intervals: number;
}

export interface PayrollPeriodRange {
  periodStart: string;
  periodEnd: string;
}

const DEFAULT_TIME_ZONE = 'America/Chicago';
const OVERTIME_AFTER_MS = 40 * 60 * 60 * 1000;
const NONDISCRETIONARY_KINDS = new Set(['travel', 'bonus', 'adjustment']);

function timeZone(value: string | null | undefined): string {
  if (!value) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return value;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
}

function zonedParts(date: Date, zone: string): ZonedParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  ) as unknown as ZonedParts;
  return { year: parts.year, month: parts.month, day: parts.day };
}

function dateKey(date: Date, zone: string): string {
  const parts = zonedParts(date, zone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function offsetMinutes(date: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)]) as Array<[string, number]>;
  const values = Object.fromEntries(parts) as Record<string, number>;
  const asUtc = Date.UTC(
    values.year ?? 1970,
    (values.month ?? 1) - 1,
    values.day ?? 1,
    (values.hour ?? 0) % 24,
    values.minute ?? 0,
    values.second ?? 0,
  );
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

function midnightUtc(dateKeyValue: string, zone: string): Date {
  const [year, month, day] = dateKeyValue.split('-').map(Number);
  const guess = Date.UTC(year!, (month ?? 1) - 1, day ?? 1, 0, 0, 0);
  let instant = guess - offsetMinutes(new Date(guess), zone) * 60_000;
  instant = guess - offsetMinutes(new Date(instant), zone) * 60_000;
  return new Date(instant);
}

function shiftDateKey(dateKeyValue: string, days: number): string {
  const [year, month, day] = dateKeyValue.split('-').map(Number);
  return new Date(Date.UTC(year!, (month ?? 1) - 1, (day ?? 1) + days, 12))
    .toISOString()
    .slice(0, 10);
}

function weekStartKey(dateKeyValue: string): string {
  const [year, month, day] = dateKeyValue.split('-').map(Number);
  const weekday = new Date(Date.UTC(year!, (month ?? 1) - 1, day ?? 1, 12)).getUTCDay();
  return shiftDateKey(dateKeyValue, -((weekday + 6) % 7));
}

function isCompensable(interval: PayrollInterval): boolean {
  if (Number(interval.is_travel) === 1) return true;
  if (interval.kind === 'work') return true;
  if (interval.kind === 'break') {
    return interval.paid === undefined || interval.paid === null
      ? true
      : Number(interval.paid) === 1;
  }
  return Number(interval.paid) === 1;
}

function isFinalized(interval: PayrollInterval): boolean {
  return (
    Boolean(interval.ended_at) &&
    ['closed', 'corrected', 'approved'].includes(String(interval.status))
  );
}

interface WeekSegment {
  week: string;
  startMs: number;
  endMs: number;
  rateCents: number;
  zone: string;
}

function splitIntoWeeks(interval: PayrollInterval): WeekSegment[] {
  const zone = timeZone(interval.time_zone);
  const startMs = Date.parse(interval.started_at);
  const endMs = Date.parse(interval.ended_at ?? '');
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
  const rateCents = Math.max(0, Math.round(Number(interval.rate_cents) || 0));
  const segments: WeekSegment[] = [];
  let cursor = startMs;
  let guard = 0;
  while (cursor < endMs && guard < 20) {
    guard += 1;
    const currentKey = dateKey(new Date(cursor), zone);
    const week = weekStartKey(currentKey);
    const boundary = midnightUtc(shiftDateKey(week, 7), zone).getTime();
    const segmentEnd = Math.min(endMs, boundary);
    if (segmentEnd <= cursor) break;
    segments.push({ week, startMs: cursor, endMs: segmentEnd, rateCents, zone });
    cursor = segmentEnd;
  }
  return segments;
}

function roundMinutes(ms: number): number {
  return Math.round(ms / 60_000);
}

/**
 * Pure calculation over finalized intervals. When a period is supplied, only
 * the portion of each workweek that falls inside the pay period is paid, while
 * the overtime threshold still considers the complete workweek.
 */
export function calculatePayrollEntries(
  intervals: PayrollInterval[],
  adjustments: PayrollAdjustment[],
  period?: PayrollPeriodRange,
): Map<string, PayrollEntryResult> {
  const byMember = new Map<string, PayrollInterval[]>();
  for (const interval of intervals) {
    if (!isFinalized(interval)) continue;
    if (!isCompensable(interval)) continue;
    const list = byMember.get(interval.team_member_id) ?? [];
    list.push(interval);
    byMember.set(interval.team_member_id, list);
  }
  const adjustmentsByMember = new Map<string, PayrollAdjustment[]>();
  for (const adjustment of adjustments) {
    const list = adjustmentsByMember.get(adjustment.team_member_id) ?? [];
    list.push(adjustment);
    adjustmentsByMember.set(adjustment.team_member_id, list);
  }

  const result = new Map<string, PayrollEntryResult>();
  for (const [teamMemberId, list] of byMember) {
    list.sort((a, b) => a.started_at.localeCompare(b.started_at));
    const weeks = new Map<string, WeekSegment[]>();
    for (const interval of list) {
      for (const segment of splitIntoWeeks(interval)) {
        const segments = weeks.get(segment.week) ?? [];
        segments.push(segment);
        weeks.set(segment.week, segments);
      }
    }
    for (const segments of weeks.values()) segments.sort((a, b) => a.startMs - b.startMs);

    const memberAdjustments = adjustmentsByMember.get(teamMemberId) ?? [];
    const adjustmentTotal = memberAdjustments.reduce(
      (sum, entry) => sum + Number(entry.amount_cents || 0),
      0,
    );
    const nondiscretionaryTotal = memberAdjustments
      .filter(
        (entry) =>
          NONDISCRETIONARY_KINDS.has(String(entry.kind ?? 'adjustment')) &&
          Number(entry.amount_cents) > 0,
      )
      .reduce((sum, entry) => sum + Number(entry.amount_cents || 0), 0);
    const allWeekMs = [...weeks.values()]
      .flat()
      .reduce((sum, segment) => sum + (segment.endMs - segment.startMs), 0);
    const memberZone = timeZone(list[0]?.time_zone);

    let regularMs = 0;
    let overtimeMs = 0;
    let regularCents = 0;
    let overtimeCents = 0;
    const weekSummary: PayrollEntryResult['weeks'] = {};

    for (const [week, segments] of weeks) {
      const weekMs = segments.reduce((sum, segment) => sum + (segment.endMs - segment.startMs), 0);
      if (weekMs <= 0) continue;
      const weekStraightCents = segments.reduce(
        (sum, segment) =>
          sum + Math.round((segment.rateCents * (segment.endMs - segment.startMs)) / 3_600_000),
        0,
      );
      const allocatedAdjustment =
        nondiscretionaryTotal > 0 && allWeekMs > 0
          ? Math.round((nondiscretionaryTotal * weekMs) / allWeekMs)
          : 0;
      const regularRateCents =
        weekMs > 0 ? (weekStraightCents + allocatedAdjustment) / (weekMs / 3_600_000) : 0;
      const overtimeWeekMs = Math.max(0, weekMs - OVERTIME_AFTER_MS);
      weekSummary[week] = {
        regularMinutes: roundMinutes(weekMs - overtimeWeekMs),
        overtimeMinutes: roundMinutes(overtimeWeekMs),
        totalMinutes: roundMinutes(weekMs),
        weightedRegularRateCents: Math.round(regularRateCents),
      };

      const periodStartMs = period
        ? midnightUtc(period.periodStart, memberZone).getTime()
        : -Infinity;
      const periodEndMs = period
        ? midnightUtc(shiftDateKey(period.periodEnd, 1), memberZone).getTime()
        : Infinity;
      let cumulativeMs = 0;
      let weekOutputOvertimeMs = 0;
      for (const segment of segments) {
        const segmentMs = segment.endMs - segment.startMs;
        const regularStart = cumulativeMs;
        const outStart = Math.max(segment.startMs, periodStartMs);
        const outEnd = Math.min(segment.endMs, periodEndMs);
        if (outEnd > outStart) {
          regularCents += Math.round(
            (segment.rateCents * (outEnd - outStart)) / 3_600_000,
          );
          const outputStartOffset = outStart - segment.startMs;
          const outputEndOffset = outEnd - segment.startMs;
          const regularPortionEnd = Math.max(
            0,
            Math.min(segmentMs, OVERTIME_AFTER_MS - regularStart),
          );
          const regularOverlapStart = Math.max(0, outputStartOffset);
          const regularOverlapEnd = Math.min(outputEndOffset, regularPortionEnd);
          if (regularOverlapEnd > regularOverlapStart) {
            regularMs += regularOverlapEnd - regularOverlapStart;
          }
          const overtimeStart = Math.max(outputStartOffset, regularPortionEnd);
          if (outputEndOffset > overtimeStart) {
            overtimeMs += outputEndOffset - overtimeStart;
            weekOutputOvertimeMs += outputEndOffset - overtimeStart;
          }
        }
        cumulativeMs = regularStart + segmentMs;
      }
      if (weekOutputOvertimeMs > 0) {
        overtimeCents += Math.round(
          ((weekStraightCents + allocatedAdjustment) * weekOutputOvertimeMs) / (2 * weekMs),
        );
      }
    }

    result.set(teamMemberId, {
      teamMemberId,
      regularMinutes: roundMinutes(regularMs),
      overtimeMinutes: roundMinutes(overtimeMs),
      regularCents,
      overtimeCents,
      adjustmentsCents: adjustmentTotal,
      grossCents: Math.max(0, regularCents + overtimeCents + adjustmentTotal),
      weeks: weekSummary,
      intervals: list.length,
    });
  }

  // Adjustments may exist for an employee without finalized time intervals.
  for (const [teamMemberId, list] of adjustmentsByMember) {
    if (result.has(teamMemberId)) continue;
    const total = list.reduce((sum, entry) => sum + Number(entry.amount_cents || 0), 0);
    result.set(teamMemberId, {
      teamMemberId,
      regularMinutes: 0,
      overtimeMinutes: 0,
      regularCents: 0,
      overtimeCents: 0,
      adjustmentsCents: total,
      grossCents: Math.max(0, total),
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

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function payrollSourceCanonical(
  intervals: PayrollInterval[],
  adjustments: PayrollAdjustment[],
): string {
  const intervalRows = [...intervals]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((interval) => [
      interval.id,
      interval.team_member_id,
      interval.kind,
      Number(interval.is_travel) === 1 ? 1 : 0,
      interval.rate_type,
      Number(interval.rate_cents) || 0,
      Number(interval.paid) === 1 ? 1 : 0,
      interval.started_at,
      interval.ended_at ?? '',
      interval.status,
      interval.time_zone ?? '',
    ]);
  const adjustmentRows = [...adjustments]
    .sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')))
    .map((entry) => [
      entry.id ?? '',
      entry.team_member_id,
      entry.kind ?? 'adjustment',
      entry.label ?? '',
      Number(entry.amount_cents) || 0,
    ]);
  return JSON.stringify({ intervals: intervalRows, adjustments: adjustmentRows });
}

async function payrollSourceHash(
  intervals: PayrollInterval[],
  adjustments: PayrollAdjustment[],
): Promise<string> {
  return sha256Hex(payrollSourceCanonical(intervals, adjustments));
}

interface PayrollPeriodRow {
  id: string;
  period_start: string;
  period_end: string;
  status: string;
  branch_id?: string | null;
  source_hash?: string | null;
  calculated_at?: string | null;
  calculated_intervals?: number | null;
  calculated_gross_cents?: number | null;
}

function assertPeriodScope(actor: AdminActor, period: PayrollPeriodRow): void {
  if (actor.role === 'owner') return;
  if (!actor.branchId || period.branch_id !== actor.branchId) {
    throw new AdminAuthError(403, 'branch_scope_denied');
  }
}

export async function createPayrollPeriod(
  db: D1Database,
  actor: AdminActor,
  input: { periodStart: string; periodEnd: string; notes?: string; branchId?: string },
): Promise<{ id: string }> {
  if (!['owner', 'manager', 'finance'].includes(actor.role)) {
    throw new AdminAuthError(403, 'admin_required');
  }
  if (!periodValid(input.periodStart, input.periodEnd)) {
    throw new AdminAuthError(400, 'payroll_period_invalid');
  }
  const branchId = actor.role === 'owner' ? (input.branchId ?? null) : actor.branchId;
  if (actor.role !== 'owner' && !branchId) throw new AdminAuthError(403, 'branch_scope_denied');
  if (branchId) {
    const branch = await db
      .prepare('SELECT id FROM branches WHERE id = ? LIMIT 1')
      .bind(branchId)
      .first();
    if (!branch) throw new AdminAuthError(400, 'payroll_branch_invalid');
  }
  const id = `payroll_${crypto.randomUUID()}`;
  try {
    await db
      .prepare(
        `INSERT INTO payroll_periods
         (id, branch_id, period_start, period_end, notes, created_by_admin_user_id)
         SELECT ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM payroll_periods
           WHERE period_start = ? AND period_end = ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM payroll_periods
           WHERE status <> 'void' AND period_start <= ? AND period_end >= ?
             AND (? IS NULL OR branch_id = ? OR branch_id IS NULL)
         )`,
      )
      .bind(
        id,
        branchId,
        input.periodStart,
        input.periodEnd,
        String(input.notes ?? '').slice(0, 1000),
        actor.id,
        input.periodStart,
        input.periodEnd,
        input.periodEnd,
        input.periodStart,
        branchId,
        branchId,
      )
      .run();
  } catch (error) {
    if (/unique|constraint/i.test((error as Error).message ?? '')) {
      throw new AdminAuthError(409, 'payroll_period_overlap');
    }
    throw error;
  }
  const inserted = await db
    .prepare('SELECT id FROM payroll_periods WHERE id = ? LIMIT 1')
    .bind(id)
    .first<{ id: string }>();
  if (!inserted) throw new AdminAuthError(409, 'payroll_period_overlap');
  await audit(db, {
    actorUserId: actor.id,
    action: 'payroll.period_created',
    entityType: 'payroll_period',
    entityId: id,
    detail: `${branchId ?? 'all'}:${input.periodStart}..${input.periodEnd}`,
  });
  return { id };
}

async function loadPayrollSources(
  db: D1Database,
  period: PayrollPeriodRow,
): Promise<{ intervals: PayrollInterval[]; adjustments: PayrollAdjustment[] }> {
  // Read the complete workweeks touched by the period so a partial pay period
  // cannot understate weekly overtime. The function then pays only the
  // in-period portion.
  const windowStart = new Date(
    midnightUtc(shiftDateKey(period.period_start, -7), DEFAULT_TIME_ZONE).getTime() - 26 * 3_600_000,
  ).toISOString();
  const windowEnd = new Date(
    midnightUtc(shiftDateKey(period.period_end, 8), DEFAULT_TIME_ZONE).getTime() + 26 * 3_600_000,
  ).toISOString();
  const branchFilter = period.branch_id ? ' AND tm.branch_id = ?' : '';
  const branchBind = period.branch_id ? [period.branch_id] : [];
  const intervalRows = await db
    .prepare(
      `SELECT ti.id, ti.team_member_id, ti.kind,
              COALESCE(ti.is_travel, 0) AS is_travel,
              ti.rate_type, ti.rate_cents, ti.paid, ti.started_at, ti.ended_at, ti.status,
              COALESCE(b.timezone, 'America/Chicago') AS time_zone
       FROM time_intervals ti
       JOIN team_members tm ON tm.id = ti.team_member_id
       LEFT JOIN branches b ON b.id = tm.branch_id
       WHERE ti.started_at >= ? AND ti.started_at < ? AND ti.ended_at IS NOT NULL
         AND ti.status IN ('closed','corrected','approved')${branchFilter}
       ORDER BY ti.started_at`,
    )
    .bind(windowStart, windowEnd, ...branchBind)
    .all<PayrollInterval>();
  const adjustmentRows = await db
    .prepare(
      `SELECT a.id, a.team_member_id, a.kind, a.label, a.amount_cents
       FROM payroll_adjustments a
       JOIN team_members tm ON tm.id = a.team_member_id
       WHERE a.period_id = ?${branchFilter.replace('tm.branch_id', 'tm.branch_id')}`,
    )
    .bind(period.id, ...branchBind)
    .all<PayrollAdjustment>();
  return {
    intervals: intervalRows.results ?? [],
    adjustments: adjustmentRows.results ?? [],
  };
}

export async function calculatePayrollPeriod(
  db: D1Database,
  actor: AdminActor,
  periodId: string,
): Promise<{ entries: number; grossCents: number; recalculated: boolean }> {
  const period = await db
    .prepare('SELECT * FROM payroll_periods WHERE id = ? LIMIT 1')
    .bind(periodId)
    .first<PayrollPeriodRow>();
  if (!period) throw new AdminAuthError(404, 'payroll_period_not_found');
  assertPeriodScope(actor, period);
  if (period.status === 'approved') throw new AdminAuthError(409, 'payroll_period_approved');
  if (period.status === 'void') throw new AdminAuthError(409, 'payroll_period_void');
  const sources = await loadPayrollSources(db, period);
  const entries = calculatePayrollEntries(sources.intervals, sources.adjustments, {
    periodStart: period.period_start,
    periodEnd: period.period_end,
  });
  const sourceHash = await payrollSourceHash(sources.intervals, sources.adjustments);
  let gross = 0;
  const statements = [
    db.prepare("DELETE FROM payroll_entries WHERE period_id = ? AND status = 'calculated'").bind(periodId),
  ];
  for (const entry of entries.values()) {
    gross += entry.grossCents;
    statements.push(
      db
        .prepare(
          `INSERT INTO payroll_entries
           (id, period_id, team_member_id, regular_minutes, overtime_minutes,
            regular_cents, overtime_cents, adjustments_cents, gross_cents, rate_snapshot_json, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'calculated')`,
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
          JSON.stringify({
            method: 'weighted_regular_rate',
            period: { start: period.period_start, end: period.period_end },
            weeks: entry.weeks,
            intervals: entry.intervals,
          }),
        ),
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE payroll_periods SET status = 'calculated', calculated_at = ?, source_hash = ?,
           calculated_intervals = ?, calculated_gross_cents = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status IN ('open','calculated')`,
      )
      .bind(
        new Date().toISOString(),
        sourceHash,
        sources.intervals.length,
        gross,
        periodId,
      ),
  );
  if (db.batch) await db.batch(statements);
  else for (const statement of statements) await statement.run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'payroll.period_calculated',
    entityType: 'payroll_period',
    entityId: periodId,
    detail: `${entries.size} entries; gross ${gross}; source ${sourceHash.slice(0, 12)}`,
  });
  return { entries: entries.size, grossCents: gross, recalculated: Number(period.calculated_intervals ?? 0) > 0 };
}

export async function approvePayrollPeriod(
  db: D1Database,
  actor: AdminActor,
  periodId: string,
): Promise<void> {
  if (actor.role !== 'owner') throw new AdminAuthError(403, 'owner_required');
  const period = await db
    .prepare('SELECT * FROM payroll_periods WHERE id = ? LIMIT 1')
    .bind(periodId)
    .first<PayrollPeriodRow>();
  if (!period) throw new AdminAuthError(404, 'payroll_period_not_found');
  assertPeriodScope(actor, period);
  if (period.status !== 'calculated') throw new AdminAuthError(409, 'payroll_period_not_calculated');
  const sources = await loadPayrollSources(db, period);
  const currentHash = await payrollSourceHash(sources.intervals, sources.adjustments);
  if (!period.source_hash || period.source_hash !== currentHash) {
    throw new AdminAuthError(409, 'payroll_recalculation_required');
  }
  const statements = [
    db
      .prepare(
        `UPDATE payroll_periods SET status = 'approved', approved_at = ?,
           approved_by_admin_user_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'calculated' AND source_hash = ?`,
      )
      .bind(new Date().toISOString(), actor.id, periodId, currentHash),
    db
      .prepare(
        "UPDATE payroll_entries SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE period_id = ?",
      )
      .bind(periodId),
  ];
  if (db.batch) {
    const results = await db.batch(statements);
    const changed = Number((results[0]?.meta?.changes as number | undefined) ?? 1);
    if (changed === 0) throw new AdminAuthError(409, 'payroll_recalculation_required');
  } else {
    for (const statement of statements) await statement.run();
  }
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
  if (!['owner', 'manager', 'finance'].includes(actor.role)) {
    throw new AdminAuthError(403, 'admin_required');
  }
  const period = await db
    .prepare('SELECT * FROM payroll_periods WHERE id = ? LIMIT 1')
    .bind(input.periodId)
    .first<PayrollPeriodRow>();
  if (!period) throw new AdminAuthError(404, 'payroll_period_not_found');
  assertPeriodScope(actor, period);
  if (period.status === 'approved') throw new AdminAuthError(409, 'payroll_period_approved');
  if (period.status === 'void') throw new AdminAuthError(409, 'payroll_period_void');
  if (period.branch_id) {
    const member = await db
      .prepare('SELECT branch_id FROM team_members WHERE id = ? LIMIT 1')
      .bind(input.teamMemberId)
      .first<{ branch_id: string | null }>();
    if (!member || member.branch_id !== period.branch_id) {
      throw new AdminAuthError(403, 'branch_scope_denied');
    }
  }
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
  const statements = [
    db
      .prepare(
        `INSERT INTO payroll_adjustments
         (id, period_id, team_member_id, kind, label, amount_cents, created_by_admin_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, input.periodId, input.teamMemberId, kind, label, amount, actor.id),
  ];
  if (period.status === 'calculated') {
    // A calculated total is now stale. Remove it so it cannot be approved.
    statements.push(
      db
        .prepare(
          "DELETE FROM payroll_entries WHERE period_id = ? AND status = 'calculated'",
        )
        .bind(input.periodId),
      db
        .prepare(
          `UPDATE payroll_periods SET status = 'open', calculated_at = NULL,
             calculated_intervals = 0, calculated_gross_cents = 0, source_hash = '',
             updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        )
        .bind(input.periodId),
    );
  }
  if (db.batch) await db.batch(statements);
  else for (const statement of statements) await statement.run();
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
  actor?: AdminActor,
): Promise<Array<Record<string, unknown>>> {
  const branchFilter =
    actor && actor.role !== 'owner'
      ? actor.branchId
        ? ' WHERE p.branch_id = ?'
        : ' WHERE 1 = 0'
      : '';
  const rows = await db
    .prepare(
      `SELECT p.*, (SELECT COALESCE(SUM(gross_cents),0) FROM payroll_entries e WHERE e.period_id = p.id) AS gross_cents,
              (SELECT COUNT(*) FROM payroll_entries e WHERE e.period_id = p.id) AS employee_count
       FROM payroll_periods p${branchFilter} ORDER BY p.period_start DESC LIMIT 100`,
    )
    .bind(...(branchFilter && actor?.branchId ? [actor.branchId] : []))
    .all<Record<string, unknown>>();
  return rows.results ?? [];
}

export async function getPayrollPeriod(
  db: D1Database,
  periodId: string,
  actor?: AdminActor,
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
  if (actor && actor.role !== 'owner') {
    if (!actor.branchId || String(period.branch_id ?? '') !== actor.branchId) {
      throw new AdminAuthError(403, 'branch_scope_denied');
    }
  }
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
    'Overtime Premium',
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
