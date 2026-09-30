// ─────────────────────────────────────────────────────────────────────────────
// Central pricing configuration — SINGLE SOURCE OF TRUTH for every number
// the estimator uses and every price/policy decision the site presents.
//
// ── WHAT IS PUBLIC vs INTERNAL ───────────────────────────────────────────────
// PUBLIC (may be shown to customers):
//   * Estimated RANGES produced by the estimator (the product itself).
//   * Hourly rates or exact job prices are NEVER published until the owner
//     approves them (approval flags below).
// INTERNAL ONLY (never rendered publicly, never sent to analytics):
//   * targetGrossRevenuePerLaborHour
//   * ownerLaborTargetPerHour
//   * per-add-on provisional prices while `addons.state` is provisional
//
// ── PROVISIONAL vs APPROVED ─────────────────────────────────────────────────
// This business is launching. Most values are PROVISIONAL starting points from
// the owner's directive, not statistically proven numbers. Every provisional
// value carries `state: 'provisional'` + a note explaining its origin and how
// to recalibrate it. See docs/operations/ESTIMATOR-CALIBRATION.md.
//
// Do not flip a value to 'approved' without the owner's explicit approval.
// Do not publish provisional values unless the matching publication flag is on.
// ─────────────────────────────────────────────────────────────────────────────

export type ApprovalState = 'provisional' | 'approved';

export interface ConfigValue<T> {
  value: T;
  state: ApprovalState;
  /** Why this value exists and what should trigger a change. */
  note: string;
}

function provisional<T>(value: T, note: string): ConfigValue<T> {
  return { value, state: 'provisional', note };
}

// ── Estimator service types (matches src/lib/estimate/types.ts) ──────────────
export type PricingServiceType = 'standard' | 'deep' | 'move_in_out' | 'str_turnover';
export type Frequency = 'weekly' | 'biweekly' | 'monthly' | 'one_time';
export type Condition = 'maintained' | 'average' | 'needs_attention' | 'heavy' | 'severe';
export type LastProfessionalClean =
  | 'within_month'
  | 'one_to_three_months'
  | 'three_to_twelve_months'
  | 'over_a_year'
  | 'never_professional'
  | 'not_sure';

export interface AddonDefinition {
  id: string;
  label: string;
  /** Short customer-facing line shown in the estimate flow. */
  blurb: string;
  /** Labor-hours this add-on adds when included in the same visit. */
  laborHours?: number;
  /** Requires a custom quote (equipment / specialized work) — never instant. */
  customQuote: boolean;
  /** Provisional internal price (not published while publication flag is off). */
  price?: ConfigValue<number>;
  category: 'kitchen' | 'bath_laundry' | 'windows' | 'interior_detail' | 'pets' | 'organization' | 'specialty';
}

export const pricing = {
  // ── Internal labor economics (directive §21) ───────────────────────────────
  laborEconomics: {
    /**
     * Target GROSS revenue per labor-hour used to convert estimated labor into
     * the estimate range. INTERNAL ONLY — this is not what anyone is paid and
     * must never be displayed. It exists so the estimate reflects the true
     * cost of doing quality work (overhead, supplies, travel, fees, taxes,
     * marketing, admin, callbacks, equipment) rather than a bare wage.
     */
    targetGrossRevenuePerLaborHour: provisional(
      55,
      'Directive §21 initial production-rate target. Recalibrate after the first 10–30 jobs using actual labor-hours and revenue (docs/operations/ESTIMATOR-CALIBRATION.md). Never displayed publicly.',
    ),
    /**
     * Desired owner labor compensation floor BEFORE overheads and profit.
     * INTERNAL ONLY.
     */
    ownerLaborTargetPerHour: provisional(
      35,
      'Directive §21 owner labor target floor. The estimate engine must keep even small jobs economically rational against this floor.',
    ),
  },

  // ── Minimum job value (directive §22) ──────────────────────────────────────
  minimumJob: provisional(
    125,
    'Directive §22 initial provisional minimum. One setting only. Applied silently to the estimate range; the number is not advertised unless the owner approves.',
  ),

  // ── Labor-hour model (directive §20 anchors) ───────────────────────────────
  // Anchors: a maintained 3/2 home ≈ 4.5–5.0 labor-hours for the founder alone;
  // a first clean of a similar home ≈ 6 labor-hours. The base + per-unit model
  // below reproduces those anchors and is intended for recalibration.
  laborModel: {
    baseHours: {
      standard: provisional(2.0, 'Chosen so a maintained ~1600 sqft 3/2 standard clean lands at ≈4.8–4.9 labor-hours (directive §20 anchor).'),
      deep: provisional(3.2, 'Deep cleaning adds baseboard/trim/door/frame/wall-detail time on top of the standard scope.'),
      move_in_out: provisional(3.4, 'Move-in/move-out assumes an empty or nearly empty home with inside-cabinet and appliance attention.'),
      str_turnover: provisional(1.2, 'STR turnover base excludes size/beds; a 2/2 with 2 beds lands at ≈3.0–3.2 labor-hours including linen reset.'),
    } satisfies Record<PricingServiceType, ConfigValue<number>>,
    sqftHoursPerThousand: provisional(1.1, 'Square footage matters more than bedroom count (directive §27). 1000 sqft ≈ 1.1 labor-hours at standard condition.'),
    fullBathHours: provisional(0.5, 'Bathrooms are the most labor-dense rooms in the home.'),
    halfBathHours: provisional(0.25, 'Half baths take roughly half a full bath.'),
    bedroomHours: provisional(0.15, 'Bedrooms beyond the first two add light time; deliberately small so the model does not overfit bedroom count (directive §27).'),
    bedroomsIncludedInBase: provisional(2, 'First two bedrooms are already inside baseHours.'),
    strBathHours: provisional(0.35, 'STR bathroom reset per full bath.'),
    strBedHours: provisional(0.2, 'STR bed reset (linens, presentation) per bed.'),
    strSqftHoursPerThousand: provisional(0.8, 'STR turnover is a reset, not a deep clean; square footage contributes less than residential cleaning.'),
  },

  /** Condition multiplier applied to total labor (directive §25 step 3). */
  conditionFactors: {
    maintained: provisional(1.0, 'Recently and regularly cleaned home in good shape.'),
    average: provisional(1.1, 'Lived-in home with normal buildup.'),
    needs_attention: provisional(1.25, 'Noticeably overdue cleaning; extra attention throughout.'),
    heavy: provisional(1.45, 'Heavy buildup; multiple areas need detail work.'),
    severe: provisional(2.0, 'Severe condition — always routed to custom confirmation, never an instant estimate.'),
  } satisfies Record<Condition, ConfigValue<number>>,

  /** How long since the last professional clean (directive §25 step 3). */
  lastCleanFactors: {
    within_month: provisional(1.0, 'Home maintained recently; recurring service is realistic.'),
    one_to_three_months: provisional(1.03, 'Small additional detail time expected.'),
    three_to_twelve_months: provisional(1.08, 'Noticeable buildup in neglected areas.'),
    over_a_year: provisional(1.15, 'Extended gap; first visit behaves close to a first professional clean.'),
    never_professional: provisional(1.2, 'First professional clean — matches the directive §20 ≈6 labor-hour anchor for a maintained 3/2.'),
    not_sure: provisional(1.05, 'Conservative middle value when the customer is unsure; flagged for review.'),
  } satisfies Record<LastProfessionalClean, ConfigValue<number>>,

  /**
   * Recurring frequency labor adjustment. Recurring homes stay cleaner, so the
   * SAME home takes less labor per visit. This is a labor-efficiency model,
   * not a marketing discount (directive §28).
   */
  frequencyFactors: {
    weekly: provisional(0.92, 'Weekly homes are the most maintainable; best per-visit value follows from labor efficiency.'),
    biweekly: provisional(0.95, 'Biweekly homes remain close to maintenance level.'),
    monthly: provisional(0.98, 'Monthly homes drift; smaller efficiency benefit.'),
    one_time: provisional(1.0, 'One-time baseline — no maintenance benefit.'),
  } satisfies Record<Frequency, ConfigValue<number>>,

  /**
   * Recurring initial-visit flag (directive §29): when a customer books
   * recurring service for a home that has not been professionally cleaned in a
   * long time, the first visit may need detailed/reset pricing.
   */
  recurringReset: {
    flagWhenLastCleanIn: ['over_a_year', 'never_professional'] as LastProfessionalClean[],
    message: 'Initial Detailed Clean May Be Required',
    note: 'Flags only — the founder keeps discretion. Never force every new recurring customer into a deep clean.',
  },

  // ── Add-ons (directive §19) ────────────────────────────────────────────────
  addons: {
    state: 'provisional' as ApprovalState,
    items: [
      { id: 'inside_fridge', label: 'Inside refrigerator', blurb: 'Empty, wipe out and detail the refrigerator interior.', laborHours: 0.5, customQuote: false, category: 'kitchen', price: provisional(30, 'Provisional internal price.') },
      { id: 'inside_oven', label: 'Inside oven', blurb: 'Detail the oven interior and door glass.', laborHours: 0.6, customQuote: false, category: 'kitchen', price: provisional(35, 'Provisional internal price.') },
      { id: 'inside_cabinets', label: 'Inside cabinets', blurb: 'Wipe out cabinet interiors and shelves.', laborHours: 0.8, customQuote: false, category: 'kitchen', price: provisional(45, 'Provisional internal price.') },
      { id: 'interior_windows', label: 'Interior windows', blurb: 'Interior glass, sills and tracks where safely reachable.', laborHours: 0.6, customQuote: false, category: 'windows', price: provisional(35, 'Provisional internal price.') },
      { id: 'exterior_windows_ground', label: 'Ground-floor exterior windows', blurb: 'Exterior glass reachable from the ground — no ladders.', laborHours: 0.8, customQuote: false, category: 'windows', price: provisional(40, 'Provisional internal price. Unsafe height work is excluded and requires custom review.') },
      { id: 'laundry', label: 'Laundry', blurb: 'A load of laundry — washed, dried and put away.', laborHours: 0.7, customQuote: false, category: 'bath_laundry', price: provisional(35, 'Provisional internal price.') },
      { id: 'dishes', label: 'Dishes', blurb: 'Load and run the dishwasher or hand-wash a sink of dishes.', laborHours: 0.4, customQuote: false, category: 'kitchen', price: provisional(25, 'Provisional internal price.') },
      { id: 'bed_linen_change', label: 'Bed linen change', blurb: 'Change linens on the beds you leave out for us.', laborHours: 0.4, customQuote: false, category: 'bath_laundry', price: provisional(20, 'Provisional internal price.') },
      { id: 'organization_general', label: 'General organization', blurb: 'Straighten and organize a room or shared space.', laborHours: 0.8, customQuote: false, category: 'organization', price: provisional(45, 'Provisional internal price.') },
      { id: 'pantry_organization', label: 'Pantry organization', blurb: 'Organize shelves, group items and wipe surfaces.', laborHours: 0.6, customQuote: false, category: 'organization', price: provisional(40, 'Provisional internal price.') },
      { id: 'closet_organization', label: 'Closet organization', blurb: 'Organize one closet — hanging, folding, grouping.', laborHours: 0.6, customQuote: false, category: 'organization', price: provisional(40, 'Provisional internal price.') },
      { id: 'pet_hair_intensive', label: 'Pet-hair intensive', blurb: 'Extra passes for embedded pet hair on floors and upholstery.', laborHours: 0.7, customQuote: false, category: 'pets', price: provisional(35, 'Provisional internal price.') },
      { id: 'detailed_walls', label: 'Detailed wall spot-cleaning', blurb: 'Careful spot-cleaning of walls and switch plates where the finish allows.', laborHours: 0.8, customQuote: false, category: 'interior_detail', price: provisional(45, 'Provisional internal price. Paint-safe methods only; stain removal is never guaranteed.') },
      { id: 'detailed_baseboards', label: 'Detailed baseboards', blurb: 'Hand-wipe baseboards instead of a dry dusting.', laborHours: 0.7, customQuote: false, category: 'interior_detail', price: provisional(40, 'Provisional internal price.') },
      { id: 'carpet_cleaning', label: 'Carpet cleaning', blurb: 'Quoted separately — specialty equipment is scheduled case by case.', customQuote: true, category: 'specialty' },
      { id: 'upholstery_cleaning', label: 'Upholstery cleaning', blurb: 'Quoted separately — specialty equipment is scheduled case by case.', customQuote: true, category: 'specialty' },
      { id: 'pressure_washing', label: 'Pressure washing', blurb: 'Quoted separately by scope and surface.', customQuote: true, category: 'specialty' },
      { id: 'garage_cleaning', label: 'Garage cleaning', blurb: 'Quoted separately after seeing the space and debris volume.', customQuote: true, category: 'specialty' },
      { id: 'patio_cleaning', label: 'Patio / porch cleaning', blurb: 'Quoted separately by size and condition.', customQuote: true, category: 'specialty' },
    ] satisfies AddonDefinition[],
    note: 'Provisional prices are INTERNAL. They feed the estimate only while publication is off (business.flags.publishProvisionalAddonPricing = false).',
  },

  // ── Instant-estimate boundaries (directive §27) ────────────────────────────
  customQuoteThresholds: {
    squareFeetOver: provisional(4500, 'Beyond this the labor model loses confidence — request a walkthrough or custom scope.'),
    fullBathsOver: provisional(4, 'Very large or complex bathroom counts need eyes on the property.'),
    bedroomsOver: provisional(5, 'Large homes are flagged for a custom scope review.'),
    severeCondition: true,
    customQuoteAddons: true,
    outsideInstantZone: true,
    unknownLocation: true,
  },

  // ── Estimate range presentation (directive §23) ────────────────────────────
  range: {
    lowFactor: provisional(0.92, 'Low end of the presented range.'),
    highFactor: provisional(1.12, 'High end of the presented range.'),
  },
  rounding: {
    toNearest: provisional(5, 'Round estimates to the nearest $5 to avoid false precision.'),
  },

  // ── Travel policy (directive §31, §34) ─────────────────────────────────────
  travel: {
    /**
     * Miles included (one way) in the base price before a travel adjustment.
     * Mirror of INCLUDED_ONE_WAY_MILES in .env.example / the travel function.
     */
    includedOneWayMiles: provisional(15, 'Directive §31 starting point. Adjust with the owner once the operating origin and zone map are approved.'),
    /** Per-mile vehicle cost (fuel excluded; fuel is priced live) in USD. */
    perMileWearCost: provisional(0.12, 'Provisional wear allowance (tires, oil, depreciation). Reviewed monthly against real job data.'),
    /** Gulf Coast weekly retail gasoline reference used when the EIA feed is down. */
    fallbackGasPrice: provisional(3.1, 'Reference only — NOT a Pensacola pump price claim. Keep current via docs/operations/ESTIMATOR-CALIBRATION.md; the live EIA feed overrides it when available.'),
    /** Flat adjustments used by the offline zone fallback (no routing). */
    zoneAdjustments: {
      core: provisional(0, 'Core area: travel economics are already inside the estimate. No line item is ever shown to the customer (directive §34).'),
      surrounding: provisional(15, 'Surrounding communities: modest travel adjustment incorporated silently into the total.'),
    },
    /**
     * Client-side mirrors of the server travel environment values. The server
     * function (functions/api/travel.ts) owns the authoritative values from
     * .env; these defaults keep the offline estimator reasonable when the
     * function is not deployed or reachable.
     */
    clientDefaults: {
      mpg: provisional(24, 'Mirror of VEHICLE_MPG. Update both together when the vehicle changes.'),
      maxInstantDistanceMiles: provisional(45, 'Mirror of MAX_INSTANT_ESTIMATE_DISTANCE. Beyond this a routed job requires manual confirmation.'),
    },
  },

  // ── Cancellation policy (directive §36) — PROVISIONAL, not final ──────────
  cancellation: {
    ownerApproved: false,
    noticeHours: provisional(24, 'Provisional 24-hour notice expectation.'),
    underNoticePercent: provisional(25, 'Provisional fee under 24 hours. NOT FINAL until owner approval.'),
    sameDayPercent: provisional(50, 'Provisional same-day / no-access / lockout fee. NOT FINAL until owner approval.'),
    discretionNote:
      'The founder may exercise reasonable discretion for established clients and genuine emergencies.',
  },

  // ── Satisfaction philosophy (directive §37) ────────────────────────────────
  satisfaction: {
    statement:
      'If something within the agreed cleaning scope was missed, contact us promptly and we will work quickly to make it right.',
    notificationWindowHours: provisional(null as number | null, 'Directive §37: a notification window (for example 24 hours) may be configured after owner approval. Until then, public copy deliberately avoids a hard number.'),
  },

  // ── Calibration (directive §74) ────────────────────────────────────────────
  calibration: {
    minimumSampleJobs: provisional(10, 'Do not make large formula changes before ~10 jobs.'),
    fullSampleJobs: provisional(30, 'Re-evaluate the full model around 30 jobs.'),
    doc: 'docs/operations/ESTIMATOR-CALIBRATION.md',
  },

  // ── Publication flags (directive §19, §21, §22) ────────────────────────────
  publication: {
    /** Estimated RANGES are the product and are always allowed. */
    publishEstimateRanges: true,
    /** NEVER true without owner approval: per-add-on prices. */
    publishAddonPrices: false,
    /** NEVER true without owner approval: hourly rates. */
    publishHourlyRates: false,
    /** NEVER true without owner approval: the minimum job value as a claim. */
    publishMinimumJob: false,
  },
} as const;

export type PricingConfig = typeof pricing;

/** Convenience accessor that keeps call sites readable. */
export function pricingValue<T>(configValue: ConfigValue<T>): T {
  return configValue.value;
}
