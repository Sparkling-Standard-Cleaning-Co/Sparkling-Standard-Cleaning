// Side-effect-free pricing simulator.
//
// Runs the SAME calculators the public estimators and the server verification
// use. It never creates a lead, hold, booking, payment, email, calendar event
// or customer record, and it passes an explicit configuration to the shared
// calculators instead of mutating the active pricing singleton.

import { buildPricingConfig } from '../../config/pricing.ts';
import { commercialTierConfig } from '../../config/estimators/commercial.ts';
import { calculateEstimate, type EstimateContext } from '../estimate/calculate.ts';
import {
  calculateFacilityPrice,
  calculateFacilityWorkload,
  type FacilityTraffic,
  type FacilityType,
  type FlooringType,
} from '../estimate/commercial.ts';
import type { Condition, EstimateInputDraft, PricingBreakdown } from '../estimate/types.ts';
import type { PricingSnapshot } from './snapshot.ts';

export type SimulatorEngine = 'residential' | 'str' | 'commercial' | 'church';

export interface SimulatorResidentialInput {
  serviceType?: 'standard' | 'deep' | 'move_in_out' | 'str_turnover';
  propertyType?: 'house' | 'apartment' | 'condo' | 'townhome' | 'other';
  squareFeet?: number;
  bedrooms?: number;
  fullBaths?: number;
  halfBaths?: number;
  beds?: number;
  frequency?: 'weekly' | 'biweekly' | 'monthly' | 'one_time';
  condition?: Condition;
  lastClean?: 'within_month' | 'one_to_three_months' | 'three_to_twelve_months' | 'over_a_year' | 'never_professional' | 'not_sure';
  addonIds?: string[];
  zip?: string;
  pets?: 'none' | 'one' | 'multiple_shedding';
  supportiveEligible?: boolean;
  promotionCode?: string;
  oneWayMiles?: number | null;
  durationMinutes?: number | null;
}

export interface SimulatorFacilityInput {
  cleanableSqft?: number;
  restroomFixtures?: number;
  breakroom?: boolean;
  facilityType?: FacilityType;
  condition?: Condition;
  traffic?: FacilityTraffic;
  flooring?: FlooringType;
  firstClean?: boolean;
  specialty?: boolean;
  frequency?: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  oneWayMiles?: number | null;
  otherDiscountApplied?: boolean;
}

export interface SimulatorInput {
  engine: SimulatorEngine;
  residential?: SimulatorResidentialInput;
  facility?: SimulatorFacilityInput;
}

export interface SimulatorPrice {
  status: 'priced' | 'custom_confirmation_required' | 'invalid' | 'pricing_disabled';
  total: number | null;
  range: { low: number; high: number } | null;
  laborHours: number | null;
  breakdown: PricingBreakdown | null;
  cleaningSubtotal: number | null;
  travelAdjustment: number | null;
  extrasSubtotal: number | null;
  discountAmount: number | null;
  ongoingPerVisit: number | null;
  tier: 'A' | 'B' | 'C' | null;
  discountLabel: string | null;
  message: string | null;
}

export interface SimulatorComparison {
  engine: SimulatorEngine;
  published: SimulatorPrice;
  draft: SimulatorPrice;
  differenceUsd: number | null;
  differencePercent: number | null;
  laborHoursDifference: number | null;
}

function round2(value: number): number {
  return Math.round((value + 1e-9) * 100) / 100;
}

function residentialDraft(input: SimulatorResidentialInput, engine: SimulatorEngine): EstimateInputDraft {
  return {
    serviceType: input.serviceType ?? (engine === 'str' ? 'str_turnover' : 'standard'),
    propertyType: input.propertyType ?? 'house',
    squareFeet: input.squareFeet ?? 1600,
    bedrooms: input.bedrooms ?? 3,
    fullBaths: input.fullBaths ?? 2,
    halfBaths: input.halfBaths ?? 0,
    beds: input.beds ?? (engine === 'str' ? 2 : 0),
    frequency: input.frequency ?? (engine === 'str' ? 'one_time' : 'one_time'),
    condition: input.condition ?? 'maintained',
    lastClean: input.lastClean ?? 'within_month',
    addonIds: input.addonIds ?? [],
    zip: input.zip ?? '32533',
    pets: input.pets ?? 'none',
    supportiveEligible: input.supportiveEligible === true,
  };
}

function estimateContext(input: SimulatorResidentialInput, config: ReturnType<typeof buildPricingConfig>): EstimateContext {
  const oneWayMiles = Number.isFinite(input.oneWayMiles) && (input.oneWayMiles ?? 0) > 0 ? Number(input.oneWayMiles) : null;
  const durationMinutes = Number.isFinite(input.durationMinutes) && (input.durationMinutes ?? 0) > 0
    ? Number(input.durationMinutes)
    : null;
  return {
    travel: {
      ...(oneWayMiles
        ? {
            routed: {
              oneWayMiles,
              durationMinutes,
              gasPrice: null,
              gasPriceSource: 'configured_reference' as const,
              provider: 'simulator',
              method: 'straight_line_estimate' as const,
              verified: false,
            },
          }
        : {}),
      includedOneWayMiles: config.travel.includedOneWayMiles.value,
      mpg: config.travel.clientDefaults.mpg.value,
      wearPerMile: config.travel.perMileWearCost.value,
      referenceGasPrice: config.travel.fallbackGasPrice.value,
      zoneAdjustments: {
        core: config.travel.zoneAdjustments.core.value,
        surrounding: config.travel.zoneAdjustments.surrounding.value,
      },
      maxInstantDistanceMiles: config.travel.clientDefaults.maxInstantDistanceMiles.value,
      maxDrivingMinutes: config.drivingPolicy.maxDrivingMinutes.value,
      reviewBandMinutes: config.drivingPolicy.reviewBandMinutes.value,
    },
    pricingConfig: config,
    promotions: {
      claimedCampaignCode: input.promotionCode?.trim() || null,
    },
  };
}

function runResidential(snapshotActivated: PricingSnapshot, input: SimulatorResidentialInput, engine: SimulatorEngine): SimulatorPrice {
  const config = buildPricingConfig(snapshotActivated.owner, snapshotActivated.travel);
  const result = calculateEstimate(residentialDraft(input, engine), estimateContext(input, config));
  if (result.status === 'invalid') {
    return {
      status: 'invalid',
      total: null,
      range: null,
      laborHours: null,
      breakdown: null,
      cleaningSubtotal: null,
      travelAdjustment: null,
      extrasSubtotal: null,
      discountAmount: null,
      ongoingPerVisit: null,
      tier: null,
      discountLabel: null,
      message: result.message ?? 'The simulator input is incomplete.',
    };
  }
  if (result.status === 'custom_confirmation_required') {
    return {
      status: 'custom_confirmation_required',
      total: null,
      range: null,
      laborHours: result.laborHours ?? null,
      breakdown: result.pricing ?? null,
      cleaningSubtotal: null,
      travelAdjustment: null,
      extrasSubtotal: null,
      discountAmount: null,
      ongoingPerVisit: null,
      tier: null,
      discountLabel: null,
      message: result.message ?? 'This scenario requires personal confirmation.',
    };
  }
  return {
    status: 'priced',
    total: result.expectedPrice,
    range: result.low !== null && result.high !== null ? { low: result.low, high: result.high } : null,
    laborHours: result.laborHours,
    breakdown: result.pricing,
    cleaningSubtotal: result.expectedPrice,
    travelAdjustment: result.pricing.travelAdjustment,
    extrasSubtotal: result.pricing.extrasSubtotal,
    discountAmount: result.pricing.discount?.amount ?? null,
    ongoingPerVisit: result.ongoing?.perVisitPrice ?? null,
    tier: null,
    discountLabel: result.pricing.discount?.label ?? null,
    message: null,
  };
}

function runFacility(snapshotActivated: PricingSnapshot, input: SimulatorFacilityInput, engine: SimulatorEngine): SimulatorPrice {
  const config = buildPricingConfig(snapshotActivated.owner, snapshotActivated.travel);
  if (!commercialTierConfig.numericEstimatesEnabled) {
    return {
      status: 'pricing_disabled',
      total: null,
      range: null,
      laborHours: null,
      breakdown: null,
      cleaningSubtotal: null,
      travelAdjustment: null,
      extrasSubtotal: null,
      discountAmount: null,
      ongoingPerVisit: null,
      tier: null,
      discountLabel: null,
      message: 'Numeric facility estimates are disabled by the owner switch.',
    };
  }
  const facilityType: FacilityType = engine === 'church' ? 'church' : input.facilityType ?? 'office';
  const workload = calculateFacilityWorkload({
    cleanableSqft: input.cleanableSqft ?? 2500,
    restroomFixtures: input.restroomFixtures ?? 6,
    breakroom: input.breakroom === true,
    facilityType,
    condition: input.condition ?? 'average',
    traffic: input.traffic ?? 'average',
    flooring: input.flooring ?? 'mixed',
    firstClean: input.firstClean === true,
    specialty: input.specialty === true,
  }, config);
  const price = calculateFacilityPrice(workload, input.frequency ?? 'weekly', {
    oneWayMiles: input.oneWayMiles ?? null,
    church: engine === 'church',
    otherDiscountApplied: input.otherDiscountApplied === true,
    pricingConfig: config,
  });
  if (!price.priced) {
    return {
      status: 'custom_confirmation_required',
      total: null,
      range: null,
      laborHours: workload.laborHours,
      breakdown: null,
      cleaningSubtotal: null,
      travelAdjustment: null,
      extrasSubtotal: null,
      discountAmount: null,
      ongoingPerVisit: null,
      tier: workload.tier,
      discountLabel: price.discount?.applied ? price.discount.label : null,
      message: 'This facility scope requires personal review.',
    };
  }
  return {
    status: 'priced',
    total: price.total,
    range: price.range,
    laborHours: workload.laborHours,
    breakdown: null,
    cleaningSubtotal: price.cleaningSubtotal,
    travelAdjustment: price.travelAdjustment,
    extrasSubtotal: null,
    discountAmount: price.discount?.applied ? price.discount.amount : null,
    ongoingPerVisit: null,
    tier: workload.tier,
    discountLabel: price.discount?.applied ? price.discount.label : null,
    message: null,
  };
}

function run(snapshotActivated: PricingSnapshot, input: SimulatorInput): SimulatorPrice {
  return input.engine === 'commercial' || input.engine === 'church'
    ? runFacility(snapshotActivated, input.facility ?? {}, input.engine)
    : runResidential(snapshotActivated, input.residential ?? {}, input.engine);
}

/**
 * Compares the published snapshot with the draft snapshot and returns both
 * breakdowns. No active configuration is changed.
 */
export function simulatePricing(
  published: PricingSnapshot,
  draft: PricingSnapshot,
  input: SimulatorInput,
): SimulatorComparison {
  const publishedPrice = run(published, input);
  const draftPrice = run(draft, input);
  const differenceUsd =
    publishedPrice.total !== null && draftPrice.total !== null
      ? round2(draftPrice.total - publishedPrice.total)
      : null;
  const differencePercent =
    differenceUsd !== null && publishedPrice.total !== null && publishedPrice.total > 0
      ? round2((differenceUsd / publishedPrice.total) * 100)
      : null;
  const laborHoursDifference =
    publishedPrice.laborHours !== null && draftPrice.laborHours !== null
      ? round2(draftPrice.laborHours - publishedPrice.laborHours)
      : null;
  return {
    engine: input.engine,
    published: publishedPrice,
    draft: draftPrice,
    differenceUsd,
    differencePercent,
    laborHoursDifference,
  };
}


