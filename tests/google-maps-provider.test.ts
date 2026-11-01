import { test } from 'node:test';
import assert from 'node:assert/strict';
import { googleAutocomplete, googlePlaceDetails } from '../src/lib/location/server-geocode.ts';
import { resolveRoute } from '../src/lib/travel/server-routing.ts';

const env = { GOOGLE_MAPS_SERVER_API_KEY: 'synthetic-google-key' };

test('Google Places autocomplete returns numbered predictions only', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    suggestions: [
      { placePrediction: { placeId: 'place-1', text: { text: '100 S Baylen St, Pensacola, FL 32502' }, structuredFormat: { mainText: { text: '100 S Baylen St' }, secondaryText: { text: 'Pensacola, FL' } } } },
      { placePrediction: { placeId: 'place-2', text: { text: 'Baylen Street, Pensacola, FL' }, structuredFormat: { mainText: { text: 'Baylen Street' }, secondaryText: { text: 'Pensacola, FL' } } } },
    ],
  }), { status: 200 })) as typeof fetch;
  try {
    const rows = await googleAutocomplete(env, '100 S Baylen St', 'session-token');
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.id, 'place-1');
    assert.equal(rows[0]?.kind, 'address');
    assert.equal(rows[1]?.kind, 'street');
  } finally { globalThis.fetch = original; }
});

test('Google Place Details preserves house number and rejects out-of-state results', async () => {
  const original = globalThis.fetch;
  let body = '{}';
  globalThis.fetch = (async () => new Response(body, { status: 200 })) as typeof fetch;
  const components = [
    { longText: '100', shortText: '100', types: ['street_number'] },
    { longText: 'South Baylen Street', shortText: 'S Baylen St', types: ['route'] },
    { longText: 'Pensacola', shortText: 'Pensacola', types: ['locality'] },
    { longText: 'Florida', shortText: 'FL', types: ['administrative_area_level_1'] },
    { longText: '32502', shortText: '32502', types: ['postal_code'] },
  ];
  try {
    body = JSON.stringify({ formattedAddress: '100 S Baylen St, Pensacola, FL 32502', addressComponents: components, location: { latitude: 30.4111, longitude: -87.2164 }, types: ['street_address'] });
    const result = await googlePlaceDetails(env, 'place-1', 'session-token');
    assert.equal(result?.precise, true);
    assert.equal(result?.state, 'FL');
    assert.equal(result?.zip, '32502');

    body = JSON.stringify({ formattedAddress: '1 Main St, Mobile, AL 36602', addressComponents: components.map((entry) => entry.types?.includes('administrative_area_level_1') ? { longText: 'Alabama', shortText: 'AL', types: entry.types } : entry), location: { latitude: 30.7, longitude: -88.0 }, types: ['street_address'] });
    const alabama = await googlePlaceDetails(env, 'place-2');
    assert.equal(alabama?.state, 'AL');
  } finally { globalThis.fetch = original; }
});

test('Google Routes drives the existing route representation without exposing the origin', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ routes: [{ distanceMeters: 16093.44, duration: '1200s' }] }), { status: 200 })) as typeof fetch;
  try {
    const route = await resolveRoute(
      { GOOGLE_MAPS_SERVER_API_KEY: 'synthetic-google-key', TRAVEL_ORIGIN: '30.5,-87.3' },
      { lat: 30.5, lng: -87.3 },
      { lat: 30.6, lng: -87.4 },
    );
    assert.equal(route.verified, true);
    assert.equal(route.provider, 'google');
    assert.equal(route.oneWayMiles, 10);
    assert.equal(route.durationMinutes, 20);
  } finally { globalThis.fetch = original; }
});
