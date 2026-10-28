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
