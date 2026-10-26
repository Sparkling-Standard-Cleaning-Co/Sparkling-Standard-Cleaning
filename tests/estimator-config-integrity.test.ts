// Initiative 6.3 estimator-control-center baseline lock.
//
// The organizational refactor must not change a price, labour assumption,
// threshold or input range. This test is deliberately explicit: an intentional
// owner-approved pricing change must update this file in the same commit, which
// forces the change to be reviewed rather than silently drifting.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pricing } from '../src/config/pricing.ts';
import { ownerPricing } from '../src/config/estimators/pricing-values.ts';
import { travelConfig } from '../src/config/estimators/travel.ts';
import { commercialTierConfig } from '../src/config/estimators/commercial.ts';
import {
  COMMERCIAL_FACILITY_TYPES,
  FACILITY_INPUT_LIMITS,
  RESIDENTIAL_INPUT_LIMITS,
  RESIDENTIAL_SERVICE_OPTIONS,
} from '../src/config/estimators/input-definitions.ts';
import { ESTIMATE_ENGINES } from '../src/lib/estimate/engines.ts';

test('estimator-control-center refactor preserves the approved pricing baseline', () => {
  assert.equal(ownerPricing.hourlyRates.recurring, 55);
  assert.equal(ownerPricing.hourlyRates.otherServices, 55);
  assert.equal(ownerPricing.hourlyRates.ownerLaborTarget, 35);
  assert.equal(ownerPricing.minimumJob, 125);
  assert.deepEqual(ownerPricing.estimatorCalibration, { residential: 1, str: 1, commercial: 1, church: 1 });
  assert.equal(ownerPricing.supportiveHomeDiscount.percent, 10);
  assert.equal(ownerPricing.supportiveHomeDiscount.termsVersion, '2026-10-25.supportive10.v2');
  assert.deepEqual(ownerPricing.supportiveHomeDiscount.eligibleServices, ['standard', 'deep', 'move_in_out']);
  assert.equal(ownerPricing.churchDiscount.percent, 10);
});

test('labour, condition, frequency and rounding assumptions are unchanged', () => {
  assert.deepEqual(ownerPricing.baseLaborHours, {
    standard: 2,
    deep: 3.2,
    move_in_out: 3.4,
    str_turnover: 1.2,
  });
  assert.deepEqual(ownerPricing.conditionFactors, {
    maintained: 1,
    average: 1.1,
    needs_attention: 1.25,
    heavy: 1.45,
    severe: 2,
  });
  assert.deepEqual(ownerPricing.frequencyFactors, {
    weekly: 0.92,
    biweekly: 0.95,
    monthly: 0.98,
    one_time: 1,
  });
  assert.deepEqual(ownerPricing.range, { lowFactor: 0.92, highFactor: 1.12 });
  assert.equal(ownerPricing.rounding.roundToNearest, 5);
  assert.equal(pricing.instantQuote.configVersion.value, '2026-10-25.engine-calibration-supportive-tax.v1');
});

test('commercial and church workload assumptions are unchanged', () => {
  assert.equal(ownerPricing.commercialPricing.grossRatePerHour, 60);
  assert.equal(ownerPricing.commercialPricing.tierAHours, 3);
  assert.equal(ownerPricing.commercialPricing.tierBHours, 8);
  assert.equal(ownerPricing.commercialPricing.overheadRatePercent, 22);
  assert.equal(ownerPricing.commercialPricing.productionSqftPerHour.office, 3000);
  assert.equal(ownerPricing.commercialPricing.productionSqftPerHour.church, 2800);
  assert.equal(commercialTierConfig.numericEstimatesEnabled, true);
  assert.equal(commercialTierConfig.tierC_triggers.restroomsOver, 4);
});

test('travel assumptions and the private-origin boundary are unchanged', () => {
  assert.equal(travelConfig.mpg, 24);
  assert.equal(travelConfig.wearPerMile, 0.12);
  assert.equal(travelConfig.includedOneWayMiles, 17.5);
  assert.equal(travelConfig.fallbackGasPrice, 3.1);
  assert.equal(travelConfig.maxDrivingMinutes, 60);
  assert.equal(travelConfig.reviewBandMinutes, 15);
  assert.equal(travelConfig.maxInstantDistanceMiles, 45);
});

test('the four estimator engines and public input definitions are intact', () => {
  assert.deepEqual(
    ESTIMATE_ENGINES.map((engine) => engine.id),
    ['residential', 'commercial', 'str', 'church'],
  );
  assert.equal(RESIDENTIAL_SERVICE_OPTIONS.length, 4);
  assert.equal(COMMERCIAL_FACILITY_TYPES.length, 8);
  assert.deepEqual(RESIDENTIAL_INPUT_LIMITS.squareFeet, { min: 200, max: 20000, step: 50 });
  assert.deepEqual(FACILITY_INPUT_LIMITS.restroomFixtures, { min: 0, max: 60, step: 1 });
});
