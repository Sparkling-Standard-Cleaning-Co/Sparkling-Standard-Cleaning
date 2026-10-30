/**
 * Employee timekeeping rules. Pure and shared by the employee portal, the
 * manager timecards and the tests.
 *
 * - Timestamps are stored in UTC ISO format.
 * - The payroll workweek is Monday 00:00 through Sunday 23:59:59 in
 *   America/Chicago (the published operating timezone).
 * - Short rest breaks are compensated; a fully relieved meal period is
 *   unpaid unless a manager corrects the interval to paid.
 * - Overtime is calculated after 40 compensated hours in the workweek.
 * - Nothing here performs payroll disbursement.
 */

export type TimeIntervalKind = 'work' | 'break' | 'meal';
export type RateType = 'regular' | 'lead' | 'solo';
export type LocationStatus = 'captured' | 'denied' | 'unavailable' | 'inaccurate' | 'not_requested';

export const OVERTIME_AFTER_MINUTES = 40 * 60;
export const MISSING_CLOCK_OUT_MINUTES = 14 * 60;
export const DEFAULT_RATES_CENTS = {
  regular: 1800,
  lead: 2200,
  solo: 2500,
} as const;

export const RATE_LABELS: Record<RateType, string> = {
  regular: 'Regular cleaner',
  lead: 'Lead cleaner',
  solo: 'Solo assignment',
};

export interface TimeIntervalLike {
  id?: string;
  kind: TimeIntervalKind;
  rate_type?: string;
  rate_cents?: number | null;
  paid?: number | boolean | null;
  started_at: string;
  ended_at?: string | null;
  status?: string;
}

export interface TimeTotals {
  workMinutes: number;
  breakMinutes: number;
  mealMinutes: number;
  paidMinutes: number;
  grossCents: number;
  overtimeMinutes: number;
}

const CENTRAL = 'America/Chicago';
const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CENTRAL,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

interface CentralParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function centralParts(date: Date): CentralParts {
  const parts = Object.fromEntries(
    partsFormatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  ) as unknown as CentralParts;
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour % 24,
    minute: parts.minute,
    second: parts.second,
  };
}

/** YYYY-MM-DD in Central Time. */
export function centralDateKey(date: Date): string {
  const parts = centralParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

/** Minutes that local time is behind/ahead of UTC at the given instant. */
function centralOffsetMinutes(date: Date): number {
  const parts = centralParts(date);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

/** UTC instant for a Central-Time calendar date at 00:00:00. */
export function centralMidnightUtc(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  const guess = Date.UTC(year!, month! - 1, day!, 0, 0, 0);
  // Two passes handle the DST transition night correctly.
  let instant = guess - centralOffsetMinutes(new Date(guess)) * 60_000;
  instant = guess - centralOffsetMinutes(new Date(instant)) * 60_000;
  return new Date(instant);
}

function addDaysToKey(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days, 12));
  return date.toISOString().slice(0, 10);
}

function weekdayOfKey(key: string): number {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!, 12)).getUTCDay();
}

export interface WorkweekBounds {
  startIso: string;
  endIso: string;
  startDate: string;
  endDate: string;
}

/** Monday 00:00 through the following Monday 00:00, Central Time. */
export function workweekBounds(now = new Date()): WorkweekBounds {
  const today = centralDateKey(now);
  const weekday = weekdayOfKey(today);
  const daysSinceMonday = (weekday + 6) % 7;
  const startDate = addDaysToKey(today, -daysSinceMonday);
  const nextMonday = addDaysToKey(startDate, 7);
  return {
    startIso: centralMidnightUtc(startDate).toISOString(),
    endIso: centralMidnightUtc(nextMonday).toISOString(),
    startDate,
    endDate: addDaysToKey(startDate, 6),
  };
}

/** Today, tomorrow and the day after (Central Time). */
export function employeeJobWindow(now = new Date()): { fromIso: string; toIso: string; days: string[] } {
  const today = centralDateKey(now);
  const days = [today, addDaysToKey(today, 1), addDaysToKey(today, 2)];
  return {
    fromIso: centralMidnightUtc(today).toISOString(),
    toIso: centralMidnightUtc(addDaysToKey(today, 3)).toISOString(),
    days,
  };
}

function endOf(interval: TimeIntervalLike, now: Date): number {
  if (interval.ended_at) {
    const ended = Date.parse(interval.ended_at);
    return Number.isFinite(ended) ? ended : now.getTime();
  }
  return now.getTime();
}

export function intervalMinutes(interval: TimeIntervalLike, now = new Date()): number {
  const started = Date.parse(interval.started_at);
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.round((endOf(interval, now) - started) / 60_000));
}

function rateCents(interval: TimeIntervalLike): number {
  const stored = Number(interval.rate_cents);
  if (Number.isFinite(stored) && stored > 0) return stored;
  const type = (interval.rate_type ?? 'regular') as RateType;
  return DEFAULT_RATES_CENTS[type] ?? DEFAULT_RATES_CENTS.regular;
}

export function isPaid(interval: TimeIntervalLike): boolean {
  if (interval.kind === 'work') return true;
  if (interval.kind === 'break') return interval.paid === undefined || interval.paid === null ? true : Boolean(interval.paid);
  return Boolean(interval.paid);
}

/** Totals for a set of intervals. Open intervals count up to `now`. */
export function summarizeIntervals(intervals: TimeIntervalLike[], now = new Date()): TimeTotals {
  let workMinutes = 0;
  let breakMinutes = 0;
  let mealMinutes = 0;
  let paidMinutes = 0;
  let grossCents = 0;
  for (const interval of intervals) {
    const minutes = intervalMinutes(interval, now);
    if (minutes <= 0) continue;
    if (interval.kind === 'work') workMinutes += minutes;
    if (interval.kind === 'break') breakMinutes += minutes;
    if (interval.kind === 'meal') mealMinutes += minutes;
    if (isPaid(interval) || interval.kind === 'work') {
      paidMinutes += minutes;
      grossCents += Math.round((minutes / 60) * rateCents(interval));
    }
  }
  return {
    workMinutes,
    breakMinutes,
    mealMinutes,
    paidMinutes,
    grossCents,
    overtimeMinutes: Math.max(0, workMinutes - OVERTIME_AFTER_MINUTES),
  };
}

export function formatMinutes(total: number): string {
  const minutes = Math.max(0, Math.round(total));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h ${String(remainder).padStart(2, '0')}m`;
}

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export function isMissingClockOut(interval: TimeIntervalLike, now = new Date()): boolean {
  if (interval.kind !== 'work' || interval.ended_at) return false;
  return intervalMinutes(interval, now) >= MISSING_CLOCK_OUT_MINUTES;
}

export function normaliseRateType(value: unknown): RateType | null {
  return value === 'regular' || value === 'lead' || value === 'solo' ? value : null;
}

/**
 * A solo rate is valid only for a job performed by one cleaner. The caller
 * supplies the appointment's crew size and assigned-resource count.
 */
export function soloRateAllowed(crewSize: number, assignedResources: number): boolean {
  return crewSize === 1 && assignedResources <= 1;
}
