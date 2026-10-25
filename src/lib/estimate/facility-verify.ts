// Server-side facility quote verification (Initiative 6.1).
//
// The browser sends structured scope facts plus its preliminary price. The
// server independently rebuilds the workload and cleaning price from those
// facts using the SAME shared module, so a tampered browser price can never be
// presented as checked. Travel remains a separate, explicitly preliminary
// component (a live route is not re-requested inside the lead relay).

import { pricing } from '../../config/pricing.ts';
import {
  calculateFacilityPrice,
  calculateFacilityWorkload,
  type FacilityType,
  type FacilityWorkloadInput,
  type FlooringType,
} from './commercial.ts';

export interface FacilityVerification {
  status: 'verified' | 'preliminary' | 'mismatch' | 'unverifiable';
  expectedCleaning: number | null;
  expectedRange: { low: number; high: number } | null;
  laborHours: number | null;
  discountAmount: number | null;
  configMatch: 'match' | 'mismatch' | 'unknown';
  travelStatus: 'verified' | 'preliminary' | 'manual_review';
}

const TOLERANCE = 10;

function num(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replaceAll(',', '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

const FACILITY_TYPES = new Set<FacilityType>(['office', 'retail', 'salon', 'gym', 'community', 'church']);

export function verifyFacilityQuote(fields: Record<string, string>): FacilityVerification {
  const sqft = num(fields.cleanable_sqft);
  const clientCleaning = num(fields.cleaning_subtotal);
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
      expectedRange: null,
      laborHours: null,
      discountAmount: null,
      configMatch,
      travelStatus: 'manual_review',
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
    oneWayMiles: num(fields.travel_one_way_miles),
    church: input.facilityType === 'church' || fields.service_type === 'church_cleaning',
  });

  if (!price.priced) {
    return {
      status: 'preliminary',
      expectedCleaning: null,
      expectedRange: null,
      laborHours: workload.laborHours,
      discountAmount: price.discount?.amount ?? null,
      configMatch,
      travelStatus: fields.travel_verified === 'true' ? 'verified' : 'preliminary',
    };
  }

  const travelStatus =
    fields.travel_verified === 'true' ? 'verified' : fields.travel_verified === 'false' && fields.travel_qualification === 'manual_review' ? 'manual_review' : 'preliminary';

  if (clientCleaning === null) {
    return {
      status: 'unverifiable',
      expectedCleaning: price.perVisit,
      expectedRange: price.range,
      laborHours: workload.laborHours,
      discountAmount: price.discount?.amount ?? null,
      configMatch,
      travelStatus,
    };
  }

  const matches = Math.abs(clientCleaning - price.perVisit) <= TOLERANCE;
  return {
    status: configMatch === 'mismatch' || !matches ? 'mismatch' : travelStatus === 'verified' ? 'verified' : 'preliminary',
    expectedCleaning: price.perVisit,
    expectedRange: price.range,
    laborHours: workload.laborHours,
    discountAmount: price.discount?.amount ?? null,
    configMatch,
    travelStatus,
  };
}
