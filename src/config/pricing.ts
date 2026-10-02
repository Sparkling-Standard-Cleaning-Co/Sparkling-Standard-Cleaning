// ─────────────────────────────────────────────────────────────────────────────
// Central pricing configuration — the TYPED CONFIG consumed by the estimator
// and every price/policy decision the site presents.
//
// RAW OWNER-EDITABLE VALUES live in `src/config/owner-pricing.ts` and are
// imported below, wrapped here with their approval state and explanation.
// Edit pricing values in owner-pricing.ts; edit this file only to add a new
// policy or change an approval state/note.
//
// Travel economics are shared with the serverless function via
// `src/config/travel.ts` (imported below) — do not duplicate those numbers.

import { travelConfig } from './travel.ts';
import { ownerPricing } from './owner-pricing.ts';

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

function approved<T>(value: T, note: string): ConfigValue<T> {
  return { value, state: 'approved', note };
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
  /**
   * Optional fixed charge in USD (owner-set in owner-pricing.ts). When a
   * positive finite number, it replaces `laborHours × rate` for the CHARGE
   * only; the add-on's labor-hours still count toward scheduled labor time.
   * Leave unset for the standard labor-based pricing.
   */
  fixedPriceUsd?: number;
  /** Requires a custom quote (equipment / specialized work) — never instant. */
  customQuote: boolean;
  category: 'kitchen' | 'bath_laundry' | 'windows' | 'interior_detail' | 'pets' | 'organization' | 'specialty';
}

export const pricing = {
  // ── Internal labor economics (directive §21) ───────────────────────────────
  laborEconomics: {
    /**
     * Target GROSS revenue per labor-hour used to convert estimated labor into
     * the estimate range. INTERNAL ONLY — this is not what anyone is paid and
     * must never be displayed.
     *
     * Option C (owner-approved 2026-10-01): $42/labor-hour for applicable
     * recurring maintenance (recurring standard cleans) and $50/labor-hour for
     * other approved service categories (one-time, deep, move-out, STR).
     * The model must still cover real operating costs and margin.
     */
    targetGrossRevenuePerLaborHour: approved(
      ownerPricing.hourlyRates.otherServices,
      'Option C — other service categories rate (one-time, deep, move-in/out, STR). Owner-approved 2026-10-01. Never displayed publicly.',
    ),
    recurringGrossRevenuePerLaborHour: approved(
      ownerPricing.hourlyRates.recurring,
      'Option C — applicable recurring maintenance rate (weekly/biweekly/monthly standard cleans). Owner-approved 2026-10-01. Never displayed publicly.',
    ),
    /**
     * Desired owner labor compensation floor BEFORE overheads and profit.
     * INTERNAL ONLY.
     */
    ownerLaborTargetPerHour: provisional(
      ownerPricing.hourlyRates.ownerLaborTarget,
      'Directive §21 owner labor target floor. The estimate engine must keep even small jobs economically rational against this floor.',
    ),
  },

  // ── Minimum job value (directive §22) ──────────────────────────────────────
  minimumJob: provisional(
    ownerPricing.minimumJob,
    'Directive §22 initial provisional minimum. One setting only. Applied silently to the estimate range; the number is not advertised unless the owner approves.',
  ),

  // ── Labor-hour model (directive §20 anchors) ───────────────────────────────
  // Anchors: a maintained 3/2 home ≈ 4.5–5.0 labor-hours for the founder alone;
  // a first clean of a similar home ≈ 6 labor-hours. The base + per-unit model
  // below reproduces those anchors and is intended for recalibration.
  laborModel: {
    baseHours: {
      standard: provisional(ownerPricing.baseLaborHours.standard, 'Chosen so a maintained ~1600 sqft 3/2 standard clean lands at ≈4.8–4.9 labor-hours (directive §20 anchor).'),
      deep: provisional(ownerPricing.baseLaborHours.deep, 'Deep cleaning adds baseboard/trim/door/frame/wall-detail time on top of the standard scope.'),
      move_in_out: provisional(ownerPricing.baseLaborHours.move_in_out, 'Move-in/move-out assumes an empty or nearly empty home with inside-cabinet and appliance attention.'),
      str_turnover: provisional(ownerPricing.baseLaborHours.str_turnover, 'STR turnover base excludes size/beds; a 2/2 with 2 beds lands at ≈3.0–3.2 labor-hours including linen reset.'),
    } satisfies Record<PricingServiceType, ConfigValue<number>>,
    sqftHoursPerThousand: provisional(ownerPricing.laborUnits.sqftHoursPerThousand, 'Square footage matters more than bedroom count (directive §27). 1000 sqft ≈ 1.1 labor-hours at standard condition.'),
    fullBathHours: provisional(ownerPricing.laborUnits.fullBathHours, 'Bathrooms are the most labor-dense rooms in the home.'),
    halfBathHours: provisional(ownerPricing.laborUnits.halfBathHours, 'Half baths take roughly half a full bath.'),
    bedroomHours: provisional(ownerPricing.laborUnits.bedroomHours, 'Bedrooms beyond the first two add light time; deliberately small so the model does not overfit bedroom count (directive §27).'),
    bedroomsIncludedInBase: provisional(ownerPricing.laborUnits.bedroomsIncludedInBase, 'First two bedrooms are already inside baseHours.'),
    strBathHours: provisional(ownerPricing.laborUnits.strBathHours, 'STR bathroom reset per full bath.'),
    strBedHours: provisional(ownerPricing.laborUnits.strBedHours, 'STR bed reset (linens, presentation) per bed.'),
    strSqftHoursPerThousand: provisional(ownerPricing.laborUnits.strSqftHoursPerThousand, 'STR turnover is a reset, not a deep clean; square footage contributes less than residential cleaning.'),
  },

  /** Condition multiplier applied to total labor (directive §25 step 3). */
  conditionFactors: {
    maintained: provisional(ownerPricing.conditionFactors.maintained, 'Recently and regularly cleaned home in good shape.'),
    average: provisional(ownerPricing.conditionFactors.average, 'Lived-in home with normal buildup.'),
    needs_attention: provisional(ownerPricing.conditionFactors.needs_attention, 'Noticeably overdue cleaning; extra attention throughout.'),
    heavy: provisional(ownerPricing.conditionFactors.heavy, 'Heavy buildup; multiple areas need detail work.'),
    severe: provisional(ownerPricing.conditionFactors.severe, 'Severe condition — always routed to custom confirmation, never an instant estimate.'),
  } satisfies Record<Condition, ConfigValue<number>>,

  /** How long since the last professional clean (directive §25 step 3). */
  lastCleanFactors: {
    within_month: provisional(ownerPricing.lastCleanFactors.within_month, 'Home maintained recently; recurring service is realistic.'),
    one_to_three_months: provisional(ownerPricing.lastCleanFactors.one_to_three_months, 'Small additional detail time expected.'),
    three_to_twelve_months: provisional(ownerPricing.lastCleanFactors.three_to_twelve_months, 'Noticeable buildup in neglected areas.'),
    over_a_year: provisional(ownerPricing.lastCleanFactors.over_a_year, 'Extended gap; first visit behaves close to a first professional clean.'),
    never_professional: provisional(ownerPricing.lastCleanFactors.never_professional, 'First professional clean — matches the directive §20 ≈6 labor-hour anchor for a maintained 3/2.'),
    not_sure: provisional(ownerPricing.lastCleanFactors.not_sure, 'Conservative middle value when the customer is unsure; flagged for review.'),
  } satisfies Record<LastProfessionalClean, ConfigValue<number>>,

  /**
   * Recurring frequency labor adjustment. Recurring homes stay cleaner, so the
   * SAME home takes less labor per visit. This is a labor-efficiency model,
   * not a marketing discount (directive §28).
   */
  frequencyFactors: {
    weekly: provisional(ownerPricing.frequencyFactors.weekly, 'Weekly homes are the most maintainable; best per-visit value follows from labor efficiency.'),
    biweekly: provisional(ownerPricing.frequencyFactors.biweekly, 'Biweekly homes remain close to maintenance level.'),
    monthly: provisional(ownerPricing.frequencyFactors.monthly, 'Monthly homes drift; smaller efficiency benefit.'),
    one_time: provisional(ownerPricing.frequencyFactors.one_time, 'One-time baseline — no maintenance benefit.'),
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
  // ONE authoritative add-on pricing method: an add-on's price is its
  // configured LABOR-HOURS × the applicable gross revenue per labor-hour
  // (Option C rates). The former per-add-on provisional menu prices were
  // removed because they disagreed with the live calculations. Displayed
  // add-on amounts therefore always reconcile with the proposed total.
  addons: {
    state: 'provisional' as ApprovalState,
    // Raw items (including any optional fixedPriceUsd) live in owner-pricing.ts.
    items: ownerPricing.addons,
    note: 'Add-on amounts are calculated from labor-hours × the applicable approved rate (or the owner-set fixed price when one exists). Specialty items show “Custom quote” and are never priced instantly.',
  },

  // ── Multi-add-on incentive (PROPOSED — not published) ─────────────────────
  // Owner review required before this can appear on the site. When enabled the
  // engine applies exactly ONE tier to the eligible add-on subtotal; it never
  // discounts base cleaning, travel, specialty work or the minimum job price.
  addonIncentive: {
    enabled: provisional(ownerPricing.promotions.addonIncentive.enabled, 'PROPOSED promotion — requires owner approval before publication. Off by default.'),
    tiers: [
      {
        minAddons: ownerPricing.promotions.addonIncentive.twoAddons.minAddons,
        percent: provisional(ownerPricing.promotions.addonIncentive.twoAddons.percent, 'Proposed: 5% off the eligible add-on subtotal for two add-ons.'),
      },
      {
        minAddons: ownerPricing.promotions.addonIncentive.threeOrMoreAddons.minAddons,
        percent: provisional(ownerPricing.promotions.addonIncentive.threeOrMoreAddons.percent, 'Proposed: 8% off the eligible add-on subtotal for three or more add-ons.'),
      },
    ],
    maxDiscount: provisional(ownerPricing.promotions.addonIncentive.maxDiscount, 'Internal safety cap on the incentive amount; keep below the smallest realistic add-on subtotal without owner review.'),
    note: 'Single tier only (never stacked). Applies only to non-specialty add-ons. Requires owner approval before it can be enabled.',
  },

  // ── One-hour response guarantee (PROPOSED — not published) ────────────────
  // Requires owner approval AND operational evidence before publication. The
  // discount is a service-recovery credit, never an automatic booking promise.
  responseGuarantee: {
    enabled: provisional(ownerPricing.promotions.responseGuarantee.enabled, 'PROPOSED customer-service guarantee — requires owner approval and documented response tracking before publication.'),
    windowBusinessHours: provisional(ownerPricing.promotions.responseGuarantee.windowBusinessHours, 'One business hour, measured during published business hours (America/Chicago).'),
    discountPercent: provisional(ownerPricing.promotions.responseGuarantee.discountPercent, 'Proposed 25% off the first eligible cleaning when the personal response misses the window.'),
    maxDiscount: provisional(ownerPricing.promotions.responseGuarantee.maxDiscount, 'Proposed $50 maximum credit.'),
    eligibleServices: ownerPricing.promotions.responseGuarantee.eligibleServices,
    businessTimezone: ownerPricing.promotions.responseGuarantee.businessTimezone,
    note: 'Automatic acknowledgments do not count as a response; the clock starts when a request arrives during business hours, or when the next business day begins. Does not combine with other promotions. Requires documented receipt and response timestamps.',
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
    lowFactor: provisional(ownerPricing.range.lowFactor, 'Low end of the presented range.'),
    highFactor: provisional(ownerPricing.range.highFactor, 'High end of the presented range.'),
  },
  rounding: {
    toNearest: provisional(ownerPricing.rounding.roundToNearest, 'Round estimates to the nearest $5 to avoid false precision.'),
  },

  // ── Travel policy (directive §31, §34) ─────────────────────────────────────
  travel: {
    /**
     * Miles included (one way) in the base price before a travel adjustment.
     * Numbers come from the shared travel config (src/config/travel.ts) so the
     * client and the serverless function cannot drift apart.
     */
    includedOneWayMiles: provisional(
      travelConfig.includedOneWayMiles,
      'Shared with functions/api/travel.ts via src/config/travel.ts. Directive §31 starting point.',
    ),
    /** Per-mile vehicle cost (fuel excluded; fuel is priced live) in USD. */
    perMileWearCost: provisional(
      travelConfig.wearPerMile,
      'Shared wear allowance (tires, oil, depreciation). Reviewed monthly against real job data.',
    ),
    /** Gulf Coast weekly retail gasoline reference used when the EIA feed is down. */
    fallbackGasPrice: provisional(
      travelConfig.fallbackGasPrice,
      'Reference only — NOT a Pensacola pump price claim. The live EIA feed overrides it when available.',
    ),
    /** Flat adjustments used by the offline zone fallback (no routing). */
    zoneAdjustments: {
      core: provisional(0, 'Core area: travel economics are already inside the estimate. No line item is ever shown to the customer (directive §34).'),
      surrounding: provisional(15, 'Surrounding communities: modest travel adjustment incorporated silently into the total.'),
    },
    /**
     * Client-side mirrors of the server travel environment values. The server
     * function owns the authoritative values from the shared travel config;
     * these keep the offline estimator reasonable.
     */
    clientDefaults: {
      mpg: provisional(travelConfig.mpg, 'Shared with functions/api/travel.ts. Update both together when the vehicle changes.'),
      maxInstantDistanceMiles: provisional(
        travelConfig.maxInstantDistanceMiles,
        'Hard safety cap for routed trips without a duration. Beyond this a routed job requires manual confirmation.',
      ),
    },
  },

  // ── Driving-time policy (location engine) ─────────────────────────────────
  drivingPolicy: {
    /**
     * Ordinary service boundary in minutes of routed driving time. A routed
     * destination within this qualifies for an ordinary instant estimate.
     * PROVISIONAL — owner must approve the final value before binding quotes.
     */
    maxDrivingMinutes: provisional(
      travelConfig.maxDrivingMinutes,
      'Owner intent: about one hour of actual driving time from the private operating origin. Requires owner approval before binding instant prices.',
    ),
    /** Additional review band beyond the boundary (needs personal confirmation). */
    reviewBandMinutes: provisional(
      travelConfig.reviewBandMinutes,
      'Proposed 15-minute band; owner approval required. Within the band the estimate is shown and marked for personal confirmation.',
    ),
  },

  // ── Instant quote (single offered price) ──────────────────────────────────
  instantQuote: {
    /**
     * Enables the proposed-price experience: one clearly labeled cleaning
     * price derived from the estimate model, shown with the reservation
     * request flow. Owner-directed (2026-10-01) — the price is a proposal on
     * a non-binding REQUEST, never a confirmed booking.
     */
    enabled: approved(true, 'Owner-directed proposed-price experience (2026-10-01). Always labeled as a request pending owner confirmation.'),
    /**
     * Binding customer offers (auto-accepted prices/charges) remain disabled
     * until the server-side verification path is live AND the owner approves
     * the reference-quote impact report. The reservation flow is
     * request-only while this is false.
     */
    binding: approved(false, 'Binding offers stay off: every reservation is server-verified and owner-confirmed, never auto-charged.'),
    /**
     * Configuration version recorded with every quote and verified against
     * the server before a reservation is accepted. Bump when pricing logic,
     * rates or policy values change so old quotes cannot be silently reused.
     */
    configVersion: approved('2026-10-01.option-c.v1', 'Quote provenance marker. Increment on any pricing/policy change.'),
    /**
     * Which value from the calculation becomes the offered price. 'expected' is
     * the model price and never the lowest range value; 'midpoint' and 'high'
     * are alternatives for owner review.
     */
    selection: provisional('expected' as 'expected' | 'midpoint' | 'high', 'Default protects margin: the offered price is the model price, not the low end of a range.'),
    /** Offered prices are never below expectedPrice × this margin floor. */
    marginFloor: provisional(1, 'Hard margin safeguard: selection candidates below expectedPrice are discarded.'),
    /**
     * Server-side review validity window recorded when the server verifies a
     * quote (owner notification field). NOT a customer-facing hold, expiry
     * promise or binding offer; customer copy describes a proposed price
     * subject to owner confirmation.
     */
    validityHours: provisional(336, 'Server-issued verification validity window (14 days) for the owner notification only. Not shown to customers as a hold.'),
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
