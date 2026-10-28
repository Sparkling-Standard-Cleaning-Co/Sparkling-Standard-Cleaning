/**
 * Timezone-safe helpers for the booking engine. All storage is UTC; all
 * owner/customer scheduling language is America/Chicago. Never use the
 * visitor's device timezone to decide availability.
 */

export interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const partsFormatter = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let existing = partsFormatter.get(timeZone);
  if (!existing) {
    existing = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    partsFormatter.set(timeZone, existing);
  }
  return existing;
}

export function zonedParts(date: Date, timeZone: string): ZonedDateParts {
  const parts = formatter(timeZone).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  };
}

function offsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, date.getUTCSeconds());
  return asUtc - date.getTime();
}

/** Convert a local wall-clock date/time in a named zone to a UTC instant. */
export function zonedTimeToUtc(
  date: string,
  time: string,
  timeZone: string,
): Date {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) throw new Error('invalid local date/time');
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const wall = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = wall;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = offsetMs(new Date(guess), timeZone);
    const next = wall - offset;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + days, 12));
  return next.toISOString().slice(0, 10);
}

/** Local weekday for a local date (0=Sunday). */
export function localWeekday(date: string, timeZone: string): number {
  const noon = zonedTimeToUtc(date, '12:00', timeZone);
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(noon);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return Math.max(0, days.indexOf(name));
}
export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function formatLocalTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatLocalDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
}
