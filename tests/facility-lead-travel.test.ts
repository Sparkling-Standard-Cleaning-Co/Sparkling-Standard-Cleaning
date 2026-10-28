import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost as leadPost } from '../functions/api/lead.ts';
import { calculateFacilityPrice, calculateFacilityWorkload } from '../src/lib/estimate/commercial.ts';
import { pricing } from '../src/config/pricing.ts';
import { legalTerms } from '../src/config/legal.ts';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
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

function facilityFields() {
  const workload = calculateFacilityWorkload({
    cleanableSqft: 2000,
    restroomFixtures: 6,
    breakroom: false,
    facilityType: 'office',
    condition: 'average',
    traffic: 'average',
    flooring: 'mixed',
    firstClean: false,
    specialty: false,
  });
  const price = calculateFacilityPrice(workload, 'weekly', { oneWayMiles: 10 });
  assert.ok(price.priced && price.tier === 'A');
  return {
    request_type: 'facility_estimate',
    engine_type: 'commercial',
    service_type: 'commercial_cleaning',
    organization: 'Synthetic Commercial Facility',
    name: 'Synthetic Customer',
    phone: '8500000000',
    email: 'facility@example.test',
    facility_type: 'office',
    cleanable_sqft: '2000',
    restroom_fixtures: '6',
    breakroom: 'none',
    condition: 'average',
    traffic: 'average',
    flooring: 'mixed',
    frequency: 'weekly',
    service_address: '100 S Baylen St',
    address_city: 'Pensacola',
    address_state: 'FL',
    zip: '32502',
    address_method: 'manual',
    address_confirmed: 'yes',
    pin_latitude: '30.411100',
    pin_longitude: '-87.216400',
    pin_adjusted: 'no',
    cleaning_subtotal: String(price.cleaningSubtotal),
    quoted_price: String(price.total),
    quote_config_version: pricing.commercialPricing.configVersion.value,
    // Deliberately forged client travel claims: the server must replace these.
    travel_one_way_miles: '999',
    travel_verified: 'true',
    travel_qualification: 'verified_route',
    terms_accepted: 'yes',
    terms_version: legalTerms.termsVersion,
  };
}

test('facility lead uses server route evidence, not forged client travel claims', async () => {
  let notification: Record<string, string> | null = null;
  const stub = async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    if (href.includes('api.mapmap.ai/geocode?')) {
      return jsonResponse({
        features: [
          {
            properties: {
              label: '100 S Baylen St, Pensacola, FL 32502',
              id: 'us:123',
              housenumber: '100',
              postcode: '32502',
              city: 'Pensacola',
              state: 'FL',
            },
            geometry: { coordinates: [-87.2164, 30.4111] },
          },
        ],
      });
    }
    if (href.includes('/route/v1/')) {
      return jsonResponse({ code: 'Ok', routes: [{ distance: 16093.44, duration: 1200 }] });
    }
    if (href.includes('api.web3forms.com')) {
      notification = JSON.parse(String(init?.body)) as Record<string, string>;
      return jsonResponse({ success: true });
    }
    throw new Error(`unexpected fetch: ${href}`);
  };

  const response = await withFetch(stub, () =>
    leadPost({
      request: new Request('https://example.test/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.99.0.1' },
        body: JSON.stringify({
          subject: 'Facility request - synthetic',
          fields: facilityFields(),
        }),
      }),
      env: {
        WEB3FORMS_ACCESS_KEY: 'test-server-key',
        TRAVEL_ORIGIN: '30.6100,-87.3400',
        ROUTES_PROVIDER: 'mapmap',
        ROUTES_API_KEY: 'test-routes-key',
        REFERENCE_GAS_PRICE: '3.10',
      },
    } as never),
  );

  assert.equal(response.status, 200);
  assert.ok(notification);
  const body = notification as Record<string, string>;
  assert.match(body['Travel — Status'] ?? '', /Verified route/i);
  assert.match(body['Travel — One-way'] ?? '', /10 mi/i);
  assert.doesNotMatch(body['Travel — One-way'] ?? '', /999/);
  assert.equal(body['Facility — Quote check'], 'Verified server calculation');
});
