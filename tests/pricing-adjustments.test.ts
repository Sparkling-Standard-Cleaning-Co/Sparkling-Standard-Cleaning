// Initiative 6.4 pricing rules: four engine calibration factors, Community Support discount,
// exact church reconciliation and tax transparency.

import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateEstimate, type EstimateContext } from '../src/lib/estimate/calculate.ts';
import { selectInstantAmount } from '../src/lib/estimate/quote.ts';
import {
  calculateChurchEstimate,
  calculateFacilityPrice,
  calculateFacilityWorkload,
} from '../src/lib/estimate/commercial.ts';
import { taxPresentationForService } from '../src/lib/estimate/tax.ts';
import { formatUsd } from '../src/lib/format.ts';
import { pricing, resolveEstimatorCalibration } from '../src/config/pricing.ts';
import { ownerPricing } from '../src/config/estimators/pricing-values.ts';
import type { EstimateInput } from '../src/lib/estimate/types.ts';

function context(overrides: Partial<EstimateContext> = {}): EstimateContext {
  return {
    travel: {
      includedOneWayMiles: 15,
      mpg: 24,
      wearPerMile: 0.12,
      referenceGasPrice: 3.1,
      zoneAdjustments: { core: 0, surrounding: 15 },
      maxInstantDistanceMiles: 45,
      ...overrides.travel,
    },
    ...(overrides.globalFactorOverride !== undefined
      ? { globalFactorOverride: overrides.globalFactorOverride }
      : {}),
    ...(overrides.promotions ? { promotions: overrides.promotions } : {}),
  };
}

function input(overrides: Partial<EstimateInput> = {}): EstimateInput {
  return {
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
    ...overrides,
  };
}

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

function baseRounded(result: ReturnType<typeof calculateEstimate>): number {
  return round2(result.pricing.basePrice + result.pricing.extrasSubtotal + result.pricing.roundingAdjustment);
}

test('four independent owner calibration factors are configured and validated', () => {
  assert.deepEqual(ownerPricing.estimatorCalibration, {
    residential: 1,
    str: 1,
    commercial: 1,
    church: 1,
  });
  for (const engine of ['residential', 'str', 'commercial', 'church'] as const) {
    assert.equal(pricing.estimatorCalibration[engine].value, ownerPricing.estimatorCalibration[engine]);
    assert.equal(resolveEstimatorCalibration(engine), 1);
  }
  assert.equal(resolveEstimatorCalibration('commercial', 1.1), 1.1);
  assert.equal(resolveEstimatorCalibration('church', 0.9), 0.9);
  assert.equal(resolveEstimatorCalibration('residential', Number.NaN), 1, 'nonfinite fails closed');
  assert.equal(resolveEstimatorCalibration('str', 0.49), 1, 'below supported range fails closed');
  assert.equal(resolveEstimatorCalibration('commercial', 1.51), 1, 'above supported range fails closed');
  assert.equal(resolveEstimatorCalibration('church', 0), 1, 'zero fails closed');
});

test('each calibration key is independent and reads only its own engine value', () => {
  const original = {
    residential: pricing.estimatorCalibration.residential.value,
    str: pricing.estimatorCalibration.str.value,
    commercial: pricing.estimatorCalibration.commercial.value,
    church: pricing.estimatorCalibration.church.value,
  };
  try {
    pricing.estimatorCalibration.residential.value = 1.03;
    pricing.estimatorCalibration.str.value = 0.97;
    pricing.estimatorCalibration.commercial.value = 1.08;
    pricing.estimatorCalibration.church.value = 0.92;
    assert.equal(resolveEstimatorCalibration('residential'), 1.03);
    assert.equal(resolveEstimatorCalibration('str'), 0.97);
    assert.equal(resolveEstimatorCalibration('commercial'), 1.08);
    assert.equal(resolveEstimatorCalibration('church'), 0.92);
    assert.equal(resolveEstimatorCalibration('commercial', 1.25), 1.25, 'test override remains explicit');
    assert.equal(resolveEstimatorCalibration('church', 0.85), 0.85, 'test override remains explicit');
  } finally {
    pricing.estimatorCalibration.residential.value = original.residential;
    pricing.estimatorCalibration.str.value = original.str;
    pricing.estimatorCalibration.commercial.value = original.commercial;
    pricing.estimatorCalibration.church.value = original.church;
  }
});

test('residential totals scale exactly at 0.85, 0.90, 1.00, 1.10 and 1.25', () => {
  const baseline = calculateEstimate(input(), context());
  const base = baseRounded(baseline);
  const travel = baseline.pricing.travelAdjustment;

  for (const factor of [0.85, 0.9, 1.0, 1.1, 1.25]) {
    const result = calculateEstimate(input(), context({ globalFactorOverride: factor }));
    assert.equal(result.status, 'estimated');
    assert.equal(result.pricing.globalFactor, factor);
    assert.equal(result.pricing.subtotal, round2(base * factor + travel));
    assert.equal(selectInstantAmount(result), result.pricing.subtotal);
    assert.equal(
      round2(
        result.pricing.basePrice +
          result.pricing.extrasSubtotal +
          result.pricing.roundingAdjustment +
          result.pricing.globalAdjustment +
          result.pricing.travelAdjustment,
      ),
      result.pricing.subtotal,
      'the displayed lines reconcile',
    );
  }
});

test('Community Support eligibility applies exactly 10% and never requires sensitive details', () => {
  const base = calculateEstimate(input(), context());
  const eligible = calculateEstimate(input({ supportiveEligible: true }), context());
  const ineligible = calculateEstimate(input({ supportiveEligible: false }), context());
  assert.equal(ineligible.pricing.discount, null);
  assert.equal(eligible.pricing.discount?.id, 'supportive-home');
  assert.equal(eligible.pricing.discount?.source, 'supportive');
  assert.equal(eligible.pricing.discount?.percent, 0.1);
  assert.equal(eligible.pricing.discount?.amount, round2(baseRounded(base) * 0.1));
  assert.equal(
    eligible.pricing.subtotal,
    round2(baseRounded(base) * 0.9 + base.pricing.travelAdjustment),
  );
});

test('a Community Support discount is not erased by the minimum job', () => {
  const tiny = calculateEstimate(
    input({ squareFeet: 200, bedrooms: 0, fullBaths: 0, propertyType: 'apartment', supportiveEligible: true }),
    context(),
  );
  assert.equal(tiny.status, 'estimated');
  assert.equal(tiny.pricing.basePrice + tiny.pricing.extrasSubtotal + tiny.pricing.roundingAdjustment, 125);
  assert.equal(tiny.pricing.discount?.amount, 12.5);
  assert.equal(tiny.pricing.subtotal, 112.5);
  assert.equal(selectInstantAmount(tiny), 112.5, 'the benefit is not re-floored');
});

test('Community Support never applies to STR and never stacks with SPARKLE100', () => {
  const str = calculateEstimate(
    input({ serviceType: 'str_turnover', propertyType: 'condo', squareFeet: 900, bedrooms: 2, fullBaths: 1, supportiveEligible: true }),
    context(),
  );
  assert.equal(str.pricing.discount, null);

  const claimed = calculateEstimate(
    input({ frequency: 'weekly', supportiveEligible: true }),
    context({ promotions: { claimedCampaignCode: 'SPARKLE100' } }),
  );
  assert.equal(claimed.pricing.discount?.source, 'campaign', 'the larger single discount wins');
  assert.equal(claimed.pricing.discount?.amount, 100);
});

test('commercial Tier A/B and church totals apply the engine calibration factor exactly', () => {
  const tierAWorkload = calculateFacilityWorkload({
    cleanableSqft: 2000,
    restroomFixtures: 6,
    breakroom: false,
    facilityType: 'office',
  });
  for (const factor of [0.85, 0.9, 1.0, 1.1, 1.25]) {
    const price = calculateFacilityPrice(tierAWorkload, 'weekly', { globalFactorOverride: factor });
    assert.equal(price.priced, true);
    assert.equal(price.globalFactor, factor);
    assert.equal(price.perVisit, round2(price.cleaningSubtotal * factor));
    assert.equal(price.total, round2(price.perVisit + price.travelAdjustment));
  }

  const tierBWorkload = calculateFacilityWorkload({
    cleanableSqft: 6000,
    restroomFixtures: 10,
    breakroom: true,
    facilityType: 'office',
  });
  const tierB = calculateFacilityPrice(tierBWorkload, 'weekly', { globalFactorOverride: 0.9 });
  assert.equal(tierB.tier, 'B');
  assert.ok(tierB.range);
  assert.equal(tierB.range?.low, round2(tierB.total * 0.85));
  assert.equal(tierB.range?.high, round2(tierB.total * 1.15));

  const church = calculateChurchEstimate({
    cleanableSqft: 4000,
    restroomFixtures: 6,
    breakroom: true,
    frequency: 'weekly',
    globalFactorOverride: 0.9,
  });
  assert.equal(church.price.discount?.amount, round2(church.price.cleaningSubtotal * 0.1));
  assert.equal(church.price.perVisit, round2(church.price.cleaningSubtotal * 0.9 * 0.9));
});

test('Tier C never fabricates a price even with the engine calibration factor', () => {
  const workload = calculateFacilityWorkload({
    cleanableSqft: 30000,
    restroomFixtures: 24,
    breakroom: true,
    facilityType: 'office',
  });
  const price = calculateFacilityPrice(workload, 'weekly', { globalFactorOverride: 0.9 });
  assert.equal(price.tier, 'C');
  assert.equal(price.priced, false);
});

test('tax presentation is explicit, category-specific and never invents a rate', () => {
  const residential = taxPresentationForService('standard');
  assert.equal(residential.treatment, 'not_taxable');
  assert.match(residential.label, /No sales tax applicable/);

  const str = taxPresentationForService('str_turnover');
  assert.equal(str.treatment, 'not_taxable');
  assert.match(str.note, /host/i);

  const commercial = taxPresentationForService('commercial_cleaning');
  assert.equal(commercial.treatment, 'taxable_pending');
  assert.match(commercial.label, /applicable tax/);
  assert.match(commercial.note, /6% state sales tax/);
  assert.doesNotMatch(commercial.label, /\d+\.\d+%/);

  const church = taxPresentationForService('church_cleaning');
  assert.equal(church.treatment, 'exemption_pending');
  assert.match(church.label, /unless exempt/);
  assert.match(church.note, /DR-14/);

  const unknown = taxPresentationForService('something_else');
  assert.equal(unknown.treatment, 'unknown');
  assert.match(unknown.label, /applicable tax/);
});

test('currency formatting always shows two decimals for fractional amounts', () => {
  assert.equal(formatUsd(145), '$145');
  assert.equal(formatUsd(145, { forceCents: true }), '$145.00');
  assert.equal(formatUsd(14.5), '$14.50');
  assert.equal(formatUsd(130.5, { forceCents: true }), '$130.50');
  assert.equal(formatUsd(null), '—');
});
