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

test('lead: honeypot submissions are rejected with a distinct spam error', async () => {
  const response = await leadPost({
    request: jsonRequest({ subject: 'x', fields: { phone: '5551234567', extra_ref: 'bot' } }),
    env: {},
  } as never);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: 'spam_rejected' });
});

test('lead: a legacy autofilled company_website value no longer rejects a customer', async () => {
  // The old honeypot name was an autofill magnet. It is no longer a trap, so a
  // cached old bundle that still sends it (or a browser autofilling a normal
  // field) can never cost a legitimate customer their submission.
  const response = await withFetch(
    async () => jsonResponse({ success: true }),
    () =>
      leadPost({
        request: jsonRequest({
          subject: 'x',
          fields: { phone: '5551234567', company_website: 'autofilled by the browser' },
        }),
        env: { WEB3FORMS_ACCESS_KEY: 'dummy-server-key' },
      } as never),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
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

// ── /api/lead → customer confirmation (Resend, mocked) ─────────────────────
//
// The lead is delivered through Web3Forms first; the customer confirmation is
// a second, independent path. No real email is sent: every provider call is
// routed through a stub.

const customerFields = {
  name: 'Synthetic Customer',
  phone: '8500000000',
  email: 'synthetic@example.com',
  service_type: 'standard',
  frequency: 'biweekly',
  service_address: '100 S Baylen St',
  address_city: 'Pensacola',
  address_state: 'FL',
  zip: '32502',
};

interface RoutedCall {
  url: string;
  init?: RequestInit;
}

async function withRoutedFetch<T>(
  handlers: { web3forms?: () => Promise<Response>; resend?: () => Promise<Response> },
  run: (calls: RoutedCall[]) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const calls: RoutedCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('api.web3forms.com')) {
      return handlers.web3forms ? handlers.web3forms() : jsonResponse({ success: true });
    }
    if (url.includes('api.resend.com')) {
      return handlers.resend ? handlers.resend() : jsonResponse({ id: 'email-1' });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test('lead: a successful owner delivery sends exactly one branded customer confirmation', async () => {
  await withRoutedFetch({}, async (calls) => {
    const response = await leadPost({
      request: jsonRequest({ subject: 'x', fields: customerFields }),
      env: { WEB3FORMS_ACCESS_KEY: 'dummy-server-key', RESEND_API_KEY: 'dummy-resend-key' },
    } as never);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });

    const resendCalls = calls.filter((call) => call.url.includes('api.resend.com'));
    assert.equal(resendCalls.length, 1, 'no duplicate send for one server invocation');
    const body = JSON.parse(String(resendCalls[0].init?.body)) as Record<string, unknown>;
    assert.deepEqual(body.to, ['synthetic@example.com'], 'correct recipient');
    assert.equal(body.subject, 'We received your Sparkling Standard request', 'correct subject');
    assert.match(String(body.html), /We received your request/, 'HTML body generated');
    assert.match(String(body.html), /House cleaning \(standard\)/);
    assert.match(String(body.text), /WE RECEIVED YOUR REQUEST/, 'plain-text body generated');
    assert.match(String(body.text), /100 S Baylen St, Pensacola, FL 32502/);
    const headers = resendCalls[0].init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer dummy-resend-key');
  });
});

test('lead: a Resend failure after owner delivery still returns a successful lead response', async () => {
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  };
  try {
    await withRoutedFetch({ resend: async () => jsonResponse({ error: 'provider down' }, 500) }, async (calls) => {
      const response = await leadPost({
        request: jsonRequest({ subject: 'x', fields: customerFields }),
        env: { WEB3FORMS_ACCESS_KEY: 'dummy-server-key', RESEND_API_KEY: 'dummy-resend-key' },
      } as never);
      assert.equal(response.status, 200, 'the lead stays successful');
      assert.deepEqual(await response.json(), { ok: true });
      assert.equal(calls.filter((call) => call.url.includes('api.resend.com')).length, 1);
    });
  } finally {
    console.error = originalError;
  }
  assert.ok(
    errors.some((line) => line.includes('customer-confirmation: failed (provider 500)')),
    'the failure is recorded server-side',
  );
  assert.ok(
    errors.every((line) => !line.includes('synthetic@example.com') && !line.includes('dummy-resend-key')),
    'no PII or secret in the log line',
  );
});

test('lead: owner-delivery failure never triggers a customer confirmation', async () => {
  await withRoutedFetch({ web3forms: async () => jsonResponse({ success: false }, 500) }, async (calls) => {
    const response = await leadPost({
      request: jsonRequest({ subject: 'x', fields: customerFields }),
      env: { WEB3FORMS_ACCESS_KEY: 'dummy-server-key', RESEND_API_KEY: 'dummy-resend-key' },
    } as never);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { ok: false, error: 'provider_failed' });
    assert.equal(
      calls.filter((call) => call.url.includes('api.resend.com')).length,
      0,
      'a failed lead is never confirmed to the customer',
    );
  });
});

test('lead: a phone-only request skips the customer confirmation safely', async () => {
  await withRoutedFetch({}, async (calls) => {
    const response = await leadPost({
      request: jsonRequest({ subject: 'x', fields: { name: 'Synthetic', phone: '8500000000' } }),
      env: { WEB3FORMS_ACCESS_KEY: 'dummy-server-key', RESEND_API_KEY: 'dummy-resend-key' },
    } as never);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(calls.filter((call) => call.url.includes('api.resend.com')).length, 0);
  });
});

test('lead: an invalid customer email is never sent a confirmation', async () => {
  await withRoutedFetch({}, async (calls) => {
    const response = await leadPost({
      request: jsonRequest({ subject: 'x', fields: { ...customerFields, email: 'not-an-email' } }),
      env: { WEB3FORMS_ACCESS_KEY: 'dummy-server-key', RESEND_API_KEY: 'dummy-resend-key' },
    } as never);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(calls.filter((call) => call.url.includes('api.resend.com')).length, 0);
  });
});

test('lead: without the Resend secret the lead still succeeds and no confirmation is attempted', async () => {
  await withRoutedFetch({}, async (calls) => {
    const response = await leadPost({
      request: jsonRequest({ subject: 'x', fields: customerFields }),
      env: { WEB3FORMS_ACCESS_KEY: 'dummy-server-key' },
    } as never);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload, { ok: true });
    assert.equal(calls.filter((call) => call.url.includes('api.resend.com')).length, 0);
    assert.equal(JSON.stringify(payload).includes('RESEND'), false, 'no configuration detail in the response');
  });
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

