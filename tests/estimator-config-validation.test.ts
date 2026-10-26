// Owner configuration validation. Values are deliberately changed in cloned
// objects; current production values are never mutated or asserted.

import assert from 'node:assert/strict';
import test from 'node:test';

import { ownerPricing, type OwnerPricingConfig } from '../src/config/estimators/pricing-values.ts';
import { travelConfig } from '../src/config/estimators/travel.ts';
import { commercialTierConfig } from '../src/config/estimators/commercial.ts';
import {
  assertValidEstimatorConfiguration,
  formatEstimatorConfigIssues,
  validateEstimatorConfiguration,
} from '../src/config/estimators/validation.ts';

const cloneOwner = (): OwnerPricingConfig => structuredClone(ownerPricing);

test('the current owner configuration passes hard validation', () => {
  const result = validateEstimatorConfiguration();
  assert.equal(result.valid, true, formatEstimatorConfigIssues(result.errors));
  assert.equal(result.errors.length, 0);
  assert.doesNotThrow(() => assertValidEstimatorConfiguration());
});

test('an out-of-range calibration factor is rejected with its variable name', () => {
  const owner = cloneOwner();
  owner.estimatorCalibration.commercial = 1.75;
  const result = validateEstimatorConfiguration({ ownerPricing: owner });
  assert.equal(result.valid, false);
  const error = result.errors.find((entry) => entry.path === 'estimatorCalibration.commercial');
  assert.ok(error);
  assert.match(error.message, /between 0\.50 and 1\.50/i);
  assert.match(error.message, /1\.75/);
  assert.throws(() => assertValidEstimatorConfiguration({ ownerPricing: owner }), /Commercial calibration factor/i);
});

test('missing and invalid required numeric values are rejected', () => {
  const owner = cloneOwner();
  (owner.hourlyRates as { recurring: number }).recurring = Number.NaN;
  (owner as unknown as Record<string, unknown>).minimumJob = '125';
  const result = validateEstimatorConfiguration({ ownerPricing: owner });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.path === 'hourlyRates.recurring'));
  assert.ok(result.errors.some((entry) => entry.path === 'minimumJob'));
});

test('range ordering and commercial tier ordering are hard errors', () => {
  const owner = cloneOwner();
  owner.range.lowFactor = 1.2;
  owner.range.highFactor = 0.9;
  owner.commercialPricing.tierAHours = 8;
  owner.commercialPricing.tierBHours = 3;
  const result = validateEstimatorConfiguration({ ownerPricing: owner });
  assert.ok(result.errors.some((entry) => entry.path === 'range.highFactor'));
  assert.ok(result.errors.some((entry) => entry.path === 'commercialPricing.tierBHours'));
});

test('duplicate add-on ids and invalid add-on pricing are rejected', () => {
  const owner = cloneOwner();
  owner.addons[1]!.id = owner.addons[0]!.id;
  const result = validateEstimatorConfiguration({ ownerPricing: owner });
  assert.ok(result.errors.some((entry) => entry.path === 'addons[1].id' && /Duplicate/.test(entry.message)));

  const invalidAddon = cloneOwner();
  invalidAddon.addons.push({
    id: 'invalid_addon',
    label: 'Invalid add-on',
    blurb: 'Should fail validation.',
    customQuote: false,
    category: 'kitchen',
  });
  const invalidResult = validateEstimatorConfiguration({ ownerPricing: invalidAddon });
  assert.ok(invalidResult.errors.some((entry) => /positive labor hours or a positive fixed price/i.test(entry.message)));
});

test('travel values and dependencies are validated', () => {
  const result = validateEstimatorConfiguration({
    travel: { ...travelConfig, mpg: 0, includedOneWayMiles: -1 },
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.path === 'travelConfig.mpg'));
  assert.ok(result.errors.some((entry) => entry.path === 'travelConfig.includedOneWayMiles'));
});

test('a lower rate remains valid but produces an actionable business warning', () => {
  const owner = cloneOwner();
  owner.hourlyRates.recurring = 37;
  owner.hourlyRates.otherServices = 55;
  owner.hourlyRates.ownerLaborTarget = 35;
  const result = validateEstimatorConfiguration({ ownerPricing: owner });
  assert.equal(result.valid, true, formatEstimatorConfigIssues(result.errors));
  assert.ok(result.warnings.some((entry) => entry.path === 'hourlyRates.ownerLaborTarget'));
});

test('owner values are not rewritten by validation', () => {
  const owner = cloneOwner();
  owner.estimatorCalibration.church = 1.25;
  const before = JSON.stringify(owner);
  validateEstimatorConfiguration({ ownerPricing: owner });
  assert.equal(JSON.stringify(owner), before);
  assert.equal(owner.estimatorCalibration.church, 1.25);
});

test('the commercial tier configuration is validated independently', () => {
  const result = validateEstimatorConfiguration({
    commercial: { ...commercialTierConfig, tierA_maxCleanableSqft: 9000, tierB_maxCleanableSqft: 1000 },
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.path === 'commercialTierConfig.tierB_maxCleanableSqft'));
});
