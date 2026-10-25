import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ENGINE_STEPS,
  ESTIMATE_ENGINES,
  engineEstimateHref,
  parseEngineParam,
  parseResidentialServiceParam,
} from '../src/lib/estimate/engines.ts';
import { calculateChurchDiscount } from '../src/lib/estimate/church-discount.ts';
import { calculateChurchEstimate, calculateFacilityWorkload } from '../src/lib/estimate/commercial.ts';
import { commercialTierConfig } from '../src/config/commercial-tiers.ts';

test('engine parameter is allowlisted and defaults to residential', () => {
  for (const engine of ESTIMATE_ENGINES) assert.equal(parseEngineParam(engine.id), engine.id);
  assert.equal(parseEngineParam('commercial'), 'commercial');
  assert.equal(parseEngineParam('str'), 'str');
  assert.equal(parseEngineParam('church'), 'church');
  assert.equal(parseEngineParam('evil'), 'residential');
  assert.equal(parseEngineParam(null), 'residential');
});

test('engine links and residential presets stay inside the registry', () => {
  assert.equal(engineEstimateHref('church'), '/estimate/church/');
  assert.equal(engineEstimateHref('commercial'), '/estimate/commercial/');
  assert.equal(engineEstimateHref('str'), '/estimate/str/');
  assert.deepEqual(parseResidentialServiceParam('deep'), { serviceType: 'deep', frequency: 'one_time' });
  assert.deepEqual(parseResidentialServiceParam('move-out'), { serviceType: 'move_in_out', frequency: 'one_time' });
  assert.deepEqual(parseResidentialServiceParam('supportive'), { serviceType: 'standard', supportive: true });
  assert.equal(parseResidentialServiceParam('commercial'), null);
});

test('each calculator family has six intentional step titles', () => {
  assert.equal(ENGINE_STEPS.residential.titles.length, 6);
  assert.equal(ENGINE_STEPS.str.titles.length, 6);
  assert.notEqual(ENGINE_STEPS.residential.titles[1], ENGINE_STEPS.str.titles[1]);
});

test('church discount is exactly 10% of the cleaning subtotal', () => {
  const result = calculateChurchDiscount(300);
  assert.equal(result.applied, true);
  assert.equal(result.percent, 10);
  assert.equal(result.amount, 30);
  assert.equal(result.discountedSubtotal, 270);
});

test('church discount never stacks with another promotion', () => {
  const result = calculateChurchDiscount(300, { otherDiscountApplied: true });
  assert.equal(result.applied, false);
  assert.equal(result.amount, 0);
  assert.match(result.reason ?? '', /cannot be combined/);
});

test('church discount can bring a minimum-job subtotal below the floor (benefit not erased)', () => {
  const result = calculateChurchDiscount(125);
  assert.equal(result.applied, true);
  assert.equal(result.amount, 12.5);
  assert.equal(result.discountedSubtotal, 112.5);
});

test('facility workload uses the owner baseline, condition and traffic assumptions', () => {
  const workload = calculateFacilityWorkload({
    cleanableSqft: 2000,
    restrooms: 2,
    breakroom: true,
    condition: 'average',
    traffic: 'average',
  });
  // 20 setup + 60 area + 6 restrooms + 10 breakroom = 96 workload minutes;
  // the owner-approved average-condition factor (1.1) applies → 105.6 min.
  assert.equal(workload.totalMinutes, 106);
  assert.equal(workload.laborHours, 1.76);
  assert.equal(workload.numericPricingEnabled, commercialTierConfig.numericEstimatesEnabled);
});

test('numeric facility pricing stays gated until calibration is approved', () => {
  assert.equal(commercialTierConfig.numericEstimatesEnabled, false);
  const workload = calculateFacilityWorkload({ cleanableSqft: 1200, restrooms: 1, breakroom: false });
  assert.equal(workload.numericPricingEnabled, false);
  assert.equal(workload.scopeReviewRequired, true);
  const church = calculateChurchEstimate({ cleanableSqft: 4000, restrooms: 3, breakroom: true });
  assert.equal(church.preliminaryTotal, null);
  assert.equal(church.discount.applied, false, 'no dollar discount is fabricated while gated');
});
