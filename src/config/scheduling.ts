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
  /**
   * Owner policy (2026-10-19): every NEW recurring residential maintenance
   * arrangement begins with a Deep Cleaning. Applies to standard residential
   * recurring requests; move-outs and STR turnovers are one-off scopes.
   */
  recurringResidential: {
    requiresInitialDeepClean: true,
    message:
      'A Deep Cleaning is required before a new recurring residential maintenance arrangement begins. Your first visit will be a Deep Cleaning; it is priced and confirmed personally, and the estimate shows your ongoing per-visit price.',
  },
} as const;
