// Estimate payment endpoint tests — server-owned amount and fail-closed paths.
// No network: global fetch is stubbed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost } from '../functions/api/estimate-checkout.ts';
import { calculateFacilityPrice, calculateFacilityWorkload } from '../src/lib/estimate/commercial.ts';
import { pricing } from '../src/config/pricing.ts';

let ip = 0;
const jsonRequest = (body: unknown) =>
  new Request('https://example.test/api/estimate-checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.88.0.${++ip}` },
    body: JSON.stringify(body),
  });

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

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

test('a valid Tier A facility quote charges the server total, never the browser value', async () => {
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
  const serverPrice = calculateFacilityPrice(workload, 'weekly', {
    oneWayMiles: null,
    church: false,
  });
  assert.ok(serverPrice.priced && serverPrice.tier === 'A');
  let amountCents = '';

  const response = await withFetch(
    async (url, init) => {
      assert.match(String(url), /api\.stripe\.com\/v1\/checkout\/sessions/);
      const body = init?.body as URLSearchParams;
      amountCents = body.get('line_items[0][price_data][unit_amount]') ?? '';
      assert.equal(body.get('metadata[checkout_kind]'), 'estimate_payment');
      assert.equal(body.get('line_items[0][price_data][currency]'), 'usd');
      return jsonResponse({ url: 'https://checkout.stripe.test/session' });
    },
    () =>
      onRequestPost({
        request: jsonRequest({
          fields: {
            request_type: 'facility_estimate',
            engine_type: 'commercial',
            service_type: 'commercial_cleaning',
            cleanable_sqft: '2000',
            restroom_fixtures: '6',
            frequency: 'weekly',
            condition: 'average',
            traffic: 'average',
            flooring: 'mixed',
            cleaning_subtotal: String(serverPrice.cleaningSubtotal),
            quoted_price: String(serverPrice.total),
            quote_config_version: pricing.commercialPricing.configVersion.value,
            email: 'customer@example.test',
          },
          returnPath: '/estimate/commercial/',
        }),
        env: { STRIPE_SECRET_KEY: 'sk_test_dummy' },
      } as never),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, url: 'https://checkout.stripe.test/session' });
  assert.equal(amountCents, String(Math.round(serverPrice.total * 100)));
});

test('a client-inflated facility price is rejected before Stripe is called', async () => {
  let called = false;
  const response = await withFetch(
    async () => {
      called = true;
      return jsonResponse({ url: 'https://checkout.stripe.test/session' });
    },
    () =>
      onRequestPost({
        request: jsonRequest({
          fields: {
            request_type: 'facility_estimate',
            engine_type: 'commercial',
            service_type: 'commercial_cleaning',
            cleanable_sqft: '2000',
            restroom_fixtures: '6',
            frequency: 'weekly',
            condition: 'average',
            traffic: 'average',
            flooring: 'mixed',
            cleaning_subtotal: '125',
            quoted_price: '1',
            quote_config_version: pricing.commercialPricing.configVersion.value,
          },
          returnPath: '/estimate/commercial/',
        }),
        env: { STRIPE_SECRET_KEY: 'sk_test_dummy' },
      } as never),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, error: 'quote_not_payable' });
  assert.equal(called, false);
});
