// Server-side facility quote verification (Initiative 6.1).
//
// The browser sends structured scope facts plus its preliminary price. The
// server independently rebuilds the workload and cleaning price from those
// facts using the SAME shared module, so a tampered browser price can never be
// presented as checked. Travel remains a separate, explicitly preliminary
// component (a live route is not re-requested inside the lead relay).
//
// The owner kill switch (`commercialTierConfig.numericEstimatesEnabled`) is
// enforced here independently of browser state. When it is off, the server
// returns no prices, no labour hours and no discount amount, and the relay
// strips any client-supplied facility price fields before the owner notification.

import { pricing } from '../../config/pricing.ts';
import { commercialTierConfig } from '../../config/estimators/commercial.ts';
import {
  calculateFacilityPrice,
  calculateFacilityWorkload,
  type FacilityType,
  type FacilityWorkloadInput,
  type FlooringType,
} from './commercial.ts';

export interface FacilityVerification {
  status: 'verified' | 'preliminary' | 'mismatch' | 'unverifiable' | 'pricing_disabled';
  expectedCleaning: number | null;
  /** Per-visit total including the server-known travel adjustment. */
  expectedTotal: number | null;
  expectedRange: { low: number; high: number } | null;
  laborHours: number | null;
  discountAmount: number | null;
  /** Human label when a church discount applies. */
  discountLabel: string | null;
  /** Engine calibration factor applied to the service subtotal (null when disabled/unpriced). */
  globalFactor: number | null;
  /** Dollar effect of the calibration factor. */
  globalAdjustment: number | null;
  configMatch: 'match' | 'mismatch' | 'unknown';
  travelStatus: 'verified' | 'preliminary' | 'manual_review';
  /** False when the owner has disabled numeric facility pricing. */
  pricingEnabled: boolean;
}

export interface FacilityVerifyOptions {
  /** Owner kill switch override for tests; defaults to the shared config. */
  numericEstimatesEnabled?: boolean | undefined;
  /** Server-routed one-way miles override for payment verification. */
  routedOneWayMiles?: number | null | undefined;
  /** True only when the payment endpoint independently obtained a live route. */
  routedTravelVerified?: boolean | undefined;
}

/** Client-supplied facility fields that must never survive a disabled switch. */
export const FACILITY_PRICING_FIELDS = [
  'cleaning_subtotal',
  'quoted_price',
  'quoted_range',
  'monthly_price',
  'church_discount_amount',
  'church_savings',
  'commercial_rate',
  'travel_adjustment',
  'labor_hours',
  'quote_config_version',
  'facility_tier',
  'estimate_low',
  'estimate_high',
  'estimate_confidence',
] as const;

/**
 * Removes every client-supplied numeric facility field and marks the request
 * as a scope review. Called by the relay when the owner switch is off.
 */
export function stripFacilityPricingFields(fields: Record<string, string>): void {
  for (const key of FACILITY_PRICING_FIELDS) delete fields[key];
  fields.estimate_status = 'custom_confirmation_required';
}

const TOLERANCE = 10;

function num(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replaceAll(',', '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

const FACILITY_TYPES = new Set<FacilityType>(['office', 'retail', 'salon', 'gym', 'community', 'church']);

export function verifyFacilityQuote(
  fields: Record<string, string>,
  options: FacilityVerifyOptions = {},
): FacilityVerification {
  const numericEnabled =
    options.numericEstimatesEnabled ?? commercialTierConfig.numericEstimatesEnabled;
  if (!numericEnabled) {
    return {
      status: 'pricing_disabled',
      expectedCleaning: null,
      expectedTotal: null,
      expectedRange: null,
      laborHours: null,
      discountAmount: null,
      discountLabel: null,
      globalFactor: null,
      globalAdjustment: null,
      configMatch: 'unknown',
      travelStatus: 'preliminary',
      pricingEnabled: false,
    };
  }

  const sqft = num(fields.cleanable_sqft);
  const clientCleaning = num(fields.cleaning_subtotal);
  const clientFinal = num(fields.quoted_price);
  const clientVersion = fields.quote_config_version ?? '';
  const configMatch =
    clientVersion === ''
      ? 'unknown'
      : clientVersion === pricing.commercialPricing.configVersion.value
        ? 'match'
        : 'mismatch';

  if (!sqft || sqft <= 0) {
    return {
      status: 'unverifiable',
      expectedCleaning: null,
      expectedTotal: null,
      expectedRange: null,
      laborHours: null,
      discountAmount: null,
      discountLabel: null,
      globalFactor: null,
      globalAdjustment: null,
      configMatch,
      travelStatus: 'manual_review',
      pricingEnabled: true,
    };
  }

  const rawType = (fields.facility_type ?? 'office') as FacilityType;
  const input: FacilityWorkloadInput = {
    cleanableSqft: sqft,
    restroomFixtures: num(fields.restroom_fixtures),
    breakroom: fields.breakroom === 'breakroom' || fields.breakroom === 'kitchen',
    facilityType: FACILITY_TYPES.has(rawType) ? rawType : 'office',
    condition: (fields.condition ?? 'average') as NonNullable<FacilityWorkloadInput['condition']>,
    traffic: (fields.traffic ?? 'average') as NonNullable<FacilityWorkloadInput['traffic']>,
    flooring: (fields.flooring ?? 'mixed') as FlooringType,
    firstClean: fields.first_clean === 'yes',
    specialty: (fields.specialty_services ?? '') !== '',
  };
  const workload = calculateFacilityWorkload(input);
  const price = calculateFacilityPrice(workload, fields.frequency ?? 'weekly', {
    oneWayMiles:
      options.routedOneWayMiles !== undefined
        ? options.routedOneWayMiles
        : num(fields.travel_one_way_miles),
    church: input.facilityType === 'church' || fields.service_type === 'church_cleaning',
  });

  if (!price.priced) {
    return {
      status: 'preliminary',
      expectedCleaning: null,
      expectedTotal: null,
      expectedRange: null,
      laborHours: workload.laborHours,
      discountAmount: price.discount?.applied ? price.discount.amount : null,
      discountLabel: price.discount?.applied ? `Church discount (${pricing.churchDiscount.percent.value}%)` : null,
      globalFactor: price.globalFactor,
      globalAdjustment: price.globalAdjustment,
      configMatch,
      travelStatus: fields.travel_verified === 'true' ? 'verified' : 'preliminary',
      pricingEnabled: true,
    };
  }

  const travelStatus =
    options.routedTravelVerified !== undefined
      ? options.routedTravelVerified
        ? 'verified'
        : 'preliminary'
      : fields.travel_verified === 'true'
        ? 'verified'
        : fields.travel_verified === 'false' && fields.travel_qualification === 'manual_review'
          ? 'manual_review'
          : 'preliminary';

  if (clientCleaning === null || clientFinal === null) {
    return {
      status: 'unverifiable',
      expectedCleaning: price.perVisit,
      expectedTotal: price.total,
      expectedRange: price.range,
      laborHours: workload.laborHours,
      discountAmount: price.discount?.applied ? price.discount.amount : null,
      discountLabel: price.discount?.applied ? `Church discount (${pricing.churchDiscount.percent.value}%)` : null,
      globalFactor: price.globalFactor,
      globalAdjustment: price.globalAdjustment,
      configMatch,
      travelStatus,
      pricingEnabled: true,
    };
  }

  // Verify BOTH the submitted cleaning subtotal and the final per-visit price
  // against the server rebuild. A client cannot tamper one while leaving the
  // other intact and still receive a matching verdict.
  const cleaningMatches = Math.abs(clientCleaning - price.cleaningSubtotal) <= TOLERANCE;
  const finalMatches = Math.abs(clientFinal - price.total) <= TOLERANCE;
  return {
    status: configMatch === 'mismatch' || !cleaningMatches || !finalMatches ? 'mismatch' : travelStatus === 'verified' ? 'verified' : 'preliminary',
    expectedCleaning: price.perVisit,
    expectedTotal: price.total,
    expectedRange: price.range,
    laborHours: workload.laborHours,
    discountAmount: price.discount?.applied ? price.discount.amount : null,
    discountLabel: price.discount?.applied ? `Church discount (${pricing.churchDiscount.percent.value}%)` : null,
    globalFactor: price.globalFactor,
    globalAdjustment: price.globalAdjustment,
    configMatch,
    travelStatus,
    pricingEnabled: true,
  };
}
