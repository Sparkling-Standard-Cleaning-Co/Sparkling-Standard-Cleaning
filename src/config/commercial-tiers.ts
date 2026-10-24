// Commercial estimate tier model (Smart Estimate directive, Part 4).
//
// A preliminary commercial estimate is a TIERED promise:
//   Tier A — Preliminary Cleaning Estimate (a single calculated number)
//   Tier B — Estimated Price Range (a low/high band)
//   Tier C — Request a Custom Cleaning Quote (walkthrough)
//
// NUMERIC TIERS ARE DISABLED until the owner approves the commercial pricing
// methodology in writing (docs/launch/COMMERCIAL-ESTIMATE-MODEL.md). The
// threshold below is the owner's PROPOSED starting boundary (~2,500
// cleanable sqft) prepared for analysis — it is configurable, NOT a buried
// constant, and enabling `numericEstimatesEnabled` is a separate owner
// decision. While false, every commercial request routes to Tier C with
// honest "preliminary" language, exactly as today.
//
// All thresholds live here so the owner can tune them in one place.

import { pricing } from './pricing.ts';

export type CommercialTier = 'A' | 'B' | 'C';

export interface CommercialTierConfig {
  /** Owner approval gate for Tier A/B numeric estimates. FALSE = all Tier C. */
  numericEstimatesEnabled: boolean;
  /**
   * Tier A ceiling: the largest CLEANABLE square footage eligible for a
   * single calculated preliminary estimate. PROPOSED (owner's ~2,500 sqft
   * starting point) — confirm against the labor model before enabling.
   */
  tierA_maxCleanableSqft: number;
  /**
   * Tier B ceiling: above Tier A up to this size shows a calculated RANGE.
   * Anything larger (or any specialty/high-risk factor) is Tier C.
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
  // Owner approval required before flipping to true. When true, Tier A/B
  // flow through the approved residential labor-hour economics adapted for
  // commercial density (see the model document); when false everything is
  // Tier C and NO number is invented.
  numericEstimatesEnabled: false,
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
 * Resolves the estimate tier for a commercial intake. Pure function — the
 * wizard and any future server path share it. Numeric content (the Tier A
 * estimate or Tier B range) is produced by the estimator engine ONLY when
 * numericEstimatesEnabled is true; otherwise the outcome always describes a
 * request-a-quote flow.
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
