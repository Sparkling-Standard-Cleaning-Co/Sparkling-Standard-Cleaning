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
    active: false,
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

  /** Published operating window (local Central Time): 7:00 AM to 7:00 PM. */
  workdayStart: '07:00',
  workdayEnd: '19:00',

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

  /**
   * Owner-approved multi-cleaner efficiency. Each additional cleaner adds this
   * fraction of a solo cleaner's output. Used only to plan the on-site crew
   * when a quote provides labor hours; the price itself is unchanged.
   */
  crewEfficiency: 0.85,

  /**
   * A job whose full crew cannot yet be assigned may still be reserved and
   * paid when the time is operationally feasible. The reservation remains
   * staffing-pending until management secures the crew.
   */
  allowStaffingPendingReservation: true,

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

/**
 * Public customer-facing start windows. These are start-time windows, not
 * completion promises. A slot must begin inside one of them.
 */
export const publicBookingWindows = [
  { period: 'first', label: 'Morning - First Appointment', startMinutes: 7 * 60, endMinutes: 8 * 60 + 30 },
  { period: 'afternoon', label: 'Afternoon Appointment', startMinutes: 12 * 60 + 30, endMinutes: 14 * 60 + 30 },
] as const;

export function isPublicBookingStartMinutes(minutes: number): boolean {
  return publicBookingWindows.some(
    (window) => minutes >= window.startMinutes && minutes <= window.endMinutes,
  );
}

/** The active resources that may receive work. */
export function activeBookingResources(): ReadonlyArray<BookingResource> {
  return bookingResources.filter((resource) => resource.active);
}

export function bookingResourceById(id: string): BookingResource | null {
  return bookingResources.find((resource) => resource.id === id) ?? null;
}

/**
 * True when the supplied ids form a safe crew assignment. Resource ids are
 * database-owned (team_members.booking_resource_id); this validates shape and
 * uniqueness without freezing the roster in code.
 */
export function validResourceIds(ids: ReadonlyArray<string> | null | undefined): boolean {
  if (!ids || ids.length === 0 || ids.length > bookingConfig.maxCrewSize) return false;
  if (new Set(ids).size !== ids.length) return false;
  const inactive = new Set(bookingResources.filter((resource) => !resource.active).map((resource) => resource.id));
  return ids.every(
    (id) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id) && !inactive.has(id),
  );
}
