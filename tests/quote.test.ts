// Instant quote tests — deterministic single-price selection derived from the
// existing estimate engine, with margin safeguards and display references.
//
// The production feature flag (pricing.instantQuote.enabled) is false; these
// tests exercise the selection logic that owner approval will enable.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { calculateEstimate, type EstimateContext } from '../src/lib/estimate/calculate.ts';
import { buildInstantQuote, createQuoteReference, isQuoteValid, selectInstantAmount } from '../src/lib/estimate/quote.ts';
import { pricing } from '../src/config/pricing.ts';
import type { EstimateInput } from '../src/lib/estimate/types.ts';

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

test('the instant feature is disabled by default pending owner approval', () => {
  assert.equal(pricing.instantQuote.enabled.value, false);
});

test('an eligible home receives one deterministic price', () => {
  const result = calculateEstimate(input(), context);
  const first = selectInstantAmount(result);
  const second = selectInstantAmount(result);
  assert.equal(result.status, 'estimated');
  assert.ok(first !== null && first > 0);
  assert.equal(first, second, 'selection is deterministic');
  assert.equal((first as number) % pricing.rounding.toNearest.value, 0, 'rounded to the configured step');
});

test('the offered price is never below the model price (margin safeguard)', () => {
  const result = calculateEstimate(input(), context);
  const amount = selectInstantAmount(result);
  assert.ok(amount !== null && result.expectedPrice !== null);
  assert.ok(amount >= result.expectedPrice, 'never below expected price');
});

test('the offered price is never the lowest range value', () => {
  const result = calculateEstimate(input(), context);
  const amount = selectInstantAmount(result);
  assert.ok(amount !== null && result.low !== null);
  assert.ok(amount > result.low, 'must not simply reuse the low end of the range');
});

test('weekly and biweekly recurring homes get distinct quotes', () => {
  const weekly = selectInstantAmount(calculateEstimate(input({ frequency: 'weekly' }), context));
  const biweekly = selectInstantAmount(calculateEstimate(input({ frequency: 'biweekly' }), context));
  assert.ok(weekly !== null && biweekly !== null);
  assert.ok(weekly < biweekly, 'weekly maintenance is the most efficient per visit');
});

test('a first clean quotes above a maintained one-time clean', () => {
  const maintained = selectInstantAmount(calculateEstimate(input(), context));
  const firstClean = selectInstantAmount(
    calculateEstimate(input({ lastClean: 'never_professional' }), context),
  );
  assert.ok(maintained !== null && firstClean !== null);
  assert.ok(firstClean > maintained);
});

test('travel adjustments appear in the quoted total', () => {
  const core = selectInstantAmount(calculateEstimate(input({ zip: '32503' }), context));
  const surrounding = selectInstantAmount(calculateEstimate(input({ zip: '32571' }), context));
  assert.ok(core !== null && surrounding !== null);
  assert.ok(surrounding > core, 'surrounding-zone travel is included');
});

test('extras increase the quoted price', () => {
  const base = selectInstantAmount(calculateEstimate(input(), context));
  const withExtras = selectInstantAmount(
    calculateEstimate(input({ addonIds: ['inside_oven', 'inside_fridge', 'laundry'] }), context),
  );
  assert.ok(base !== null && withExtras !== null);
  assert.ok(withExtras > base);
});

test('jobs requiring custom confirmation never produce an instant price', () => {
  const severe = calculateEstimate(input({ condition: 'severe' }), context);
  assert.equal(selectInstantAmount(severe), null);
  const giant = calculateEstimate(input({ squareFeet: 6000 }), context);
  assert.equal(selectInstantAmount(giant), null);
  const customAddon = calculateEstimate(input({ addonIds: ['carpet_cleaning'] }), context);
  assert.equal(selectInstantAmount(customAddon), null);
});

test('tiny jobs respect the minimum, rounded up to the configured step', () => {
  const tiny = calculateEstimate(input({ squareFeet: 300, bedrooms: 0, fullBaths: 1 }), context);
  const amount = selectInstantAmount(tiny);
  assert.ok(amount !== null);
  assert.ok(amount >= pricing.minimumJob.value);
  assert.equal(amount % pricing.rounding.toNearest.value, 0);
});

test('quote references are well-formed, deterministic per minute and non-sensitive', () => {
  const at = Date.UTC(2026, 9, 1, 12, 0, 0);
  const a = createQuoteReference({ amount: 255, serviceType: 'standard', zip: '32503', timestamp: at });
  const b = createQuoteReference({ amount: 255, serviceType: 'standard', zip: '32503', timestamp: at + 30_000 });
  const c = createQuoteReference({ amount: 260, serviceType: 'standard', zip: '32503', timestamp: at });
  assert.match(a, /^SS-\d{8}-[0-9A-Z]{6}$/);
  assert.equal(a, b, 'stable within the same minute');
  assert.notEqual(a, c, 'changes with the amount');
  assert.ok(!a.includes('32503') && !a.includes('255'), 'contains no customer information');
});

test('quote expiration follows the configured validity window', () => {
  const now = Date.UTC(2026, 9, 1, 12, 0, 0);
  const quote = buildInstantQuote(calculateEstimate(input(), context), { serviceType: 'standard', zip: '32503' }, now);
  assert.ok(quote !== null);
  assert.equal(isQuoteValid(now, now), true);
  assert.equal(isQuoteValid(now, now + pricing.instantQuote.validityHours.value * 3_600_000), true);
  assert.equal(isQuoteValid(now, now + pricing.instantQuote.validityHours.value * 3_600_000 + 1), false);
  assert.ok(new Date(quote.expiresAt).getTime() > now);
});
