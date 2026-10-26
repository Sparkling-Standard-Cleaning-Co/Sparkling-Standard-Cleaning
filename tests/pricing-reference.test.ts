// Fixed-reference arithmetic test.
//
// This suite temporarily installs explicit, controlled pricing values and
// restores them afterwards. It does not read the owner's current numbers; it
// proves the calculation formulas themselves with known inputs and outputs.
// Current-configuration integration tests live in the other pricing suites.

import assert from 'node:assert/strict';
import test from 'node:test';

import { pricing } from '../src/config/pricing.ts';
import { calculateEstimate, type EstimateContext } from '../src/lib/estimate/calculate.ts';
import { selectInstantAmount } from '../src/lib/estimate/quote.ts';
import type { EstimateInput } from '../src/lib/estimate/types.ts';

function collectConfigValues(node: unknown, found: Array<{ value: unknown }> = []) {
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if ('value' in record && 'state' in record && 'note' in record) {
      found.push(record as { value: unknown });
      return found;
    }
    for (const value of Object.values(record)) collectConfigValues(value, found);
  }
  return found;
}

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

const input: EstimateInput = {
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
};

function installFixture(): () => void {
  const wrappers = collectConfigValues(pricing);
  const original = wrappers.map((entry) => entry.value);
  try {
    pricing.laborEconomics.targetGrossRevenuePerLaborHour.value = 50;
    pricing.laborEconomics.recurringGrossRevenuePerLaborHour.value = 50;
    pricing.laborEconomics.ownerLaborTargetPerHour.value = 20;
    pricing.minimumJob.value = 100;
    pricing.estimatorCalibration.residential.value = 1;
    pricing.estimatorCalibration.str.value = 1;
    pricing.estimatorCalibration.commercial.value = 1;
    pricing.estimatorCalibration.church.value = 1;
    pricing.laborModel.baseHours.standard.value = 2;
    pricing.laborModel.sqftHoursPerThousand.value = 1;
    pricing.laborModel.fullBathHours.value = 0.5;
    pricing.laborModel.halfBathHours.value = 0.25;
    pricing.laborModel.bedroomHours.value = 0.1;
    pricing.laborModel.bedroomsIncludedInBase.value = 2;
    pricing.conditionFactors.maintained.value = 1;
    pricing.lastCleanFactors.within_month.value = 1;
    pricing.frequencyFactors.one_time.value = 1;
    pricing.range.lowFactor.value = 0.9;
    pricing.range.highFactor.value = 1.1;
    pricing.rounding.toNearest.value = 5;
    pricing.instantQuote.selection.value = 'expected';
    pricing.instantQuote.marginFloor.value = 1;
  } catch (error) {
    for (let index = wrappers.length - 1; index >= 0; index -= 1) {
      wrappers[index]!.value = original[index];
    }
    throw error;
  }
  return () => {
    for (let index = wrappers.length - 1; index >= 0; index -= 1) {
      wrappers[index]!.value = original[index];
    }
  };
}

test('fixed reference: 4.70 labor-hours at $50 with a $100 minimum is $235', () => {
  const restore = installFixture();
  try {
    const result = calculateEstimate(input, context);
    assert.equal(result.status, 'estimated');
    assert.ok(Math.abs((result.laborHours ?? 0) - 4.7) < 1e-9);
    assert.equal(result.pricing.basePrice, 235);
    assert.equal(result.pricing.subtotal, 235);
    assert.equal(selectInstantAmount(result), 235);
  } finally {
    restore();
  }
});

test('fixed reference: a 1.10 calibration factor turns $235 into $258.50', () => {
  const restore = installFixture();
  try {
    const result = calculateEstimate(input, { ...context, globalFactorOverride: 1.1 });
    assert.equal(result.pricing.subtotal, 258.5);
    assert.equal(result.pricing.globalAdjustment, 23.5);
    assert.equal(selectInstantAmount(result), 258.5);
  } finally {
    restore();
  }
});

test('fixed reference: a 0.85 calibration factor turns $235 into $199.75', () => {
  const restore = installFixture();
  try {
    const result = calculateEstimate(input, { ...context, globalFactorOverride: 0.85 });
    assert.equal(result.pricing.subtotal, 199.75);
    assert.equal(result.pricing.globalAdjustment, -35.25);
  } finally {
    restore();
  }
});
