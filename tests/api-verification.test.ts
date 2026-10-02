// Pages Function tests - authoritative reservation quote verification in
// /api/lead: the server recomputes every priced reservation and never trusts
// browser prices, coordinates, quote references or verdicts.
//
// Run with: npm test  (Node's built-in test runner + TypeScript type stripping)
// All provider calls are mocked; no network access.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost as leadPost } from '../functions/api/lead.ts';

const jsonRequest = (body: unknown) =>
  new Request('https://example.test/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

// ── /api/lead — authoritative reservation verification ───────────────────────

const reservationFields = (overrides: Record<string, string> = {}) => ({
  request_type: 'reservation_request',
  service_type: 'standard',
  property_type: 'house',
  zip: '32503',
  square_feet: '1600',
  bedrooms: '3',
  full_baths: '2',
  half_baths: '0',
  frequency: 'one_time',
  condition: 'maintained',
  last_cleaned: 'within_month',
  pets: 'none',
  addon_ids: '',
  service_address: '100 S Baylen St',
  name: 'Reservation Test',
  phone: '8500000000',
  quoted_price: '0',
  quote_reference: 'SS-20261001-ABC123',
  quote_config_version: '2026-10-01.option-c.v1',
  // A hostile client claiming its own verification result:
  quote_verified: 'match',
  verified_price: '1',
  ...overrides,
});

function verificationStub() {
  const forwarded: Array<Record<string, unknown>> = [];
  const stub = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const href = String(url);
    if (href.includes('geocoding.geo.census.gov')) {
      return jsonResponse({
        result: {
          addressMatches: [
            { matchedAddress: '100 S BAYLEN ST, PENSACOLA, FL, 32502', coordinates: { x: -87.2164, y: 30.4111 } },
          ],
        },
      });
    }
    if (href.includes('/route/v1/')) {
      return jsonResponse({ code: 'Ok', routes: [{ distance: 24140.2, duration: 1800.5 }] });
    }
    if (href.includes('api.web3forms.com')) {
      forwarded.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return jsonResponse({ success: true });
    }
    return jsonResponse({ error: 'unexpected' }, 500);
  };
  return { stub, forwarded };
}

test('lead: reservation requests are recalculated server-side and labeled for the owner', async () => {
  const { stub, forwarded } = verificationStub();
  const response = await withFetch(stub, () =>
    leadPost({
      request: jsonRequest({ subject: 'Reservation', fields: reservationFields({ quoted_price: '1' }) }),
      env: { WEB3FORMS_ACCESS_KEY: 'dummy-server-key', TRAVEL_ORIGIN: '30.6100,-87.3400' },
    } as never),
  );
  assert.equal(response.status, 200);
  assert.equal(forwarded.length, 1);
  const sent = forwarded[0] as Record<string, string>;
  // Client claims are discarded; the server verdict wins.
  assert.equal(sent.quote_verified, 'mismatch', 'a $1 claim cannot verify');
  assert.equal(sent.client_price, '1');
  assert.ok(Number(sent.verified_price) > 0, 'the server price is a real number');
  assert.equal(sent.travel_method, 'straight_line_estimate');
  assert.equal(sent.travel_destination_source, 'address_geocode');
  assert.equal(sent.server_config_version, '2026-10-01.option-c.v1');
  assert.ok(sent.verification_note && /verified calculation/i.test(sent.verification_note));
  assert.ok(sent.quote_valid_through);
});

test('lead: a forged client verification field never reaches the owner', async () => {
  const { stub, forwarded } = verificationStub();
  await withFetch(stub, () =>
    leadPost({
      request: jsonRequest({
        subject: 'Reservation',
        fields: reservationFields({ quoted_price: '1', quote_verified: 'match', verified_price: '9999' }),
      }),
      env: { WEB3FORMS_ACCESS_KEY: 'dummy-server-key', TRAVEL_ORIGIN: '30.6100,-87.3400' },
    } as never),
  );
  const sent = forwarded[0] as Record<string, string>;
  assert.equal(sent.quote_verified, 'mismatch', 'server verdict replaces the forged claim');
  assert.notEqual(sent.verified_price, '9999', 'server price replaces the forged price');
  assert.ok(Number(sent.verified_price) > 0);
});

test('lead: a non-priced request is delivered without verification fields', async () => {
  const { stub, forwarded } = verificationStub();
  const response = await withFetch(stub, () =>
    leadPost({
      request: jsonRequest({ subject: 'Estimate', fields: { phone: '5551234567', service_type: 'standard' } }),
      env: { WEB3FORMS_ACCESS_KEY: 'dummy-server-key' },
    } as never),
  );
  assert.equal(response.status, 200);
  const sent = forwarded[0] as Record<string, string>;
  assert.equal(sent.quote_verified, undefined);
  assert.equal(sent.verified_price, undefined);
});

test('lead: a provider outage still delivers the reservation with an honest verdict', async () => {
  const forwarded: Array<Record<string, unknown>> = [];
  const response = await withFetch(
    async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.includes('api.web3forms.com')) {
        forwarded.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return jsonResponse({ success: true });
      }
      return jsonResponse({ provider: 'down' }, 500);
    },
    () =>
      leadPost({
        request: jsonRequest({ subject: 'Reservation', fields: reservationFields() }),
        env: { WEB3FORMS_ACCESS_KEY: 'dummy-server-key', TRAVEL_ORIGIN: '30.6100,-87.3400' },
      } as never),
  );
  assert.equal(response.status, 200, 'the customer request is never lost');
  assert.equal(forwarded.length, 1);
  const sent = forwarded[0] as Record<string, string>;
  // Geocoding and routing are down; the server still recomputes from the ZIP
  // reference and labels the $0 claim honestly.
  assert.equal(sent.quote_verified, 'mismatch');
  assert.equal(sent.travel_destination_source, 'zip_centroid');
  assert.ok(Number(sent.verified_price) > 0);
});
