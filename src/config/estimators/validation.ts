// Central validation for the owner-editable estimator configuration.
//
// This is deliberately independent of the calculator: it validates values,
// dependencies and safety invariants before a build or deploy. It does not
// rewrite an owner's chosen value. Hard errors stop deployment; warnings are
// business advice and are printed for the owner. Runtime calibration handling
// still fails closed to 1.00 if a bad value reaches a calculator.

import { ownerPricing, type OwnerPricingConfig } from './pricing-values.ts';
import { travelConfig, type TravelConfig } from './travel.ts';
import { commercialTierConfig, type CommercialTierConfig } from './commercial.ts';
import { pricing, pricingValue } from '../pricing.ts';
import {
  COMMERCIAL_FACILITY_TYPES,
  FACILITY_INPUT_LIMITS,
  RESIDENTIAL_INPUT_LIMITS,
  RESIDENTIAL_SERVICE_OPTIONS,
} from './input-definitions.ts';

export type ConfigIssueSeverity = 'error' | 'warning';

export interface ConfigIssue {
  severity: ConfigIssueSeverity;
  path: string;
  message: string;
  value?: unknown;
}

export interface EstimatorConfigurationResult {
  valid: boolean;
  errors: ConfigIssue[];
  warnings: ConfigIssue[];
}

export interface EstimatorConfigurationInput {
  ownerPricing?: OwnerPricingConfig;
  travel?: TravelConfig;
  commercial?: CommercialTierConfig;
}

const SERVICES = new Set(['standard', 'deep', 'move_in_out', 'str_turnover']);
const FREQUENCIES = new Set(['weekly', 'biweekly', 'monthly', 'one_time']);
const ADDON_CATEGORIES = new Set([
  'kitchen',
  'bath_laundry',
  'windows',
  'interior_detail',
  'pets',
  'organization',
  'specialty',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const bound = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(2));
const received = (value: unknown): string => {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
};
const labelFor = (path: string): string => {
  const last = path.split('.').pop() ?? path;
  return last
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .replace(/^./, (character) => character.toUpperCase());
};

function issue(
  severity: ConfigIssueSeverity,
  path: string,
  message: string,
  value?: unknown,
): ConfigIssue {
  return { severity, path, message, ...(value === undefined ? {} : { value }) };
}

function asRecord(value: unknown, path: string, errors: ConfigIssue[]): Record<string, unknown> {
  if (isRecord(value)) return value;
  errors.push(issue('error', path, `${labelFor(path)} must be an object.`));
  return {};
}

function numberValue(
  value: unknown,
  path: string,
  errors: ConfigIssue[],
  options: {
    min?: number;
    max?: number;
    integer?: boolean;
    positive?: boolean;
    nonnegative?: boolean;
    label?: string;
  } = {},
): number | null {
  const displayLabel = options.label ?? labelFor(path);
  if (!isFiniteNumber(value)) {
    errors.push(issue('error', path, `${displayLabel} must be a finite number.`, value));
    return null;
  }
  if (options.positive && value <= 0) {
    errors.push(issue('error', path, `${displayLabel} must be greater than zero. Received ${received(value)}.`));
    return null;
  }
  if (options.nonnegative && value < 0) {
    errors.push(issue('error', path, `${displayLabel} cannot be negative. Received ${received(value)}.`));
    return null;
  }
  if (options.min !== undefined && options.max !== undefined && (value < options.min || value > options.max)) {
    errors.push(
      issue('error', path, `${displayLabel} must be between ${bound(options.min)} and ${bound(options.max)}. Received ${received(value)}.`),
    );
    return null;
  }
  if (options.min !== undefined && value < options.min) {
    errors.push(
      issue('error', path, `${displayLabel} must be at least ${bound(options.min)}. Received ${received(value)}.`),
    );
    return null;
  }
  if (options.max !== undefined && value > options.max) {
    errors.push(
      issue('error', path, `${displayLabel} must not exceed ${bound(options.max)}. Received ${received(value)}.`),
    );
    return null;
  }
  if (options.integer && !Number.isInteger(value)) {
    errors.push(issue('error', path, `${displayLabel} must be a whole number. Received ${received(value)}.`));
    return null;
  }
  return value;
}

function booleanValue(value: unknown, path: string, errors: ConfigIssue[]): boolean | null {
  if (typeof value !== 'boolean') {
    errors.push(issue('error', path, `${labelFor(path)} must be true or false.`, value));
    return null;
  }
  return value;
}

function stringValue(value: unknown, path: string, errors: ConfigIssue[], allowEmpty = false): string | null {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    errors.push(issue('error', path, `${labelFor(path)} must be a non-empty string.`, value));
    return null;
  }
  return value;
}

function arrayValue(value: unknown, path: string, errors: ConfigIssue[]): unknown[] {
  if (!Array.isArray(value)) {
    errors.push(issue('error', path, `${labelFor(path)} must be an array.`));
    return [];
  }
  return value;
}

function serviceList(value: unknown, path: string, errors: ConfigIssue[]): void {
  const list = arrayValue(value, path, errors);
  for (const [index, service] of list.entries()) {
    if (!SERVICES.has(String(service))) {
      errors.push(issue('error', `${path}[${index}]`, `Unknown service type ${received(service)}.`));
    }
  }
}

function frequencyList(value: unknown, path: string, errors: ConfigIssue[]): void {
  const list = arrayValue(value, path, errors);
  for (const [index, frequency] of list.entries()) {
    if (!FREQUENCIES.has(String(frequency))) {
      errors.push(issue('error', `${path}[${index}]`, `Unknown frequency ${received(frequency)}.`));
    }
  }
}

function dateValue(value: unknown, path: string, errors: ConfigIssue[]): void {
  if (value === null) return;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    errors.push(issue('error', path, `${labelFor(path)} must be a valid YYYY-MM-DD date or null.`, value));
  }
}

function discountValue(
  value: unknown,
  kind: unknown,
  path: string,
  errors: ConfigIssue[],
  warnings: ConfigIssue[],
): void {
  if (!isFiniteNumber(value)) {
    errors.push(issue('error', path, `${labelFor(path)} must be a finite number when enabled.`, value));
    return;
  }
  if (kind === 'percent') {
    numberValue(value, path, errors, { min: 0.000001, max: 0.5 });
    if (value > 0.25) {
      warnings.push(issue('warning', path, `${labelFor(path)} is above 25%; confirm the owner-approved terms.`, value));
    }
  } else if (kind === 'fixed') {
    numberValue(value, path, errors, { positive: true });
  } else {
    errors.push(issue('error', path, `${labelFor(path)} kind must be "percent" or "fixed".`, kind));
  }
}

function validatePromotionArray(
  value: unknown,
  path: string,
  errors: ConfigIssue[],
  warnings: ConfigIssue[],
): void {
  const list = arrayValue(value, path, errors);
  const ids = new Set<string>();
  for (const [index, entry] of list.entries()) {
    const program = asRecord(entry, `${path}[${index}]`, errors);
    const id = stringValue(program.id, `${path}[${index}].id`, errors);
    if (id && ids.has(id)) errors.push(issue('error', `${path}[${index}].id`, `Duplicate promotion id ${id}.`));
    if (id) ids.add(id);
    booleanValue(program.enabled, `${path}[${index}].enabled`, errors);
    const kind = program.kind;
    if (program.enabled === true) {
      if (program.value === null || program.value === undefined) {
        errors.push(issue('error', `${path}[${index}].value`, 'An enabled promotion must have a value.'));
      } else {
        discountValue(program.value, kind, `${path}[${index}].value`, errors, warnings);
      }
      if (!(typeof program.maxDiscountUsd === 'number' && Number.isFinite(program.maxDiscountUsd) && program.maxDiscountUsd > 0)) {
        warnings.push(issue('warning', `${path}[${index}].maxDiscountUsd`, 'An enabled promotion should have a positive safety cap.'));
      }
      serviceList(program.eligibility && (program.eligibility as Record<string, unknown>).services, `${path}[${index}].eligibility.services`, errors);
      frequencyList(program.eligibility && (program.eligibility as Record<string, unknown>).frequencies, `${path}[${index}].eligibility.frequencies`, errors);
    }
    dateValue(program.expiresOn, `${path}[${index}].expiresOn`, errors);
    if (program.stackable === true) {
      errors.push(issue('error', `${path}[${index}].stackable`, 'Promotions must remain non-stackable.'));
    }
  }
}

function validateAddonBundles(
  value: unknown,
  path: string,
  errors: ConfigIssue[],
  warnings: ConfigIssue[],
  addonIds: Set<string>,
): void {
  const list = arrayValue(value, path, errors);
  const ids = new Set<string>();
  for (const [index, entry] of list.entries()) {
    const bundle = asRecord(entry, `${path}[${index}]`, errors);
    const id = stringValue(bundle.id, `${path}[${index}].id`, errors);
    if (id && ids.has(id)) errors.push(issue('error', `${path}[${index}].id`, `Duplicate bundle id ${id}.`));
    if (id) ids.add(id);
    stringValue(bundle.label, `${path}[${index}].label`, errors);
    const enabled = booleanValue(bundle.enabled, `${path}[${index}].enabled`, errors);
    booleanValue(bundle.requiresRecurring, `${path}[${index}].requiresRecurring`, errors);
    frequencyList(bundle.eligibleFrequencies, `${path}[${index}].eligibleFrequencies`, errors);
    const required = arrayValue(bundle.requiredAddonIds, `${path}[${index}].requiredAddonIds`, errors);
    if (required.length === 0) {
      errors.push(issue('error', `${path}[${index}].requiredAddonIds`, 'A bundle must require at least one add-on.'));
    }
    for (const [addonIndex, addonId] of required.entries()) {
      if (typeof addonId !== 'string' || !addonIds.has(addonId)) {
        errors.push(issue('error', `${path}[${index}].requiredAddonIds[${addonIndex}]`, `Unknown add-on id ${received(addonId)}.`));
      }
    }
    if (enabled === true) {
      if (bundle.value === null || bundle.value === undefined) {
        errors.push(issue('error', `${path}[${index}].value`, 'An enabled bundle must have a value.'));
      } else {
        discountValue(bundle.value, bundle.kind, `${path}[${index}].value`, errors, warnings);
      }
      if (!(typeof bundle.maxDiscountUsd === 'number' && Number.isFinite(bundle.maxDiscountUsd) && bundle.maxDiscountUsd > 0)) {
        errors.push(issue('error', `${path}[${index}].maxDiscountUsd`, 'An enabled bundle needs a positive safety cap.'));
      }
    }
    dateValue(bundle.expiresOn, `${path}[${index}].expiresOn`, errors);
    if (bundle.stackable === true) {
      errors.push(issue('error', `${path}[${index}].stackable`, 'Bundles must remain non-stackable.'));
    }
  }
}
export function validateEstimatorConfiguration(
  input: EstimatorConfigurationInput = {},
): EstimatorConfigurationResult {
  const errors: ConfigIssue[] = [];
  const warnings: ConfigIssue[] = [];
  const owner = asRecord(input.ownerPricing ?? ownerPricing, 'ownerPricing', errors);

  const rates = asRecord(owner.hourlyRates, 'hourlyRates', errors);
  const recurringRate = numberValue(rates.recurring, 'hourlyRates.recurring', errors, { positive: true });
  const otherRate = numberValue(rates.otherServices, 'hourlyRates.otherServices', errors, { positive: true });
  const ownerTarget = numberValue(rates.ownerLaborTarget, 'hourlyRates.ownerLaborTarget', errors, {
    positive: true,
  });
  if (ownerTarget !== null && recurringRate !== null && ownerTarget >= recurringRate) {
    errors.push(
      issue(
        'error',
        'hourlyRates.ownerLaborTarget',
        `Owner labour target must stay below the recurring rate. Received ${ownerTarget} and ${recurringRate}.`,
        ownerTarget,
      ),
    );
  }
  if (ownerTarget !== null && otherRate !== null && ownerTarget >= otherRate) {
    errors.push(
      issue(
        'error',
        'hourlyRates.ownerLaborTarget',
        `Owner labour target must stay below the other-services rate. Received ${ownerTarget} and ${otherRate}.`,
        ownerTarget,
      ),
    );
  }
  if (recurringRate !== null && otherRate !== null && recurringRate > otherRate) {
    warnings.push(
      issue(
        'warning',
        'hourlyRates.recurring',
        `Recurring rate ${recurringRate} exceeds the other-services rate ${otherRate}; confirm this is intentional.`,
      ),
    );
  }
  if (ownerTarget !== null && recurringRate !== null && ownerTarget > recurringRate * 0.9) {
    warnings.push(
      issue(
        'warning',
        'hourlyRates.ownerLaborTarget',
        'Owner labour target leaves less than 10% headroom above the owner floor before overhead and profit.',
      ),
    );
  }

  const minimum = numberValue(owner.minimumJob, 'minimumJob', errors, { positive: true });
  const calibration = asRecord(owner.estimatorCalibration, 'estimatorCalibration', errors);
  for (const engine of ['residential', 'str', 'commercial', 'church'] as const) {
    const label = `${engine[0]?.toUpperCase()}${engine.slice(1)}`;
    const factor = numberValue(calibration[engine], `estimatorCalibration.${engine}`, errors, {
      min: 0.5,
      max: 1.5,
      label: `${label} calibration factor`,
    });
    if (factor !== null && (factor < 0.85 || factor > 1.15)) {
      warnings.push(
        issue(
          'warning',
          `estimatorCalibration.${engine}`,
          `${label} calibration factor is outside the typical 0.85–1.15 range. Received ${factor}.`,
          factor,
        ),
      );
    }
  }

  const community = asRecord(owner.supportiveHomeDiscount, 'supportiveHomeDiscount', errors);
  booleanValue(community.enabled, 'supportiveHomeDiscount.enabled', errors);
  const communityPercent = numberValue(community.percent, 'supportiveHomeDiscount.percent', errors, {
    min: 0,
    max: 100,
  });
  if (community.enabled === true && communityPercent === 0) {
    errors.push(issue('error', 'supportiveHomeDiscount.percent', 'An enabled discount cannot be 0%.'));
  }
  if (communityPercent !== null && communityPercent > 25) {
    warnings.push(issue('warning', 'supportiveHomeDiscount.percent', 'Community Support discount is above 25%; confirm the owner-approved terms.'));
  }
  stringValue(community.termsVersion, 'supportiveHomeDiscount.termsVersion', errors);
  serviceList(community.eligibleServices, 'supportiveHomeDiscount.eligibleServices', errors);
  for (const [index, service] of arrayValue(community.eligibleServices, 'supportiveHomeDiscount.eligibleServices', errors).entries()) {
    if (!SERVICES.has(String(service)) || service === 'str_turnover') {
      errors.push(issue('error', `supportiveHomeDiscount.eligibleServices[${index}]`, 'Community Support may apply only to eligible residential services, never STR.'));
    }
  }

  const church = asRecord(owner.churchDiscount, 'churchDiscount', errors);
  booleanValue(church.enabled, 'churchDiscount.enabled', errors);
  const churchPercent = numberValue(church.percent, 'churchDiscount.percent', errors, { min: 0, max: 100 });
  if (church.enabled === true && churchPercent === 0) {
    errors.push(issue('error', 'churchDiscount.percent', 'An enabled discount cannot be 0%.'));
  }
  if (churchPercent !== null && churchPercent > 25) {
    warnings.push(issue('warning', 'churchDiscount.percent', 'Church discount is above 25%; confirm the owner-approved terms.'));
  }

  const commercial = asRecord(owner.commercialPricing, 'commercialPricing', errors);
  numberValue(commercial.grossRatePerHour, 'commercialPricing.grossRatePerHour', errors, { positive: true });
  const production = asRecord(commercial.productionSqftPerHour, 'commercialPricing.productionSqftPerHour', errors);
  for (const type of ['office', 'retail', 'salon', 'gym', 'community', 'church'] as const) {
    numberValue(production[type], `commercialPricing.productionSqftPerHour.${type}`, errors, { positive: true });
  }
  numberValue(commercial.fixtureMinutes, 'commercialPricing.fixtureMinutes', errors, { nonnegative: true });
  numberValue(commercial.breakroomMinutes, 'commercialPricing.breakroomMinutes', errors, { nonnegative: true });
  numberValue(commercial.setupMinutes, 'commercialPricing.setupMinutes', errors, { positive: true });
  numberValue(commercial.firstCleanFactor, 'commercialPricing.firstCleanFactor', errors, { min: 1, max: 5 });
  numberValue(commercial.rangeSpreadPercent, 'commercialPricing.rangeSpreadPercent', errors, { min: 0, max: 50 });
  const tierA = numberValue(commercial.tierAHours, 'commercialPricing.tierAHours', errors, { positive: true });
  const tierB = numberValue(commercial.tierBHours, 'commercialPricing.tierBHours', errors, { positive: true });
  if (tierA !== null && tierB !== null && tierB <= tierA) {
    errors.push(
      issue(
        'error',
        'commercialPricing.tierBHours',
        `Tier B workload threshold must be greater than Tier A. Received ${tierB} and ${tierA}.`,
      ),
    );
  }
  numberValue(commercial.overheadRatePercent, 'commercialPricing.overheadRatePercent', errors, { min: 0, max: 100 });

  const baseHours = asRecord(owner.baseLaborHours, 'baseLaborHours', errors);
  for (const service of ['standard', 'deep', 'move_in_out', 'str_turnover'] as const) {
    numberValue(baseHours[service], `baseLaborHours.${service}`, errors, { positive: true });
  }

  const labor = asRecord(owner.laborUnits, 'laborUnits', errors);
  for (const key of ['sqftHoursPerThousand', 'fullBathHours', 'halfBathHours', 'bedroomHours', 'strBathHours', 'strBedHours', 'strSqftHoursPerThousand'] as const) {
    numberValue(labor[key], `laborUnits.${key}`, errors, { nonnegative: true });
  }
  numberValue(labor.bedroomsIncludedInBase, 'laborUnits.bedroomsIncludedInBase', errors, {
    nonnegative: true,
    integer: true,
  });

  const conditions = asRecord(owner.conditionFactors, 'conditionFactors', errors);
  let previousCondition: number | null = null;
  for (const condition of ['maintained', 'average', 'needs_attention', 'heavy', 'severe'] as const) {
    const factor = numberValue(conditions[condition], `conditionFactors.${condition}`, errors, {
      positive: true,
      max: 5,
    });
    if (factor !== null && previousCondition !== null && factor <= previousCondition) {
      errors.push(
        issue(
          'error',
          `conditionFactors.${condition}`,
          `Condition factors must strictly increase from maintained to severe. Received ${factor} after ${previousCondition}.`,
        ),
      );
    }
    if (factor !== null) previousCondition = factor;
  }

  const lastClean = asRecord(owner.lastCleanFactors, 'lastCleanFactors', errors);
  for (const key of ['within_month', 'one_to_three_months', 'three_to_twelve_months', 'over_a_year', 'never_professional', 'not_sure'] as const) {
    numberValue(lastClean[key], `lastCleanFactors.${key}`, errors, { positive: true, max: 3 });
  }

  const frequencies = asRecord(owner.frequencyFactors, 'frequencyFactors', errors);
  for (const key of ['weekly', 'biweekly', 'monthly', 'one_time'] as const) {
    const factor = numberValue(frequencies[key], `frequencyFactors.${key}`, errors, { positive: true, max: 1.5 });
    if (factor !== null && factor > 1) {
      warnings.push(issue('warning', `frequencyFactors.${key}`, `Frequency factor ${factor} is above 1.0; recurring work now adds labor rather than reducing it.`));
    }
  }

  const range = asRecord(owner.range, 'range', errors);
  const low = numberValue(range.lowFactor, 'range.lowFactor', errors, { min: 0.01, max: 0.999999 });
  const high = numberValue(range.highFactor, 'range.highFactor', errors, { min: 1.000001, max: 5 });
  if (low !== null && high !== null && high <= low) {
    errors.push(issue('error', 'range.highFactor', `Range high factor must exceed low factor. Received ${high} and ${low}.`));
  }
  const rounding = asRecord(owner.rounding, 'rounding', errors);
  const roundStep = numberValue(rounding.roundToNearest, 'rounding.roundToNearest', errors, { positive: true, max: 100 });
  if (roundStep !== null && minimum !== null && Math.abs(minimum / roundStep - Math.round(minimum / roundStep)) > 1e-9) {
    warnings.push(issue('warning', 'rounding.roundToNearest', 'Minimum job is not a multiple of the rounding step; minimum-floor rounding may not reconcile exactly.'));
  }

  const addons = arrayValue(owner.addons, 'addons', errors);
  const addonIds = new Set<string>();
  for (const [index, entry] of addons.entries()) {
    const addon = asRecord(entry, `addons[${index}]`, errors);
    const id = stringValue(addon.id, `addons[${index}].id`, errors);
    if (id && !/^[a-z][a-z0-9_]*$/.test(id)) {
      errors.push(issue('error', `addons[${index}].id`, `Add-on id ${received(id)} must be lowercase snake_case.`));
    }
    if (id && addonIds.has(id)) errors.push(issue('error', `addons[${index}].id`, `Duplicate add-on id ${id}.`));
    if (id) addonIds.add(id);
    stringValue(addon.label, `addons[${index}].label`, errors);
    stringValue(addon.blurb, `addons[${index}].blurb`, errors);
    if (!ADDON_CATEGORIES.has(String(addon.category))) {
      errors.push(issue('error', `addons[${index}].category`, `Unknown add-on category ${received(addon.category)}.`));
    }
    const custom = booleanValue(addon.customQuote, `addons[${index}].customQuote`, errors);
    const laborHours = addon.laborHours;
    const fixed = addon.fixedPriceUsd;
    if (custom === true) {
      if (laborHours !== undefined || fixed !== undefined) {
        errors.push(issue('error', `addons[${index}]`, 'Custom-quote add-ons must not carry labor hours or a fixed price.'));
      }
    } else if (custom === false) {
      if (laborHours !== undefined) {
        numberValue(laborHours, `addons[${index}].laborHours`, errors, { nonnegative: true });
      }
      if (fixed !== undefined) {
        numberValue(fixed, `addons[${index}].fixedPriceUsd`, errors, { positive: true });
      }
      const hasLabor = typeof laborHours === 'number' && laborHours > 0;
      const hasFixed = typeof fixed === 'number' && fixed > 0;
      if (!hasLabor && !hasFixed) {
        errors.push(issue('error', `addons[${index}]`, 'A non-custom add-on needs positive labor hours or a positive fixed price.'));
      }
    }
  }

  const promotions = asRecord(owner.promotions, 'promotions', errors);
  const incentive = asRecord(promotions.addonIncentive, 'promotions.addonIncentive', errors);
  booleanValue(incentive.enabled, 'promotions.addonIncentive.enabled', errors);
  const tiers = asRecord(incentive, 'promotions.addonIncentive', errors);
  for (const key of ['twoAddons', 'threeOrMoreAddons'] as const) {
    const tier = asRecord(tiers[key], `promotions.addonIncentive.${key}`, errors);
    numberValue(tier.minAddons, `promotions.addonIncentive.${key}.minAddons`, errors, { min: 2, integer: true });
    numberValue(tier.percent, `promotions.addonIncentive.${key}.percent`, errors, { min: 0.000001, max: 0.25 });
  }
  numberValue(incentive.maxDiscount, 'promotions.addonIncentive.maxDiscount', errors, { positive: true });

  const guarantee = asRecord(promotions.responseGuarantee, 'promotions.responseGuarantee', errors);
  booleanValue(guarantee.enabled, 'promotions.responseGuarantee.enabled', errors);
  numberValue(guarantee.windowBusinessHours, 'promotions.responseGuarantee.windowBusinessHours', errors, { positive: true });
  numberValue(guarantee.discountPercent, 'promotions.responseGuarantee.discountPercent', errors, { min: 0, max: 100 });
  numberValue(guarantee.maxDiscount, 'promotions.responseGuarantee.maxDiscount', errors, { positive: true });
  serviceList(guarantee.eligibleServices, 'promotions.responseGuarantee.eligibleServices', errors);
  stringValue(guarantee.businessTimezone, 'promotions.responseGuarantee.businessTimezone', errors);

  validatePromotionArray(promotions.appreciationDiscounts, 'promotions.appreciationDiscounts', errors, warnings);
  validateAddonBundles(promotions.addonBundles, 'promotions.addonBundles', errors, warnings, addonIds);

  const founding = asRecord(promotions.foundingTen, 'promotions.foundingTen', errors);
  booleanValue(founding.enabled, 'promotions.foundingTen.enabled', errors);
  if (founding.enabled === true && !['first_clean_discount', 'recurring_discount', 'complimentary_upgrade'].includes(String(founding.mechanism))) {
    errors.push(issue('error', 'promotions.foundingTen.mechanism', 'An enabled Founding-10 program must select a mechanism.'));
  }
  const capacity = asRecord(founding.capacity, 'promotions.foundingTen.capacity', errors);
  numberValue(capacity.slots, 'promotions.foundingTen.capacity.slots', errors, { positive: true, integer: true });
  if (founding.reservationRequired !== true) {
    warnings.push(issue('warning', 'promotions.foundingTen.reservationRequired', 'Founding-10 enrollments should remain owner-reserved; confirm the change.'));
  }
  dateValue(founding.expiresOn, 'promotions.foundingTen.expiresOn', errors);

  const campaign = asRecord(promotions.campaign, 'promotions.campaign', errors);
  stringValue(campaign.code, 'promotions.campaign.code', errors);
  booleanValue(campaign.enabled, 'promotions.campaign.enabled', errors);
  numberValue(campaign.value, 'promotions.campaign.value', errors, { positive: true });
  serviceList(campaign.services, 'promotions.campaign.services', errors);
  frequencyList(campaign.frequencies, 'promotions.campaign.frequencies', errors);
  dateValue(campaign.expiresOn, 'promotions.campaign.expiresOn', errors);
  if (campaign.stackable === true) errors.push(issue('error', 'promotions.campaign.stackable', 'Campaigns must remain non-stackable.'));
  const popup = asRecord(campaign.popup, 'promotions.campaign.popup', errors);
  for (const key of ['eyebrow', 'headline', 'offer', 'ctaLabel', 'secondaryLabel', 'termsLine'] as const) {
    stringValue(popup[key], `promotions.campaign.popup.${key}`, errors);
  }
  numberValue(popup.activeSeconds, 'promotions.campaign.popup.activeSeconds', errors, { nonnegative: true });
  numberValue(popup.dismissedCooldownDays, 'promotions.campaign.popup.dismissedCooldownDays', errors, { nonnegative: true });

  const thresholds = asRecord(pricing.customQuoteThresholds, 'customQuoteThresholds', errors);
  for (const key of ['squareFeetOver', 'fullBathsOver', 'bedroomsOver'] as const) {
    numberValue(pricingValue(thresholds[key] as never), `customQuoteThresholds.${key}`, errors, { positive: true, integer: true });
  }
  for (const key of ['severeCondition', 'customQuoteAddons', 'outsideInstantZone', 'unknownLocation'] as const) {
    booleanValue(thresholds[key], `customQuoteThresholds.${key}`, errors);
  }

  const ownerTravel = asRecord(pricing.travel, 'travel', errors);
  numberValue(pricingValue(ownerTravel.includedOneWayMiles as never), 'travel.includedOneWayMiles', errors, { nonnegative: true });
  numberValue(pricingValue(ownerTravel.perMileWearCost as never), 'travel.perMileWearCost', errors, { nonnegative: true });
  numberValue(pricingValue(ownerTravel.fallbackGasPrice as never), 'travel.fallbackGasPrice', errors, { positive: true });
  const zones = asRecord(ownerTravel.zoneAdjustments, 'travel.zoneAdjustments', errors);
  numberValue(pricingValue(zones.core as never), 'travel.zoneAdjustments.core', errors, { nonnegative: true });
  numberValue(pricingValue(zones.surrounding as never), 'travel.zoneAdjustments.surrounding', errors, { nonnegative: true });
  const clientDefaults = asRecord(ownerTravel.clientDefaults, 'travel.clientDefaults', errors);
  numberValue(pricingValue(clientDefaults.mpg as never), 'travel.clientDefaults.mpg', errors, { positive: true });
  numberValue(pricingValue(clientDefaults.maxInstantDistanceMiles as never), 'travel.clientDefaults.maxInstantDistanceMiles', errors, { positive: true });

  const driving = asRecord(pricing.drivingPolicy, 'drivingPolicy', errors);
  numberValue(pricingValue(driving.maxDrivingMinutes as never), 'drivingPolicy.maxDrivingMinutes', errors, { positive: true });
  numberValue(pricingValue(driving.reviewBandMinutes as never), 'drivingPolicy.reviewBandMinutes', errors, { nonnegative: true });

  const travel = asRecord(input.travel ?? travelConfig, 'travelConfig', errors);
  for (const key of ['mpg', 'fallbackGasPrice', 'maxDrivingMinutes', 'maxInstantDistanceMiles'] as const) {
    numberValue(travel[key], `travelConfig.${key}`, errors, { positive: true });
  }
  for (const key of ['wearPerMile', 'includedOneWayMiles', 'reviewBandMinutes', 'cacheSeconds'] as const) {
    numberValue(travel[key], `travelConfig.${key}`, errors, { nonnegative: true });
  }
  const ownerClientMpg = pricingValue(
    (ownerTravel.clientDefaults as Record<string, unknown>).mpg as never,
  );
  if (isFiniteNumber(ownerClientMpg) && isFiniteNumber(travel.mpg) && ownerClientMpg !== travel.mpg) {
    warnings.push(
      issue(
        'warning',
        'travel.clientDefaults.mpg',
        'Client travel MPG differs from the shared travel configuration; confirm both paths were updated.',
      ),
    );
  }

  const limits = [
    ['RESIDENTIAL_INPUT_LIMITS', RESIDENTIAL_INPUT_LIMITS],
    ['FACILITY_INPUT_LIMITS', FACILITY_INPUT_LIMITS],
  ] as const;
  for (const [name, group] of limits) {
    for (const [key, limit] of Object.entries(group)) {
      const path = `${name}.${key}`;
      numberValue(limit.min, `${path}.min`, errors, { nonnegative: true });
      numberValue(limit.max, `${path}.max`, errors, { positive: true });
      if (limit.step !== undefined) numberValue(limit.step, `${path}.step`, errors, { positive: true });
      if (limit.min >= limit.max) errors.push(issue('error', path, `${name}.${key} min must be below max.`));
    }
  }
  for (const [name, options] of [
    ['RESIDENTIAL_SERVICE_OPTIONS', RESIDENTIAL_SERVICE_OPTIONS],
    ['COMMERCIAL_FACILITY_TYPES', COMMERCIAL_FACILITY_TYPES],
  ] as const) {
    const values = new Set<string>();
    for (const [index, option] of options.entries()) {
      if (!option.value || values.has(option.value)) {
        errors.push(issue('error', `${name}[${index}].value`, `${name} options must have unique non-empty values.`));
      }
      values.add(option.value);
      if (!option.label || !option.label.trim()) {
        errors.push(issue('error', `${name}[${index}].label`, `${name} options need labels.`));
      }
    }
  }
  for (const service of SERVICES) {
    if (!RESIDENTIAL_SERVICE_OPTIONS.some((option) => option.value === service)) {
      errors.push(issue('error', 'RESIDENTIAL_SERVICE_OPTIONS', `Missing required residential service option ${service}.`));
    }
  }

  const commercialSettings = asRecord(input.commercial ?? commercialTierConfig, 'commercialTierConfig', errors);
  booleanValue(commercialSettings.numericEstimatesEnabled, 'commercialTierConfig.numericEstimatesEnabled', errors);
  const legacyA = numberValue(commercialSettings.tierA_maxCleanableSqft, 'commercialTierConfig.tierA_maxCleanableSqft', errors, { positive: true });
  const legacyB = numberValue(commercialSettings.tierB_maxCleanableSqft, 'commercialTierConfig.tierB_maxCleanableSqft', errors, { positive: true });
  if (legacyA !== null && legacyB !== null && legacyB < legacyA) {
    errors.push(issue('error', 'commercialTierConfig.tierB_maxCleanableSqft', 'Legacy Tier B square-foot threshold must not be below Tier A.'));
  }
  const triggers = asRecord(commercialSettings.tierC_triggers, 'commercialTierConfig.tierC_triggers', errors);
  numberValue(triggers.restroomsOver, 'commercialTierConfig.tierC_triggers.restroomsOver', errors, { nonnegative: true, integer: true });
  for (const [index, service] of arrayValue(triggers.specialtyServices, 'commercialTierConfig.tierC_triggers.specialtyServices', errors).entries()) {
    if (typeof service !== 'string' || !service.trim()) {
      errors.push(issue('error', `commercialTierConfig.tierC_triggers.specialtyServices[${index}]`, 'Specialty trigger ids must be non-empty strings.'));
    }
  }

  const errorsOnly = errors.filter((entry) => entry.severity === 'error');
  const warningsOnly = warnings.filter((entry) => entry.severity === 'warning');
  return { valid: errorsOnly.length === 0, errors: errorsOnly, warnings: warningsOnly };
}

export function formatEstimatorConfigIssues(issues: ConfigIssue[]): string {
  return issues.map((entry) => `${entry.severity.toUpperCase()} ${entry.path}: ${entry.message}`).join('\n');
}

export function assertValidEstimatorConfiguration(
  input: EstimatorConfigurationInput = {},
): EstimatorConfigurationResult {
  const result = validateEstimatorConfiguration(input);
  if (!result.valid) {
    throw new Error(`Estimator configuration is invalid:\n${formatEstimatorConfigIssues(result.errors)}`);
  }
  return result;
}
