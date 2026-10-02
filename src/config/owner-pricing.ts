// ─────────────────────────────────────────────────────────────────────────────
// OWNER PRICING SETTINGS — the one file the owner edits to tune pricing.
//
// THIS REPOSITORY IS PUBLIC. Nothing here is confidential just because the
// website does not display it: internal rates, labor assumptions and proposed
// promotions are readable by anyone. Never put secrets, credentials, customer
// information or genuinely confidential competitive data in this file.
//
// HOW IT FITS TOGETHER
//   1. THIS FILE holds every raw, owner-editable pricing value as a plain
//      number — no approval wrappers, no presentation decisions.
//   2. `src/config/pricing.ts` consumes these values and attaches the
//      `provisional` / `approved` approval state plus the note explaining
//      where each number came from. That file stays the typed configuration
//      the estimator imports; edit values HERE, not there.
//   3. The estimator engine (`src/lib/estimate/`) reads only `pricing.ts`.
//
// WORKFLOW: edit a value → save → run `npm test` and `npm run check` (they
// catch typos and invalid structures) → commit → rebuild/deploy. Run
// `npm run estimate:quotes` first to see the economic impact on representative
// homes. Config changes take effect only after a new build.
//
// APPROVAL DISCIPLINE: every value below is either PROVISIONAL (a starting
// point that may change) or APPROVED (owner-approved; do not change without a
// new owner decision). That state lives next to each value in `pricing.ts`.
// Promotion and publication flags MUST stay off until the owner approves the
// exact terms in writing — never publish a promise the business has not made.
//
// QUOTE CONFIG VERSION: `pricing.instantQuote.configVersion` must be bumped
// whenever an EFFECTIVE pricing rule below changes a price; the fixed-price
// add-on support added here changes no effective rule, so it is NOT bumped.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AddonDefinition,
  Condition,
  Frequency,
  LastProfessionalClean,
  PricingServiceType,
} from './pricing.ts';

/**
 * Who a promotion is allowed to apply to. `new` means the customer's first
 * cleaning with Sparkling Standard; `established_recurring` means a customer
 * with completed recurring visits. The estimator does not yet ask which a
 * visitor is, so programs that require a customer kind fail closed and never
 * apply automatically — they are reserved for an owner-reviewed flow.
 */
export type PromotionCustomerKind = 'any' | 'new' | 'established_recurring';

export interface PromotionEligibility {
  /** Empty array means every estimable service. */
  services: PricingServiceType[];
  /** Empty array means every frequency. */
  frequencies: Frequency[];
  customer: PromotionCustomerKind;
}

/**
 * A configurable discount program. `value` stays null and `enabled` stays
 * false until the owner approves exact written terms — never invent a
 * discount to fill a placeholder. Every program is non-stackable: the engine
 * applies at most ONE discount to a quote.
 */
export interface PromotionTerms {
  /** Internal stable id recorded with any quote that uses it. */
  id: string;
  /** Keep false until the owner approves the exact terms in writing. */
  enabled: boolean;
  kind: 'percent' | 'fixed';
  /** Percent (0.10 = 10%) or USD when `kind` is 'fixed'. Null = unset. */
  value: number | null;
  /** Which part of the price the discount may reduce. Never travel. */
  appliesTo: 'addons' | 'total' | 'first_visit';
  eligibility: PromotionEligibility;
  /** Internal safety cap in USD; null = no owner-approved cap yet. */
  maxDiscountUsd: number | null;
  /** ISO date (YYYY-MM-DD) after which the program must not apply. */
  expiresOn: string | null;
  /** Exactly one promotion applies. Kept literal for honesty in the type. */
  stackable: false;
}

/** One add-on bundle: a discount on the eligible add-on subtotal when the
 *  customer selects a required set (and, optionally, a recurring rhythm). */
export interface AddonBundleDefinition {
  id: string;
  label: string;
  enabled: boolean;
  /** Every id must be selected (non-specialty only) for the bundle to apply. */
  requiredAddonIds: string[];
  /** Empty array means any frequency; otherwise only these qualify. */
  eligibleFrequencies: Frequency[];
  /** Optional: require any recurring rhythm (weekly/biweekly/monthly). */
  requiresRecurring: boolean;
  kind: 'percent' | 'fixed';
  /** Percent off the eligible add-on subtotal, or USD. Null = unset. */
  value: number | null;
  maxDiscountUsd: number | null;
  expiresOn: string | null;
  stackable: false;
}

/**
 * Founding-10 program — three possible mechanisms, none chosen or active.
 * The owner picks one and supplies terms; the estimator never invents terms.
 * The customer count is owner-controlled: the site does not claim live
 * availability, and no cap is enforced from browser state.
 */
export interface FoundingTenConfig {
  enabled: boolean;
  /** Null until the owner chooses a mechanism. */
  mechanism: 'first_clean_discount' | 'recurring_discount' | 'complimentary_upgrade' | null;
  /** Mechanism 1: one-time discount on the first cleaning. */
  firstClean: {
    kind: 'percent' | 'fixed';
    value: number | null;
    maxDiscountUsd: number | null;
  };
  /** Mechanism 2: ongoing discount for qualifying recurring customers. */
  recurring: {
    kind: 'percent' | 'fixed';
    value: number | null;
    maxDiscountUsd: number | null;
    durationMonths: number | null;
    qualifyingFrequencies: Frequency[];
  };
  /** Mechanism 3: complimentary upgrade / add-on instead of a price cut. */
  upgrade: {
    addonIds: string[];
    maxValueUsd: number | null;
    appliesToFrequencies: Frequency[];
  };
  /**
   * Capacity is OWNER-MANUAL by design: the site cannot count verified
   * enrollments without infrastructure this business does not have at zero
   * cost. The owner tracks slots; the customer reserves, never auto-wins.
   */
  capacity: {
    slots: number;
    enforcement: 'owner_manual';
    /** Null = not tracked here. Never present a number as live availability. */
    awardedCount: number | null;
  };
  /** Always true for this program: the owner approves each enrollment. */
  reservationRequired: boolean;
  expiresOn: string | null;
}

export interface OwnerPricingConfig {
  // ── 1. Hourly rates (internal gross revenue per labor-hour, USD) ──────────
  hourlyRates: {
    /** Applicable recurring maintenance: weekly/biweekly/monthly standard cleans. */
    recurring: number;
    /** Everything else: one-time, deep, move-in/out and STR-turnover work. */
    otherServices: number;
    /** Founder pay floor before overheads and profit. Must stay below both rates. */
    ownerLaborTarget: number;
  };

  // ── 2. Minimum job ────────────────────────────────────────────────────────
  /** Smallest job value, applied silently to every estimate range. */
  minimumJob: number;

  // ── 3. Base labor-hours per service type (before size and rooms) ──────────
  baseLaborHours: Record<PricingServiceType, number>;

  // ── 4. Labor-hours per property unit ──────────────────────────────────────
  laborUnits: {
    /** Labor-hours per 1,000 sq ft for residential services. */
    sqftHoursPerThousand: number;
    /** Labor-hours per full bathroom. */
    fullBathHours: number;
    /** Labor-hours per half bathroom. */
    halfBathHours: number;
    /** Labor-hours per bedroom beyond the first `bedroomsIncludedInBase`. */
    bedroomHours: number;
    /** How many bedrooms are already inside every base service time. */
    bedroomsIncludedInBase: number;
    /** STR turnover: labor-hours per full bathroom. */
    strBathHours: number;
    /** STR turnover: labor-hours per bed reset. */
    strBedHours: number;
    /** STR turnover: labor-hours per 1,000 sq ft. */
    strSqftHoursPerThousand: number;
  };

  // ── 5. Condition multipliers (applied to total labor) ─────────────────────
  conditionFactors: Record<Condition, number>;

  // ── 6. Time-since-last-professional-clean multipliers ─────────────────────
  lastCleanFactors: Record<LastProfessionalClean, number>;

  // ── 7. Recurring frequency labor-efficiency factors ───────────────────────
  frequencyFactors: Record<Frequency, number>;

  // ── 8. Estimate range presentation and rounding ───────────────────────────
  range: {
    /** Low end of the presented estimate range (below 1). */
    lowFactor: number;
    /** High end of the presented estimate range (above 1). */
    highFactor: number;
  };
  rounding: {
    /** Estimates round UP to the nearest multiple of this many USD. */
    roundToNearest: number;
  };

  // ── 9. Add-ons ────────────────────────────────────────────────────────────
  /**
   * Each add-on is charged as `laborHours × applicable rate` unless it sets a
   * positive finite `fixedPriceUsd`, which replaces the charge only. Labor
   * hours still count toward the scheduled labor time either way. Every item
   * here is deliberately labor-based today — leave `fixedPriceUsd` unset
   * unless the owner approves a flat price.
   */
  addons: AddonDefinition[];

  // ── 10. Promotions and discounts (all disabled until owner approval) ──────
  promotions: {
    /**
     * Multi-add-on incentive. Single tier only (never stacked); applies only
     * to eligible non-specialty add-ons, never to base cleaning, travel,
     * specialty work or the minimum job. DISABLED until owner approval.
     */
    addonIncentive: {
      enabled: boolean;
      /** Tier applied when exactly 2 eligible add-ons are selected. */
      twoAddons: { minAddons: number; percent: number };
      /** Tier applied when 3 or more eligible add-ons are selected. */
      threeOrMoreAddons: { minAddons: number; percent: number };
      /** Internal safety cap on the incentive amount in USD. */
      maxDiscount: number;
    };
    /**
     * One-business-hour response guarantee. A service-recovery credit, never
     * an automatic booking promise. DISABLED until owner approval AND
     * documented response timestamps exist.
     */
    responseGuarantee: {
      enabled: boolean;
      /** Business hours allowed before the credit applies. */
      windowBusinessHours: number;
      /** Percent off the first eligible cleaning when the window is missed. */
      discountPercent: number;
      /** Maximum credit in USD. */
      maxDiscount: number;
      /** Service types eligible for the credit. */
      eligibleServices: PricingServiceType[];
      /** Timezone the business-hours clock runs in (IANA name). */
      businessTimezone: string;
    };
    /**
     * Appreciation discounts for returning/loyal customers. One program per
     * entry; all disabled with no terms until the owner approves them. The
     * engine applies at most one promotion per quote.
     */
    appreciationDiscounts: PromotionTerms[];
    /**
     * Add-on bundles that reward profitable, retention-friendly combinations.
     * All disabled with no terms until owner approval.
     */
    addonBundles: AddonBundleDefinition[];
    /**
     * Founding-10 program — three prepared mechanisms, none selected or
     * active. Requires explicit owner approval before any part is enabled.
     */
    foundingTen: FoundingTenConfig;
  };
}

export const ownerPricing: OwnerPricingConfig = {
  // ── 1. Hourly rates ───────────────────────────────────────────────────────
  // Owner-approved Option C (2026-10-01). INTERNAL ONLY — never displayed.
  hourlyRates: {
    recurring: 42,
    otherServices: 50,
    ownerLaborTarget: 35,
  },

  // ── 2. Minimum job ────────────────────────────────────────────────────────
  minimumJob: 125,

  // ── 3. Base labor-hours per service type ──────────────────────────────────
  baseLaborHours: {
    standard: 2.0,
    deep: 3.2,
    move_in_out: 3.4,
    str_turnover: 1.2,
  },

  // ── 4. Labor-hours per property unit ──────────────────────────────────────
  laborUnits: {
    sqftHoursPerThousand: 1.1,
    fullBathHours: 0.5,
    halfBathHours: 0.25,
    bedroomHours: 0.15,
    bedroomsIncludedInBase: 2,
    strBathHours: 0.35,
    strBedHours: 0.2,
    strSqftHoursPerThousand: 0.8,
  },

  // ── 5. Condition multipliers ──────────────────────────────────────────────
  conditionFactors: {
    maintained: 1.0,
    average: 1.1,
    needs_attention: 1.25,
    heavy: 1.45,
    severe: 2.0,
  },

  // ── 6. Time-since-last-clean multipliers ──────────────────────────────────
  lastCleanFactors: {
    within_month: 1.0,
    one_to_three_months: 1.03,
    three_to_twelve_months: 1.08,
    over_a_year: 1.15,
    never_professional: 1.2,
    not_sure: 1.05,
  },

  // ── 7. Frequency factors ──────────────────────────────────────────────────
  // Labor efficiency, not marketing discounts: recurring homes stay cleaner.
  frequencyFactors: {
    weekly: 0.92,
    biweekly: 0.95,
    monthly: 0.98,
    one_time: 1.0,
  },

  // ── 8. Range and rounding ─────────────────────────────────────────────────
  range: {
    lowFactor: 0.92,
    highFactor: 1.12,
  },
  rounding: {
    roundToNearest: 5,
  },

  // ── 9. Add-ons ────────────────────────────────────────────────────────────
  // To change a charge: edit `laborHours` (labor-based, the default) or set
  // `fixedPriceUsd` to a positive number to charge a flat price instead.
  // Specialty items must keep `customQuote: true` and must NOT carry labor
  // hours or a fixed price — they are quoted case by case.
  addons: [
    { id: 'inside_fridge', label: 'Inside refrigerator', blurb: 'Empty, wipe out and detail the refrigerator interior.', laborHours: 0.5, customQuote: false, category: 'kitchen' },
    { id: 'inside_oven', label: 'Inside oven', blurb: 'Detail the oven interior and door glass.', laborHours: 0.6, customQuote: false, category: 'kitchen' },
    { id: 'inside_cabinets', label: 'Inside cabinets', blurb: 'Wipe out cabinet interiors and shelves.', laborHours: 0.8, customQuote: false, category: 'kitchen' },
    { id: 'interior_windows', label: 'Interior windows', blurb: 'Interior glass, sills and tracks where safely reachable.', laborHours: 0.6, customQuote: false, category: 'windows' },
    { id: 'exterior_windows_ground', label: 'Ground-floor exterior windows', blurb: 'Exterior glass reachable from the ground — no ladders.', laborHours: 0.8, customQuote: false, category: 'windows' },
    { id: 'laundry', label: 'Laundry', blurb: 'A load of laundry — washed, dried and put away.', laborHours: 0.7, customQuote: false, category: 'bath_laundry' },
    { id: 'dishes', label: 'Dishes', blurb: 'Load and run the dishwasher or hand-wash a sink of dishes.', laborHours: 0.4, customQuote: false, category: 'kitchen' },
    { id: 'bed_linen_change', label: 'Bed linen change', blurb: 'Change linens on the beds you leave out for us.', laborHours: 0.4, customQuote: false, category: 'bath_laundry' },
    { id: 'organization_general', label: 'General organization', blurb: 'Straighten and organize a room or shared space.', laborHours: 0.8, customQuote: false, category: 'organization' },
    { id: 'pantry_organization', label: 'Pantry organization', blurb: 'Organize shelves, group items and wipe surfaces.', laborHours: 0.6, customQuote: false, category: 'organization' },
    { id: 'closet_organization', label: 'Closet organization', blurb: 'Organize one closet — hanging, folding, grouping.', laborHours: 0.6, customQuote: false, category: 'organization' },
    { id: 'pet_hair_intensive', label: 'Pet-hair intensive', blurb: 'Extra passes for embedded pet hair on floors and upholstery.', laborHours: 0.7, customQuote: false, category: 'pets' },
    { id: 'detailed_walls', label: 'Detailed wall spot-cleaning', blurb: 'Careful spot-cleaning of walls and switch plates where the finish allows.', laborHours: 0.8, customQuote: false, category: 'interior_detail' },
    { id: 'detailed_baseboards', label: 'Detailed baseboards', blurb: 'Hand-wipe baseboards instead of a dry dusting.', laborHours: 0.7, customQuote: false, category: 'interior_detail' },
    { id: 'carpet_cleaning', label: 'Carpet cleaning', blurb: 'Quoted separately — specialty equipment is scheduled case by case.', customQuote: true, category: 'specialty' },
    { id: 'upholstery_cleaning', label: 'Upholstery cleaning', blurb: 'Quoted separately — specialty equipment is scheduled case by case.', customQuote: true, category: 'specialty' },
    { id: 'pressure_washing', label: 'Pressure washing', blurb: 'Quoted separately by scope and surface.', customQuote: true, category: 'specialty' },
    { id: 'garage_cleaning', label: 'Garage cleaning', blurb: 'Quoted separately after seeing the space and debris volume.', customQuote: true, category: 'specialty' },
    { id: 'patio_cleaning', label: 'Patio / porch cleaning', blurb: 'Quoted separately by size and condition.', customQuote: true, category: 'specialty' },
  ],

  // ── 10. Promotions and discounts ──────────────────────────────────────────
  // ALL DISABLED. These require explicit owner approval before any of them is
  // wired into customer-facing behavior or published.
  promotions: {
    addonIncentive: {
      enabled: false,
      twoAddons: { minAddons: 2, percent: 0.05 },
      threeOrMoreAddons: { minAddons: 3, percent: 0.08 },
      maxDiscount: 75,
    },
    responseGuarantee: {
      enabled: false,
      windowBusinessHours: 1,
      discountPercent: 25,
      maxDiscount: 50,
      eligibleServices: ['standard', 'deep', 'move_in_out', 'str_turnover'],
      businessTimezone: 'America/Chicago',
    },
    // Prepared programs — DISABLED with no terms. Study the financial
    // scenarios in docs/launch/PROMOTION-PROPOSALS.md, approve exact terms,
    // then set `value` AND `enabled` in the same owner-approved change.
    appreciationDiscounts: [
      {
        id: 'appreciation-established-recurring',
        enabled: false,
        kind: 'percent',
        value: null,
        appliesTo: 'total',
        eligibility: { services: [], frequencies: ['weekly', 'biweekly', 'monthly'], customer: 'established_recurring' },
        maxDiscountUsd: null,
        expiresOn: null,
        stackable: false,
      },
      {
        id: 'appreciation-referral-welcome',
        enabled: false,
        kind: 'fixed',
        value: null,
        appliesTo: 'first_visit',
        eligibility: { services: ['standard'], frequencies: ['weekly', 'biweekly', 'monthly'], customer: 'new' },
        maxDiscountUsd: null,
        expiresOn: null,
        stackable: false,
      },
    ],
    addonBundles: [
      {
        id: 'bundle-kitchen-refresh',
        label: 'Kitchen refresh bundle',
        enabled: false,
        requiredAddonIds: ['inside_fridge', 'inside_oven'],
        eligibleFrequencies: [],
        requiresRecurring: false,
        kind: 'percent',
        value: null,
        maxDiscountUsd: null,
        expiresOn: null,
        stackable: false,
      },
      {
        id: 'bundle-recurring-care',
        label: 'Recurring care bundle',
        enabled: false,
        requiredAddonIds: ['bed_linen_change', 'dishes'],
        eligibleFrequencies: ['weekly', 'biweekly'],
        requiresRecurring: true,
        kind: 'percent',
        value: null,
        maxDiscountUsd: null,
        expiresOn: null,
        stackable: false,
      },
    ],
    foundingTen: {
      enabled: false,
      mechanism: null,
      firstClean: { kind: 'percent', value: null, maxDiscountUsd: null },
      recurring: { kind: 'percent', value: null, maxDiscountUsd: null, durationMonths: null, qualifyingFrequencies: [] },
      upgrade: { addonIds: [], maxValueUsd: null, appliesToFrequencies: [] },
      capacity: { slots: 10, enforcement: 'owner_manual', awardedCount: null },
      reservationRequired: true,
      expiresOn: null,
    },
  },
};
