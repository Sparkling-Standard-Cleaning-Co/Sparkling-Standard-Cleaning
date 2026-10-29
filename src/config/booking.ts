/**
 * Owner-controlled booking configuration. Live booking stays gated by the
 * dedicated Google Calendar connection and the server-side availability probe.
 *
 * Scheduling is resource-aware: the operating model has two real cleaning
 * resources (owner direction, 2026-10-28). A job is performed by one resource
 * by default; the owner may confirm a joint job with both resources and a
 * shorter on-site duration. Nothing here invents availability, crew or
 * working days.
 */
export interface BookingResource {
  /** Stable internal id stored with holds, requests and calendar events. */
  id: string;
  /** Internal display name used on owner calendar events. */
  name: string;
  /** Inactive resources never receive new availability. */
  active: boolean;
  /** Optional per-resource working window; defaults to the business window. */
  workdays?: ReadonlyArray<number>;
  workdayStart?: string;
  workdayEnd?: string;
}

export const bookingResources: ReadonlyArray<BookingResource> = [
  {
    id: 'hayli',
    name: 'Hayli',
    active: true,
  },
  {
    id: 'family-cleaner',
    name: 'Family Cleaner',
    active: true,
  },
] as const;

export const bookingConfig = {
  /** Master switch. Requires a connected calendar and a verified availability probe. */
  enabled: true,

  timeZone: 'America/Chicago',
  timeZoneLabel: 'Central Time',

  /** Calendar that holds confirmed cleaning jobs. Never the Sunshine Climate calendar. */
  calendarIdEnv: 'GOOGLE_CALENDAR_ID',
  calendarName: 'Sparkling Standard — Bookings',

  /**
   * Candidate slot grid. Owner direction: first appointment choices begin at
   * 7:00 AM, subsequent starts are calculated from real durations and travel,
   * and the grid increments every 15 minutes.
   */
  slotMinutes: 15,

  /** Public working window (local Central Time). Normal cleaning ends by 6:00 PM. */
  workdayStart: '07:00',
  workdayEnd: '18:00',
  /** 0=Sunday … 6=Saturday. The published service days are seven days. */
  workdays: [0, 1, 2, 3, 4, 5, 6] as ReadonlyArray<number>,

  minimumNoticeHours: 24,
  maxAdvanceDays: 60,

  /** Round-trip transition buffers, not included in the cleaning duration. */
  travelBufferMinutes: 15,
  jobBufferMinutes: 15,

  /** Every online job starts as a one-resource job; the owner may join a second. */
  defaultCrewSize: 1,
  maxCrewSize: 2,

  /** Defensive duration bounds; real durations come from the estimate. */
  minimumJobMinutes: 60,
  maximumJobMinutes: 600,

  /** Temporary hold lifetime. */
  holdMinutes: 20,

  /**
   * Paid, fully verified bookings confirm automatically. Incomplete or
   * review-required requests remain pending for owner action.
   */
  confirmationMode: 'auto_confirm' as 'owner_approval' | 'auto_confirm',

  /** Gate for automatic confirmation of fully verified paid bookings. */
  autoConfirmAllowed: true,
} as const;

/** The active resources that may receive work. */
export function activeBookingResources(): ReadonlyArray<BookingResource> {
  return bookingResources.filter((resource) => resource.active);
}

export function bookingResourceById(id: string): BookingResource | null {
  return bookingResources.find((resource) => resource.id === id) ?? null;
}

/** True when every supplied id names an active, known resource. */
export function validResourceIds(ids: ReadonlyArray<string> | null | undefined): boolean {
  if (!ids || ids.length === 0) return false;
  if (new Set(ids).size !== ids.length) return false;
  return ids.every((id) => activeBookingResources().some((resource) => resource.id === id));
}
