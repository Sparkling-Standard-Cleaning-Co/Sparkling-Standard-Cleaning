// Facility calibration matrix: coverage, exact church arithmetic, Tier C
// behavior, engine calibration factor interaction and browser/server-compatible outputs.
// These are hypothetical scenarios, never presented as completed jobs.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHURCH_SCENARIOS,
  COMMERCIAL_SCENARIOS,
  runAllCalibration,
  runFacilityCalibration,
} from '../src/lib/estimate/calibration.ts';
import { pricing } from '../src/config/pricing.ts';

const { commercial, church } = runAllCalibration();

test('the matrix has at least 25 commercial and 20 church scenarios with unique ids', () => {
  assert.ok(COMMERCIAL_SCENARIOS.length >= 25);
  assert.ok(CHURCH_SCENARIOS.length >= 20);
  const ids = [...COMMERCIAL_SCENARIOS, ...CHURCH_SCENARIOS].map((scenario) => scenario.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('commercial coverage includes sizes, fixtures, conditions, floors, schedules and travel', () => {
  const types = new Set(COMMERCIAL_SCENARIOS.map((scenario) => scenario.facilityType));
  for (const type of ['office', 'retail', 'salon', 'gym', 'community']) assert.ok(types.has(type), type);
  assert.ok(new Set(COMMERCIAL_SCENARIOS.map((scenario) => scenario.sqft)).size >= 10);
  assert.ok(COMMERCIAL_SCENARIOS.some((scenario) => scenario.fixtures >= 18));
  assert.ok(COMMERCIAL_SCENARIOS.some((scenario) => scenario.condition === 'heavy'));
  assert.ok(COMMERCIAL_SCENARIOS.some((scenario) => scenario.flooring === 'carpet'));
  assert.ok(COMMERCIAL_SCENARIOS.some((scenario) => scenario.flooring === 'hard'));
  assert.ok(COMMERCIAL_SCENARIOS.some((scenario) => scenario.frequency === 'monthly'));
  assert.ok(COMMERCIAL_SCENARIOS.some((scenario) => scenario.visitsPerWeek > 1));
  assert.ok(COMMERCIAL_SCENARIOS.some((scenario) => scenario.oneWayMiles));
});

test('church coverage includes sanctuaries, classrooms, nurseries, kitchens, offices and buildings', () => {
  assert.ok(CHURCH_SCENARIOS.some((scenario) => scenario.sqft <= 2500));
  assert.ok(CHURCH_SCENARIOS.some((scenario) => scenario.sqft >= 15000));
  assert.ok(CHURCH_SCENARIOS.some((scenario) => scenario.fixtures >= 22));
  assert.ok(CHURCH_SCENARIOS.some((scenario) => scenario.breakroom));
  assert.ok(CHURCH_SCENARIOS.some((scenario) => scenario.frequency === 'monthly'));
  assert.ok(CHURCH_SCENARIOS.some((scenario) => scenario.visitsPerWeek > 1));
  assert.ok(CHURCH_SCENARIOS.some((scenario) => scenario.oneWayMiles));
});

test('every church row reconciles the exact 10% discount and cents', () => {
  for (const row of church) {
    if (row.discount > 0) {
      assert.equal(row.discount, Math.round((row.cleaningSubtotal * 0.1 + Number.EPSILON) * 100) / 100, row.id);
    }
    assert.doesNotMatch(row.reconciliation, /ERROR/, row.id);
    if (row.serviceRevenue !== null) {
      assert.equal(row.serviceRevenue + row.travelCharge, row.totalPerVisit, row.id);
    }
  }
});

test('Tier C/specialty rows are honest custom reviews, not negative-profit prices', () => {
  for (const row of [...commercial, ...church].filter((entry) => entry.tier === 'C' || entry.specialty)) {
    assert.equal(row.customerEstimate, 'Custom scope review', row.id);
    assert.equal(row.serviceRevenue, null, row.id);
    assert.equal(row.overhead, null, row.id);
    assert.equal(row.operatingProfit, null, row.id);
    assert.match(row.uncertainty, /walkthrough|scope review/i, row.id);
  }
});

test('ordinary Tier A/B rows are numeric, profitable and carry effective units', () => {
  const numeric = [...commercial, ...church].filter((row) => row.tier !== 'C' && !row.specialty);
  assert.ok(numeric.length > 0);
  for (const row of numeric) {
    assert.ok(row.serviceRevenue !== null && row.serviceRevenue > 0, row.id);
    assert.ok(row.totalPerVisit > 0, row.id);
    assert.ok(row.operatingProfit !== null && row.operatingProfit > 0, row.id);
    assert.ok(row.effectivePerSqftPerVisit !== null && row.effectivePerSqftPerVisit > 0, row.id);
    assert.ok(row.monthlyEquivalent !== null && row.monthlyEquivalent >= row.totalPerVisit * 0.99, row.id);
  }
});

test('the engine calibration factor scales the service subtotal without changing the discount', () => {
  const base = runFacilityCalibration(
    CHURCH_SCENARIOS.find((scenario) => scenario.id === 'h04')!,
  );
  const lower = runFacilityCalibration(
    CHURCH_SCENARIOS.find((scenario) => scenario.id === 'h04')!,
    { globalFactor: 0.9 },
  );
  const higher = runFacilityCalibration(
    CHURCH_SCENARIOS.find((scenario) => scenario.id === 'h04')!,
    { globalFactor: 1.1 },
  );
  assert.equal(lower.discount, base.discount);
  assert.equal(higher.discount, base.discount);
  assert.ok(lower.serviceRevenue !== null && base.serviceRevenue !== null && lower.serviceRevenue < base.serviceRevenue);
  assert.ok(higher.serviceRevenue !== null && higher.serviceRevenue > base.serviceRevenue);
  assert.equal(higher.globalAdjustment > 0, true);
  assert.equal(lower.globalAdjustment < 0, true);
});

test('minimum-floor jobs and travel are identified explicitly', () => {
  assert.ok(
    commercial.some((row) => row.cleaningSubtotal === pricing.minimumJob.value && row.serviceRevenue !== null),
  );
  const travel = commercial.find((row) => row.id === 'c25');
  assert.ok(travel && travel.travelCharge > 0);
  assert.ok(travel.serviceRevenue !== null);
  assert.equal(travel.totalPerVisit, Math.round((travel.serviceRevenue + travel.travelCharge) * 100) / 100);
});
