// Input validation + normalization for the estimator.
// The estimator must fail safely: malformed input never produces a number.

import { normalizeZip } from '../../config/geography.ts';
import { pricing } from '../../config/pricing.ts';
import type {
  Condition,
  EstimateInputDraft,
  Frequency,
  LastProfessionalClean,
  NormalizedEstimateInput,
  PetSituation,
  PropertyType,
  ServiceType,
} from './types.ts';

export interface ValidationOk {
  ok: true;
  input: NormalizedEstimateInput;
}

export interface ValidationFailed {
  ok: false;
  issues: string[];
}

export type ValidationResult = ValidationOk | ValidationFailed;

const SERVICE_TYPES = new Set(['standard', 'deep', 'move_in_out', 'str_turnover']);
const FREQUENCIES = new Set(['weekly', 'biweekly', 'monthly', 'one_time']);
const CONDITIONS = new Set(['maintained', 'average', 'needs_attention', 'heavy', 'severe']);
const LAST_CLEAN = new Set([
  'within_month',
  'one_to_three_months',
  'three_to_twelve_months',
  'over_a_year',
  'never_professional',
  'not_sure',
]);
const PROPERTY_TYPES = new Set(['house', 'apartment', 'condo', 'townhome', 'other']);
const PET_SITUATIONS = new Set(['none', 'one', 'multiple_shedding']);

/** Clamps a numeric value into a safe range; non-finite values become null. */
export function clampNumber(value: unknown, min: number, max: number): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.min(max, Math.max(min, numeric));
}

function asEnum<T extends string>(value: unknown, allowed: Set<string>): T | null {
  return typeof value === 'string' && allowed.has(value) ? (value as T) : null;
}

export function validateEstimateInput(
  raw: EstimateInputDraft | null | undefined,
): ValidationResult {
  const issues: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, issues: ['No estimate input was provided.'] };
  }

  const serviceType = asEnum<ServiceType>(raw.serviceType, SERVICE_TYPES);
  if (!serviceType) issues.push('Choose a cleaning type.');

  const frequency: Frequency = asEnum<Frequency>(raw.frequency, FREQUENCIES) ?? 'one_time';

  const condition = asEnum<Condition>(raw.condition, CONDITIONS);
  if (!condition) issues.push('Choose the home’s current condition.');

  const lastClean =
    raw.lastClean === undefined ? undefined : asEnum<LastProfessionalClean>(raw.lastClean, LAST_CLEAN);
  if (raw.lastClean !== undefined && !lastClean) issues.push('Unrecognized last-cleaning answer.');

  const propertyType =
    raw.propertyType === undefined ? undefined : asEnum<PropertyType>(raw.propertyType, PROPERTY_TYPES);
  const pets = raw.pets === undefined ? undefined : asEnum<PetSituation>(raw.pets, PET_SITUATIONS);

  const normalizedZip = normalizeZip(raw.zip ?? null);
  if (!normalizedZip) issues.push('Enter a 5-digit service ZIP code.');

  const squareFeet = clampNumber(raw.squareFeet, 200, 20000);
  if (squareFeet === null) issues.push('Enter the approximate square footage.');

  const bedrooms = clampNumber(raw.bedrooms, 0, 12) ?? 0;
  const fullBaths = clampNumber(raw.fullBaths, 0, 12) ?? 0;
  const halfBaths = clampNumber(raw.halfBaths, 0, 12) ?? 0;
  const beds = raw.beds === undefined ? undefined : (clampNumber(raw.beds, 0, 25) ?? undefined);

  if (serviceType === 'str_turnover' && (beds === undefined || beds <= 0)) {
    issues.push('Tell us how many beds the rental has.');
  }

  const knownAddonIds = new Set(pricing.addons.items.map((item) => item.id));
  const addonIds = Array.isArray(raw.addonIds)
    ? raw.addonIds.filter((id): id is string => typeof id === 'string' && knownAddonIds.has(id))
    : [];

  if (issues.length > 0 || !serviceType || !condition || !normalizedZip || squareFeet === null) {
    return { ok: false, issues: issues.length > 0 ? issues : ['The estimate input is incomplete.'] };
  }

  return {
    ok: true,
    input: {
      serviceType,
      squareFeet,
      bedrooms,
      fullBaths,
      halfBaths,
      frequency,
      condition,
      addonIds,
      zip: normalizedZip,
      normalizedZip,
      ...(propertyType ? { propertyType } : {}),
      ...(lastClean ? { lastClean } : {}),
      ...(beds !== undefined ? { beds } : {}),
      ...(pets ? { pets } : {}),
    },
  };
}
