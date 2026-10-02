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
    quote_reference: 'SS-20261001-ABC123',
    quote_config_version: pricing.instantQuote.configVersion.value,
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

test('a matching reservation with live travel, precise address and current config is fully verified', async () => {
  const now = Date.UTC(2026, 9, 1, 12, 0, 0);
  const quoted = browserPrice();
  const verification = await withFetch(providerStub(), () =>
    verifyReservationQuote(fields({ quoted_price: String(quoted) }), routedEnv, now),
  );
  assert.equal(verification.status, 'verified', verification.note);
  assert.equal(verification.verifiedPrice, quoted);
  assert.equal(verification.clientPrice, quoted);
  assert.equal(verification.travel.verified, true);
  assert.equal(verification.travel.method, 'route');
  assert.equal(verification.travel.oneWayMiles, ROUNDED_ONE_WAY_MILES);
  assert.equal(verification.travel.durationMinutes, ROUNDED_DURATION_MINUTES);
  assert.equal(verification.configMatch, 'match');
  assert.equal(verification.destinationPrecise, true);
  assert.equal(verification.referenceValid, true);
  assert.match(verification.note, /Verified/);
});

test('the config version and expiration policy are recorded on every verdict', async () => {
  const now = Date.UTC(2026, 9, 1, 12, 0, 0);
  const verification = await withFetch(providerStub(), () =>
    verifyReservationQuote(fields({ quoted_price: String(browserPrice()) }), routedEnv, now),
  );
  assert.equal(verification.status, 'verified');
  assert.equal(verification.configVersion, pricing.instantQuote.configVersion.value);
  assert.equal(verification.configMatch, 'match');
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
  assert.equal(verification.status, 'verified');
});

test('browser-submitted coordinates cannot redirect the route — and a divergent pin is flagged', async () => {
  const tampered = fields({
    quoted_price: String(browserPrice()),
    // Coordinates the browser might try to inject (e.g. next door to the origin).
    pin_latitude: '30.6105',
    pin_longitude: '-87.3405',
  });
  const verification = await withFetch(providerStub(), () => verifyReservationQuote(tampered, routedEnv));
  // The travel distance still reflects the geocoded address, not the injected pin.
  assert.equal(verification.travel.destinationSource, 'address_geocode');
  assert.equal(verification.travel.oneWayMiles, ROUNDED_ONE_WAY_MILES);
  // The injected pin no longer matches the address, so the quote cannot verify.
  assert.equal(verification.pinCheck, 'divergent');
  assert.equal(verification.status, 'preliminary');
  assert.notEqual(verification.status, 'verified');
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

test('without TRAVEL_ORIGIN verification still recalculates, but never as verified', async () => {
  const quoted = browserPrice({}, false, false);
  const verification = await withFetch(providerStub(), () =>
    verifyReservationQuote(fields({ quoted_price: String(quoted) }), zoneEnv),
  );
  assert.equal(verification.status, 'preliminary');
  assert.equal(verification.travel.method, 'zone');
  assert.equal(verification.travel.verified, false);
  // The address is still resolved server-side for the owner's records even
  // when no private origin exists to route from.
  assert.equal(verification.travel.destinationSource, 'address_geocode');
  assert.match(verification.note, /Preliminary/);
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
  assert.ok(['preliminary', 'mismatch'].includes(verification.status));
  assert.notEqual(verification.status, 'verified');
});

// ── Integrity: uncertainty is preserved, never rounded down ─────────────────

test('a matching price routed only to the ZIP centre is preliminary, never verified', async () => {
  // The address cannot be geocoded (both provider and Census return nothing),
  // so the server falls back to the ZIP centroid even though routing is live.
  const quoted = browserPrice();
  const verification = await withFetch(
    async (url) => {
      const href = String(url);
      if (href.includes('geocoding.geo.census.gov')) {
        return jsonResponse({ result: { addressMatches: [] } });
      }
      if (href.includes('api.mapmap.ai/geocode?')) {
        return jsonResponse({ features: [] });
      }
      if (href.includes('/route/v1/')) {
        return jsonResponse({ code: 'Ok', routes: [{ distance: 19000, duration: 900 }] });
      }
      return jsonResponse({}, 500);
    },
    () => verifyReservationQuote(fields({ quoted_price: String(quoted) }), routedEnv),
  );
  assert.equal(verification.travel.destinationSource, 'zip_centroid');
  assert.equal(verification.travel.verified, true, 'the route itself is live');
  assert.equal(verification.destinationPrecise, false);
  assert.equal(verification.status, 'preliminary');
  assert.match(verification.note, /ZIP-centre/);
});

test('a match with an unknown configuration version is preliminary', async () => {
  const quoted = browserPrice();
  const withoutVersion = fields({ quoted_price: String(quoted) });
  delete withoutVersion.quote_config_version;
  const verification = await withFetch(providerStub(), () =>
    verifyReservationQuote(withoutVersion, routedEnv),
  );
  assert.equal(verification.status, 'preliminary');
  assert.equal(verification.configMatch, 'unknown');
  assert.match(verification.note, /no configuration version/);
});

test('a match built on a stale configuration version is preliminary', async () => {
  const quoted = browserPrice();
  const verification = await withFetch(providerStub(), () =>
    verifyReservationQuote(
      fields({ quoted_price: String(quoted), quote_config_version: '2026-09-01.option-c.v0' }),
      routedEnv,
    ),
  );
  assert.equal(verification.status, 'preliminary');
  assert.equal(verification.configMatch, 'mismatch');
  assert.match(verification.note, /different configuration version/);
});

test('a forged quote reference is flagged but is never treated as authorization', async () => {
  const quoted = browserPrice();
  const verification = await withFetch(providerStub(), () =>
    verifyReservationQuote(
      fields({ quoted_price: String(quoted), quote_reference: 'FORGED-REFERENCE' }),
      routedEnv,
    ),
  );
  assert.equal(verification.referenceValid, false, 'the forged reference is recorded as invalid');
  // The reference is display data: it neither verifies nor invalidates the price.
  assert.equal(verification.status, 'verified');
});

test('scope tampering is caught: a small-home price submitted for a large home mismatches', async () => {
  const smallHomePrice = browserPrice({ squareFeet: 300, bedrooms: 0, fullBaths: 1 });
  const verification = await withFetch(providerStub(), () =>
    verifyReservationQuote(fields({ quoted_price: String(smallHomePrice) }), routedEnv),
  );
  assert.equal(verification.status, 'mismatch');
  assert.ok(verification.verifiedPrice !== null && verification.verifiedPrice > smallHomePrice);
});

test("a fabricated price that differs by a cent beyond tolerance is a mismatch, not 'close enough'", async () => {
  const quoted = browserPrice();
  const verification = await withFetch(providerStub(), () =>
    verifyReservationQuote(fields({ quoted_price: String(quoted + QUOTE_MATCH_TOLERANCE + 0.01) }), routedEnv),
  );
  assert.equal(verification.status, 'mismatch');
});

// ── Pin integrity: a moved pin is a different destination ───────────────────

test('a customer-moved pin is never verified even when price, route and config all match', async () => {
  const quoted = browserPrice();
  // The pin sits ~5 m from the address (jitter), but the customer reports a drag.
  const verification = await withFetch(providerStub(), () =>
    verifyReservationQuote(
      fields({
        quoted_price: String(quoted),
        pin_latitude: '30.41114',
        pin_longitude: '-87.21644',
        pin_adjusted: 'yes',
      }),
      routedEnv,
    ),
  );
  assert.equal(verification.pinCheck, 'adjusted');
  assert.equal(verification.status, 'preliminary', 'a moved pin must never be fully verified');
  assert.match(verification.note, /moved the confirmed pin/i);
});

test('a divergent pin is never verified even when the adjusted flag is omitted', async () => {
  const quoted = browserPrice();
  // ~2 km away from the geocoded address, with no pin_adjusted claim.
  const verification = await withFetch(providerStub(), () =>
    verifyReservationQuote(
      fields({
        quoted_price: String(quoted),
        pin_latitude: '30.4291',
        pin_longitude: '-87.2164',
      }),
      routedEnv,
    ),
  );
  assert.equal(verification.pinCheck, 'divergent');
  assert.ok(verification.pinDistanceMeters !== null && verification.pinDistanceMeters > 500);
  assert.equal(verification.status, 'preliminary', 'travel to the original address cannot verify a moved pin');
  assert.match(verification.note, /submitted pin is about/i);
});

test('a small pin jitter with no reported move does not degrade a verified quote', async () => {
  const quoted = browserPrice();
  const verification = await withFetch(providerStub(), () =>
    verifyReservationQuote(
      fields({
        quoted_price: String(quoted),
        pin_latitude: '30.41110',
        pin_longitude: '-87.21640',
        pin_adjusted: 'no',
      }),
      routedEnv,
    ),
  );
  assert.equal(verification.pinCheck, 'ok');
  assert.equal(verification.status, 'verified');
});

test('reservations without pin coordinates keep the previous verified behavior', async () => {
  const quoted = browserPrice();
  const verification = await withFetch(providerStub(), () =>
    verifyReservationQuote(fields({ quoted_price: String(quoted) }), routedEnv),
  );
  assert.equal(verification.pinCheck, 'unknown');
  assert.equal(verification.status, 'verified');
});
