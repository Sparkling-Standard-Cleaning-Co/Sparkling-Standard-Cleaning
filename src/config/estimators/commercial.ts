// Commercial estimate tier model (Smart Estimate directive, Part 4).
//
// A preliminary commercial estimate is a TIERED promise:
//   Tier A — Preliminary Cleaning Estimate (a single calculated number)
//   Tier B — Estimated Price Range (a low/high band)
//   Tier C — Request a Custom Cleaning Quote (walkthrough)
//
// NUMERIC TIERS ARE ENABLED provisionally (Initiative 6.1, 2026-10-25) under
// explicit owner delegation for evidence-based preliminary estimates. Tier A/B
// prices are nonbinding and owner-confirmed; Tier C remains a custom scope
// review. The workload-hour tier boundaries live in `pricing.commercialPricing`.
// The legacy square-foot thresholds below remain for reference only.
//
// Thresholds remain configurable in one place.

import { pricing } from '../pricing.ts';

export type CommercialTier = 'A' | 'B' | 'C';

export interface CommercialTierConfig {
  /**
   * Owner kill switch for numeric facility pricing. TRUE = Tier A/B show
   * nonbinding preliminary numbers (Tier C remains scope review). FALSE = every
   * commercial/church request is a scope review and no numeric price survives
   * in the UI, request, owner notification or server verification.
   */
  numericEstimatesEnabled: boolean;
  /**
   * LEGACY square-foot reference only. Runtime tiering is by workload hours
   * (`pricing.commercialPricing.tierAHours` / `tierBHours`), not square feet.
   */
  tierA_maxCleanableSqft: number;
  /**
   * LEGACY square-foot reference only (see above).
   */
  tierB_maxCleanableSqft: number;
  /** Conditions that force Tier C regardless of size. */
  tierC_triggers: {
    /** Restrooms above this count force Tier C (variable workload). */
    restroomsOver: number;
    /** Any specialty cleaning need selected forces Tier C. */
    specialtyServices: string[];
  };
}

export const commercialTierConfig: CommercialTierConfig = {
  // Enabled 2026-10-24 (Initiative 6.1) for nonbinding preliminary Tier A/B
  // estimates. This flag is enforced in commercial.ts (browser pricing) and
  // facility-verify.ts (server). Set false for a scope-review-only experience
  // with no numeric prices anywhere.
  numericEstimatesEnabled: true,
  tierA_maxCleanableSqft: 2500,
  tierB_maxCleanableSqft: 6000,
  tierC_triggers: {
    restroomsOver: 4,
    specialtyServices: [
      'post_construction',
      'medical_facility',
      'industrial_kitchen',
      'floor_resurfacing',
      'biohazard',
      'high_rise',
    ],
  },
};

export interface CommercialIntakeInput {
  cleanableSqft: number | null;
  restroomCount: number | null;
  specialtyServices: string[];
}

export interface CommercialTierOutcome {
  tier: CommercialTier;
  /** Customer-facing heading (exact owner-approved language). */
  heading: string;
  /** Customer-facing explanation of what the tier means. */
  explanation: string;
}

/**
 * LEGACY square-foot resolver retained as reference. The live facility form and
 * server verification use the workload-hour engine in `commercial.ts`; the
 * owner kill switch above still governs both.
 */
export function resolveCommercialTier(
  intake: CommercialIntakeInput,
  config: CommercialTierConfig = commercialTierConfig,
): CommercialTierOutcome {
  const sqft = intake.cleanableSqft ?? 0;
  const specialty = intake.specialtyServices.some((service) =>
    config.tierC_triggers.specialtyServices.includes(service),
  );
  const manyRestrooms = (intake.restroomCount ?? 0) > config.tierC_triggers.restroomsOver;

  if (!config.numericEstimatesEnabled) {
    return {
      tier: 'C',
      heading: 'Request a Custom Cleaning Quote',
      explanation:
        'Sparkling Standard reviews your space personally and confirms a clear, exact quote before any work is scheduled — no generic ballpark, no surprises.',
    };
  }
  if (specialty || manyRestrooms || sqft > config.tierB_maxCleanableSqft) {
    return {
      tier: 'C',
      heading: 'Request a Custom Cleaning Quote',
      explanation:
        'This space has details that deserve an in-person look. Sparkling Standard schedules a walkthrough and prepares a clear, exact quote.',
    };
  }
  if (sqft > config.tierA_maxCleanableSqft) {
    return {
      tier: 'B',
      heading: 'Estimated Price Range',
      explanation:
        'A preliminary price range for your space — Sparkling Standard confirms the exact price after a quick review of the details you provided.',
    };
  }
  return {
    tier: 'A',
    heading: 'Preliminary Cleaning Estimate',
    explanation:
      'A preliminary calculated estimate for your space — Sparkling Standard confirms the final scope and price with you before anything is scheduled.',
  };
}

/**
 * The approved labor economics every tier must build on — imported, never
 * duplicated: the $55/labor-hour rate, the $125 minimum and the floor-to-$5
 * rounding all flow from the same single sources of truth the residential
 * estimator uses.
 */
export const COMMERCIAL_ECONOMICS = {
  laborRatePerHour: pricing.laborEconomics.targetGrossRevenuePerLaborHour.value,
  minimumJob: pricing.minimumJob.value,
  roundingStep: pricing.rounding.toNearest.value,
} as const;
