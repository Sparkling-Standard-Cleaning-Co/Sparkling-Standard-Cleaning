import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUsableLatLng, parseLatLng, resolveRoute } from '../src/lib/travel/server-routing.ts';

test('a provider-verified zero-distance route stays verified', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ routes: [{ distance: 0, duration: 0 }] }), { status: 200 })) as typeof fetch;
  try {
    const route = await resolveRoute({ ROUTES_PROVIDER: 'mapmap', ROUTES_API_KEY: 'test', MAPMAP_BASE: 'https://example.invalid' }, { lat: 30.5, lng: -87.3 }, { lat: 30.5, lng: -87.3 });
    assert.equal(route.verified, true);
    assert.equal(route.method, 'route');
    assert.equal(route.oneWayMiles, 0);
    assert.equal(route.durationMinutes, 0);
  } finally {
    globalThis.fetch = original;
  }
});


test('the missing-coordinate sentinel is never a usable destination', () => {
  assert.equal(isUsableLatLng(null), false);
  assert.equal(isUsableLatLng({ lat: 0, lng: 0 }), false);
  assert.equal(isUsableLatLng({ lat: Number.NaN, lng: -87.2 }), false);
  assert.equal(isUsableLatLng({ lat: 30.68, lng: -87.19 }), true);
  assert.equal(parseLatLng('0,0'), null);
  assert.equal(parseLatLng('30.68,-87.19')?.lat, 30.68);
});

test('resolveRoute refuses invalid coordinates instead of fabricating mileage', async () => {
  await assert.rejects(
    () => resolveRoute({}, { lat: 30.5, lng: -87.3 }, { lat: 0, lng: 0 }),
    /invalid_route_coordinates/,
  );
});
