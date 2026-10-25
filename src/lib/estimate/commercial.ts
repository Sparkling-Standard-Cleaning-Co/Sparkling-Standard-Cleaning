// Commercial / church facility workload model (Initiative 6.0).
//
// This is NOT the residential bedroom/bathroom model. It estimates cleaning
// labor from facility workload using the owner-approved baseline constants in
// `owner-pricing.ts`:
//   setup 20 min + 30 min per 1,000 cleanable sqft + 3 min per restroom
//   + 10 min for a breakroom/kitchen, adjusted by condition and traffic.
//
// NUMERIC FACILITY PRICING IS GATED (`commercialTiers.numericEstimatesEnabled
// === false`). While closed, the engine still produces an honest workload and
// scope summary, but NEVER a dollar amount. See
// docs/operations/ESTIMATOR-ENGINES.md and scripts/commercial-calibration.mjs.

import type { Condition } from '../../config/pricing.ts';
import { pricing } from '../../config/pricing.ts';
import { commercialTierConfig, resolveCommercialTier } from '../../config/commercial-tiers.ts';
import { calculateChurchDiscount, type ChurchDiscountResult } from './church-discount.ts';

export type FacilityTraffic = 'low' | 'average' | 'high';

export interface FacilityWorkloadInput {
  /** Cleanable area only (not storage / unused space). */
  cleanableSqft: number | null;
  restrooms: number | null;
  breakroom: boolean;
  condition?: Condition;
  traffic?: FacilityTraffic;
}

export interface FacilityWorkload {
  setupMinutes: number;
  areaMinutes: number;
  restroomMinutes: number;
  breakroomMinutes: number;
  conditionFactor: number;
  trafficFactor: number;
  totalMinutes: number;
  laborHours: number;
  /** Owner-facing contribution benchmark; never shown while pricing is gated. */
  targetLaborValue: number;
  numericPricingEnabled: boolean;
  /** True when the customer receives a scope-review request, not a price. */
  scopeReviewRequired: boolean;
  tier: 'A' | 'B' | 'C';
  exclusions: string[];
}

function finiteOrZero(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function calculateFacilityWorkload(input: FacilityWorkloadInput): FacilityWorkload {
  const sqft = finiteOrZero(input.cleanableSqft);
  const restrooms = finiteOrZero(input.restrooms);
  const condition = input.condition ?? 'average';
  const traffic = input.traffic ?? 'average';

  const setupMinutes = pricing.commercialWorkload.setupMinutes.value;
  const areaMinutes = (sqft / 1000) * pricing.commercialWorkload.minutesPerThousandSqft.value;
  const restroomMinutes = restrooms * pricing.commercialWorkload.minutesPerRestroom.value;
  const breakroomMinutes = input.breakroom ? pricing.commercialWorkload.minutesPerBreakroom.value : 0;
  const conditionFactor = pricing.conditionFactors[condition].value;
  const trafficFactor = pricing.commercialWorkload.trafficFactors[traffic].value;

  const totalMinutes = (setupMinutes + areaMinutes + restroomMinutes + breakroomMinutes) * conditionFactor * trafficFactor;
  const laborHours = Math.round((totalMinutes / 60) * 100) / 100;

  const tier = resolveCommercialTier({
    cleanableSqft: sqft || null,
    restroomCount: restrooms || null,
    specialtyServices: [],
  });

  return {
    setupMinutes,
    areaMinutes: Math.round(areaMinutes * 10) / 10,
    restroomMinutes,
    breakroomMinutes,
    conditionFactor,
    trafficFactor,
    totalMinutes: Math.round(totalMinutes),
    laborHours,
    targetLaborValue: Math.round(laborHours * pricing.laborEconomics.targetGrossRevenuePerLaborHour.value),
    numericPricingEnabled: commercialTierConfig.numericEstimatesEnabled,
    scopeReviewRequired: !commercialTierConfig.numericEstimatesEnabled || tier.tier === 'C',
    tier: tier.tier,
    exclusions: [
      'Specialty services (post-construction, floor stripping, biohazard) require a custom quote.',
      'Consumables and restocking are quoted separately unless agreed in writing.',
      'Third-party costs and taxes are not included in any preliminary figure.',
    ],
  };
}

export interface ChurchEstimateInput extends FacilityWorkloadInput {
  /** True when another promotion is also being applied. */
  otherDiscountApplied?: boolean;
}

export interface ChurchEstimateSummary {
  workload: FacilityWorkload;
  discount: ChurchDiscountResult;
  /** Null while numeric pricing is gated — never a fabricated amount. */
  preliminaryTotal: number | null;
}

/**
 * Church estimates reuse the facility workload and apply the owner-directed
 * 10% discount to the cleaning subtotal. Dollar figures are produced ONLY
 * when the commercial numeric gate is open; otherwise the request proceeds as
 * a scope review and the discount entitlement is recorded for the owner.
 */
export function calculateChurchEstimate(input: ChurchEstimateInput): ChurchEstimateSummary {
  const workload = calculateFacilityWorkload(input);
  const subtotal = workload.numericPricingEnabled ? workload.targetLaborValue : 0;
  const discount = calculateChurchDiscount(subtotal, {
    otherDiscountApplied: input.otherDiscountApplied === true,
  });
  return {
    workload,
    discount,
    preliminaryTotal: workload.numericPricingEnabled
      ? Math.round(discount.discountedSubtotal / pricing.rounding.toNearest.value) *
        pricing.rounding.toNearest.value
      : null,
  };
}
