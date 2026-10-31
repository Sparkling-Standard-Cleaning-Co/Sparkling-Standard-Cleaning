/**
 * Shared booking availability service. Both the read-only availability API and
 * the atomic hold endpoint must use exactly the same calendar/travel rules.
 *
 * Scheduling is resource-aware: the configured cleaning resources each have
 * their own working window, travel origin and busy timeline. A job consumes
 * one resource by default; a joint job consumes two.
 */
import { activeBookingResources, bookingConfig } from '../../config/booking.ts';
import {
  calendarJobsForDate,
  calendarJobsForRange,
  calendarStatus,
  googleConfigured,
  type GoogleCalendarEnv,
} from './google-calendar.ts';
import {
  calculateAvailability,
  type AvailabilityResult,
  type BookingResourceWindow,
  type ExistingJob,
} from './availability.ts';
import { formatLocalTime } from './time.ts';
import { bookingStore, listActiveHolds, type BookingStorageEnv } from './holds.ts';
import { resolveAddress, type GeocodeEnv } from '../location/server-geocode.ts';
import {
  parseLatLng,
  resolveRoute,
  type LatLng,
  type RoutingEnv,
} from '../travel/server-routing.ts';

export interface BookingEnv extends GoogleCalendarEnv, GeocodeEnv, RoutingEnv, BookingStorageEnv {}

export type AvailabilityServiceResult =
  | { ok: false; enabled: false; reason: string; slots: AvailabilityResult['slots'] }
  | {
      ok: true;
      enabled: true;
      date: string;
      durationMinutes: number;
      crewSize: number;
      origin: LatLng;
      destination: LatLng;
      availability: AvailabilityResult;
    };

export interface AvailabilityInput {
  date: string;
  durationMinutes: number;
  destination: LatLng;
  /** Defaults to one cleaning resource. */
  crewSize?: number;
  /** Force an owner-selected resource assignment. */
  requiredResourceIds?: ReadonlyArray<string>;
  now?: Date;
  ignoreHoldId?: string;
}

export async function availabilityForDate(
  env: BookingEnv,
  input: AvailabilityInput,
): Promise<AvailabilityServiceResult> {
  if (!bookingConfig.enabled) {
    return { ok: false, enabled: false, reason: 'booking_not_enabled', slots: [] };
  }
  if (!googleConfigured(env)) {
    return { ok: false, enabled: false, reason: 'calendar_not_configured', slots: [] };
  }
  const origin = parseLatLng(env.TRAVEL_ORIGIN);
  if (!origin) {
    return { ok: false, enabled: false, reason: 'travel_origin_not_configured', slots: [] };
  }
  const status = await calendarStatus(env);
  if (!status.connected) {
    return { ok: false, enabled: false, reason: status.reason ?? 'calendar_unavailable', slots: [] };
  }
  const calendar = await calendarJobsForDate(env, input.date, bookingConfig.timeZone);
  if (!calendar.ok) {
    return {
      ok: false,
      enabled: false,
      reason: calendar.reason ?? 'calendar_unavailable',
      slots: [],
    };
  }
  const bucket = bookingStore(env);
  if (!bucket) {
    return { ok: false, enabled: false, reason: 'booking_store_not_configured', slots: [] };
  }
  const holds = (await listActiveHolds(bucket, input.date)).filter(
    (hold) => hold.id !== input.ignoreHoldId,
  );
  const jobs: ExistingJob[] = holds.map((hold) => ({
    start: new Date(hold.start),
    end: new Date(hold.end),
    location: hold.destination,
    ...(hold.resourceIds && hold.resourceIds.length > 0 ? { resourceIds: hold.resourceIds } : {}),
  }));
  for (const job of calendar.jobs) {
    if (job.blocksDay) {
      jobs.push({
        start: job.start,
        end: job.end,
        location: null,
        blocksDay: true,
        ...(job.resourceIds && job.resourceIds.length > 0 ? { resourceIds: job.resourceIds } : {}),
      });
      continue;
    }
    const location = job.locationText
      ? await resolveAddress(env, job.locationText).catch(() => null)
      : null;
    jobs.push({
      start: job.start,
      end: job.end,
      location: location ? { lat: location.lat, lng: location.lng } : null,
      ...(job.resourceIds && job.resourceIds.length > 0 ? { resourceIds: job.resourceIds } : {}),
    });
  }
  const travelMinutes = async (from: LatLng, to: LatLng): Promise<number | null> => {
    // A hold/job at the same destination has zero travel; providers may return
    // a zero-distance route that resolveRoute treats as unverified.
    if (Math.abs(from.lat - to.lat) < 0.00002 && Math.abs(from.lng - to.lng) < 0.00002) return 0;
    const route = await resolveRoute(env, from, to).catch(() => null);
    if (!route || !route.verified || route.durationMinutes === null) return null;
    return Math.ceil(route.durationMinutes);
  };
  const durationMinutes = Math.min(
    bookingConfig.maximumJobMinutes,
    Math.max(bookingConfig.minimumJobMinutes, Math.round(input.durationMinutes)),
  );
  const crewSize = Math.min(
    bookingConfig.maxCrewSize,
    Math.max(1, Math.round(input.crewSize ?? bookingConfig.defaultCrewSize)),
  );
  const resources: BookingResourceWindow[] = activeBookingResources().map((resource) => ({
    id: resource.id,
    workdays: resource.workdays ?? bookingConfig.workdays,
    workdayStart: resource.workdayStart ?? bookingConfig.workdayStart,
    workdayEnd: resource.workdayEnd ?? bookingConfig.workdayEnd,
    origin,
  }));
  const availability = await calculateAvailability(
    {
      date: input.date,
      timeZone: bookingConfig.timeZone,
      workdayStart: bookingConfig.workdayStart,
      workdayEnd: bookingConfig.workdayEnd,
      workdays: bookingConfig.workdays,
      slotMinutes: bookingConfig.slotMinutes,
      minimumNoticeHours: bookingConfig.minimumNoticeHours,
      maxAdvanceDays: bookingConfig.maxAdvanceDays,
      travelBufferMinutes: bookingConfig.travelBufferMinutes,
      jobBufferMinutes: bookingConfig.jobBufferMinutes,
      resources,
      crewSize,
      ...(input.requiredResourceIds ? { requiredResourceIds: input.requiredResourceIds } : {}),
      minimumJobMinutes: bookingConfig.minimumJobMinutes,
      maximumJobMinutes: bookingConfig.maximumJobMinutes,
      durationMinutes,
      destination: input.destination,
      jobs,
      now: input.now ?? new Date(),
      travelMinutes,
    },
    formatLocalTime,
  );
  return {
    ok: true,
    enabled: true,
    date: input.date,
    durationMinutes,
    crewSize,
    origin,
    destination: input.destination,
    availability,
  };
}

export interface MonthAvailability {
  date: string;
  enabled: boolean;
  morningAvailable: boolean;
  afternoonAvailable: boolean;
  morningSlots: number;
  afternoonSlots: number;
  available: boolean;
  known: boolean;
  slotCount: number;
  reason?: string;
}

function localDateKey(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}

export async function availabilityForRange(
  env: BookingEnv,
  input: {
    from: string;
    to: string;
    durationMinutes: number;
    destination: LatLng;
    crewSize?: number;
    now?: Date;
    ignoreHoldId?: string;
  },
): Promise<{ ok: true; timeZone: string; days: MonthAvailability[] } | { ok: false; reason: string; days: MonthAvailability[] }> {
  const empty = (reason: string): { ok: false; reason: string; days: MonthAvailability[] } => ({ ok: false, reason, days: [] });
  if (!bookingConfig.enabled) return empty('booking_not_enabled');
  if (!googleConfigured(env)) return empty('calendar_not_configured');
  const origin = parseLatLng(env.TRAVEL_ORIGIN);
  if (!origin) return empty('travel_origin_not_configured');
  const status = await calendarStatus(env);
  if (!status.connected) return empty(status.reason ?? 'calendar_unavailable');
  const calendar = await calendarJobsForRange(env, input.from, input.to, bookingConfig.timeZone);
  if (!calendar.ok) return empty(calendar.reason ?? 'calendar_unavailable');
  const bucket = bookingStore(env);
  if (!bucket) return empty('booking_store_not_configured');

  const dates: string[] = [];
  for (let cursor = input.from; cursor <= input.to; cursor = new Date(Date.parse(cursor + 'T12:00:00Z') + 86_400_000).toISOString().slice(0, 10)) {
    dates.push(cursor);
  }
  const jobsByDay = new Map<string, typeof calendar.jobs>();
  for (const job of calendar.jobs) {
    const key = localDateKey(job.start, bookingConfig.timeZone);
    const list = jobsByDay.get(key) ?? [];
    list.push(job);
    jobsByDay.set(key, list);
  }
  const locationCache = new Map<string, LatLng | null>();
  const travelCache = new Map<string, number | null>();
  const durations = Math.min(
    bookingConfig.maximumJobMinutes,
    Math.max(bookingConfig.minimumJobMinutes, Math.round(input.durationMinutes)),
  );
  const crewSize = Math.min(
    bookingConfig.maxCrewSize,
    Math.max(1, Math.round(input.crewSize ?? bookingConfig.defaultCrewSize)),
  );
  const resources: BookingResourceWindow[] = activeBookingResources().map((resource) => ({
    id: resource.id,
    workdays: resource.workdays ?? bookingConfig.workdays,
    workdayStart: resource.workdayStart ?? bookingConfig.workdayStart,
    workdayEnd: resource.workdayEnd ?? bookingConfig.workdayEnd,
    origin,
  }));
  const travelMinutes = async (from: LatLng, to: LatLng): Promise<number | null> => {
    const key = `${from.lat.toFixed(5)},${from.lng.toFixed(5)}>${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
    if (travelCache.has(key)) return travelCache.get(key) ?? null;
    let value: number | null;
    if (Math.abs(from.lat - to.lat) < 0.00002 && Math.abs(from.lng - to.lng) < 0.00002) value = 0;
    else {
      const route = await resolveRoute(env, from, to).catch(() => null);
      value = route && route.verified && route.durationMinutes !== null ? Math.ceil(route.durationMinutes) : null;
    }
    travelCache.set(key, value);
    return value;
  };
  const resolveJobLocation = async (text: string): Promise<LatLng | null> => {
    if (!text) return null;
    if (locationCache.has(text)) return locationCache.get(text) ?? null;
    const resolved = await resolveAddress(env, text).catch(() => null);
    const value = resolved ? { lat: resolved.lat, lng: resolved.lng } : null;
    locationCache.set(text, value);
    return value;
  };

  const days: MonthAvailability[] = [];
  for (const date of dates) {
    const holds = (await listActiveHolds(bucket, date)).filter((hold) => hold.id !== input.ignoreHoldId);
    const jobs: ExistingJob[] = holds.map((hold) => ({
      start: new Date(hold.start),
      end: new Date(hold.end),
      location: hold.destination,
      ...(hold.resourceIds && hold.resourceIds.length > 0 ? { resourceIds: hold.resourceIds } : {}),
    }));
    for (const job of jobsByDay.get(date) ?? []) {
      if (job.blocksDay) {
        jobs.push({ start: job.start, end: job.end, location: null, blocksDay: true, ...(job.resourceIds?.length ? { resourceIds: job.resourceIds } : {}) });
        continue;
      }
      const location = await resolveJobLocation(job.locationText);
      jobs.push({ start: job.start, end: job.end, location, ...(job.resourceIds?.length ? { resourceIds: job.resourceIds } : {}) });
    }
    const availability = await calculateAvailability(
      {
        date,
        timeZone: bookingConfig.timeZone,
        workdayStart: bookingConfig.workdayStart,
        workdayEnd: bookingConfig.workdayEnd,
        workdays: bookingConfig.workdays,
        slotMinutes: bookingConfig.slotMinutes,
        minimumNoticeHours: bookingConfig.minimumNoticeHours,
        maxAdvanceDays: bookingConfig.maxAdvanceDays,
        travelBufferMinutes: bookingConfig.travelBufferMinutes,
        jobBufferMinutes: bookingConfig.jobBufferMinutes,
        resources,
        crewSize,
        minimumJobMinutes: bookingConfig.minimumJobMinutes,
        maximumJobMinutes: bookingConfig.maximumJobMinutes,
        durationMinutes: durations,
        destination: input.destination,
        jobs,
        now: input.now ?? new Date(),
        travelMinutes,
      },
      formatLocalTime,
    );
    let morning = false;
    let afternoon = false;
    let morningSlots = 0;
    let afternoonSlots = 0;
    for (const slot of availability.slots) {
      const local = new Intl.DateTimeFormat('en-US', { timeZone: bookingConfig.timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(slot.start));
      const [hour = 0, minute = 0] = local.split(':').map(Number);
      const minutes = hour * 60 + minute;
      if (minutes >= 7 * 60 && minutes <= 8 * 60 + 30) { morning = true; morningSlots += 1; }
      if (minutes >= 12 * 60 + 30 && minutes <= 14 * 60 + 30) { afternoon = true; afternoonSlots += 1; }
    }
    days.push({
      date,
      enabled: availability.enabled,
      morningAvailable: morning,
      afternoonAvailable: afternoon,
      morningSlots,
      afternoonSlots,
      available: availability.available && (morning || afternoon),
      known: availability.enabled && !availability.reason,
      slotCount: availability.slots.length,
      ...(availability.reason ? { reason: availability.reason } : {}),
    });
  }
  return { ok: true, timeZone: bookingConfig.timeZone, days };
}
