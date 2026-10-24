// Service/frequency compatibility matrix tests (owner-directed estimator
// audit, 2026-10-23). The selected service determines which questions exist;
// invalid combinations are REJECTED by the shared validator — never silently
// repriced or relabeled.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { calculateEstimate, type EstimateContext } from '../src/lib/estimate/calculate.ts';
import { validateEstimateInput } from '../src/lib/estimate/validation.ts';
import {
  SERVICE_FREQUENCIES,
  ONE_TIME_SERVICES,
  serviceAsksFrequency,
  serviceSupportsFrequency,
} from '../src/lib/estimate/service-matrix.ts';
import type { EstimateInput, Frequency, ServiceType } from '../src/lib/estimate/types.ts';

const ALL_FREQUENCIES: Frequency[] = ['weekly', 'biweekly', 'monthly', 'one_time'];
const ALL_SERVICES: ServiceType[] = ['standard', 'deep', 'move_in_out', 'str_turnover'];

// ── The matrix itself ────────────────────────────────────────────────────────

test('the service/frequency matrix matches the real product offerings', () => {
  assert.deepEqual([...SERVICE_FREQUENCIES.standard], ['one_time', 'weekly', 'biweekly', 'monthly']);
  for (const service of ONE_TIME_SERVICES) {
    assert.deepEqual([...SERVICE_FREQUENCIES[service]], ['one_time'], `${service} is one-time only`);
  }
});

test('only residential house cleaning is asked for a rhythm', () => {
  assert.equal(serviceAsksFrequency('standard'), true);
  for (const service of ONE_TIME_SERVICES) {
    assert.equal(serviceAsksFrequency(service), false, `${service} never shows the frequency question`);
  }
});

test('every service/frequency combination resolves consistently', () => {
  for (const service of ALL_SERVICES) {
    for (const frequency of ALL_FREQUENCIES) {
      assert.equal(
        serviceSupportsFrequency(service, frequency),
        SERVICE_FREQUENCIES[service].includes(frequency),
        `${service} + ${frequency}`,
      );
    }
  }
});

// ── Shared validation rejects invalid combinations ──────────────────────────

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

test('the owner scenario: move-in/move-out with a weekly rhythm is REJECTED', () => {
  const result = validateEstimateInput(input({ serviceType: 'move_in_out', frequency: 'weekly' }));
  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => /one-time service/i.test(issue)),
    'the rejection explains that the service is one-time',
    JSON.stringify(result.issues),
  );
});

test('every invalid service/frequency pair fails validation; every valid pair passes', () => {
  for (const service of ALL_SERVICES) {
    for (const frequency of ALL_FREQUENCIES) {
      const draft = input({
        serviceType: service,
        frequency,
        // STR turnovers genuinely need the bed count.
        ...(service === 'str_turnover' ? { beds: 2 } : {}),
      });
      const result = validateEstimateInput(draft);
      assert.equal(
        result.ok,
        serviceSupportsFrequency(service, frequency),
        `${service} + ${frequency} should ${result.ok ? 'not have passed' : 'have passed'}`,
      );
    }
  }
});

test('a missing frequency safely defaults to one_time for every service', () => {
  for (const service of ALL_SERVICES) {
    const draft = input({
      serviceType: service,
      ...(service === 'str_turnover' ? { beds: 2 } : {}),
    });
    delete draft.frequency;
    const result = validateEstimateInput(draft);
    assert.equal(result.ok, true, `${service} with no frequency is valid`);
    assert.equal(result.ok && result.input.frequency, 'one_time');
  }
});

// ── Calculation end-to-end: one-time services price as one-time ────────────

function context(): EstimateContext {
  return {
    travel: {
      includedOneWayMiles: 17.5,
      mpg: 24,
      wearPerMile: 0.12,
      referenceGasPrice: 3.1,
      zoneAdjustments: { core: 0, surrounding: 15 },
      maxInstantDistanceMiles: 45,
    },
  };
}

test('a move-in/move-out estimate is a one-time scope with no ongoing summary', () => {
  const result = calculateEstimate(
    input({ serviceType: 'move_in_out', frequency: 'one_time' }),
    context(),
  );
  assert.equal(result.status, 'estimated');
  assert.equal(result.ongoing, undefined, 'no recurring rhythm is quoted for a move');
  assert.ok(!result.flags.some((flag) => flag.code === 'INITIAL_DEEP_CLEAN_REQUIRED'));
  const baseTrace = result.trace.find((entry) => entry.step === 'labor:base');
  assert.equal(baseTrace?.detail, 'move_in_out base', 'the labor model prices the move scope');
});

test('a deep cleaning estimate is one-time; recurring deep work is not a bookable product', () => {
  const oneTime = calculateEstimate(input({ serviceType: 'deep', frequency: 'one_time' }), context());
  assert.equal(oneTime.status, 'estimated');
  assert.equal(oneTime.ongoing, undefined);
  assert.ok(validateEstimateInput(input({ serviceType: 'deep', frequency: 'weekly' })).ok === false);
});

test('an STR turnover estimate is one-time (per-turnover); the beds field drives the labor', () => {
  const result = calculateEstimate(
    input({ serviceType: 'str_turnover', frequency: 'one_time', beds: 4 }),
    context(),
  );
  assert.equal(result.status, 'estimated');
  assert.equal(result.ongoing, undefined);
  const baseTrace = result.trace.find((entry) => entry.step === 'labor:str_base');
  assert.ok(baseTrace, 'the STR labor model prices the turnover');
});

test('recurring residential keeps the full rhythm matrix and the two-price structure', () => {
  for (const frequency of ['weekly', 'biweekly', 'monthly'] as const) {
    const result = calculateEstimate(input({ frequency }), context());
    assert.equal(result.status, 'estimated');
    assert.ok(result.ongoing, `a new ${frequency} arrangement carries the ongoing summary`);
    assert.ok(result.flags.some((flag) => flag.code === 'INITIAL_DEEP_CLEAN_REQUIRED'));
  }
});
