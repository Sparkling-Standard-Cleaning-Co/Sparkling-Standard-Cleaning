/**
 * Pure, server-testable availability rules. Google Calendar provides busy
 * jobs; this module turns them into conservative start times for one crew,
 * including origin travel, travel between jobs, buffer time and work hours.
 *
 * Availability is never inferred from a browser clock or a missing calendar
 * event. If a route cannot be calculated, the slot is withheld.
 */
import {
  addDays,
  addMinutes,
  localWeekday,
  zonedTimeToUtc,
} from './time.ts';
import type { LatLng } from '../travel/server-routing.ts';

export interface ExistingJob {
  start: Date;
  end: Date;
  location: LatLng | null;
  /** All-day/owner-blocked events block the day. */
  blocksDay?: boolean;
}

export interface AvailabilityRequest {
  date: string;
  timeZone: string;
  workdayStart: string;
  workdayEnd: string;
  workdays: ReadonlyArray<number>;
  slotMinutes: number;
  minimumNoticeHours: number;
  maxAdvanceDays: number;
  travelBufferMinutes: number;
  jobBufferMinutes: number;
  crewCount: number;
  maxConcurrentJobs: number;
  minimumJobMinutes: number;
  maximumJobMinutes: number;
  durationMinutes: number;
  origin: LatLng;
  destination: LatLng;
  jobs: ExistingJob[];
  now: Date;
  travelMinutes: (from: LatLng, to: LatLng) => Promise<number | null>;
}

export interface AvailableSlot {
  start: string;
  end: string;
  startLabel: string;
  endLabel: string;
}

export interface AvailabilityResult {
  available: boolean;
  enabled: boolean;
  reason?:
    | 'day_closed'
    | 'past_cutoff'
    | 'beyond_window'
    | 'crew_unavailable'
    | 'duration_invalid'
    | 'fully_booked'
    | 'travel_unavailable';
  slots: AvailableSlot[];
}

function localPartsToIso(date: Date): string {
  return date.toISOString();
}

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date): boolean {
  return startA < endB && startB < endA;
}

export async function calculateAvailability(
  request: AvailabilityRequest,
  formatTime: (date: Date, timeZone: string) => string,
): Promise<AvailabilityResult> {
  if (request.crewCount < 1 || request.maxConcurrentJobs < 1) {
    return { available: false, enabled: true, reason: 'crew_unavailable', slots: [] };
  }
  if (
    request.durationMinutes < request.minimumJobMinutes ||
    request.durationMinutes > request.maximumJobMinutes
  ) {
    return { available: false, enabled: true, reason: 'duration_invalid', slots: [] };
  }
  if (!request.workdays.includes(localWeekday(request.date, request.timeZone))) {
    return { available: false, enabled: true, reason: 'day_closed', slots: [] };
  }
  const dayStart = zonedTimeToUtc(request.date, request.workdayStart, request.timeZone);
  const dayEnd = zonedTimeToUtc(request.date, request.workdayEnd, request.timeZone);
  const earliest = addMinutes(request.now, request.minimumNoticeHours * 60);
  const latest = addMinutes(request.now, request.maxAdvanceDays * 24 * 60);
  if (dayEnd <= earliest) {
    return { available: false, enabled: true, reason: 'past_cutoff', slots: [] };
  }
  if (dayStart > latest) {
    return { available: false, enabled: true, reason: 'beyond_window', slots: [] };
  }
  if (request.jobs.some((job) => job.blocksDay)) {
    return { available: false, enabled: true, reason: 'day_closed', slots: [] };
  }

  const jobs = [...request.jobs].sort((a, b) => a.start.getTime() - b.start.getTime());
  const buffer = request.travelBufferMinutes + request.jobBufferMinutes;
  const durationMs = request.durationMinutes * 60_000;
  const windowStart = new Date(Math.max(dayStart.getTime(), earliest.getTime()));
  const windowEnd = new Date(Math.min(dayEnd.getTime(), latest.getTime()));
  const slots: AvailableSlot[] = [];
  let cursor = new Date(windowStart);

  // Align to the owner's local slot grid, not the UTC clock.
  const localStart = zonedTimeToUtc(request.date, request.workdayStart, request.timeZone);
  const offset = cursor.getTime() - localStart.getTime();
  const slotMs = request.slotMinutes * 60_000;
  const remainder = ((offset % slotMs) + slotMs) % slotMs;
  if (remainder !== 0) cursor = new Date(cursor.getTime() + (slotMs - remainder));

  while (cursor.getTime() + durationMs <= windowEnd.getTime()) {
    const candidateStart = new Date(cursor);
    const candidateEnd = new Date(cursor.getTime() + durationMs);
    let feasible = true;
    let previousJob: ExistingJob | null = null;
    let nextJob: ExistingJob | null = null;

    for (const job of jobs) {
      if (overlaps(candidateStart, candidateEnd, job.start, job.end)) {
        feasible = false;
        break;
      }
      if (job.end <= candidateStart) previousJob = job;
      if (job.start >= candidateEnd || (job.start > candidateStart && nextJob === null)) {
        nextJob = job;
        break;
      }
    }

    if (feasible) {
      if (previousJob && !previousJob.location) {
        return { available: false, enabled: true, reason: 'travel_unavailable', slots: [] };
      }
      const from = previousJob?.location ?? request.origin;
      const fromTravel = feasible ? await request.travelMinutes(from, request.destination) : null;
      if (fromTravel === null) {
        return { available: false, enabled: true, reason: 'travel_unavailable', slots: [] };
      }
      const earliestStart = previousJob
        ? addMinutes(previousJob.end, buffer + fromTravel)
        : addMinutes(dayStart, buffer + fromTravel);
      if (candidateStart < earliestStart) feasible = false;
    }

    if (feasible && nextJob) {
      if (!nextJob.location) {
        return { available: false, enabled: true, reason: 'travel_unavailable', slots: [] };
      } else {
        const toTravel = await request.travelMinutes(request.destination, nextJob.location);
        if (toTravel === null) {
          return { available: false, enabled: true, reason: 'travel_unavailable', slots: [] };
        }
        const latestEnd = addMinutes(nextJob.start, -(buffer + toTravel));
        if (candidateEnd > latestEnd) feasible = false;
      }
    }

    if (feasible) {
      slots.push({
        start: localPartsToIso(candidateStart),
        end: localPartsToIso(candidateEnd),
        startLabel: formatTime(candidateStart, request.timeZone),
        endLabel: formatTime(candidateEnd, request.timeZone),
      });
    }
    cursor = new Date(cursor.getTime() + slotMs);
  }

  return {
    available: slots.length > 0,
    enabled: true,
    ...(slots.length === 0 ? { reason: 'fully_booked' as const } : {}),
    slots,
  };
}

export function bookingDateWindow(now: Date, maxAdvanceDays: number): string[] {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const dates: string[] = [];
  for (let index = 0; index <= maxAdvanceDays; index += 1) dates.push(addDays(today, index));
  return dates;
}
