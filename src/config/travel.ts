// ─────────────────────────────────────────────────────────────────────────────
// Travel economics and driving-time policy — SHARED SINGLE SOURCE.
//
// Imported by BOTH the client estimator (src/config/pricing.ts re-exports the
// values) and the Cloudflare Pages Function (functions/api/travel.ts). This
// removes the previous duplicated constants that could drift apart.
//
// The private operating coordinates and provider API keys are NOT here — they
// live only in Cloudflare environment secrets (TRAVEL_ORIGIN, ROUTES_API_KEY).
//
// Values marked PROVISIONAL may be tuned by the owner; driving-policy values
// require owner approval before they gate binding instant prices.
// ─────────────────────────────────────────────────────────────────────────────

export const travelConfig = {
  /** Vehicle fuel economy (miles per gallon). PROVISIONAL. */
  mpg: 24,
  /** Vehicle wear allowance per mile, USD (fuel excluded). PROVISIONAL. */
  wearPerMile: 0.12,
  /** One-way miles included in the base price before a travel adjustment. PROVISIONAL. */
  includedOneWayMiles: 15,
  /** Gulf Coast reference gasoline price used when the live feed is unavailable. PROVISIONAL. */
  fallbackGasPrice: 3.1,
  /** Route lookup cache duration for the serverless function, seconds. */
  cacheSeconds: 21600,

  // ── Driving-time policy (owner approval required before enabling binding quotes) ──
  /**
   * Ordinary service boundary: destinations whose routed driving time is at or
   * under this many minutes qualify for an ordinary instant estimate.
   * PROVISIONAL — owner approved in principle ("about one hour"); final value
   * must be confirmed before binding instant prices are enabled.
   */
  maxDrivingMinutes: 60,
  /**
   * Additional review band: routed destinations between maxDrivingMinutes and
   * maxDrivingMinutes + reviewBandMinutes still receive an estimate but are
   * marked for personal confirmation. PROVISIONAL — requires owner approval.
   */
  reviewBandMinutes: 15,
  /**
   * Hard distance safety cap retained for routed trips without a duration
   * (provider answered with distance only). Beyond this the estimate asks for
   * personal confirmation.
   */
  maxInstantDistanceMiles: 45,
} as const;

export type TravelConfig = typeof travelConfig;
