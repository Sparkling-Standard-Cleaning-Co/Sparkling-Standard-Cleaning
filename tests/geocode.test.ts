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

test('geocode suggest: maps provider features to minimal suggestions', async () => {
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
