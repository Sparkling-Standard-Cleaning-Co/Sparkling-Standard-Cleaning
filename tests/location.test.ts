// Customer location helpers — coordinate validation, display formatting and
// geocoder query building. Pure functions; no browser or network required.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGeocodeQuery,
  formatLocationLine,
  houseNumberFromStreet,
  isPlausibleCoordinate,
  labelHasHouseNumber,
  locationKey,
  streetLineFromLabel,
  US_STATES,
  zipFromLabel,
  type ConfirmedLocation,
} from '../src/lib/location/location.ts';

const base: ConfirmedLocation = {
  label: '100 S BAYLEN ST, PENSACOLA, FL, 32502',
  street: '100 S Baylen St',
  unit: '4B',
  lat: 30.4111,
  lng: -87.2164,
  zip: '32502',
  city: 'Pensacola',
  state: 'FL',
  source: 'census',
  confirmedAt: '2026-10-01T12:00:00.000Z',
};

test('coordinates are validated before they are ever used', () => {
  assert.equal(isPlausibleCoordinate(30.4111, -87.2164), true);
  assert.equal(isPlausibleCoordinate(-90, 180), true);
  assert.equal(isPlausibleCoordinate(90.01, -87), false);
  assert.equal(isPlausibleCoordinate(30, -180.1), false);
  assert.equal(isPlausibleCoordinate(Number.NaN, -87), false);
  assert.equal(isPlausibleCoordinate('30', -87), false);
  assert.equal(isPlausibleCoordinate(undefined, undefined), false);
});

test('location keys are stable at ~11 m precision and distinguish nearby pins', () => {
  assert.equal(locationKey(30.41111, -87.21644), locationKey(30.41112, -87.21643));
  assert.notEqual(locationKey(30.4111, -87.2164), locationKey(30.4211, -87.2164));
});

test('ZIP extraction works for provider and Census labels', () => {
  assert.equal(zipFromLabel('100 S Baylen St, Pensacola, FL 32502'), '32502');
  assert.equal(zipFromLabel('100 S BAYLEN ST, PENSACOLA, FL, 32502-1234'), '32502');
  assert.equal(zipFromLabel('Pensacola, FL'), null);
  assert.equal(zipFromLabel(undefined), null);
});

test('the display line combines street, unit and region without duplicates', () => {
  assert.equal(
    formatLocationLine(base),
    '100 S Baylen St, Unit 4B · Pensacola, FL 32502',
  );
  const zipOnly: ConfirmedLocation = { ...base, unit: undefined, city: undefined, state: undefined };
  delete zipOnly.unit;
  delete zipOnly.city;
  delete zipOnly.state;
  assert.equal(formatLocationLine(zipOnly), '100 S Baylen St · 32502');
});

test('provider labels are reduced to the street line without repeating the region', () => {
  assert.equal(streetLineFromLabel('100 S Baylen St, Pensacola, FL 32502', 'Pensacola', 'FL', '32502'), '100 S Baylen St');
  assert.equal(
    streetLineFromLabel('100 S BAYLEN ST, PENSACOLA, FL, 32502', 'PENSACOLA', 'FL', '32502'),
    '100 S BAYLEN ST',
  );
  assert.equal(streetLineFromLabel('100 S Baylen St', undefined, undefined, undefined), '100 S Baylen St');
});

test('manual geocoder queries join street, unit, city, state and ZIP', () => {
  assert.equal(
    buildGeocodeQuery('6360 Haupert Ln', undefined, 'Molino', 'FL', '32577'),
    '6360 Haupert Ln, Molino, FL, 32577',
  );
  assert.equal(
    buildGeocodeQuery('100 S Baylen St', '4B', 'Pensacola', 'FL', '32502'),
    '100 S Baylen St 4B, Pensacola, FL, 32502',
  );
  assert.equal(buildGeocodeQuery('100 S Baylen St', undefined, undefined, 'FL', '32502'), '100 S Baylen St, FL, 32502');
  assert.equal(buildGeocodeQuery('100 S Baylen St', '', '', '', ''), '100 S Baylen St');
});

test('house-number helpers distinguish exact addresses from street-level results', () => {
  assert.equal(houseNumberFromStreet('6360 Haupert Ln'), '6360');
  assert.equal(houseNumberFromStreet('12A Palm Ave'), '12a');
  assert.equal(houseNumberFromStreet('Haupert Lane'), null);
  assert.equal(houseNumberFromStreet(''), null);

  assert.equal(labelHasHouseNumber('6360 HAUPERT LN, MOLINO, FL, 32577', '6360'), true);
  assert.equal(labelHasHouseNumber('Haupert Lane, Molino, Florida, 32577', '6360'), false);
  assert.equal(labelHasHouseNumber('Haupert Lane, Molino, Florida, 32577', null), true);
});

test('the state selector includes Florida and Alabama first', () => {
  assert.equal(US_STATES[0].code, 'FL');
  assert.equal(US_STATES[1].code, 'AL');
  assert.ok(US_STATES.some((state) => state.name === 'Florida'));
  assert.ok(US_STATES.some((state) => state.name === 'Alabama'));
  assert.equal(new Set(US_STATES.map((state) => state.code)).size, US_STATES.length, 'no duplicate states');
});
