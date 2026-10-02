// Pages Function fail-safe tests (deployment reliability).
// Run with: npm test  (Node's built-in test runner + TypeScript type stripping)
//
// ── /api/lead ──────────────────────────────────────────────────────────────
// constructed requests and environments. They encode the deployment contract:
//  - missing configuration fails safe (503) so the client can fall back,
//  - malformed or spammy input is rejected (400),
//  - provider success is the ONLY path that reports success,
//  - provider failures never masquerade as success.
//
// No network access: global fetch is stubbed per test and always restored.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost as leadPost, onRequestGet as leadGet } from '../functions/api/lead.ts';
import { onRequestPost as travelPost, onRequestGet as travelGet } from '../functions/api/travel.ts';

let requestIp = 0;
const jsonRequest = (body: unknown, ip = `10.77.0.${++requestIp}`) =>
  new Request('https://example.test/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });

async function withFetch<T>(
  stub: (url: string | URL, init?: RequestInit) => Promise<Response>,
  run: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = stub as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// ── /api/lead ──────────────────────────────────────────────────────────────

test('lead: malformed JSON body is rejected', async () => {
  const response = await leadPost({
    request: new Request('https://example.test/api/lead', { method: 'POST', body: 'not json' }),
    env: {},
  } as never);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, error: 'invalid_request' });
});

test('lead: missing fields are rejected', async () => {
  const response = await leadPost({ request: jsonRequest({ subject: 'x' }), env: {} } as never);
  assert.equal(response.status, 400);
});

test('lead: honeypot submissions are rejected', async () => {
  const response = await leadPost({
    request: jsonRequest({ subject: 'x', fields: { phone: '5551234567', company_website: 'bot' } }),
    env: {},
  } as never);
  assert.equal(response.status, 400);
});

test('lead: a submission without phone or email is rejected', async () => {
  const response = await leadPost({
    request: jsonRequest({ subject: 'x', fields: { message: 'hello' } }),
    env: {},
  } as never);
  assert.equal(response.status, 400);
});

test('lead: Turnstile configured without a token fails verification', async () => {
  const response = await leadPost({
    request: jsonRequest({ subject: 'x', fields: { phone: '5551234567' } }),
    env: { TURNSTILE_SECRET_KEY: 'dummy-turnstile-secret' },
  } as never);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, error: 'verification_failed' });
});

test('lead: missing server key returns not_configured so the client can fall back', async () => {
  const response = await leadPost({
    request: jsonRequest({ subject: 'x', fields: { phone: '5551234567' } }),
    env: {},
  } as never);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, error: 'not_configured' });
});

test('lead: provider success is reported as success', async () => {
  const response = await withFetch(
    async () => jsonResponse({ success: true }),
    () =>
      leadPost({
        request: jsonRequest({ subject: 'x', fields: { phone: '5551234567', name: 'Test' } }),
        env: { WEB3FORMS_ACCESS_KEY: 'dummy-server-key' },
      } as never),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test('lead: a preview-branch deployment marks every submission as a test', async () => {
  let sent: Record<string, unknown> | null = null;
  const response = await withFetch(
    async (_url, init) => {
      sent = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return jsonResponse({ success: true });
    },
    () =>
      leadPost({
        request: jsonRequest({ subject: 'Reservation request — test', fields: { phone: '5550000000' } }),
        env: { WEB3FORMS_ACCESS_KEY: 'dummy', CF_PAGES_BRANCH: 'dev/owner-preview-2026-10-02' },
      } as never),
  );
  assert.equal(response.status, 200);
  assert.match(String(sent?.subject), /^\[PREVIEW TEST — NOT A REAL BOOKING\]/);
  assert.match(String(sent?.preview_test), /NOT a real cleaning request/);
  assert.equal(sent?.preview_branch, 'dev/owner-preview-2026-10-02');
});

test('lead: production (main) is never marked as a test', async () => {
  let sent: Record<string, unknown> | null = null;
  const response = await withFetch(
    async (_url, init) => {
      sent = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return jsonResponse({ success: true });
    },
    () =>
      leadPost({
        request: jsonRequest({ subject: 'Reservation request — real', fields: { phone: '5550000001' } }),
        env: { WEB3FORMS_ACCESS_KEY: 'dummy', CF_PAGES_BRANCH: 'main' },
      } as never),
  );
  assert.equal(response.status, 200);
  assert.equal(sent?.subject, 'Reservation request — real');
  assert.equal(sent?.preview_test, undefined);
});

test('lead: a client cannot fake or remove the preview marker on production', async () => {
  let sent: Record<string, unknown> | null = null;
  await withFetch(
    async (_url, init) => {
      sent = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return jsonResponse({ success: true });
    },
    () =>
      leadPost({
        request: jsonRequest({
          subject: 'Reservation request',
          fields: { phone: '5550000002', preview_test: 'pretend this is a test', preview_branch: 'fake' },
        }),
        env: { WEB3FORMS_ACCESS_KEY: 'dummy', CF_PAGES_BRANCH: 'main' },
      } as never),
  );
  assert.equal(sent?.preview_test, undefined, 'server-owned preview fields are discarded');
  assert.equal(sent?.preview_branch, undefined);
});

test('lead: PREVIEW_TEST_MODE forces the marker without a branch variable', async () => {
  let sent: Record<string, unknown> | null = null;
  await withFetch(
    async (_url, init) => {
      sent = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return jsonResponse({ success: true });
    },
    () =>
      leadPost({
        request: jsonRequest({ subject: 'Message', fields: { email: 'test@example.com' } }),
        env: { WEB3FORMS_ACCESS_KEY: 'dummy', PREVIEW_TEST_MODE: 'true' },
      } as never),
  );
  assert.match(String(sent?.subject), /^\[PREVIEW TEST/);
});

test('lead: provider failure is never reported as success', async () => {
  const response = await withFetch(
    async () => jsonResponse({ success: false }, 500),
    () =>
      leadPost({
        request: jsonRequest({ subject: 'x', fields: { phone: '5551234567' } }),
        env: { WEB3FORMS_ACCESS_KEY: 'dummy-server-key' },
      } as never),
  );
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, error: 'provider_failed' });
});

test('lead: GET is method-not-allowed', async () => {
  const response = await leadGet();
  assert.equal(response.status, 405);
});

// ── /api/travel ─────────────────────────────────────────────────────────────

test('travel: missing origin returns origin_not_configured', async () => {
  const response = await travelPost({ request: jsonRequest({ zip: '32503' }), env: {} } as never);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, error: 'origin_not_configured' });
});

test('travel: malformed ZIP is rejected', async () => {
  const response = await travelPost({
    request: jsonRequest({ zip: 'abc' }),
    env: { TRAVEL_ORIGIN: '30.6100,-87.3400' },
  } as never);
  assert.equal(response.status, 400);
});

test('travel: valid but unreferenced ZIP is rejected', async () => {
  const response = await travelPost({
    request: jsonRequest({ zip: '90210' }),
    env: { TRAVEL_ORIGIN: '30.6100,-87.3400' },
  } as never);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, error: 'zip_not_referenced' });
});

test('travel: with no routing provider it returns a labeled straight-line estimate and reference gas', async () => {
  const response = await travelPost({
    request: jsonRequest({ zip: '32503' }),
    env: { TRAVEL_ORIGIN: '30.6100,-87.3400' },
  } as never);
  assert.equal(response.status, 200);
  const data = (await response.json()) as Record<string, unknown>;
  assert.equal(data.method, 'straight_line_estimate');
  assert.equal(data.provider, 'straight_line');
  assert.equal(data.gasPriceSource, 'configured_reference');
  assert.equal(typeof data.oneWayMiles, 'number');
  assert.ok((data.oneWayMiles as number) > 0);
});

test('travel: the paid Google provider is disabled and never called', async () => {
  const response = await withFetch(
    async (url) => {
      throw new Error(`a paid provider was called: ${String(url)}`);
    },
    () =>
      travelPost({
        request: jsonRequest({ zip: '32501' }),
        env: {
          TRAVEL_ORIGIN: '30.6100,-87.3400',
          ROUTES_PROVIDER: 'google',
          ROUTES_API_KEY: 'paid-provider-key',
        },
      } as never),
  );
  assert.equal(response.status, 200);
  const data = (await response.json()) as Record<string, unknown>;
  assert.equal(data.method, 'straight_line_estimate', 'paid routing must be disabled');
  assert.equal(data.provider, 'straight_line');
});

test('travel: the paid Mapbox provider is disabled and never called', async () => {
  const response = await withFetch(
    async (url) => {
      throw new Error(`a paid provider was called: ${String(url)}`);
    },
    () =>
      travelPost({
        request: jsonRequest({ zip: '32502' }),
        env: {
          TRAVEL_ORIGIN: '30.6100,-87.3400',
          ROUTES_PROVIDER: 'mapbox',
          ROUTES_API_KEY: 'paid-provider-key',
        },
      } as never),
  );
  assert.equal(response.status, 200);
  const data = (await response.json()) as Record<string, unknown>;
  assert.equal(data.method, 'straight_line_estimate', 'paid routing must be disabled');
});

test('travel: EIA fuel feed failure falls back to the configured reference price', async () => {
  const response = await withFetch(
    async () => jsonResponse({ error: 'down' }, 500),
    () =>
      travelPost({
        request: jsonRequest({ zip: '32504' }),
        env: { TRAVEL_ORIGIN: '30.6100,-87.3400', EIA_API_KEY: 'dummy-eia-key' },
      } as never),
  );
  assert.equal(response.status, 200);
  const data = (await response.json()) as Record<string, unknown>;
  assert.equal(data.gasPriceSource, 'configured_reference');
});

test('travel: live EIA price is used when the feed succeeds', async () => {
  const response = await withFetch(
    async () => jsonResponse({ response: { data: [{ value: 3.42 }] } }),
    () =>
      travelPost({
        request: jsonRequest({ zip: '32505' }),
        env: { TRAVEL_ORIGIN: '30.6100,-87.3400', EIA_API_KEY: 'dummy-eia-key' },
      } as never),
  );
  assert.equal(response.status, 200);
  const data = (await response.json()) as Record<string, unknown>;
  assert.equal(data.gasPriceSource, 'eia_live');
  assert.equal(data.gasPrice, 3.42);
});

test('travel: a configured MapMap route returns distance and driving duration', async () => {
  const response = await withFetch(
    async () => jsonResponse({ code: 'Ok', routes: [{ distance: 24140.2, duration: 1800.5 }] }),
    () =>
      travelPost({
        request: jsonRequest({ zip: '32506' }),
        env: {
          TRAVEL_ORIGIN: '30.6100,-87.3400',
          ROUTES_PROVIDER: 'mapmap',
          ROUTES_API_KEY: 'dummy-mapmap-key',
        },
      } as never),
  );
  assert.equal(response.status, 200);
  const data = (await response.json()) as Record<string, unknown>;
  assert.equal(data.method, 'route');
  assert.equal(data.provider, 'mapmap');
  assert.equal(data.durationMinutes, 30);
  assert.ok(typeof data.oneWayMiles === 'number' && (data.oneWayMiles as number) > 0);
});

test('travel: a MapMap quota refusal falls back to the straight-line estimate', async () => {
  const response = await withFetch(
    async () => jsonResponse({ code: 'quota-exceeded' }, 429),
    () =>
      travelPost({
        request: jsonRequest({ zip: '32507' }),
        env: {
          TRAVEL_ORIGIN: '30.6100,-87.3400',
          ROUTES_PROVIDER: 'mapmap',
          ROUTES_API_KEY: 'dummy-mapmap-key',
        },
      } as never),
  );
  assert.equal(response.status, 200);
  const data = (await response.json()) as Record<string, unknown>;
  assert.equal(data.method, 'straight_line_estimate');
  assert.equal(data.durationMinutes, null);
});

test('travel: GET is method-not-allowed', async () => {
  const response = await travelGet();
  assert.equal(response.status, 405);
});

// ── /api/travel with confirmed destination coordinates ──────────────────────

test('travel: confirmed coordinates produce a labeled straight-line route without a provider', async () => {
  const response = await travelPost({
    request: jsonRequest({ zip: '32503', lat: 30.4111, lng: -87.2164 }),
    env: { TRAVEL_ORIGIN: '30.6100,-87.3400' },
  } as never);
  assert.equal(response.status, 200);
  const data = (await response.json()) as Record<string, unknown>;
  assert.equal(data.method, 'straight_line_estimate');
  assert.equal(data.verified, false);
  assert.equal(typeof data.oneWayMiles, 'number');
  assert.ok((data.oneWayMiles as number) > 0);
});

test('travel: confirmed coordinates use the configured provider route and duration', async () => {
  const response = await withFetch(
    async (url) => {
      // Distinct destination from the straight-line test above (the function
      // caches per destination for the isolate).
      assert.match(String(url), /\/route\/v1\/driving\/-87\.34,30\.61;-87\.3,30\.5/);
      return jsonResponse({ code: 'Ok', routes: [{ distance: 24140.2, duration: 1800.5 }] });
    },
    () =>
      travelPost({
        request: jsonRequest({ zip: '32504', lat: 30.5, lng: -87.3 }),
        env: {
          TRAVEL_ORIGIN: '30.6100,-87.3400',
          ROUTES_PROVIDER: 'mapmap',
          ROUTES_API_KEY: 'dummy-mapmap-key',
        },
      } as never),
  );
  assert.equal(response.status, 200);
  const data = (await response.json()) as Record<string, unknown>;
  assert.equal(data.method, 'route');
  assert.equal(data.verified, true);
  assert.equal(data.durationMinutes, 30);
});

test('travel: coordinates without a ZIP are accepted (confirmed pin path)', async () => {
  const response = await travelPost({
    request: jsonRequest({ lat: 30.4111, lng: -87.2164 }),
    env: { TRAVEL_ORIGIN: '30.6100,-87.3400' },
  } as never);
  assert.equal(response.status, 200);
  const data = (await response.json()) as Record<string, unknown>;
  assert.equal(data.zone, 'unknown');
  assert.ok((data.oneWayMiles as number) > 0);
});

test('travel: a MapMap key without an explicit provider still routes (inferred provider)', async () => {
  const response = await withFetch(
    async (url) => {
      assert.match(String(url), /\/route\/v1\/driving\/-87\.34,30\.61;-87\.25,30\.42/);
      return jsonResponse({ code: 'Ok', routes: [{ distance: 12000, duration: 900 }] });
    },
    () =>
      travelPost({
        request: jsonRequest({ zip: '32505', lat: 30.42, lng: -87.25 }),
        env: { TRAVEL_ORIGIN: '30.6100,-87.3400', ROUTES_API_KEY: 'dummy-mapmap-key' },
      } as never),
  );
  assert.equal(response.status, 200);
  const data = (await response.json()) as Record<string, unknown>;
  assert.equal(data.method, 'route');
  assert.equal(data.verified, true);
  assert.equal(data.provider, 'mapmap');
});

test('travel: invalid coordinates fall back to a valid ZIP instead of failing the estimate', async () => {
  const response = await travelPost({
    request: jsonRequest({ zip: '32503', lat: 999, lng: 'nope' }),
    env: { TRAVEL_ORIGIN: '30.6100,-87.3400' },
  } as never);
  assert.equal(response.status, 200);
  const data = (await response.json()) as Record<string, unknown>;
  assert.equal(data.zone, 'core');
});

test('travel: no coordinates and no ZIP is an invalid request', async () => {
  const response = await travelPost({
    request: jsonRequest({}),
    env: { TRAVEL_ORIGIN: '30.6100,-87.3400' },
  } as never);
  assert.equal(response.status, 400);
});

test('travel: a burst from one IP is throttled so the free allowance cannot be drained', async () => {
  const ip = '203.0.113.9';
  let lastStatus = 0;
  for (let index = 0; index < 34; index += 1) {
    const response = await travelPost({
      request: jsonRequest({ zip: '32503' }, ip),
      env: { TRAVEL_ORIGIN: '30.6100,-87.3400' },
    } as never);
    lastStatus = response.status;
  }
  assert.equal(lastStatus, 429, 'requests beyond the per-IP window must be refused');
});

