// Driving-time policy tests — minutes decide eligibility when a routed duration
// exists; the provisional ZIP zone is only a fallback. Mocked route data keeps
// these tests independent of any third-party API.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { calculateEstimate, type EstimateContext } from '../src/lib/estimate/calculate.ts';
import type { EstimateInput } from '../src/lib/estimate/types.ts';

function context(routed?: EstimateContext['travel']['routed'], overrides: Partial<EstimateContext['travel']> = {}) {
  return {
    travel: {
      ...(routed ? { routed } : {}),
      includedOneWayMiles: 15,
      mpg: 24,
      wearPerMile: 0.12,
      referenceGasPrice: 3.1,
      zoneAdjustments: { core: 0, surrounding: 15 },
      maxInstantDistanceMiles: 45,
      ...overrides,
    },
  } satisfies EstimateContext;
}

const routed = (durationMinutes: number | null, oneWayMiles = 20) => ({
  oneWayMiles,
  durationMinutes,
  gasPrice: 3.1,
  gasPriceSource: 'configured_reference' as const,
  provider: 'mock',
});

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

test('routed duration inside the boundary is an ordinary estimate', () => {
  const result = calculateEstimate(input(), context(routed(30)));
  assert.equal(result.status, 'estimated');
  assert.equal(result.travel.drivingTimeStatus, 'within');
  assert.equal(result.travel.requiresManualConfirmation, false);
  assert.equal(result.travel.durationMinutes, 30);
});

test('routed duration at the boundary (60 min) still qualifies', () => {
  const result = calculateEstimate(input(), context(routed(60)));
  assert.equal(result.status, 'estimated');
  assert.equal(result.travel.drivingTimeStatus, 'within');
});

test('routed duration inside the review band requires personal confirmation', () => {
  const result = calculateEstimate(input(), context(routed(65)));
  assert.equal(result.status, 'custom_confirmation_required');
  assert.equal(result.travel.drivingTimeStatus, 'review_band');
  assert.equal(result.travel.requiresManualConfirmation, true);
  assert.match(result.travel.reason ?? '', /just beyond/i);
});

test('routed duration beyond the band routes to manual confirmation honestly', () => {
  const result = calculateEstimate(input(), context(routed(90)));
  assert.equal(result.status, 'custom_confirmation_required');
  assert.equal(result.travel.drivingTimeStatus, 'beyond');
  assert.match(result.travel.reason ?? '', /send a request/i);
});

test('an Alabama (extended) ZIP qualifies when the routed duration is inside the policy', () => {
  const result = calculateEstimate(input({ zip: '36502' }), context(routed(40)));
  assert.equal(result.status, 'estimated');
  assert.equal(result.travel.drivingTimeStatus, 'within');
});

test('an outside-zone ZIP qualifies when routed inside the policy too', () => {
  const result = calculateEstimate(input({ zip: '30301' }), context(routed(45)));
  assert.equal(result.status, 'estimated');
});

test('without routed data the zone policy still applies (extended stays manual)', () => {
  const result = calculateEstimate(input({ zip: '36502' }), context());
  assert.equal(result.status, 'custom_confirmation_required');
  assert.equal(result.travel.drivingTimeStatus, undefined);
});

test('a routed trip without duration keeps the hard distance safety cap', () => {
  const result = calculateEstimate(input(), context(routed(null, 60)));
  assert.equal(result.status, 'custom_confirmation_required');
  assert.equal(result.travel.requiresManualConfirmation, true);
});

test('policy values can be overridden by context (owner tuning)', () => {
  const result = calculateEstimate(input(), context(routed(33), { maxDrivingMinutes: 30, reviewBandMinutes: 5 }));
  assert.equal(result.status, 'custom_confirmation_required');
  assert.equal(result.travel.drivingTimeStatus, 'review_band');
});

// ── Preliminary vs verified travel ───────────────────────────────────────────

test('a live provider route is marked verified travel', () => {
  const result = calculateEstimate(
    input(),
    context({
      oneWayMiles: 24,
      durationMinutes: 28,
      gasPrice: 3.1,
      gasPriceSource: 'configured_reference',
      provider: 'mapmap',
      method: 'route',
      verified: true,
    }),
  );
  assert.equal(result.status, 'estimated');
  assert.equal(result.travel.method, 'route');
  assert.equal(result.travel.verified, true);
});

test('a straight-line route estimate is explicitly preliminary', () => {
  const result = calculateEstimate(
    input(),
    context({
      oneWayMiles: 24,
      durationMinutes: null,
      gasPrice: 3.1,
      gasPriceSource: 'configured_reference',
      provider: 'straight_line',
      method: 'straight_line_estimate',
      verified: false,
    }),
  );
  assert.equal(result.status, 'estimated');
  assert.equal(result.travel.method, 'straight_line_estimate');
  assert.equal(result.travel.verified, false);
});

test('offline zone mode is never presented as verified travel', () => {
  const result = calculateEstimate(input(), context());
  assert.equal(result.travel.method, 'zone');
  assert.equal(result.travel.verified, false);
});
