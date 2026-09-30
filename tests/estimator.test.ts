// Estimator unit tests (directive §82).
// Run with: npm test  (Node's built-in test runner + TypeScript type stripping)
//
// These tests encode the business anchors from the owner's directive:
//  - maintained 3/2 ≈ 4.5–5.0 labor-hours
//  - first clean of a similar home ≈ 6 labor-hours
//  - recurring frequency reduces labor, not with stacked fake discounts
//  - the estimator fails safely for bad input and never returns nonsense.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { calculateEstimate, type EstimateContext } from '../src/lib/estimate/calculate.ts';
import type { EstimateInput } from '../src/lib/estimate/types.ts';

function context(overrides: Partial<EstimateContext['travel']> = {}): EstimateContext {
  return {
    travel: {
      includedOneWayMiles: 15,
      mpg: 24,
      wearPerMile: 0.12,
      referenceGasPrice: 3.1,
      zoneAdjustments: { core: 0, surrounding: 15 },
      maxInstantDistanceMiles: 45,
      ...overrides,
    },
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

// ── Anchors ──────────────────────────────────────────────────────────────────

test('maintained 3/2 standard clean matches the 4.5–5.0 labor-hour anchor', () => {
  const result = calculateEstimate(input(), context());
  assert.equal(result.status, 'estimated');
  assert.ok(result.laborHours !== null);
  assert.ok(result.laborHours >= 4.5 && result.laborHours <= 5.0, `labor was ${result.laborHours}`);
});

test('first professional clean of a similar 3/2 lands near the 6 labor-hour anchor', () => {
  const result = calculateEstimate(input({ lastClean: 'never_professional' }), context());
  assert.equal(result.status, 'estimated');
  assert.ok(result.laborHours !== null);
  assert.ok(result.laborHours >= 5.5 && result.laborHours <= 6.3, `labor was ${result.laborHours}`);
});

// ── Frequencies ──────────────────────────────────────────────────────────────

test('weekly recurring takes less labor than biweekly for the same home', () => {
  const weekly = calculateEstimate(input({ frequency: 'weekly' }), context());
  const biweekly = calculateEstimate(input({ frequency: 'biweekly' }), context());
  assert.equal(weekly.status, 'estimated');
  assert.equal(biweekly.status, 'estimated');
  assert.ok((weekly.laborHours ?? 0) < (biweekly.laborHours ?? 0));
});

test('monthly recurring costs more per visit than weekly but less than one-time', () => {
  const weekly = calculateEstimate(input({ frequency: 'weekly' }), context());
  const monthly = calculateEstimate(input({ frequency: 'monthly' }), context());
  const oneTime = calculateEstimate(input({ frequency: 'one_time' }), context());
  assert.ok((weekly.expectedPrice ?? 0) <= (monthly.expectedPrice ?? 0));
  assert.ok((monthly.expectedPrice ?? 0) <= (oneTime.expectedPrice ?? 0));
});

test('recurring request for a long-neglected home flags an initial detailed clean', () => {
  const result = calculateEstimate(
    input({ frequency: 'biweekly', lastClean: 'never_professional', condition: 'average' }),
    context(),
  );
  assert.equal(result.status, 'estimated');
  assert.ok(result.flags.some((flag) => flag.code === 'INITIAL_DETAILED_CLEAN_SUGGESTED'));
});

// ── Service types ────────────────────────────────────────────────────────────

test('deep cleaning produces an estimate with more labor than standard', () => {
  const standard = calculateEstimate(input(), context());
  const deep = calculateEstimate(input({ serviceType: 'deep' }), context());
  assert.equal(deep.status, 'estimated');
  assert.ok((deep.laborHours ?? 0) > (standard.laborHours ?? 0));
});

test('move-out cleaning produces a valid estimate', () => {
  const result = calculateEstimate(
    input({ serviceType: 'move_in_out', propertyType: 'apartment', squareFeet: 900, bedrooms: 2 }),
    context(),
  );
  assert.equal(result.status, 'estimated');
  assert.ok((result.low ?? 0) >= 125);
});

test('STR turnover uses the bed/bath model', () => {
  const small = calculateEstimate(
    input({
      serviceType: 'str_turnover',
      propertyType: 'condo',
      squareFeet: 900,
      bedrooms: 2,
      fullBaths: 2,
      beds: 2,
      lastClean: 'within_month',
    }),
    context(),
  );
  const large = calculateEstimate(
    input({
      serviceType: 'str_turnover',
      propertyType: 'house',
      squareFeet: 2200,
      bedrooms: 4,
      fullBaths: 3,
      beds: 5,
      lastClean: 'within_month',
    }),
    context(),
  );
  assert.equal(small.status, 'estimated');
  assert.equal(large.status, 'estimated');
  assert.ok((large.laborHours ?? 0) > (small.laborHours ?? 0));
});

// ── Add-ons ──────────────────────────────────────────────────────────────────

test('add-ons increase labor by their configured hours', () => {
  const base = calculateEstimate(input(), context());
  const withAddons = calculateEstimate(input({ addonIds: ['inside_oven', 'inside_fridge'] }), context());
  assert.equal(withAddons.status, 'estimated');
  const delta = (withAddons.laborHours ?? 0) - (base.laborHours ?? 0);
  assert.ok(Math.abs(delta - 1.1) < 0.001, `delta was ${delta}`);
});

test('specialty add-ons always require custom confirmation', () => {
  const result = calculateEstimate(input({ addonIds: ['carpet_cleaning'] }), context());
  assert.equal(result.status, 'custom_confirmation_required');
  assert.ok(result.flags.some((flag) => flag.code === 'CUSTOM_CONFIRMATION_REQUIRED'));
});

// ── Minimums and rounding ────────────────────────────────────────────────────

test('the minimum job value is applied to tiny jobs', () => {
  const result = calculateEstimate(
    input({ squareFeet: 200, bedrooms: 0, fullBaths: 0, propertyType: 'apartment' }),
    context(),
  );
  assert.equal(result.status, 'estimated');
  assert.equal(result.minimumApplied, true);
  assert.equal(result.low, 125);
});

test('estimated ranges are rounded to $5 and high is never below low', () => {
  const result = calculateEstimate(input(), context());
  assert.equal(result.status, 'estimated');
  assert.equal((result.low ?? 0) % 5, 0);
  assert.equal((result.high ?? 0) % 5, 0);
  assert.ok((result.high ?? 0) >= (result.low ?? 0));
  assert.ok((result.low ?? 0) >= 125);
});

// ── Travel ───────────────────────────────────────────────────────────────────

test('core-area jobs have no travel adjustment', () => {
  const result = calculateEstimate(input(), context());
  assert.equal(result.status, 'estimated');
  assert.equal(result.travel.adjustment, 0);
});

test('surrounding-area jobs carry the configured travel adjustment', () => {
  const result = calculateEstimate(input({ zip: '32571' }), context());
  assert.equal(result.status, 'estimated');
  assert.equal(result.travel.zone, 'surrounding');
  assert.equal(result.travel.adjustment, 15);
});

test('Alabama extended territory requires manual confirmation instead of fake precision', () => {
  const result = calculateEstimate(input({ zip: '36502' }), context());
  assert.equal(result.status, 'custom_confirmation_required');
  assert.equal(result.low, null);
  assert.equal(result.travel.zone, 'extended');
});

test('ZIPs outside the service area fail safely to manual confirmation', () => {
  const result = calculateEstimate(input({ zip: '90210' }), context());
  assert.equal(result.status, 'custom_confirmation_required');
  assert.equal(result.low, null);
  assert.equal(result.travel.zone, 'outside');
});

test('routed distance beyond the instant-estimate range requires confirmation', () => {
  const result = calculateEstimate(
    input({ zip: '32561' }),
    context({
      routed: { oneWayMiles: 60, gasPrice: 3.1, gasPriceSource: 'eia_live', provider: 'test' },
    }),
  );
  assert.equal(result.status, 'custom_confirmation_required');
  assert.ok(result.travel.oneWayMiles === 60);
});

test('routed distance within range prices travel from fuel + wear', () => {
  const result = calculateEstimate(
    input(),
    context({ routed: { oneWayMiles: 25, gasPrice: 3.0, gasPriceSource: 'eia_live', provider: 'test' } }),
  );
  assert.equal(result.status, 'estimated');
  // extra one-way = 10 mi; round trip = 20 mi; fuel = 20/24*3 = 2.5; wear = 20*0.12 = 2.4
  assert.equal(result.travel.adjustment, 4.9);
  assert.equal(result.travel.gasPriceSource, 'eia_live');
});

test('missing gas API falls back to the reference price without failing the quote', () => {
  const result = calculateEstimate(
    input(),
    context({ routed: { oneWayMiles: 25, gasPrice: null, gasPriceSource: 'none', provider: 'test' } }),
  );
  assert.equal(result.status, 'estimated');
  assert.equal(result.travel.gasPriceSource, 'configured_reference');
  assert.equal(result.travel.gasPricePerGallon, 3.1);
});

test('routing unavailable (zone mode) still estimates in the core area', () => {
  const result = calculateEstimate(input(), context());
  assert.equal(result.status, 'estimated');
  assert.equal(result.travel.mode, 'zone');
});

// ── Thresholds ───────────────────────────────────────────────────────────────

test('homes over the square-footage threshold require custom confirmation', () => {
  const result = calculateEstimate(input({ squareFeet: 5200, bedrooms: 5, fullBaths: 4 }), context());
  assert.equal(result.status, 'custom_confirmation_required');
});

test('extreme (severe) condition requires custom confirmation', () => {
  const result = calculateEstimate(input({ condition: 'severe' }), context());
  assert.equal(result.status, 'custom_confirmation_required');
  assert.equal(result.expectedPrice, null);
});

test('giant homes never produce an instant number', () => {
  const result = calculateEstimate(
    input({ squareFeet: 9000, bedrooms: 8, fullBaths: 6 }),
    context(),
  );
  assert.equal(result.status, 'custom_confirmation_required');
  assert.equal(result.low, null);
  assert.equal(result.high, null);
});

// ── Malformed input ──────────────────────────────────────────────────────────

test('null input returns invalid with no numbers', () => {
  const result = calculateEstimate(null, context());
  assert.equal(result.status, 'invalid');
  assert.equal(result.low, null);
  assert.equal(result.high, null);
  assert.ok((result.issues ?? []).length > 0);
});

test('garbage strings and negative numbers never produce a negative price', () => {
  const result = calculateEstimate(
    input({ squareFeet: -500 as number, bedrooms: -3 as number, fullBaths: Number.NaN as number }),
    context(),
  );
  // Negative square footage is clamped to the minimum, NaN baths become 0.
  if (result.status === 'estimated') {
    assert.ok((result.low ?? 0) > 0);
    assert.ok((result.high ?? 0) >= (result.low ?? 0));
  } else {
    assert.equal(result.status, 'invalid');
  }
});

test('an unrecognized ZIP is treated as outside and never instant-priced', () => {
  const result = calculateEstimate(input({ zip: 'not-a-zip' }), context());
  assert.equal(result.status, 'invalid');
  assert.ok((result.issues ?? []).some((issue) => issue.includes('ZIP')));
});

test('the result never exposes trace values as prices', () => {
  const result = calculateEstimate(input(), context());
  assert.equal(result.status, 'estimated');
  for (const step of result.trace) {
    assert.ok(typeof step.step === 'string');
    assert.ok(!('low' in step) && !('high' in step));
  }
});
