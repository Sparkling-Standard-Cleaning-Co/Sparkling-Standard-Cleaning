// Reservation scheduling policy — deliberately free of `import.meta.env` so
// both the browser estimator and the Cloudflare Pages Functions can import it
// without a build-environment dependency.

export const schedulingConfig = {
  /**
   * Customers may request a preferred cleaning date up to this many days
   * ahead. Owner-configurable; the estimator enforces it in the date picker
   * and the server discards out-of-window dates with a note (never silently
   * booking them).
   */
  advanceReservationDays: 60,
} as const;
