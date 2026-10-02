// Configuration validation tests.
//
// These guard the owner-editable configuration files (src/config/pricing.ts,
// src/config/geography.ts) against invalid settings — a typo in a factor, a
// duplicate add-on id, or an out-of-bounds zone entry fails here before it can
// reach a customer. Pricing VALUES are not asserted (the owner may change them
// deliberately); only their structural sanity is.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pricing, pricingValue, type ConfigValue } from '../src/config/pricing.ts';
import { zipReference, zonePolicy, normalizeZip } from '../src/config/geography.ts';
import { travelConfig } from '../src/config/travel.ts';

function collectConfigValues(node: unknown, found: ConfigValue<unknown>[] = []): ConfigValue<unknown>[] {
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if ('value' in record && 'state' in record && 'note' in record) {
      found.push(record as unknown as ConfigValue<unknown>);
      return found;
    }
    for (const value of Object.values(record)) collectConfigValues(value, found);
  }
  return found;
}

test('every pricing value declares a valid approval state with a note', () => {
  const values = collectConfigValues(pricing);
  assert.ok(values.length > 20, `expected many config values, found ${values.length}`);
  for (const entry of values) {
    assert.ok(['provisional', 'approved'].includes(entry.state), `bad state: ${entry.state}`);
    assert.ok(typeof entry.note === 'string' && entry.note.length > 5, 'every value needs a note');
  }
});

test('owner labor target stays below both approved Option C rates', () => {
  const owner = pricingValue(pricing.laborEconomics.ownerLaborTargetPerHour);
  const other = pricingValue(pricing.laborEconomics.targetGrossRevenuePerLaborHour);
  const recurring = pricingValue(pricing.laborEconomics.recurringGrossRevenuePerLaborHour);
  assert.ok(owner < other, 'owner target must be below the other-services rate');
  assert.ok(owner < recurring, 'owner target must be below the recurring rate');
  assert.ok(recurring <= other, 'recurring maintenance rate must not exceed the other-services rate');
  // Option C values are owner-approved (2026-10-01).
  assert.equal(pricing.laborEconomics.targetGrossRevenuePerLaborHour.state, 'approved');
  assert.equal(pricing.laborEconomics.recurringGrossRevenuePerLaborHour.state, 'approved');
});

test('condition factors are ordered and at least 1', () => {
  const factors = Object.values(pricing.conditionFactors).map((entry) => pricingValue(entry));
  for (const factor of factors) assert.ok(factor >= 1, `condition factor below 1: ${factor}`);
  for (let index = 1; index < factors.length; index += 1) {
    assert.ok(factors[index] > factors[index - 1], 'condition factors must strictly increase');
  }
});

test('frequency factors stay within (0, 1]', () => {
  for (const entry of Object.values(pricing.frequencyFactors)) {
    const factor = pricingValue(entry);
    assert.ok(factor > 0 && factor <= 1, `frequency factor out of range: ${factor}`);
  }
});

test('last-clean factors are at least 1 and bounded', () => {
  for (const entry of Object.values(pricing.lastCleanFactors)) {
    const factor = pricingValue(entry);
    assert.ok(factor >= 1 && factor <= 1.5, `last-clean factor out of range: ${factor}`);
  }
});

test('estimate range spreads bracket 1.0 and rounding is positive', () => {
  assert.ok(pricingValue(pricing.range.lowFactor) < 1);
  assert.ok(pricingValue(pricing.range.highFactor) > 1);
  assert.ok(pricingValue(pricing.rounding.toNearest) > 0);
});

test('minimum job value is positive', () => {
  assert.ok(pricingValue(pricing.minimumJob) > 0);
});

test('add-on ids are unique snake_case and definitions are complete', () => {
  const ids = pricing.addons.items.map((addon) => addon.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate add-on id');
  for (const addon of pricing.addons.items) {
    assert.match(addon.id, /^[a-z][a-z0-9_]*$/, `bad add-on id: ${addon.id}`);
    assert.ok(addon.label.length > 2, `add-on ${addon.id} needs a label`);
    assert.ok(addon.blurb.length > 5, `add-on ${addon.id} needs a description`);
    assert.ok(addon.category.length > 2, `add-on ${addon.id} needs a category`);
    if (addon.customQuote) {
      assert.equal(addon.price, undefined, `custom-quote add-on ${addon.id} must not carry a price`);
    } else {
      assert.ok((addon.laborHours ?? 0) > 0, `add-on ${addon.id} needs labor hours`);
    }
  }
});

test('provisional prices and rates are not published by default', () => {
  assert.equal(pricing.publication.publishHourlyRates, false);
  assert.equal(pricing.publication.publishAddonPrices, false);
  assert.equal(pricing.publication.publishMinimumJob, false);
  assert.equal(pricing.addons.state, 'provisional');
});

test('travel economics are sane', () => {
  assert.ok(pricingValue(pricing.travel.clientDefaults.mpg) > 0);
  assert.ok(pricingValue(pricing.travel.clientDefaults.maxInstantDistanceMiles) > 0);
  assert.ok(pricingValue(pricing.travel.includedOneWayMiles) >= 0);
  assert.ok(pricingValue(pricing.travel.perMileWearCost) >= 0);
  assert.ok(pricingValue(pricing.travel.fallbackGasPrice) > 0);
});

test('every ZIP reference has a valid state, zone and plausible coordinates', () => {
  const validZones = ['core', 'surrounding', 'extended', 'outside', 'unknown'];
  for (const [zip, entry] of Object.entries(zipReference)) {
    assert.match(zip, /^\d{5}$/, `bad ZIP key: ${zip}`);
    assert.ok(['FL', 'AL'].includes(entry.state), `${zip} has state ${entry.state}`);
    assert.ok(validZones.includes(entry.zone), `${zip} has zone ${entry.zone}`);
    assert.ok(entry.lat > 29.5 && entry.lat < 31.6, `${zip} latitude out of range: ${entry.lat}`);
    assert.ok(entry.lng > -88.6 && entry.lng < -85.9, `${zip} longitude out of range: ${entry.lng}`);
  }
});

test('zone policy: instant zones estimate, manual zones explain themselves', () => {
  assert.equal(zonePolicy.core.instantEstimate, true);
  assert.equal(zonePolicy.surrounding.instantEstimate, true);
  for (const zone of ['extended', 'outside', 'unknown'] as const) {
    assert.equal(zonePolicy[zone].instantEstimate, false, `${zone} must not auto-estimate`);
    assert.ok(
      (zonePolicy[zone].manualReason ?? '').length > 10,
      `${zone} needs a customer-safe manual reason`,
    );
  }
});

test('driving policy and instant-quote settings are structurally valid', () => {
  assert.ok(pricingValue(pricing.drivingPolicy.maxDrivingMinutes) > 0);
  assert.ok(pricingValue(pricing.drivingPolicy.reviewBandMinutes) >= 0);
  assert.ok(['expected', 'midpoint', 'high'].includes(pricingValue(pricing.instantQuote.selection)));
  assert.ok(pricingValue(pricing.instantQuote.marginFloor) >= 1, 'margin floor must be at least 1');
  assert.ok(pricingValue(pricing.instantQuote.validityHours) > 0);
  // The proposed-price experience is owner-directed (2026-10-01); binding
  // customer offers remain OFF until the server verification path passes.
  assert.equal(pricingValue(pricing.instantQuote.enabled), true);
  assert.equal(pricingValue(pricing.instantQuote.binding), false);
  assert.ok(
    typeof pricingValue(pricing.instantQuote.configVersion) === 'string' &&
      pricingValue(pricing.instantQuote.configVersion).length > 5,
    'quotes must carry a configuration version',
  );
});

test('travel economics match the shared travel configuration', () => {
  assert.equal(pricingValue(pricing.travel.clientDefaults.mpg), travelConfig.mpg);
  assert.equal(pricingValue(pricing.travel.includedOneWayMiles), travelConfig.includedOneWayMiles);
  assert.equal(pricingValue(pricing.travel.perMileWearCost), travelConfig.wearPerMile);
  assert.equal(pricingValue(pricing.travel.fallbackGasPrice), travelConfig.fallbackGasPrice);
  assert.equal(pricingValue(pricing.drivingPolicy.maxDrivingMinutes), travelConfig.maxDrivingMinutes);
});

test('normalizeZip accepts ZIP+4 and rejects malformed input', () => {
  assert.equal(normalizeZip('32503-1234'), '32503');
  assert.equal(normalizeZip(' 32503 '), '32503');
  assert.equal(normalizeZip('325'), null);
  assert.equal(normalizeZip('abcde'), null);
  assert.equal(normalizeZip(undefined), null);
});
