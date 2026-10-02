// Geocode proxy tests — provider passthrough, Census fallback, validation and
// throttling. All network calls are mocked; no API key is needed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost as geocodePost, onRequestGet as geocodeGet } from '../functions/api/geocode.ts';

let ipCounter = 0;
function request(body: unknown, ip = `10.0.0.${++ipCounter}`): Request {
  return new Request('https://example.test/api/geocode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });
}

async function withFetch<T>(stub: (url: string | URL) => Promise<Response>, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL) => stub(input)) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const mapmapFeature = (overrides: Record<string, unknown> = {}) => ({
  properties: { label: '100 S Baylen St, Pensacola, FL 32502', id: 'us:123', ...overrides },
  geometry: { coordinates: [-87.2164, 30.4111] },
});

// ── Validation ───────────────────────────────────────────────────────────────

test('geocode: malformed JSON is rejected', async () => {
  const response = await geocodePost({
    request: new Request('https://example.test/api/geocode', { method: 'POST', body: 'nope' }),
    env: {},
  } as never);
  assert.equal(response.status, 400);
});

test('geocode: short queries are rejected before any provider call', async () => {
  const response = await geocodePost({ request: request({ action: 'suggest', query: 'ab' }), env: {} } as never);
  assert.equal(response.status, 400);
});

test('geocode: unknown actions are rejected', async () => {
  const response = await geocodePost({ request: request({ action: 'delete-everything' }), env: {} } as never);
  assert.equal(response.status, 400);
});

test('geocode: GET is method-not-allowed', async () => {
  assert.equal((await geocodeGet()).status, 405);
});

// ── Suggestions ──────────────────────────────────────────────────────────────

test('geocode suggest: without a provider key it reports not configured', async () => {
  const response = await geocodePost({
    request: request({ action: 'suggest', query: '100 S Baylen St' }),
    env: {},
  } as never);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, error: 'provider_not_configured' });
});

test('geocode suggest: maps provider suggestions (name/context/lat/lon) to plottable rows', async () => {
  const response = await withFetch(
    async (url) => {
      assert.match(String(url), /\/geocode\/suggest\?q=100%20S%20Baylen%20St/);
      assert.match(String(url), /bias=-87\.2169%2C30\.4213/, 'public service-area bias is applied');
      assert.doesNotMatch(String(url), /country=/, 'unsupported country param is not sent');
      return jsonResponse({
        suggestions: [
          {
            id: 'osm:w73681389:addr',
            name: '100 S Baylen St',
            context: 'Pensacola, Florida, United States',
            kind: 'address',
            lat: 30.4111,
            lon: -87.2164,
          },
        ],
      });
    },
    () =>
      geocodePost({
        request: request({ action: 'suggest', query: '100 S Baylen St' }),
        env: { MAPMAP_API_KEY: 'dummy-key' },
      } as never),
  );
  assert.equal(response.status, 200);
  const data = (await response.json()) as {
    suggestions: Array<{ id: string; label: string; lat?: number; lng?: number }>;
  };
  assert.equal(data.suggestions.length, 1);
  assert.equal(data.suggestions[0].id, 'osm:w73681389:addr');
  assert.equal(data.suggestions[0].label, '100 S Baylen St, Pensacola, Florida, United States');
  assert.equal(data.suggestions[0].lat, 30.4111);
  assert.equal(data.suggestions[0].lng, -87.2164);
});

test('geocode suggest: still accepts Photon-style feature payloads from conforming gateways', async () => {
  const response = await withFetch(
    async () => jsonResponse({ features: [mapmapFeature()] }),
    () =>
      geocodePost({
        request: request({ action: 'suggest', query: '100 S Baylen St, Pensacola' }),
        env: { MAPMAP_API_KEY: 'dummy-key' },
      } as never),
  );
  assert.equal(response.status, 200);
  const data = (await response.json()) as { suggestions: Array<{ id: string; label: string }> };
  assert.equal(data.suggestions.length, 1);
  assert.equal(data.suggestions[0].id, 'us:123');
  assert.match(data.suggestions[0].label, /Baylen/);
});

test('geocode suggest: provider failure is reported, never faked', async () => {
  const response = await withFetch(
    async () => jsonResponse({ code: 'quota-exceeded' }, 429),
    () =>
      geocodePost({
        request: request({ action: 'suggest', query: '100 S Baylen St, Pensacola' }),
        env: { MAPMAP_API_KEY: 'dummy-key' },
      } as never),
  );
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, error: 'provider_failed' });
});

// ── Resolution ───────────────────────────────────────────────────────────────

test('geocode resolve: uses MapMap when configured', async () => {
  const response = await withFetch(
    async () => jsonResponse({ features: [mapmapFeature()] }),
    () =>
      geocodePost({
        request: request({ action: 'resolve', query: '100 S Baylen St, Pensacola, FL 32502' }),
        env: { MAPMAP_API_KEY: 'dummy-key' },
      } as never),
  );
  const data = (await response.json()) as { result: { source: string; lat: number; lng: number } };
  assert.equal(response.status, 200);
  assert.equal(data.result.source, 'mapmap');
  assert.equal(data.result.lat, 30.4111);
  assert.equal(data.result.lng, -87.2164);
});

test('geocode resolve: falls back to Census when no provider key exists', async () => {
  const response = await withFetch(
    async () =>
      jsonResponse({
        result: {
          addressMatches: [
            { matchedAddress: '100 S BAYLEN ST, PENSACOLA, FL, 32502', coordinates: { x: -87.2164, y: 30.4111 } },
          ],
        },
      }),
    () =>
      geocodePost({
        request: request({ action: 'resolve', query: '100 S Baylen St, Pensacola, FL 32502' }),
        env: {},
      } as never),
  );
  const data = (await response.json()) as { result: { source: string; lat: number } };
  assert.equal(response.status, 200);
  assert.equal(data.result.source, 'census');
  assert.equal(data.result.lat, 30.4111);
});

test('geocode resolve: falls back to Census when MapMap returns no match', async () => {
  let calls = 0;
  const response = await withFetch(
    async () => {
      calls += 1;
      if (calls === 1) return jsonResponse({ features: [] }); // MapMap: no match
      return jsonResponse({
        result: { addressMatches: [{ matchedAddress: 'X', coordinates: { x: -87.2, y: 30.4 } }] },
      });
    },
    () =>
      geocodePost({
        request: request({ action: 'resolve', query: 'Nowhere Lane 1' }),
        env: { MAPMAP_API_KEY: 'dummy-key' },
      } as never),
  );
  const data = (await response.json()) as { result: { source: string } };
  assert.equal(response.status, 200);
  assert.equal(data.result.source, 'census');
});

test('geocode resolve: an unfindable address is honestly not_found', async () => {
  const response = await withFetch(
    async () => jsonResponse({ result: { addressMatches: [] } }),
    () =>
      geocodePost({
        request: request({ action: 'resolve', query: 'Notareal Street 999, Pensacola' }),
        env: {},
      } as never),
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { ok: false, error: 'not_found' });
});

test('geocode resolve: passes ZIP/city/state through when the provider supplies them', async () => {
  const response = await withFetch(
    async () =>
      jsonResponse({
        features: [mapmapFeature({ postcode: '32502', city: 'Pensacola', state: 'FL' })],
      }),
    () =>
      geocodePost({
        request: request({ action: 'resolve', query: '100 S Baylen St, Pensacola, FL' }),
        env: { MAPMAP_API_KEY: 'dummy-key' },
      } as never),
  );
  const data = (await response.json()) as { result: { zip?: string; city?: string; state?: string } };
  assert.equal(response.status, 200);
  assert.equal(data.result.zip, '32502');
  assert.equal(data.result.city, 'Pensacola');
  assert.equal(data.result.state, 'FL');
});

test('geocode resolve: a Census match exposes the ZIP from its label', async () => {
  const response = await withFetch(
    async () =>
      jsonResponse({
        result: {
          addressMatches: [
            { matchedAddress: '100 S BAYLEN ST, PENSACOLA, FL, 32502-1234', coordinates: { x: -87.2164, y: 30.4111 } },
          ],
        },
      }),
    () =>
      geocodePost({
        request: request({ action: 'resolve', query: '100 S Baylen St' }),
        env: {},
      } as never),
  );
  const data = (await response.json()) as { result: { zip?: string; source: string } };
  assert.equal(data.result.source, 'census');
  assert.equal(data.result.zip, '32502');
});

test('geocode resolve: an exact MapMap house-number match is preferred over Census', async () => {
  let censusCalls = 0;
  const response = await withFetch(
    async (url) => {
      if (String(url).includes('geocoding.geo.census.gov')) {
        censusCalls += 1;
        return jsonResponse({ result: { addressMatches: [] } });
      }
      return jsonResponse({
        features: [
          {
            properties: {
              id: 'osm:w10919246:addr',
              housenumber: '6360',
              street: 'Haupert Lane',
              city: 'Molino',
              state: 'FL',
              postcode: '32577',
            },
            geometry: { coordinates: [-87.34, 30.72] },
          },
        ],
      });
    },
    () =>
      geocodePost({
        request: request({ action: 'resolve', query: '6360 Haupert Ln, Molino, FL, 32577' }),
        env: { MAPMAP_API_KEY: 'dummy-key' },
      } as never),
  );
  const data = (await response.json()) as { result: { source: string; label: string; precise: boolean } };
  assert.equal(response.status, 200);
  assert.equal(data.result.source, 'mapmap');
  assert.match(data.result.label, /6360 Haupert Lane/);
  assert.equal(data.result.precise, true);
  assert.equal(censusCalls, 0, 'Census is not needed when MapMap has the exact address');
});

test('geocode resolve: a MapMap street-level result falls through to the exact Census match', async () => {
  const response = await withFetch(
    async (url) => {
      if (String(url).includes('geocoding.geo.census.gov')) {
        return jsonResponse({
          result: {
            addressMatches: [
              {
                matchedAddress: '6360 HAUPERT LN, MOLINO, FL, 32577',
                coordinates: { x: -87.339, y: 30.716 },
              },
            ],
          },
        });
      }
      // MapMap knows only the street, not the house number.
      return jsonResponse({
        features: [
          {
            properties: { id: 'osm:w10919246:street', name: 'Haupert Lane', street: 'Haupert Lane', type: 'street' },
            geometry: { coordinates: [-87.34, 30.72] },
          },
        ],
      });
    },
    () =>
      geocodePost({
        request: request({ action: 'resolve', query: '6360 Haupert Ln, Molino, FL, 32577' }),
        env: { MAPMAP_API_KEY: 'dummy-key' },
      } as never),
  );
  const data = (await response.json()) as {
    result: { source: string; label: string; city?: string; state?: string; zip?: string; precise: boolean };
  };
  assert.equal(response.status, 200);
  assert.equal(data.result.source, 'census');
  assert.equal(data.result.label, '6360 HAUPERT LN, MOLINO, FL, 32577');
  assert.equal(data.result.city, 'MOLINO');
  assert.equal(data.result.state, 'FL');
  assert.equal(data.result.zip, '32577');
  assert.equal(data.result.precise, true);
});

test('geocode resolve: a MapMap POI result never replaces the requested house number', async () => {
  const response = await withFetch(
    async (url) => {
      if (String(url).includes('geocoding.geo.census.gov')) {
        return jsonResponse({ result: { addressMatches: [] } });
      }
      return jsonResponse({
        features: [
          {
            properties: { id: 'osm:w360431754:poi', name: 'Molino Volunteer Fire Department', street: 'Molino Road', type: 'poi' },
            geometry: { coordinates: [-87.3439, 30.7165] },
          },
        ],
      });
    },
    () =>
      geocodePost({
        request: request({ action: 'resolve', query: '6360 Haupert Ln, Molino, FL, 32577' }),
        env: { MAPMAP_API_KEY: 'dummy-key' },
      } as never),
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { ok: false, error: 'not_found' });
});

test('geocode suggest: out-of-state rows are filtered out for the selected state', async () => {
  const response = await withFetch(
    async () =>
      jsonResponse({
        suggestions: [
          { id: 'ga', name: '3370 S Highway 97', context: 'Georgia, United States', kind: 'street', lat: 34, lon: -84 },
          { id: 'tn', name: '3370 S Highway 97', context: 'Tennessee, United States', kind: 'street', lat: 35, lon: -86 },
          { id: 'fl', name: '3370 South Highway 97', context: 'Milton, Florida, 32570, United States', kind: 'street', lat: 30.63, lon: -87.05 },
        ],
      }),
    () =>
      geocodePost({
        request: request({
          action: 'suggest',
          query: '3370 S Highway 97, FL',
          street: '3370 S Highway 97',
          state: 'FL',
        }),
        env: { MAPMAP_API_KEY: 'dummy-key' },
      } as never),
  );
  assert.equal(response.status, 200);
  const data = (await response.json()) as { suggestions: Array<{ label: string }>; needsLocation?: boolean };
  assert.equal(data.suggestions.length, 1);
  assert.match(data.suggestions[0].label, /Florida/);
  assert.equal(data.needsLocation, undefined);
});

test('geocode suggest: with nothing in-state and no city/ZIP, the response asks for a location', async () => {
  const response = await withFetch(
    async () =>
      jsonResponse({
        suggestions: [
          { id: 'ga', name: '3370 S Highway 97', context: 'Georgia, United States', kind: 'street', lat: 34, lon: -84 },
          { id: 'tn', name: '3370 S Highway 97', context: 'Tennessee, United States', kind: 'street', lat: 35, lon: -86 },
        ],
      }),
    () =>
      geocodePost({
        request: request({
          action: 'suggest',
          query: '3370 S Highway 97, FL',
          street: '3370 S Highway 97',
          state: 'FL',
        }),
        env: { MAPMAP_API_KEY: 'dummy-key' },
      } as never),
  );
  const data = (await response.json()) as { suggestions: unknown[]; needsLocation?: boolean };
  assert.equal(data.suggestions.length, 0);
  assert.equal(data.needsLocation, true);
});

test('geocode suggest: a conflicting ZIP row is dropped for the entered ZIP', async () => {
  const response = await withFetch(
    async () =>
      jsonResponse({
        suggestions: [
          { id: 'a', name: '1459 Molino Road', context: 'Florida, 32570, United States', kind: 'address', lat: 30.6, lon: -87.1 },
          { id: 'b', name: '1459 Molino Road', context: 'Florida, 32577, United States', kind: 'address', lat: 30.72, lon: -87.35 },
        ],
      }),
    () =>
      geocodePost({
        request: request({
          action: 'suggest',
          query: '1459 Molino Road, Molino, FL, 32577',
          street: '1459 Molino Road',
          city: 'Molino',
          state: 'FL',
          zip: '32577',
        }),
        env: { MAPMAP_API_KEY: 'dummy-key' },
      } as never),
  );
  const data = (await response.json()) as { suggestions: Array<{ label: string }> };
  assert.equal(data.suggestions.length, 1);
  assert.match(data.suggestions[0].label, /32577/);
});

test('geocode resolve-id: passes the provider document id through', async () => {
  const response = await withFetch(
    async (url) => {
      assert.match(String(url), /\/geocode\/retrieve\?id=us%3A123/);
      return jsonResponse({ features: [mapmapFeature()] });
    },
    () =>
      geocodePost({
        request: request({ action: 'resolve-id', id: 'us:123' }),
        env: { MAPMAP_API_KEY: 'dummy-key' },
      } as never),
  );
  const data = (await response.json()) as { result: { source: string } };
  assert.equal(response.status, 200);
  assert.equal(data.result.source, 'mapmap');
});

// ── Reverse geocoding (GPS → address) ────────────────────────────────────────

test('geocode reverse: without a provider key it reports not configured', async () => {
  const response = await geocodePost({
    request: request({ action: 'reverse', lat: 30.719, lng: -87.442 }),
    env: {},
  } as never);
  assert.equal(response.status, 503);
});

test('geocode reverse: invalid coordinates are rejected before any provider call', async () => {
  for (const body of [
    { action: 'reverse', lat: 999, lng: -87.442 },
    { action: 'reverse', lat: 30.719, lng: 'nope' },
    { action: 'reverse' },
  ]) {
    const response = await geocodePost({ request: request(body), env: { MAPMAP_API_KEY: 'dummy-key' } } as never);
    assert.equal(response.status, 400);
  }
});

test('geocode reverse: a provider house-number result is precise and carries city/state/zip', async () => {
  const response = await withFetch(
    async (url) => {
      assert.match(String(url), /\/geocode\/reverse\?lon=-87\.442&lat=30\.719&limit=1/);
      return jsonResponse({
        features: [
          {
            properties: {
              id: 'osm:w10919246:addr',
              housenumber: '6360',
              street: 'Haupert Lane',
              city: 'Molino',
              state: 'FL',
              postcode: '32577',
            },
            geometry: { coordinates: [-87.442, 30.719] },
          },
        ],
      });
    },
    () =>
      geocodePost({
        request: request({ action: 'reverse', lat: 30.719, lng: -87.442 }),
        env: { MAPMAP_API_KEY: 'dummy-key' },
      } as never),
  );
  const data = (await response.json()) as {
    result: { label: string; precise: boolean; city?: string; state?: string; zip?: string };
  };
  assert.equal(response.status, 200);
  assert.equal(data.result.precise, true);
  assert.match(data.result.label, /6360 Haupert Lane/);
  assert.equal(data.result.city, 'Molino');
  assert.equal(data.result.state, 'FL');
  assert.equal(data.result.zip, '32577');
});

test('geocode reverse: a street-level result is never marked precise', async () => {
  const response = await withFetch(
    async () =>
      jsonResponse({
        features: [
          {
            properties: { id: 'osm:w10919246:street', name: 'Haupert Lane', street: 'Haupert Lane', type: 'street' },
            geometry: { coordinates: [-87.442, 30.719] },
          },
        ],
      }),
    () =>
      geocodePost({
        request: request({ action: 'reverse', lat: 30.719, lng: -87.442 }),
        env: { MAPMAP_API_KEY: 'dummy-key' },
      } as never),
  );
  const data = (await response.json()) as { result: { precise: boolean } };
  assert.equal(response.status, 200);
  assert.equal(data.result.precise, false);
});

test('geocode reverse: no provider match is honestly not_found', async () => {
  const response = await withFetch(
    async () => jsonResponse({ features: [] }),
    () =>
      geocodePost({
        request: request({ action: 'reverse', lat: 30.719, lng: -87.442 }),
        env: { MAPMAP_API_KEY: 'dummy-key' },
      } as never),
  );
  assert.equal(response.status, 404);
});

// ── Throttling ───────────────────────────────────────────────────────────────

test('geocode: the shared ROUTES_API_KEY secret works without a duplicate key', async () => {
  const response = await withFetch(
    async () => jsonResponse({ features: [] }),
    () =>
      geocodePost({
        request: request({ action: 'suggest', query: 'Pensacola FL' }),
        env: { ROUTES_API_KEY: 'shared-routes-secret' },
      } as never),
  );
  assert.equal(response.status, 200, 'ROUTES_API_KEY must configure the provider');
});

test('geocode: MAPMAP_API_KEY still works as an alias', async () => {
  const response = await withFetch(
    async () => jsonResponse({ features: [] }),
    () =>
      geocodePost({
        request: request({ action: 'suggest', query: 'Pensacola FL' }),
        env: { MAPMAP_API_KEY: 'alias-key' },
      } as never),
  );
  assert.equal(response.status, 200);
});

test('geocode: a single IP is throttled within the minute window', async () => {
  const ip = '203.0.113.77';
  let lastStatus = 0;
  for (let index = 0; index < 22; index += 1) {
    const response = await withFetch(
      async () => jsonResponse({ features: [] }),
      () => geocodePost({ request: request({ action: 'suggest', query: 'Pensacola FL' }, ip), env: { MAPMAP_API_KEY: 'dummy-key' } } as never),
    );
    lastStatus = response.status;
  }
  assert.equal(lastStatus, 429, 'requests beyond the per-IP window must be refused');
});
