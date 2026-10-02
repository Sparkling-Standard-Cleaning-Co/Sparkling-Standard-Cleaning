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
  assert.equal(sent.config_version_match, 'match');
  assert.equal(sent.quote_reference_valid, 'true');
  assert.ok(sent.verification_note && /verified calculation/i.test(sent.verification_note));
  assert.ok(sent.quote_valid_through);

  // The owner notification carries the full calculator breakdown.
  assert.equal(sent.verification_path, 'server_relay');
  assert.equal(sent.verification_status, 'authoritative');
  assert.ok(sent.received_at && !Number.isNaN(Date.parse(sent.received_at)), 'server receipt timestamp');
  assert.ok(Number(sent.base_price) > 0, 'base cleaning price');
  assert.equal(sent.extras_subtotal, '0.00');
  assert.equal(sent.extras_detail, 'None');
  assert.equal(sent.addon_incentive, 'None');
  assert.ok(Number(sent.proposed_total) > 0, 'proposed total');
  assert.ok(Number(sent.estimated_labor_hours) > 0, 'estimated labor hours');
  assert.ok(['recurring_maintenance', 'other_services'].includes(sent.pricing_category));
  assert.ok(Number(sent.applied_rate_per_labor_hour) > 0, 'applied pricing category rate');
  // The private origin and credentials never appear anywhere in the payload.
  assert.doesNotMatch(JSON.stringify(sent), /TRAVEL_ORIGIN|ROUTES_API_KEY|30\.6100,-87\.3400/);

  // The browser receipt carries the verdict but never a price.
  const body = (await response.json()) as {
    ok: boolean;
    verification?: Record<string, unknown>;
  };
  assert.equal(body.verification?.status, 'mismatch');
  assert.equal(body.verification?.travel_verified, false);
  assert.equal(body.verification?.travel_method, 'straight_line_estimate');
  assert.equal(body.verification?.config_match, 'match');
  assert.equal(body.verification?.verified_price, undefined);
  assert.equal(body.verification?.price, undefined);
});

test('lead: a forged client verification field never reaches the owner', async () => {
  const { stub, forwarded } = verificationStub();
  await withFetch(stub, () =>
    leadPost({
      request: jsonRequest({
        subject: 'Reservation',
        fields: reservationFields({
          quoted_price: '1',
          quote_verified: 'match',
          verified_price: '9999',
          verification_path: 'trust-me',
          verification_status: 'authoritative',
          received_at: '1999-01-01T00:00:00.000Z',
          base_price: '1.00',
          proposed_total: '1.00',
        }),
      }),
      env: { WEB3FORMS_ACCESS_KEY: 'dummy-server-key', TRAVEL_ORIGIN: '30.6100,-87.3400' },
    } as never),
  );
  const sent = forwarded[0] as Record<string, string>;
  assert.equal(sent.quote_verified, 'mismatch', 'server verdict replaces the forged claim');
  assert.notEqual(sent.verified_price, '9999', 'server price replaces the forged price');
  assert.equal(sent.verification_path, 'server_relay', 'the server owns the verification path');
  assert.equal(sent.verification_status, 'authoritative');
  assert.notEqual(sent.received_at, '1999-01-01T00:00:00.000Z', 'the server stamps receipt time');
  assert.notEqual(sent.base_price, '1.00', 'the server recomputes the breakdown');
  assert.ok(Number(sent.verified_price) > 0);
});

test('lead: selected extras are itemized with their actual server-calculated charges', async () => {
  const { stub, forwarded } = verificationStub();
  await withFetch(stub, () =>
    leadPost({
      request: jsonRequest({
        subject: 'Reservation',
        fields: reservationFields({ quoted_price: '1', addon_ids: 'inside_oven' }),
      }),
      env: { WEB3FORMS_ACCESS_KEY: 'dummy-server-key', TRAVEL_ORIGIN: '30.6100,-87.3400' },
    } as never),
  );
  const sent = forwarded[0] as Record<string, string>;
  assert.equal(sent.extras_subtotal, '30.00', 'the oven charge comes from labor × rate');
  assert.match(sent.extras_detail, /Inside oven \$30\.00/);
  assert.equal(sent.pricing_category, 'other_services');
  assert.equal(sent.applied_rate_per_labor_hour, '50');
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

// ── Malicious or malformed submitted values ──────────────────────────────────

test('lead: invalid, past and far-future preferred dates are discarded with a note', async () => {
  const cases = ['not-a-date', '2020-01-01', '2099-01-01', '2026-02-31'];
  for (const preferredDate of cases) {
    const { stub, forwarded } = verificationStub();
    await withFetch(stub, () =>
      leadPost({
        request: jsonRequest({
          subject: 'Reservation',
          fields: reservationFields({ quoted_price: '1', preferred_date: preferredDate }),
        }),
        env: { WEB3FORMS_ACCESS_KEY: 'dummy-server-key', TRAVEL_ORIGIN: '30.6100,-87.3400' },
      } as never),
    );
    const sent = forwarded[0] as Record<string, string>;
    assert.equal(sent.preferred_date, undefined, `date ${preferredDate} must not be forwarded`);
    assert.match(sent.preferred_date_note ?? '', /invalid or out of range/);
  }
});

test('lead: a valid future preferred date is forwarded untouched', async () => {
  const { stub, forwarded } = verificationStub();
  const valid = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  await withFetch(stub, () =>
    leadPost({
      request: jsonRequest({
        subject: 'Reservation',
        fields: reservationFields({ quoted_price: '1', preferred_date: valid }),
      }),
      env: { WEB3FORMS_ACCESS_KEY: 'dummy-server-key', TRAVEL_ORIGIN: '30.6100,-87.3400' },
    } as never),
  );
  const sent = forwarded[0] as Record<string, string>;
  assert.equal(sent.preferred_date, valid);
  assert.equal(sent.preferred_date_note, undefined);
});

test('lead: a client-forged preferred_date_note never reaches the owner', async () => {
  const { stub, forwarded } = verificationStub();
  await withFetch(stub, () =>
    leadPost({
      request: jsonRequest({
        subject: 'Reservation',
        fields: reservationFields({
          quoted_price: '1',
          preferred_date: '2026-12-01',
          preferred_date_note: 'forged note from the client',
        }),
      }),
      env: { WEB3FORMS_ACCESS_KEY: 'dummy-server-key', TRAVEL_ORIGIN: '30.6100,-87.3400' },
    } as never),
  );
  const sent = forwarded[0] as Record<string, string>;
  assert.equal(sent.preferred_date_note, undefined);
  assert.equal(sent.preferred_date, '2026-12-01');
});

test('lead: a mis-formatted quote reference is flagged to the owner but never blocks the lead', async () => {
  const { stub, forwarded } = verificationStub();
  const response = await withFetch(stub, () =>
    leadPost({
      request: jsonRequest({
        subject: 'Reservation',
        fields: reservationFields({ quoted_price: '1', quote_reference: 'NOT-A-QUOTE-REF' }),
      }),
      env: { WEB3FORMS_ACCESS_KEY: 'dummy-server-key', TRAVEL_ORIGIN: '30.6100,-87.3400' },
    } as never),
  );
  assert.equal(response.status, 200);
  const sent = forwarded[0] as Record<string, string>;
  assert.equal(sent.quote_reference_valid, 'false');
  assert.equal(sent.quote_verified, 'mismatch', 'the reference flag does not replace the price verdict');
});

test('lead: a moved pin is flagged for the owner and can never be fully verified', async () => {
  const { stub, forwarded } = verificationStub();
  const response = await withFetch(stub, () =>
    leadPost({
      request: jsonRequest({
        subject: 'Reservation',
        fields: reservationFields({
          quoted_price: '1',
          pin_latitude: '30.41114',
          pin_longitude: '-87.21644',
          pin_adjusted: 'yes',
          // A hostile client pretending the pin was untouched:
          pin_check: 'ok',
        }),
      }),
      env: { WEB3FORMS_ACCESS_KEY: 'dummy-server-key', TRAVEL_ORIGIN: '30.6100,-87.3400' },
    } as never),
  );
  assert.equal(response.status, 200);
  const sent = forwarded[0] as Record<string, string>;
  assert.equal(sent.pin_check, 'adjusted', 'the server check replaces the forged client claim');
  assert.notEqual(sent.quote_verified, 'verified');
});

test('lead: a divergent pin without an adjusted claim is still flagged as divergent', async () => {
  const { stub, forwarded } = verificationStub();
  await withFetch(stub, () =>
    leadPost({
      request: jsonRequest({
        subject: 'Reservation',
        fields: reservationFields({
          quoted_price: '1',
          pin_latitude: '30.4291',
          pin_longitude: '-87.2164',
        }),
      }),
      env: { WEB3FORMS_ACCESS_KEY: 'dummy-server-key', TRAVEL_ORIGIN: '30.6100,-87.3400' },
    } as never),
  );
  const sent = forwarded[0] as Record<string, string>;
  assert.equal(sent.pin_check, 'divergent');
  assert.ok(Number(sent.pin_distance_from_geocode_meters) > 500);
  assert.notEqual(sent.quote_verified, 'verified');
});
