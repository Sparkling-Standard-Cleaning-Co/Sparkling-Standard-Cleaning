// Deterministic effective-pricing configuration fingerprint.
//
// The owner edits pricing-values.ts; this module converts the effective
// pricing configuration into a stable version string. It deliberately excludes
// display copy, approval notes and terms labels so a wording-only change does
// not invalidate existing quotes. It includes every owner value that can change
// a calculated price, discount, eligibility rule or estimate-availability
// decision, plus travel economics and the developer calculation-schema marker.
//
// The fingerprint is computed synchronously in both the browser bundle and the
// Cloudflare Functions from the same modules, so client and server agree
// without a build identifier, timestamp, random value or secret.

import { ownerPricing, type OwnerPricingConfig } from './pricing-values.ts';
import { travelConfig, type TravelConfig } from './travel.ts';
import { PRICING_CALCULATION_SCHEMA_VERSION } from './calculation-schema.ts';

/** Keys that describe presentation, approval provenance or owner-only policy
 *  but cannot change a calculated estimate. They are excluded from the hash. */
const NON_PRICING_KEYS = new Set([
  'label',
  'blurb',
  'popup',
  'termsLine',
  'eyebrow',
  'headline',
  'offer',
  'ctaLabel',
  'secondaryLabel',
  'termsVersion',
  'note',
  'description',
  'capacity',
  'reservationRequired',
  'businessTimezone',
  'activeSeconds',
  'dismissedCooldownDays',
]);

function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (NON_PRICING_KEYS.has(key)) continue;
      const next = (value as Record<string, unknown>)[key];
      if (next === undefined) continue;
      result[key] = clean(next);
    }
    return result;
  }
  return value;
}

/** Stable JSON: sorted object keys, no presentation-only values. */
export function stablePricingJson(value: unknown): string {
  return JSON.stringify(clean(value));
}

/** 64-bit FNV-1a, rendered as 16 lowercase hex characters. This is a stable
 *  change detector, not a cryptographic signature or secret. */
export function pricingFingerprint(value: unknown): string {
  const text = stablePricingJson(value);
  let hash = 0xcbf29ce484222325n;
  for (const character of text) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

export interface EffectivePricingInputs {
  owner?: OwnerPricingConfig;
  travel?: TravelConfig;
  schemaVersion?: string;
}

/** The exact object hashed to produce the configuration version. */
export function effectivePricingSnapshot(inputs: EffectivePricingInputs = {}): unknown {
  const owner = inputs.owner ?? ownerPricing;
  const travel = inputs.travel ?? travelConfig;
  return {
    schema: inputs.schemaVersion ?? PRICING_CALCULATION_SCHEMA_VERSION,
    owner: clean(owner),
    travel: {
      mpg: travel.mpg,
      wearPerMile: travel.wearPerMile,
      includedOneWayMiles: travel.includedOneWayMiles,
      fallbackGasPrice: travel.fallbackGasPrice,
      maxDrivingMinutes: travel.maxDrivingMinutes,
      reviewBandMinutes: travel.reviewBandMinutes,
      maxInstantDistanceMiles: travel.maxInstantDistanceMiles,
    },
  };
}

/** Automatic quote/pricing version. Stable across identical builds. */
export function computePricingConfigVersion(inputs: EffectivePricingInputs = {}): string {
  const schema = inputs.schemaVersion ?? PRICING_CALCULATION_SCHEMA_VERSION;
  return `${schema}.${pricingFingerprint(effectivePricingSnapshot({ ...inputs, schemaVersion: schema }))}`;
}

export const PRICING_CONFIG_VERSION = computePricingConfigVersion();
