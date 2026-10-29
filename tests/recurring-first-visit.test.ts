// P12 recurring restructure tests — a new recurring residential arrangement
// (standard service + recurring frequency) is quoted as its required
// FIRST VISIT Deep Cleaning, with the ongoing per-visit rhythm summarized
// alongside. The SPARKLE100 welcome campaign reconciles against exactly one
// surface: the first visit.
//
// Run with: npm test  (Node's built-in test runner + TypeScript type stripping)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { calculateEstimate, type EstimateContext } from '../src/lib/estimate/calculate.ts';
import { selectInstantAmount } from '../src/lib/estimate/quote.ts';
import { pricing } from '../src/config/pricing.ts';
import type { EstimateInput } from '../src/lib/estimate/types.ts';

function context(promotions?: EstimateContext['promotions']): EstimateContext {
  return {
    travel: {
      includedOneWayMiles: 15,
      mpg: 24,
      wearPerMile: 0.12,
      referenceGasPrice: 3.1,
      zoneAdjustments: { core: 0, surrounding: 15 },
      maxInstantDistanceMiles: 45,
    },
    ...(promotions ? { promotions } : {}),
  };
}

const CLAIMED: EstimateContext['promotions'] = {
  claimedCampaignCode: 'SPARKLE100',
};

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

test('a claimed weekly arrangement discounts the first visit by exactly $100 — never the ongoing rhythm', () => {
  const claimed = calculateEstimate(input({ frequency: 'weekly' }), context(CLAIMED));
  const unclaimed = calculateEstimate(input({ frequency: 'weekly' }), context());

  assert.equal(claimed.status, 'estimated');
  assert.equal(unclaimed.status, 'estimated');
  assert.ok(claimed.ongoing && unclaimed.ongoing);

  // The discount lands on the first-visit Deep Cleaning only.
  assert.equal(claimed.pricing.discount?.source, 'campaign');
  assert.equal(claimed.pricing.discount?.amount, 100);
  assert.equal(claimed.ongoing.pricing.discount, null, 'the ongoing rhythm is never discounted');
  assert.equal(unclaimed.pricing.discount, null);

  // Exact savings after the $5 round-up step: a $100 shift on the $5 grid
  // preserves the ceil rounding, so the offered prices differ by exactly $100.
  const claimedTotal = selectInstantAmount(claimed);
  const unclaimedTotal = selectInstantAmount(unclaimed);
  assert.ok(claimedTotal !== null && unclaimedTotal !== null);
  assert.equal(unclaimedTotal - claimedTotal, 100, 'the claimed first visit is exactly $100 lower');

  // The ongoing rhythm is identical with and without the claim.
  assert.equal(claimed.ongoing.perVisitPrice, unclaimed.ongoing.perVisitPrice);

  // The requirement flag still tells the customer what the first visit is.
  assert.ok(claimed.flags.some((flag) => flag.code === 'INITIAL_DEEP_CLEAN_REQUIRED'));
});

test('a monthly arrangement receives the campaign and prices the deep first visit', () => {
  const monthly = calculateEstimate(input({ frequency: 'monthly' }), context(CLAIMED));
  assert.equal(monthly.status, 'estimated');
  assert.ok(monthly.ongoing);
  assert.equal(monthly.ongoing.frequency, 'monthly');
  assert.equal(monthly.pricing.discount?.amount, 100);
  assert.equal(monthly.ongoing.pricing.discount, null);
  // And the first visit is still the required Deep Cleaning.
  const oneTimeStandard = calculateEstimate(input({ frequency: 'one_time' }), context());
  assert.ok((monthly.laborHours ?? 0) > (oneTimeStandard.laborHours ?? 0));
});

test('a one-time standard clean is never restructured and never carries an ongoing summary', () => {
  const result = calculateEstimate(input({ frequency: 'one_time' }), context(CLAIMED));
  assert.equal(result.status, 'estimated');
  assert.equal(result.ongoing, undefined);
  assert.equal(result.pricing.discount, null, 'one-time work is outside the campaign terms');
  assert.ok(!result.flags.some((flag) => flag.code === 'INITIAL_DEEP_CLEAN_REQUIRED'));
});

test('a recurring request needing custom confirmation prices nothing and summarizes nothing', () => {
  const severe = calculateEstimate(input({ frequency: 'weekly', condition: 'severe' }), context(CLAIMED));
  assert.equal(severe.status, 'custom_confirmation_required');
  assert.equal(severe.expectedPrice, null);
  assert.equal(severe.ongoing, undefined);
  assert.equal(selectInstantAmount(severe), null);
});

test('deep cleaning is a one-time product; a claimed weekly deep request fails closed', () => {
  // Service-matrix update (owner-directed estimator audit, 2026-10-23):
  // recurring deep work is not a bookable product — the recurring
  // residential service (with its required deep first visit) covers it.
  const deep = calculateEstimate(input({ serviceType: 'deep', frequency: 'weekly' }), context(CLAIMED));
  assert.equal(deep.status, 'invalid', 'deep + weekly is not a valid product');
});

test('the merged first-visit result reconciles with an independent deep one-time computation', () => {
  const weekly = calculateEstimate(input({ frequency: 'weekly' }), context());
  const deepOneTime = calculateEstimate(
    input({ serviceType: 'deep', frequency: 'one_time' }),
    context(),
  );
  assert.equal(weekly.status, 'estimated');
  assert.equal(deepOneTime.status, 'estimated');
  // Same scope, rate, labor and price — only the labeling differs.
  assert.equal(weekly.laborHours, deepOneTime.laborHours);
  assert.equal(weekly.expectedPrice, deepOneTime.expectedPrice);
  assert.equal(weekly.pricing.pricingCategory, 'other_services');
  assert.equal(weekly.pricing.basePrice, deepOneTime.pricing.basePrice);
  assert.equal(selectInstantAmount(weekly), selectInstantAmount(deepOneTime));
});

test('the ongoing per-visit price honors the minimum job and the round-up step', () => {
  const tiny = calculateEstimate(
    input({
      squareFeet: 200,
      bedrooms: 0,
      fullBaths: 0,
      propertyType: 'apartment',
      frequency: 'weekly',
    }),
    context(),
  );
  assert.ok(tiny.ongoing);
  assert.ok(tiny.ongoing.perVisitPrice >= pricing.minimumJob.value);
  assert.equal(tiny.ongoing.perVisitPrice % pricing.rounding.toNearest.value, 0);
  assert.ok(tiny.ongoing.perVisitPrice <= (selectInstantAmount(tiny) ?? Number.POSITIVE_INFINITY));
});
