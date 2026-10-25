// Commercial / church facility pricing — evidence-based preliminary estimates
// (Initiative 6.1, 2026-10-25).
//
// Workloading follows the ISSA method: cleaning time = area ÷ production rate
// × 60, plus FIXTURE-based restroom time (3 minutes per fixture), breakroom
// detail and setup. This replaces the earlier 30-minutes-per-1,000-sqft model,
// which understated real work and confused per-restroom with per-fixture.
//
// Pricing uses a $60/hour provisional commercial rate (published local market
// range $50–75/hr) on top of the same $35/hour owner-labour target used by the
// residential engine, the shared $125 minimum job and $5 floor rounding.
//
// Tier A (≤ 3 labour hours) → single preliminary price.
// Tier B (≤ 8 labour hours) → preliminary range.
// Tier C (larger / specialty / high uncertainty) → custom scope review.
//
// All figures are NONBINDING preliminary estimates; final scope and price are
// confirmed personally. The church discount is applied after the minimum-job
// rule to the cleaning subtotal only (see church-discount.ts).

import type { Condition } from '../../config/pricing.ts';
import { pricing } from '../../config/pricing.ts';
import { calculateChurchDiscount, type ChurchDiscountResult } from './church-discount.ts';

export type FacilityType = 'office' | 'retail' | 'salon' | 'gym' | 'community' | 'church';
export type FacilityTraffic = 'low' | 'average' | 'high';
export type FlooringType = 'carpet' | 'hard' | 'mixed';

export interface FacilityWorkloadInput {
  cleanableSqft: number | null;
  /** TOTAL restroom fixtures (toilets + urinals + sinks), not room count. */
  restroomFixtures: number | null;
  breakroom: boolean;
  facilityType?: FacilityType;
  condition?: Condition;
  traffic?: FacilityTraffic;
  flooring?: FlooringType;
  firstClean?: boolean;
  specialty?: boolean;
}

export interface FacilityWorkload {
  productionRate: number;
  areaHours: number;
  fixtureHours: number;
  breakroomHours: number;
  setupHours: number;
  conditionFactor: number;
  trafficFactor: number;
  firstCleanFactor: number;
  flooringFactor: number;
  laborHours: number;
  tier: 'A' | 'B' | 'C';
  scopeReviewRequired: boolean;
  exclusions: string[];
}

const FACILITY_TYPES = new Set<FacilityType>(['office', 'retail', 'salon', 'gym', 'community', 'church']);

function finiteOrZero(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function calculateFacilityWorkload(input: FacilityWorkloadInput): FacilityWorkload {
  const sqft = finiteOrZero(input.cleanableSqft);
  const fixtures = Math.min(40, finiteOrZero(input.restroomFixtures));
  const facilityType = FACILITY_TYPES.has(input.facilityType ?? 'office') ? (input.facilityType ?? 'office') : 'office';
  const condition = input.condition ?? 'average';
  const traffic = input.traffic ?? 'average';
  const flooring = input.flooring ?? 'mixed';

  const productionRates = pricing.commercialPricing.productionSqftPerHour as Record<string, { value: number }>;
  const productionRate = productionRates[facilityType]?.value ?? 4200;
  const areaHours = sqft > 0 ? sqft / productionRate : 0;
  const fixtureHours = (fixtures * pricing.commercialPricing.fixtureMinutes.value) / 60;
  const breakroomHours = input.breakroom ? pricing.commercialPricing.breakroomMinutes.value / 60 : 0;
  const setupHours = pricing.commercialPricing.setupMinutes.value / 60;

  const flooringFactor = flooring === 'carpet' ? 1.08 : flooring === 'mixed' ? 1.04 : 1;
  const conditionFactor = pricing.conditionFactors[condition].value;
  const trafficFactor = traffic === 'high' ? 1.15 : traffic === 'low' ? 0.95 : 1;
  const firstCleanFactor = input.firstClean ? pricing.commercialPricing.firstCleanFactor.value : 1;

  const laborHours =
    Math.round((areaHours + fixtureHours + breakroomHours + setupHours) * flooringFactor * conditionFactor * trafficFactor * firstCleanFactor * 100) / 100;

  const tier: 'A' | 'B' | 'C' =
    input.specialty || fixtures > 20 || laborHours > pricing.commercialPricing.tierBHours.value
      ? 'C'
      : laborHours > pricing.commercialPricing.tierAHours.value
        ? 'B'
        : 'A';

  return {
    productionRate,
    areaHours: Math.round(areaHours * 100) / 100,
    fixtureHours: Math.round(fixtureHours * 100) / 100,
    breakroomHours: Math.round(breakroomHours * 100) / 100,
    setupHours: Math.round(setupHours * 100) / 100,
    conditionFactor,
    trafficFactor,
    firstCleanFactor,
    flooringFactor,
    laborHours,
    tier,
    scopeReviewRequired: tier === 'C',
    exclusions: [
      'Specialty services (post-construction, floor stripping, biohazard, industrial kitchens) require a custom quote.',
      'Consumables and restocking are quoted separately unless agreed in writing.',
      'Travel is calculated from the confirmed destination; third-party costs and taxes are excluded.',
    ],
  };
}

export interface FacilityQuoteOptions {
  oneWayMiles?: number | null | undefined;
  church?: boolean | undefined;
  otherDiscountApplied?: boolean | undefined;
}

export interface FacilityPrice {
  /** Cleaning subtotal after the minimum-job rule, before any discount. */
  cleaningSubtotal: number;
  /** Per-visit cleaning price. */
  perVisit: number;
  /** Tier B low/high band; null for Tier A. */
  range: { low: number; high: number } | null;
  /** Travel adjustment included in totals when a route is known. */
  travelAdjustment: number;
  travelIncluded: boolean;
  /** Per-visit total including travel. */
  total: number;
  monthly: number | null;
  visitsPerMonth: number | null;
  discount: ChurchDiscountResult | null;
  tier: 'A' | 'B' | 'C';
  /** True when a numeric estimate can be shown (Tiers A/B). */
  priced: boolean;
}

const VISITS_PER_MONTH: Record<string, number> = {
  daily: 21.7,
  weekly: 4.33,
  biweekly: 2.17,
  monthly: 1,
};

/** Travel uses the SAME shared economics as the residential engine. */
export function facilityTravelAdjustment(oneWayMiles: number | null | undefined): number {
  if (!oneWayMiles || !Number.isFinite(oneWayMiles) || oneWayMiles <= 0) return 0;
  const included = pricing.travel.includedOneWayMiles.value;
  const extraMiles = Math.max(0, oneWayMiles - included) * 2;
  if (extraMiles <= 0) return 0;
  const perMileFuel = pricing.travel.fallbackGasPrice.value / pricing.travel.clientDefaults.mpg.value;
  const cost = extraMiles * (pricing.travel.perMileWearCost.value + perMileFuel);
  return Math.round(cost * 100) / 100;
}

function roundUpToStep(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const step = pricing.rounding.toNearest.value;
  return Math.ceil((value - 0.01) / step) * step;
}

export function calculateFacilityPrice(
  workload: FacilityWorkload,
  frequency: string,
  options: FacilityQuoteOptions = {},
): FacilityPrice {
  const rate = pricing.commercialPricing.grossRatePerHour.value;
  const rawCleaning = workload.laborHours * rate;
  const cleaningSubtotal = Math.max(pricing.minimumJob.value, roundUpToStep(rawCleaning));
  const church = options.church === true;
  const discount = church
    ? calculateChurchDiscount(cleaningSubtotal, { otherDiscountApplied: options.otherDiscountApplied === true })
    : null;
  const perVisitCore = discount?.applied ? roundUpToStep(discount.discountedSubtotal) : cleaningSubtotal;
  const travelAdjustment = roundUpToStep(facilityTravelAdjustment(options.oneWayMiles ?? null));
  const total = perVisitCore + travelAdjustment;

  const spread = pricing.commercialPricing.rangeSpreadPercent.value / 100;
  const range =
    workload.tier === 'B'
      ? {
          low: roundUpToStep(Math.max(pricing.minimumJob.value, perVisitCore * (1 - spread))),
          high: roundUpToStep(perVisitCore * (1 + spread)),
        }
      : null;

  const visitsPerMonth = VISITS_PER_MONTH[frequency] ?? null;
  return {
    cleaningSubtotal,
    perVisit: perVisitCore,
    range,
    travelAdjustment,
    travelIncluded: travelAdjustment > 0,
    total,
    monthly: visitsPerMonth ? roundUpToStep(total * visitsPerMonth) : null,
    visitsPerMonth,
    discount,
    tier: workload.tier,
    priced: workload.tier !== 'C',
  };
}

export interface ChurchEstimateInput extends FacilityWorkloadInput {
  frequency?: string;
  oneWayMiles?: number | null;
  otherDiscountApplied?: boolean;
}

export interface ChurchEstimateSummary {
  workload: FacilityWorkload;
  price: FacilityPrice;
}

/** Church estimate = facility workload + owner-directed 10% discount. */
export function calculateChurchEstimate(input: ChurchEstimateInput): ChurchEstimateSummary {
  const workload = calculateFacilityWorkload({ ...input, facilityType: 'church' });
  return {
    workload,
    price: calculateFacilityPrice(workload, input.frequency ?? 'weekly', {
      church: true,
      oneWayMiles: input.oneWayMiles,
      otherDiscountApplied: input.otherDiscountApplied,
    }),
  };
}
