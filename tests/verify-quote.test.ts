// Reservation quote verification tests — the server NEVER trusts the browser.
//
// Every provider call is mocked (MapMap geocode/route, Census, EIA). No API
// key, network access or private origin value is required.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isPricedReservation,
  mapReservationFields,
  resolveServerDestination,
  verifyReservationQuote,
  QUOTE_MATCH_TOLERANCE,
  type QuoteVerificationEnv,
} from '../src/lib/estimate/verify.ts';
import { calculateEstimate, type EstimateContext } from '../src/lib/estimate/calculate.ts';
import { selectInstantAmount } from '../src/lib/estimate/quote.ts';
import { pricing } from '../src/config/pricing.ts';
import { travelConfig } from '../src/config/travel.ts';
import type { EstimateInput } from '../src/lib/estimate/types.ts';

const ORIGIN = '30.6100,-87.3400';
const MAPMAP_KEY = 'dummy-mapmap-key';
const ROUNDED_ONE_WAY_MILES = Math.round((24140.2 / 1609.344) * 10) / 10;
const ROUNDED_DURATION_MINUTES = 30;

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

function providerStub(overrides: { noRoute?: boolean; routeMeters?: number } = {}) {
  return async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const href = String(url);
    if (href.includes('/route/v1/')) {
      if (overrides.noRoute) return jsonResponse({ code: 'quota-exceeded' }, 429);
      return jsonResponse({
        code: 'Ok',
        routes: [{ distance: overrides.routeMeters ?? 24140.2, duration: 1800.5 }],
      });
    }
    if (href.includes('api.mapmap.ai/geocode?')) {
      return jsonResponse({
        features: [
          {
            properties: {
              label: '100 S Baylen St, Pensacola, FL 32502',
              id: 'us:123',
              postcode: '32502',
              city: 'Pensacola',
              state: 'FL',
            },
            geometry: { coordinates: [-87.2164, 30.4111] },
          },
        ],
      });
    }
    if (href.includes('geocoding.geo.census.gov')) {
      return jsonResponse({
        result: {
          addressMatches: [
            {
              matchedAddress: '100 S BAYLEN ST, PENSACOLA, FL, 32502',
              coordinates: { x: -87.2164, y: 30.4111 },
            },
          ],
        },
      });
    }
    if (href.includes('api.eia.gov')) return jsonResponse({ error: 'not used' }, 500);
    // Default provider stub: fail, so tests notice unexpected calls.
    if (init?.method === 'POST' || init?.method === 'GET') {
      return jsonResponse({ error: 'unexpected' }, 500);
    }
    return jsonResponse({}, 500);
  };
}

function fields(overrides: Record<string, string> = {}): Record<string, string> {
  return {
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
    ...overrides,
  };
}

/** Computes the same client-side price a browser would show for these fields. */
function browserPrice(
  overrides: Partial<EstimateInput> = {},
  routed = true,
  envOrigin = true,
): number {
  const input: EstimateInput = {
    serviceType: 'standard',
    propertyType: 'house',
    squareFeet: 1600,
    bedrooms: 3,
    fullBaths: 2,
    halfBaths: 0,
    frequency: 'one_time',
    condition: 'maintained',
    lastClean: 'within_month',
    addonIds: [],
    zip: '32503',
    pets: 'none',
    ...overrides,
  };
  const context: EstimateContext = {
    travel: {
      ...(routed && envOrigin
        ? {
            routed: {
              oneWayMiles: ROUNDED_ONE_WAY_MILES,
              durationMinutes: ROUNDED_DURATION_MINUTES,
              gasPrice: travelConfig.fallbackGasPrice,
              gasPriceSource: 'configured_reference' as const,
              provider: 'mapmap',
              method: 'route' as const,
              verified: true,
            },
          }
        : {}),
      includedOneWayMiles: travelConfig.includedOneWayMiles,
      mpg: travelConfig.mpg,
      wearPerMile: travelConfig.wearPerMile,
      referenceGasPrice: travelConfig.fallbackGasPrice,
      zoneAdjustments: { core: 0, surrounding: pricing.travel.zoneAdjustments.surrounding.value },
      maxInstantDistanceMiles: travelConfig.maxInstantDistanceMiles,
      maxDrivingMinutes: travelConfig.maxDrivingMinutes,
      reviewBandMinutes: travelConfig.reviewBandMinutes,
    },
  };
  const result = calculateEstimate(input, context);
  const amount = selectInstantAmount(result);
  assert.ok(amount !== null, 'test fixture must be instantly estimable');
  return amount;
}

const routedEnv: QuoteVerificationEnv = {
  TRAVEL_ORIGIN: ORIGIN,
  ROUTES_PROVIDER: 'mapmap',
  ROUTES_API_KEY: MAPMAP_KEY,
};

const zoneEnv: QuoteVerificationEnv = {};

// ── Field mapping ────────────────────────────────────────────────────────────

test('mapReservationFields maps structured values and addon ids', () => {
  const draft = mapReservationFields(fields({ addon_ids: 'inside_oven, laundry ,' }));
  assert.equal(draft.serviceType, 'standard');
  assert.equal(draft.squareFeet, 1600);
  assert.deepEqual(draft.addonIds, ['inside_oven', 'laundry']);
  assert.equal(draft.zip, '32503');
});

test('isPricedReservation only matches priced reservation requests', () => {
  assert.equal(isPricedReservation(fields({ quoted_price: '255' })), true);
  assert.equal(isPricedReservation(fields()), false);
  assert.equal(isPricedReservation(fields({ quoted_price: '255', request_type: 'residential_estimate' })), false);
});

// ── Server-side destination resolution ───────────────────────────────────────

test('the server geocodes the address instead of accepting client coordinates', async () => {
  const destination = await withFetch(providerStub(), () =>
    resolveServerDestination(
      fields({ pin_latitude: '0', pin_longitude: '0' }),
      routedEnv,
    ),
  );
  assert.equal(destination?.source, 'address_geocode');
  assert.equal(destination?.lat, 30.4111);
  assert.equal(destination?.lng, -87.2164);
});

test('without a provider key the server falls back to the free Census geocoder', async () => {
  const destination = await withFetch(providerStub(), () =>
    resolveServerDestination(fields(), { TRAVEL_ORIGIN: ORIGIN }),
  );
  assert.equal(destination?.source, 'address_geocode');
  assert.equal(destination?.lat, 30.4111);
});

test('an unresolvable address falls back to the provisional ZIP centroid', async () => {
  const destination = await withFetch(
    async () => jsonResponse({ result: { addressMatches: [] } }),
    () => resolveServerDestination(fields(), { TRAVEL_ORIGIN: ORIGIN }),
  );
  assert.equal(destination?.source, 'zip_centroid');
  assert.equal(destination?.lat, 30.45);
});

// ── Match / mismatch verdicts ────────────────────────────────────────────────

test('a matching reservation verifies with the server-recalculated price', async () => {
  const now = Date.UTC(2026, 9, 1, 12, 0, 0);
  const quoted = browserPrice();
  const verification = await withFetch(providerStub(), () =>
    verifyReservationQuote(fields({ quoted_price: String(quoted) }), routedEnv, now),
  );
  assert.equal(verification.status, 'match');
  assert.equal(verification.verifiedPrice, quoted);
  assert.equal(verification.clientPrice, quoted);
  assert.equal(verification.travel.verified, true);
  assert.equal(verification.travel.method, 'route');
  assert.equal(verification.travel.oneWayMiles, ROUNDED_ONE_WAY_MILES);
  assert.equal(verification.travel.durationMinutes, ROUNDED_DURATION_MINUTES);
  assert.match(verification.note, /Verified/);
});

test('the config version and expiration policy are recorded on every verdict', async () => {
  const now = Date.UTC(2026, 9, 1, 12, 0, 0);
  const verification = await withFetch(providerStub(), () =>
    verifyReservationQuote(fields({ quoted_price: String(browserPrice()) }), routedEnv, now),
  );
  assert.equal(verification.configVersion, pricing.instantQuote.configVersion.value);
  assert.equal(
    new Date(verification.validThrough).getTime(),
    now + pricing.instantQuote.validityHours.value * 3_600_000,
  );
});

test('a client price below the server calculation is a mismatch', async () => {
  const quoted = browserPrice();
  const verification = await withFetch(providerStub(), () =>
    verifyReservationQuote(fields({ quoted_price: String(quoted - 50) }), routedEnv),
  );
  assert.equal(verification.status, 'mismatch');
  assert.equal(verification.verifiedPrice, quoted);
  assert.match(verification.note, /Do not confirm/);
});

test('an inflated client price is a mismatch', async () => {
  const quoted = browserPrice();
  const verification = await withFetch(providerStub(), () =>
    verifyReservationQuote(fields({ quoted_price: String(quoted + 200) }), routedEnv),
  );
  assert.equal(verification.status, 'mismatch');
  assert.equal(verification.verifiedPrice, quoted);
});

test('a small variance within the stated tolerance still matches', async () => {
  const quoted = browserPrice();
  const verification = await withFetch(providerStub(), () =>
    verifyReservationQuote(fields({ quoted_price: String(quoted + QUOTE_MATCH_TOLERANCE) }), routedEnv),
  );
  assert.equal(verification.status, 'match');
});

test('browser-submitted coordinates cannot redirect the verified destination', async () => {
  const tampered = fields({
    quoted_price: String(browserPrice()),
    // Coordinates the browser might try to inject (e.g. next door to the origin).
    pin_latitude: '30.6105',
    pin_longitude: '-87.3405',
  });
  const verification = await withFetch(providerStub(), () => verifyReservationQuote(tampered, routedEnv));
  assert.equal(verification.status, 'match');
  // The travel distance reflects the geocoded address, not the injected pin.
  assert.equal(verification.travel.destinationSource, 'address_geocode');
  assert.equal(verification.travel.oneWayMiles, ROUNDED_ONE_WAY_MILES);
});

test('tampered client fields that break the model are a mismatch, never a verified price', async () => {
  const verification = await withFetch(providerStub(), () =>
    verifyReservationQuote(
      fields({ quoted_price: String(browserPrice()), addon_ids: 'carpet_cleaning' }),
      routedEnv,
    ),
  );
  assert.equal(verification.status, 'mismatch');
  assert.equal(verification.verifiedPrice, null);
});

test('invalid or incomplete fields are unverifiable, never silently accepted', async () => {
  const verification = await withFetch(providerStub(), () =>
    verifyReservationQuote(fields({ quoted_price: '200', square_feet: '', condition: '' }), routedEnv),
  );
  assert.equal(verification.status, 'unverifiable');
  assert.match(verification.note, /Could not verify/);
});

test('a reservation without a submitted price is unverifiable but still reports the server price', async () => {
  const verification = await withFetch(providerStub(), () =>
    verifyReservationQuote(fields(), routedEnv),
  );
  assert.equal(verification.status, 'unverifiable');
  assert.equal(verification.verifiedPrice, browserPrice());
});

// ── Offline / degradation paths ──────────────────────────────────────────────

test('without TRAVEL_ORIGIN verification still recalculates in offline zone mode', async () => {
  const quoted = browserPrice({}, false, false);
  const verification = await withFetch(providerStub(), () =>
    verifyReservationQuote(fields({ quoted_price: String(quoted) }), zoneEnv),
  );
  assert.equal(verification.status, 'match');
  assert.equal(verification.travel.method, 'zone');
  assert.equal(verification.travel.verified, false);
  // The address is still resolved server-side for the owner's records even
  // when no private origin exists to route from.
  assert.equal(verification.travel.destinationSource, 'address_geocode');
});

test('a routing quota refusal degrades to preliminary travel but still verifies the price model', async () => {
  const now = Date.UTC(2026, 9, 1, 12, 0, 0);
  const stub = providerStub({ noRoute: true });
  const verification = await withFetch(stub, () =>
    verifyReservationQuote(fields({ quoted_price: '0' }), routedEnv, now),
  );
  assert.equal(verification.travel.method, 'straight_line_estimate');
  assert.equal(verification.travel.verified, false);
  assert.equal(verification.status, 'mismatch', 'a $0 price never verifies as a match');
});

test('a total network outage still recomputes from the ZIP reference and stays honest', async () => {
  const verification = await withFetch(
    async () => {
      throw new Error('network down');
    },
    () => verifyReservationQuote(fields({ quoted_price: '255' }), routedEnv),
  );
  // Geocoding and routing are both down; the ZIP centroid + straight-line
  // fallback still produce a deterministic server price, and the verdict
  // remains an honest comparison rather than an acceptance.
  assert.equal(verification.travel.destinationSource, 'zip_centroid');
  assert.equal(verification.travel.method, 'straight_line_estimate');
  assert.ok(verification.verifiedPrice !== null && verification.verifiedPrice > 0);
  assert.ok(['match', 'mismatch'].includes(verification.status));
});
