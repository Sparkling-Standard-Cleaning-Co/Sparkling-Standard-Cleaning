/**
 * Pure, server-testable resource-aware availability rules.
 *
 * Google Calendar provides busy jobs; this module turns them into conservative
 * start times for the actual cleaning resources, including origin travel,
 * travel between jobs, buffer time, per-resource working windows and conflict
 * prevention.
 *
 * A job is assigned to one resource by default. A joint job (crewSize 2) must
 * fit both resources. Calendar events created before resource tracking existed
 * carry no resource id and conservatively block every resource.
 *
 * Availability is never inferred from a browser clock or a missing calendar
 * event. If a route cannot be calculated for a required resource, the slot is
 * withheld.
 */
import {
  addDays,
  addMinutes,
  localWeekday,
  zonedTimeToUtc,
} from './time.ts';
import type { LatLng } from '../travel/server-routing.ts';

export interface BookingResourceWindow {
  id: string;
  workdays: ReadonlyArray<number>;
  workdayStart: string;
  workdayEnd: string;
  origin: LatLng;
}

export interface ExistingJob {
  start: Date;
  end: Date;
  location: LatLng | null;
  /** All-day/owner-blocked events block the day for the resources they cover. */
  blocksDay?: boolean;
  /**
   * Resources assigned to this job. An empty/absent list means the job blocks
   * every resource (legacy calendar events are treated conservatively).
   */
  resourceIds?: ReadonlyArray<string>;
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
  /** The real cleaning resources. */
  resources: ReadonlyArray<BookingResourceWindow>;
  /** How many resources this job needs (1 normally, 2 for a joint job). */
  crewSize: number;
  /** Force a specific owner-selected assignment instead of auto-selecting. */
  requiredResourceIds?: ReadonlyArray<string>;
  minimumJobMinutes: number;
  maximumJobMinutes: number;
  durationMinutes: number;
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
  /** Server-owned resource assignment. Never sent to the public picker. */
  resourceIds: string[];
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
    | 'insufficient_resources'
    | 'travel_unavailable'
    | 'resource_unavailable';
  slots: AvailableSlot[];
}

function localPartsToIso(date: Date): string {
  return date.toISOString();
}

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date): boolean {
  return startA < endB && startB < endA;
}

function jobAppliesToResource(job: ExistingJob, resourceId: string): boolean {
  if (!job.resourceIds || job.resourceIds.length === 0) return true;
  return job.resourceIds.includes(resourceId);
}

function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}

interface ResourceEvaluation {
  resourceId: string;
  feasible: boolean;
  busyMinutes: number;
  reason?: 'day_closed' | 'past_cutoff' | 'beyond_window' | 'travel_unavailable' | 'blocked';
}

async function evaluateResource(
  request: AvailabilityRequest,
  resource: BookingResourceWindow,
  candidateStart: Date,
  candidateEnd: Date,
  dayStart: Date,
  dayEnd: Date,
  bufferMinutes: number,
  travel: (from: LatLng, to: LatLng) => Promise<number | null>,
): Promise<ResourceEvaluation> {
  const busyMinutes = request.jobs
    .filter((job) => jobAppliesToResource(job, resource.id))
    .reduce((sum, job) => sum + minutesBetween(job.start, job.end), 0);

  if (!resource.workdays.includes(localWeekday(request.date, request.timeZone))) {
    return { resourceId: resource.id, feasible: false, busyMinutes, reason: 'day_closed' };
  }
  if (dayEnd <= request.now) {
    return { resourceId: resource.id, feasible: false, busyMinutes, reason: 'past_cutoff' };
  }
  if (candidateStart < dayStart || candidateEnd > dayEnd) {
    return { resourceId: resource.id, feasible: false, busyMinutes, reason: 'blocked' };
  }

  const jobs = request.jobs
    .filter((job) => jobAppliesToResource(job, resource.id))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  if (jobs.some((job) => job.blocksDay)) {
    return { resourceId: resource.id, feasible: false, busyMinutes, reason: 'day_closed' };
  }

  let previousJob: ExistingJob | null = null;
  let nextJob: ExistingJob | null = null;
  for (const job of jobs) {
    if (overlaps(candidateStart, candidateEnd, job.start, job.end)) {
      return { resourceId: resource.id, feasible: false, busyMinutes, reason: 'blocked' };
    }
    if (job.end <= candidateStart) previousJob = job;
    if (job.start >= candidateEnd) {
      nextJob = job;
      break;
    }
  }

  if (previousJob && !previousJob.location) {
    return { resourceId: resource.id, feasible: false, busyMinutes, reason: 'travel_unavailable' };
  }
  const from = previousJob?.location ?? resource.origin;
  const fromTravel = await travel(from, request.destination);
  if (fromTravel === null) {
    return { resourceId: resource.id, feasible: false, busyMinutes, reason: 'travel_unavailable' };
  }
  const earliestStart = previousJob
    ? addMinutes(previousJob.end, bufferMinutes + fromTravel)
    : addMinutes(dayStart, bufferMinutes + fromTravel);
  if (candidateStart < earliestStart) {
    return { resourceId: resource.id, feasible: false, busyMinutes, reason: 'blocked' };
  }

  if (nextJob) {
    if (!nextJob.location) {
      return { resourceId: resource.id, feasible: false, busyMinutes, reason: 'travel_unavailable' };
    }
    const toTravel = await travel(request.destination, nextJob.location);
    if (toTravel === null) {
      return { resourceId: resource.id, feasible: false, busyMinutes, reason: 'travel_unavailable' };
    }
    const latestEnd = addMinutes(nextJob.start, -(bufferMinutes + toTravel));
    if (candidateEnd > latestEnd) {
      return { resourceId: resource.id, feasible: false, busyMinutes, reason: 'blocked' };
    }
  }

  return { resourceId: resource.id, feasible: true, busyMinutes };
}

export async function calculateAvailability(
  request: AvailabilityRequest,
  formatTime: (date: Date, timeZone: string) => string,
): Promise<AvailabilityResult> {
  if (request.resources.length === 0 || request.crewSize < 1) {
    return { available: false, enabled: true, reason: 'crew_unavailable', slots: [] };
  }
  if (request.crewSize > request.resources.length) {
    return { available: false, enabled: true, reason: 'crew_unavailable', slots: [] };
  }
  if (request.requiredResourceIds && request.requiredResourceIds.length !== request.crewSize) {
    return { available: false, enabled: true, reason: 'insufficient_resources', slots: [] };
  }
  if (
    request.durationMinutes < request.minimumJobMinutes ||
    request.durationMinutes > request.maximumJobMinutes
  ) {
    return { available: false, enabled: true, reason: 'duration_invalid', slots: [] };
  }

  const earliest = addMinutes(request.now, request.minimumNoticeHours * 60);
  const latest = addMinutes(request.now, request.maxAdvanceDays * 24 * 60);
  const overallStart = zonedTimeToUtc(request.date, request.workdayStart, request.timeZone);
  const overallEnd = zonedTimeToUtc(request.date, request.workdayEnd, request.timeZone);
  if (overallEnd <= earliest) {
    return { available: false, enabled: true, reason: 'past_cutoff', slots: [] };
  }
  if (overallStart > latest) {
    return { available: false, enabled: true, reason: 'beyond_window', slots: [] };
  }

  const weekday = localWeekday(request.date, request.timeZone);
  const openResources = request.resources.filter(
    (resource) =>
      request.workdays.includes(weekday) && resource.workdays.includes(weekday),
  );
  if (openResources.length === 0) {
    return { available: false, enabled: true, reason: 'day_closed', slots: [] };
  }

  const travelCache = new Map<string, Promise<number | null>>();
  const travel = (from: LatLng, to: LatLng): Promise<number | null> => {
    const key = `${from.lat.toFixed(5)},${from.lng.toFixed(5)}|${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
    const cached = travelCache.get(key);
    if (cached) return cached;
    const pending = request.travelMinutes(from, to);
    travelCache.set(key, pending);
    return pending;
  };

  const resourcesById = new Map(openResources.map((resource) => [resource.id, resource]));
  const resourceOrder = new Map(request.resources.map((resource, index) => [resource.id, index]));
  const candidateResources =
    request.requiredResourceIds && request.requiredResourceIds.length > 0
      ? request.requiredResourceIds
          .map((id) => resourcesById.get(id))
          .filter((resource): resource is BookingResourceWindow => Boolean(resource))
      : openResources;
  if (request.requiredResourceIds && candidateResources.length !== request.requiredResourceIds.length) {
    return { available: false, enabled: true, reason: 'resource_unavailable', slots: [] };
  }

  const buffer = request.travelBufferMinutes + request.jobBufferMinutes;
  const durationMs = request.durationMinutes * 60_000;
  const windowStart = new Date(Math.max(overallStart.getTime(), earliest.getTime()));
  const windowEnd = new Date(Math.min(overallEnd.getTime(), latest.getTime()));
  const slots: AvailableSlot[] = [];
  let sawTravelFailure = false;
  let cursor = new Date(windowStart);

  // Align to the owner's local slot grid, not the UTC clock.
  const slotMs = request.slotMinutes * 60_000;
  const offset = cursor.getTime() - overallStart.getTime();
  const remainder = ((offset % slotMs) + slotMs) % slotMs;
  if (remainder !== 0) cursor = new Date(cursor.getTime() + (slotMs - remainder));

  while (cursor.getTime() + durationMs <= windowEnd.getTime()) {
    const candidateStart = new Date(cursor);
    const candidateEnd = new Date(cursor.getTime() + durationMs);
    const evaluations: ResourceEvaluation[] = [];

    for (const resource of candidateResources) {
      const localStart = zonedTimeToUtc(
        request.date,
        resource.workdayStart || request.workdayStart,
        request.timeZone,
      );
      const localEnd = zonedTimeToUtc(
        request.date,
        resource.workdayEnd || request.workdayEnd,
        request.timeZone,
      );
      const evaluation = await evaluateResource(
        request,
        resource,
        candidateStart,
        candidateEnd,
        localStart,
        localEnd,
        buffer,
        travel,
      );
      evaluations.push(evaluation);
      if (evaluation.reason === 'travel_unavailable') sawTravelFailure = true;
    }

    const feasible = evaluations.filter((evaluation) => evaluation.feasible);
    if (feasible.length >= request.crewSize) {
      const chosen = [...feasible]
        .sort(
          (a, b) =>
            a.busyMinutes - b.busyMinutes ||
            (resourceOrder.get(a.resourceId) ?? 0) - (resourceOrder.get(b.resourceId) ?? 0),
        )
        .slice(0, request.crewSize);
      slots.push({
        start: localPartsToIso(candidateStart),
        end: localPartsToIso(candidateEnd),
        startLabel: formatTime(candidateStart, request.timeZone),
        endLabel: formatTime(candidateEnd, request.timeZone),
        resourceIds: chosen.map((evaluation) => evaluation.resourceId),
      });
    }
    cursor = new Date(cursor.getTime() + slotMs);
  }

  if (slots.length === 0) {
    let reason: AvailabilityResult['reason'] = sawTravelFailure ? 'travel_unavailable' : 'fully_booked';
    if (request.crewSize > 1 && !sawTravelFailure) reason = 'insufficient_resources';
    return { available: false, enabled: true, reason, slots };
  }

  return { available: true, enabled: true, slots };
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
