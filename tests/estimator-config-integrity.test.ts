// Current estimator configuration integrity.
//
// These tests validate the CURRENT owner configuration's structure, range and
// dependencies without freezing its business values. Intentional owner edits
// (rates, labor hours, minimums, discounts, calibration factors, add-ons and
// travel assumptions) must not require a test edit. Mathematical regression
// protection lives in the fixed-reference and metamorphic pricing tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pricing, pricingValue } from '../src/config/pricing.ts';
import { ownerPricing } from '../src/config/estimators/pricing-values.ts';
import { travelConfig } from '../src/config/estimators/travel.ts';
import { commercialTierConfig } from '../src/config/estimators/commercial.ts';
import { PRICING_CONFIG_VERSION } from '../src/config/estimators/pricing-version.ts';
import { validateEstimatorConfiguration } from '../src/config/estimators/validation.ts';
import {
  COMMERCIAL_FACILITY_TYPES,
  FACILITY_INPUT_LIMITS,
  RESIDENTIAL_INPUT_LIMITS,
  RESIDENTIAL_SERVICE_OPTIONS,
} from '../src/config/estimators/input-definitions.ts';
import { ESTIMATE_ENGINES } from '../src/lib/estimate/engines.ts';

test('the current owner configuration is valid, complete and internally consistent', () => {
  const result = validateEstimatorConfiguration();
  assert.equal(result.valid, true, result.errors.map((entry) => `${entry.path}: ${entry.message}`).join('\n'));
  assert.equal(result.errors.length, 0);
});

test('the four calibration factors are present, finite, bounded and independent', () => {
  const keys = ['residential', 'str', 'commercial', 'church'] as const;
  assert.deepEqual(Object.keys(ownerPricing.estimatorCalibration).sort(), [...keys].sort());
  for (const engine of keys) {
    const value = ownerPricing.estimatorCalibration[engine];
    assert.equal(Number.isFinite(value), true, `${engine} must be finite`);
    assert.ok(value >= 0.5 && value <= 1.5, `${engine} must stay within 0.50–1.50`);
    assert.equal(pricing.estimatorCalibration[engine].value, value, `${engine} typed config must consume the owner value`);
  }
  // Independence is behavioral, not a requirement that every value is 1.00.
  const otherKeys = keys.filter((key) => key !== 'commercial');
  const otherValues = otherKeys.map((key) => ownerPricing.estimatorCalibration[key]);
  assert.equal(ownerPricing.estimatorCalibration.commercial, pricing.estimatorCalibration.commercial.value);
  assert.deepEqual(
    otherKeys.map((key) => ownerPricing.estimatorCalibration[key]),
    otherValues,
    'reading commercial does not mutate another engine',
  );
});

test('the automatic version is the only quote/facility provenance marker', () => {
  assert.equal(pricing.instantQuote.configVersion.value, PRICING_CONFIG_VERSION);
  assert.equal(pricing.commercialPricing.configVersion.value, PRICING_CONFIG_VERSION);
  assert.match(PRICING_CONFIG_VERSION, /^[0-9A-Za-z][0-9A-Za-z._-]*\.[0-9a-f]{16}$/);
});

test('owner pricing values flow into the typed configuration', () => {
  assert.equal(pricingValue(pricing.laborEconomics.targetGrossRevenuePerLaborHour), ownerPricing.hourlyRates.otherServices);
  assert.equal(pricingValue(pricing.laborEconomics.recurringGrossRevenuePerLaborHour), ownerPricing.hourlyRates.recurring);
  assert.equal(pricingValue(pricing.laborEconomics.ownerLaborTargetPerHour), ownerPricing.hourlyRates.ownerLaborTarget);
  assert.equal(pricingValue(pricing.minimumJob), ownerPricing.minimumJob);
  assert.equal(pricingValue(pricing.laborModel.baseHours.standard), ownerPricing.baseLaborHours.standard);
  assert.equal(pricingValue(pricing.laborModel.sqftHoursPerThousand), ownerPricing.laborUnits.sqftHoursPerThousand);
  assert.equal(pricingValue(pricing.conditionFactors.maintained), ownerPricing.conditionFactors.maintained);
  assert.equal(pricingValue(pricing.frequencyFactors.weekly), ownerPricing.frequencyFactors.weekly);
  assert.equal(pricingValue(pricing.rounding.toNearest), ownerPricing.rounding.roundToNearest);
  assert.equal(pricing.addons.items, ownerPricing.addons);
});

test('approval and publication protections remain in place', () => {
  assert.equal(pricing.instantQuote.binding.value, false, 'binding offers stay disabled');
  assert.equal(pricing.publication.publishHourlyRates, false);
  assert.equal(pricing.publication.publishAddonPrices, false);
  assert.equal(pricing.publication.publishMinimumJob, false);
  for (const program of pricing.promotions.appreciationDiscounts) assert.equal(program.enabled, false);
  for (const bundle of pricing.promotions.addonBundles) {
    if (!bundle.enabled) continue;
    assert.ok(typeof bundle.value === 'number' && bundle.value > 0);
    assert.ok(typeof bundle.maxDiscountUsd === 'number' && bundle.maxDiscountUsd > 0);
    assert.ok(bundle.requiredAddonIds.length >= 2);
    assert.equal(bundle.stackable, false);
  }
  assert.equal(pricing.promotions.foundingTen.enabled, false);
});

test('commercial tier policy is structurally valid and ordered', () => {
  assert.equal(typeof commercialTierConfig.numericEstimatesEnabled, 'boolean');
  assert.ok(commercialTierConfig.tierA_maxCleanableSqft > 0);
  assert.ok(commercialTierConfig.tierB_maxCleanableSqft >= commercialTierConfig.tierA_maxCleanableSqft);
  assert.ok(commercialTierConfig.tierC_triggers.restroomsOver >= 0);
  assert.ok(commercialTierConfig.tierC_triggers.specialtyServices.length > 0);
});

test('travel assumptions are structurally valid and shared', () => {
  assert.ok(travelConfig.mpg > 0);
  assert.ok(travelConfig.wearPerMile >= 0);
  assert.ok(travelConfig.includedOneWayMiles >= 0);
  assert.ok(travelConfig.fallbackGasPrice > 0);
  assert.ok(travelConfig.maxDrivingMinutes > 0);
  assert.ok(travelConfig.reviewBandMinutes >= 0);
  assert.ok(travelConfig.maxInstantDistanceMiles > 0);
  assert.equal(pricingValue(pricing.travel.clientDefaults.mpg), travelConfig.mpg);
  assert.equal(pricingValue(pricing.travel.includedOneWayMiles), travelConfig.includedOneWayMiles);
  assert.equal(pricingValue(pricing.travel.perMileWearCost), travelConfig.wearPerMile);
  assert.equal(pricingValue(pricing.travel.fallbackGasPrice), travelConfig.fallbackGasPrice);
  assert.equal(pricingValue(pricing.drivingPolicy.maxDrivingMinutes), travelConfig.maxDrivingMinutes);
});

test('the four engines and public input definitions are intact', () => {
  assert.deepEqual(
    ESTIMATE_ENGINES.map((engine) => engine.id),
    ['residential', 'commercial', 'str', 'church'],
  );
  assert.equal(RESIDENTIAL_SERVICE_OPTIONS.length, 4);
  assert.equal(COMMERCIAL_FACILITY_TYPES.length, 8);
  for (const limit of [...Object.values(RESIDENTIAL_INPUT_LIMITS), ...Object.values(FACILITY_INPUT_LIMITS)]) {
    assert.ok(limit.max > limit.min);
    if (limit.step !== undefined) assert.ok(limit.step > 0);
  }
});
