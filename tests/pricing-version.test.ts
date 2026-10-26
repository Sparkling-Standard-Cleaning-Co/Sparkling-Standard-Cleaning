// Automatic pricing configuration versioning.
//
// The fingerprint must change for effective price changes, stay stable for
// cosmetic/terms-label changes, and be identical on client and server.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ownerPricing, type OwnerPricingConfig } from '../src/config/estimators/pricing-values.ts';
import { travelConfig } from '../src/config/estimators/travel.ts';
import { PRICING_CALCULATION_SCHEMA_VERSION } from '../src/config/estimators/calculation-schema.ts';
import {
  PRICING_CONFIG_VERSION,
  computePricingConfigVersion,
  effectivePricingSnapshot,
  pricingFingerprint,
  stablePricingJson,
} from '../src/config/estimators/pricing-version.ts';
import { pricing } from '../src/config/pricing.ts';
import { buildInstantQuote } from '../src/lib/estimate/quote.ts';
import { calculateEstimate, type EstimateContext } from '../src/lib/estimate/calculate.ts';
import type { EstimateInput } from '../src/lib/estimate/types.ts';

const cloneOwner = (): OwnerPricingConfig => structuredClone(ownerPricing);

const context: EstimateContext = {
  travel: {
    includedOneWayMiles: 15,
    mpg: 24,
    wearPerMile: 0.12,
    referenceGasPrice: 3.1,
    zoneAdjustments: { core: 0, surrounding: 15 },
    maxInstantDistanceMiles: 45,
  },
};

const input: EstimateInput = {
  serviceType: 'standard',
  propertyType: 'house',
  squareFeet: 1600,
  bedrooms: 3,
  fullBaths: 2,
  halfBaths: 0,
  frequency: 'one_time',
  condition: 'maintained',
  lastClean: 'within_month',
  addonIds: [],
  zip: '32503',
  pets: 'none',
};

test('the automatic version is deterministic, schema-prefixed and shared by all quotes', () => {
  assert.equal(PRICING_CONFIG_VERSION, computePricingConfigVersion());
  assert.equal(pricing.instantQuote.configVersion.value, PRICING_CONFIG_VERSION);
  assert.equal(pricing.commercialPricing.configVersion.value, PRICING_CONFIG_VERSION);
  assert.match(
    PRICING_CONFIG_VERSION,
    new RegExp(`^${PRICING_CALCULATION_SCHEMA_VERSION.replaceAll('.', '\\.')}\\.[0-9a-f]{16}$`),
  );
  assert.equal(stablePricingJson(ownerPricing), stablePricingJson(ownerPricing));
  assert.equal(pricingFingerprint(ownerPricing), pricingFingerprint(ownerPricing));
});

test('the version changes when an effective owner value changes', () => {
  const base = computePricingConfigVersion();
  const commercial = cloneOwner();
  const currentCommercial = commercial.estimatorCalibration.commercial;
  commercial.estimatorCalibration.commercial = currentCommercial >= 1.5 ? 1.4 : currentCommercial + 0.1;
  const commercialVersion = computePricingConfigVersion({ owner: commercial });

  const rate = cloneOwner();
  rate.hourlyRates.recurring += 1;
  const rateVersion = computePricingConfigVersion({ owner: rate });

  const addon = cloneOwner();
  const firstAddon = addon.addons.find((entry) => entry.id === 'inside_oven');
  assert.ok(firstAddon);
  firstAddon.laborHours = (firstAddon.laborHours ?? 0) + 0.05;
  const addonVersion = computePricingConfigVersion({ owner: addon });

  assert.notEqual(commercialVersion, base);
  assert.notEqual(rateVersion, base);
  assert.notEqual(addonVersion, base);
  assert.notEqual(commercialVersion, rateVersion);
});

test('cosmetic and terms-label changes do not invalidate quotes', () => {
  const base = computePricingConfigVersion();
  const cosmetic = cloneOwner();
  cosmetic.promotions.campaign.popup.headline = 'A different seasonal headline';
  cosmetic.promotions.campaign.label = 'A different label';
  cosmetic.supportiveHomeDiscount.termsVersion = 'terms-label-only-change';
  cosmetic.addons[0]!.label = 'A friendlier add-on label';
  cosmetic.addons[0]!.blurb = 'A different customer-facing description.';
  const cosmeticVersion = computePricingConfigVersion({ owner: cosmetic });
  assert.equal(cosmeticVersion, base);
});

test('travel economics and a calculation-schema change alter the version', () => {
  const base = computePricingConfigVersion();
  const travel = { ...travelConfig, mpg: 25 };
  assert.notEqual(computePricingConfigVersion({ travel }), base);
  assert.notEqual(computePricingConfigVersion({ schemaVersion: `${PRICING_CALCULATION_SCHEMA_VERSION}-test` }), base);
});

test('the effective snapshot excludes presentation copy but includes pricing fields', () => {
  const snapshot = stablePricingJson(effectivePricingSnapshot());
  assert.match(snapshot, /"estimatorCalibration"/);
  assert.match(snapshot, /"minimumJob"/);
  assert.match(snapshot, /"grossRatePerHour"/);
  assert.doesNotMatch(snapshot, /"popup"/);
  assert.doesNotMatch(snapshot, /"termsVersion"/);
  assert.doesNotMatch(snapshot, /"blurb"/);
});

test('the browser-built quote carries the same current version the server verifies', () => {
  const result = calculateEstimate(input, context);
  const quote = buildInstantQuote(result, { serviceType: 'standard', zip: '32503' }, Date.UTC(2026, 9, 1));
  assert.ok(quote);
  assert.equal(quote.configVersion, pricing.instantQuote.configVersion.value);
});
