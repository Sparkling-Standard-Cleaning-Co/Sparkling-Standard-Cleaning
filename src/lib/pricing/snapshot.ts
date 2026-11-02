// Pricing snapshot normalization, validation and fingerprints.
//
// A snapshot is the complete owner pricing configuration plus the shared travel
// economics. Published snapshots are stored as immutable JSON in D1. Loading a
// snapshot is deliberately allow-listed through the pricing catalog: unknown
// keys are ignored and no submitted value can add executable behavior.

import { ownerPricing, type OwnerPricingConfig } from '../../config/estimators/pricing-values.ts';
import { travelConfig, type TravelConfigValues } from '../../config/estimators/travel.ts';
import { computePricingConfigVersion } from '../../config/estimators/pricing-version.ts';
import {
  getPathValue,
  pricingCatalog,
  setPathValue,
  type PricingCatalogEntry,
} from './catalog.ts';

export interface PricingSnapshot {
  owner: OwnerPricingConfig;
  travel: TravelConfigValues;
}

export interface PricingValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  snapshot: PricingSnapshot;
}

export interface PricingSnapshotMeta {
  id: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  fingerprint: string;
  note: string;
  basedOnVersion: number | null;
  createdAt: string;
  createdBy: string;
  createdByEmail: string | null;
  updatedAt: string;
  publishedAt: string | null;
  publishedBy: string | null;
  publishedByEmail: string | null;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A pristine copy of the source-controlled baseline configuration. */
export function sourcePricingSnapshot(): PricingSnapshot {
  return { owner: clone(ownerPricing), travel: clone(travelConfig) };
}

export function pricingSnapshotVersion(snapshot: PricingSnapshot): string {
  return computePricingConfigVersion({ owner: snapshot.owner, travel: snapshot.travel });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readPrimitive(input: unknown, path: string, entry: PricingCatalogEntry): { present: boolean; value: unknown; error: string | null } {
  const value = getPathValue(input, path);
  if (value === undefined) return { present: false, value: undefined, error: null };
  if (entry.kind === 'boolean') {
    if (typeof value !== 'boolean') {
      return { present: true, value: undefined, error: `${entry.label} must be on or off.` };
    }
    return { present: true, value, error: null };
  }
  if (value === null && entry.allowNull) return { present: true, value: null, error: null };
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { present: true, value: undefined, error: `${entry.label} must be a number.` };
  }
  if (entry.min !== undefined && value < entry.min) {
    return { present: true, value: undefined, error: `${entry.label} must be at least ${entry.min}${entry.max !== undefined ? ` and at most ${entry.max}` : ''}.` };
  }
  if (entry.max !== undefined && value > entry.max) {
    return { present: true, value: undefined, error: `${entry.label} must be at most ${entry.max}${entry.min !== undefined ? ` and at least ${entry.min}` : ''}.` };
  }
  return { present: true, value, error: null };
}

/**
 * Applies the catalog allow-list to an untrusted snapshot.
 * `strict` turns unknown/invalid values into blocking errors (admin save);
 * non-strict loading falls back to the baseline for anything unusable.
 */
export function normalizePricingSnapshot(input: unknown, options: { strict?: boolean } = {}): PricingValidation {
  const snapshot = sourcePricingSnapshot();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(input)) {
    return { ok: false, errors: ['A pricing configuration object is required.'], warnings, snapshot };
  }

  for (const entry of pricingCatalog) {
    const result = readPrimitive(input, entry.path, entry);
    if (!result.present) continue;
    if (result.error) {
      if (options.strict) errors.push(result.error);
      continue;
    }
    if (!setPathValue(snapshot, entry.path, result.value)) {
      if (options.strict) errors.push(`${entry.label} could not be applied to the pricing structure.`);
    }
  }

  // Structural values that must not be swapped by a submitted snapshot.
  // Add-on ids, labels, custom-quote flags, campaign code/legacy terms and
  // bundle required ids remain exactly as the source configuration defines
  // them. The catalog only changes pricing-driving values.
  applyStructuralGuards(snapshot);

  const dependencyErrors = validatePricingDependencies(snapshot);
  errors.push(...dependencyErrors);

  const minimumJob = snapshot.owner.minimumJob;
  const step = snapshot.owner.rounding.roundToNearest;
  if (step > 0 && Math.abs(minimumJob / step - Math.round(minimumJob / step)) > 1e-9) {
    warnings.push('The minimum job value is not a multiple of the rounding step; final prices may not land exactly on the minimum.');
  }

  return { ok: errors.length === 0, errors, warnings, snapshot };
}

function applyStructuralGuards(snapshot: PricingSnapshot): void {
  const baseline = ownerPricing;

  // Restore structural add-on identity while keeping the editable values that
  // were already applied through the catalog.
  const addons = snapshot.owner.addons;
  for (const [index, baselineAddon] of baseline.addons.entries()) {
    const target = addons[index];
    if (!target) continue;
    target.id = baselineAddon.id;
    target.label = baselineAddon.label;
    target.blurb = baselineAddon.blurb;
    target.customQuote = baselineAddon.customQuote;
    target.category = baselineAddon.category;
  }

  // Restore promotion structure that is not a normal pricing variable.
  snapshot.owner.promotions.campaign.code = baseline.promotions.campaign.code;
  snapshot.owner.promotions.campaign.kind = baseline.promotions.campaign.kind;
  snapshot.owner.promotions.campaign.label = baseline.promotions.campaign.label;
  if (baseline.promotions.campaign.legacy) {
    snapshot.owner.promotions.campaign.legacy = clone(baseline.promotions.campaign.legacy);
  }
  snapshot.owner.promotions.campaign.services = clone(baseline.promotions.campaign.services);
  snapshot.owner.promotions.campaign.frequencies = clone(baseline.promotions.campaign.frequencies);
  for (const [index, baselineBundle] of baseline.promotions.addonBundles.entries()) {
    const target = snapshot.owner.promotions.addonBundles[index];
    if (!target) continue;
    target.id = baselineBundle.id;
    target.label = baselineBundle.label;
    target.requiredAddonIds = clone(baselineBundle.requiredAddonIds);
    target.eligibleFrequencies = clone(baselineBundle.eligibleFrequencies);
    target.requiresRecurring = baselineBundle.requiresRecurring;
    target.kind = baselineBundle.kind;
    target.stackable = false;
  }
  // Keep the remaining promotion structures source-controlled unless a later
  // owner-approved milestone explicitly exposes them.
  snapshot.owner.promotions.addonIncentive = clone(baseline.promotions.addonIncentive);
  snapshot.owner.promotions.responseGuarantee = clone(baseline.promotions.responseGuarantee);
  snapshot.owner.promotions.appreciationDiscounts = clone(baseline.promotions.appreciationDiscounts);
  snapshot.owner.promotions.foundingTen = clone(baseline.promotions.foundingTen);
  snapshot.owner.supportiveHomeDiscount.termsVersion = baseline.supportiveHomeDiscount.termsVersion;
  snapshot.owner.supportiveHomeDiscount.eligibleServices = clone(baseline.supportiveHomeDiscount.eligibleServices);
}

export function validatePricingDependencies(snapshot: PricingSnapshot): string[] {
  const errors: string[] = [];
  const { owner } = snapshot;
  if (!(owner.hourlyRates.ownerLaborTarget < owner.hourlyRates.otherServices)) {
    errors.push('The owner labor target must stay below the one-time labor-hour rate.');
  }
  if (!(owner.hourlyRates.ownerLaborTarget < owner.hourlyRates.recurring)) {
    errors.push('The owner labor target must stay below the recurring labor-hour rate.');
  }
  if (!(owner.commercialPricing.tierAHours < owner.commercialPricing.tierBHours)) {
    errors.push('The Tier A hour limit must be below the Tier B hour limit.');
  }
  if (!(owner.range.lowFactor < owner.range.highFactor)) {
    errors.push('The estimate range low factor must be below the high factor.');
  }
  if (!(owner.rounding.roundToNearest > 0)) {
    errors.push('The rounding step must be greater than zero.');
  }
  if (!(snapshot.travel.mpg > 0)) {
    errors.push('Vehicle MPG must be greater than zero.');
  }
  return errors;
}

/** True when a snapshot is byte-equivalent (by value) to the source baseline. */
export function isSourcePricingSnapshot(snapshot: PricingSnapshot): boolean {
  return JSON.stringify(snapshot) === JSON.stringify(sourcePricingSnapshot());
}

/** A compact, non-secret summary for API responses and audit records. */
export function snapshotSummary(snapshot: PricingSnapshot): {
  version: string;
  changedValues: number;
  totalValues: number;
} {
  const baseline = sourcePricingSnapshot();
  let changedValues = 0;
  for (const entry of pricingCatalog) {
    if (JSON.stringify(getPathValue(snapshot, entry.path)) !== JSON.stringify(getPathValue(baseline, entry.path))) {
      changedValues += 1;
    }
  }
  return {
    version: pricingSnapshotVersion(snapshot),
    changedValues,
    totalValues: pricingCatalog.length,
  };
}
