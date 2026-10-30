// Legacy 10-level dirt-guide compatibility tests (the customer UI was restored
// to the original five conditions on 2026-10-30; historical values must keep
// parsing and pricing exactly as they did).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DIRT_LEVELS,
  conditionForDirtLevel,
  dirtLevelLabel,
  parseDirtLevel,
} from '../src/lib/estimate/dirt-levels.ts';
import { calculateEstimate, type EstimateContext } from '../src/lib/estimate/calculate.ts';
import { validateEstimateInput } from '../src/lib/estimate/validation.ts';
import { mapReservationFields } from '../src/lib/estimate/verify.ts';
import type { EstimateInput } from '../src/lib/estimate/types.ts';

function context(): EstimateContext {
  return {
    travel: {
      includedOneWayMiles: 15,
      mpg: 24,
      wearPerMile: 0.12,
      referenceGasPrice: 3.1,
      zoneAdjustments: { core: 0, surrounding: 15 },
      maxInstantDistanceMiles: 45,
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

test('the guide has ten sequential, plain-language levels mapped to the five condition tiers', () => {
  assert.equal(DIRT_LEVELS.length, 10);
  assert.deepEqual(
    DIRT_LEVELS.map((level) => level.level),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  assert.deepEqual(
    DIRT_LEVELS.map((level) => level.condition),
    [
      'maintained',
      'maintained',
      'average',
      'average',
      'needs_attention',
      'needs_attention',
      'heavy',
      'heavy',
      'heavy',
      'severe',
    ],
  );
  for (const level of DIRT_LEVELS) {
    assert.ok(level.label.length > 0);
    assert.ok(level.description.length > 20);
    assert.ok(level.impact.length > 0);
  }
});

test('submitted levels parse strictly and invalid values fail closed', () => {
  assert.equal(parseDirtLevel('1'), 1);
  assert.equal(parseDirtLevel(10), 10);
  assert.equal(parseDirtLevel(' 5 '), 5);
  for (const invalid of [0, 11, -1, 3.5, '3.5', 'heavy', '', null, undefined]) {
    assert.equal(parseDirtLevel(invalid), null);
  }
  assert.equal(conditionForDirtLevel(5), 'needs_attention');
  assert.equal(conditionForDirtLevel(null), null);
  assert.equal(dirtLevelLabel(9), 'Level 9 — Move-In/Out Level Dirty');
});

test('the restored five-condition input validates without a dirt level', () => {
  const validated = validateEstimateInput({
    ...input(),
    condition: 'needs_attention',
  });
  assert.equal(validated.ok, true);
  if (validated.ok) {
    assert.equal(validated.input.condition, 'needs_attention');
    assert.equal(validated.input.dirtLevel, undefined);
  }
});

test('the dirt level wins over a conflicting condition and invalid levels are rejected', () => {
  const validated = validateEstimateInput({
    ...input(),
    condition: 'maintained',
    dirtLevel: 5,
  });
  assert.equal(validated.ok, true);
  if (validated.ok) {
    assert.equal(validated.input.condition, 'needs_attention');
    assert.equal(validated.input.dirtLevel, 5);
  }

  const invalid = validateEstimateInput({
    ...input(),
    dirtLevel: 11 as EstimateInput['dirtLevel'],
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.ok(invalid.issues.some((issue) => issue.includes('dirt level')));
  }
});

test('higher dirt levels increase labor, and full restoration requires personal review', () => {
  const clean = calculateEstimate(input({ dirtLevel: 1 }), context());
  const heavy = calculateEstimate(input({ dirtLevel: 8 }), context());
  assert.equal(clean.status, 'estimated');
  assert.equal(heavy.status, 'estimated');
  assert.ok(clean.laborHours !== null && heavy.laborHours !== null);
  assert.ok(heavy.laborHours > clean.laborHours);

  const restoration = calculateEstimate(input({ dirtLevel: 10 }), context());
  assert.equal(restoration.status, 'custom_confirmation_required');
  assert.equal(restoration.expectedPrice, null);
});

test('the server mapping treats the submitted guide as authoritative over condition', () => {
  const fields = {
    service_type: 'standard',
    property_type: 'house',
    square_feet: '1600',
    bedrooms: '3',
    full_baths: '2',
    half_baths: '0',
    frequency: 'one_time',
    condition: 'maintained',
    dirt_level: '8',
    zip: '32503',
  };
  const mapped = mapReservationFields(fields);
  const validated = validateEstimateInput(mapped);
  assert.equal(validated.ok, true);
  if (validated.ok) {
    assert.equal(validated.input.dirtLevel, 8);
    assert.equal(validated.input.condition, 'heavy');
  }

  const forged = mapReservationFields({ ...fields, dirt_level: 'not-a-level' });
  const rejected = validateEstimateInput(forged);
  assert.equal(rejected.ok, false);
});