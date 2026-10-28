/**
 * Owner-controlled booking configuration. Live booking stays OFF until the
 * dedicated Google Calendar is connected and the owner confirms capacity.
 * Nothing here invents availability, crew or working days.
 */
export const bookingConfig = {
  /** Master switch. Requires a connected calendar and a verified availability probe. */
  enabled: false,

  timeZone: 'America/Chicago',
  timeZoneLabel: 'Central Time',

  /** Calendar that holds confirmed cleaning jobs. Never the Sunshine Climate calendar. */
  calendarIdEnv: 'GOOGLE_CALENDAR_ID',
  calendarName: 'Sparkling Standard — Bookings',

  /** Candidate slot grid. */
  slotMinutes: 30,

  /** Owner working window (local Central Time). */
  workdayStart: '08:00',
  workdayEnd: '18:00',
  /** 0=Sunday … 6=Saturday. The published service days are seven days. */
  workdays: [0, 1, 2, 3, 4, 5, 6] as ReadonlyArray<number>,

  minimumNoticeHours: 24,
  maxAdvanceDays: 60,

  /** Round-trip transition buffers, not included in the cleaning duration. */
  travelBufferMinutes: 15,
  jobBufferMinutes: 15,

  /** One owner-operated crew until the owner explicitly configures more. */
  crewCount: 1,
  maxConcurrentJobs: 1,

  /** Defensive duration bounds; real durations come from the estimate. */
  minimumJobMinutes: 60,
  maximumJobMinutes: 600,

  /** Temporary hold lifetime. */
  holdMinutes: 20,

  /**
   * owner_approval = a selected slot is a held request, never a confirmed
   * booking until Hayli approves. auto_confirm is intentionally unavailable
   * until the calendar + payment reconciliation are proven live.
   */
  confirmationMode: 'owner_approval' as 'owner_approval' | 'auto_confirm',

  /** Do not allow online booking to promise a confirmed event before this is true. */
  autoConfirmAllowed: false,
} as const;
