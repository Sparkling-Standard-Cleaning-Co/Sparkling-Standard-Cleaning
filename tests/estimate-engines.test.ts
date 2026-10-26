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
import { calculateChurchEstimate, calculateFacilityPrice, calculateFacilityWorkload } from '../src/lib/estimate/commercial.ts';
import { pricing, pricingValue } from '../src/config/pricing.ts';

test('engine parameter is allowlisted and defaults to residential', () => {
  for (const engine of ESTIMATE_ENGINES) assert.equal(parseEngineParam(engine.id), engine.id);
  assert.equal(parseEngineParam('commercial'), 'commercial');
  assert.equal(parseEngineParam('str'), 'str');
  assert.equal(parseEngineParam('church'), 'church');
  assert.equal(parseEngineParam('evil'), 'residential');
  assert.equal(parseEngineParam(null), 'residential');
});

test('engine links and residential presets stay inside the registry', () => {
  assert.equal(engineEstimateHref('residential'), '/estimate/residential/');
  assert.equal(engineEstimateHref('church'), '/estimate/church/');
  assert.equal(engineEstimateHref('commercial'), '/estimate/commercial/');
  assert.equal(engineEstimateHref('str'), '/estimate/str/');
  assert.equal(engineEstimateHref('residential', 'deep'), '/estimate/residential/?service=deep');
  assert.equal(
    engineEstimateHref('residential', 'move-out', { promo: 'SPARKLE100' }),
    '/estimate/residential/?service=move-out&promo=SPARKLE100',
  );
  assert.equal(
    engineEstimateHref('commercial', null, { utm_source: 'facebook', utm_campaign: 'fall' }),
    '/estimate/commercial/?utm_source=facebook&utm_campaign=fall',
  );
  assert.equal(
    engineEstimateHref('church', 'a b', { utm_content: 'a&b' }),
    '/estimate/church/?service=a+b&utm_content=a%26b',
  );
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

test('church discount applies the configured percentage to the cleaning subtotal', () => {
  if (!pricing.churchDiscount.enabled.value) return;
  const percent = pricing.churchDiscount.percent.value;
  const result = calculateChurchDiscount(300);
  assert.equal(result.applied, true);
  assert.equal(result.percent, percent);
  assert.equal(result.amount, Math.round(300 * (percent / 100) * 100) / 100);
  assert.equal(result.discountedSubtotal, Math.round(300 * (1 - percent / 100) * 100) / 100);
});

test('church discount never stacks with another promotion', () => {
  const result = calculateChurchDiscount(300, { otherDiscountApplied: true });
  assert.equal(result.applied, false);
  assert.equal(result.amount, 0);
  assert.match(result.reason ?? '', /cannot be combined/);
});

test('church discount can bring a minimum-job subtotal below the floor (benefit not erased)', () => {
  if (!pricing.churchDiscount.enabled.value) return;
  const percent = pricing.churchDiscount.percent.value / 100;
  const result = calculateChurchDiscount(pricingValue(pricing.minimumJob));
  assert.equal(result.applied, true);
  assert.equal(result.amount, Math.round(pricingValue(pricing.minimumJob) * percent * 100) / 100);
  assert.equal(result.discountedSubtotal, Math.round(pricingValue(pricing.minimumJob) * (1 - percent) * 100) / 100);
});

test('facility workloading follows the ISSA area + fixture method, not per-room time', () => {
  const workload = calculateFacilityWorkload({
    cleanableSqft: 2000,
    restroomFixtures: 6,
    breakroom: true,
    condition: 'average',
    traffic: 'average',
    flooring: 'mixed',
  });
  // area 2000/4200 = .476h; fixtures 6×3min = .3h; breakroom 10min = .167h;
  // setup 20min = .333h; × mixed 1.04 × average 1.1.
  assert.ok(Math.abs(workload.laborHours - 1.68) < 0.05, `labour hours ${workload.laborHours}`);
  assert.equal(workload.tier, 'A');
});

test('more restroom fixtures increase labour independently of floor area', () => {
  const low = calculateFacilityWorkload({ cleanableSqft: 2000, restroomFixtures: 2, breakroom: false });
  const high = calculateFacilityWorkload({ cleanableSqft: 2000, restroomFixtures: 12, breakroom: false });
  assert.ok(high.laborHours > low.laborHours + 0.4);
});

test('workload tiers escalate to a range and then a custom scope review', () => {
  const small = calculateFacilityWorkload({ cleanableSqft: 1200, restroomFixtures: 4, breakroom: false });
  const mid = calculateFacilityWorkload({ cleanableSqft: 9000, restroomFixtures: 10, breakroom: true });
  const large = calculateFacilityWorkload({ cleanableSqft: 18000, restroomFixtures: 24, breakroom: true });
  assert.equal(small.tier, 'A');
  assert.equal(mid.tier, 'B');
  assert.equal(large.tier, 'C');
});

test('commercial pricing produces a defensible numeric minimum when enabled', () => {
  const input = {
    cleanableSqft: 2000,
    restroomFixtures: 6,
    breakroom: true,
    facilityType: 'office' as const,
    condition: 'average' as const,
    traffic: 'average' as const,
    flooring: 'mixed' as const,
  };
  const workload = calculateFacilityWorkload(input);
  const price = calculateFacilityPrice(workload, 'weekly', { numericEstimatesEnabled: true });
  assert.equal(price.priced, true);
  assert.ok(price.perVisit >= pricingValue(pricing.minimumJob));
  assert.ok(price.monthly && price.monthly > price.perVisit);
  assert.equal(price.travelAdjustment, 0);
});

test('the owner kill switch suppresses every numeric facility price', () => {
  const input = {
    cleanableSqft: 2000,
    restroomFixtures: 6,
    breakroom: true,
    facilityType: 'office' as const,
    condition: 'average' as const,
    traffic: 'average' as const,
    flooring: 'mixed' as const,
  };
  const workload = calculateFacilityWorkload(input);
  const price = calculateFacilityPrice(workload, 'weekly', { numericEstimatesEnabled: false });
  assert.equal(price.priced, false);
  assert.equal(price.cleaningSubtotal, 0);
  assert.equal(price.perVisit, 0);
  assert.equal(price.total, 0);
  assert.equal(price.travelAdjustment, 0);
  assert.equal(price.range, null);
  assert.equal(price.monthly, null);
  assert.equal(price.discount, null);
  // The workload is still available for the scope review, but no number is
  // presented to the customer as a price.
  assert.ok(workload.laborHours > 0);
});

test('the kill switch suppresses the church discount amount as well', () => {
  const church = calculateChurchEstimate({
    cleanableSqft: 4000,
    restroomFixtures: 6,
    breakroom: true,
    frequency: 'weekly',
    numericEstimatesEnabled: false,
  });
  assert.equal(church.price.priced, false);
  assert.equal(church.price.discount, null);
  assert.equal(church.price.perVisit, 0);
  assert.equal(church.price.total, 0);
});

test('church estimates apply the configured discount transparently after the minimum', () => {
  const church = calculateChurchEstimate({ cleanableSqft: 4000, restroomFixtures: 6, breakroom: true, frequency: 'weekly' });
  assert.ok(church.price.cleaningSubtotal >= pricingValue(pricing.minimumJob), 'minimum applies before the discount');
  const factor = pricingValue(pricing.estimatorCalibration.church);
  if (!pricing.churchDiscount.enabled.value) {
    assert.equal(church.price.discount, null);
    assert.equal(church.price.perVisit, Math.round(church.price.cleaningSubtotal * factor * 100) / 100);
    return;
  }
  const percent = pricing.churchDiscount.percent.value / 100;
  assert.equal(church.price.discount?.applied, true);
  assert.equal(church.price.discount?.amount, Math.round(church.price.cleaningSubtotal * percent * 100) / 100);
  assert.ok(
    church.price.perVisit < Math.round(church.price.cleaningSubtotal * factor * 100) / 100,
    'the church discount reduces the calibrated price',
  );
  // The discounted amount is NOT rounded upward again; the exact percent survives.
  const expected = Math.round((church.price.cleaningSubtotal * (1 - percent) * factor + Number.EPSILON) * 100) / 100;
  assert.equal(church.price.perVisit, expected);
  assert.ok(church.price.total >= church.price.perVisit);
});

test('specialty scopes route to a custom scope review without a price', () => {
  const input = { cleanableSqft: 2000, restroomFixtures: 4, breakroom: false, specialty: true };
  const workload = calculateFacilityWorkload(input);
  const price = calculateFacilityPrice(workload, 'weekly');
  assert.equal(price.tier, 'C');
  assert.equal(price.priced, false);
});
