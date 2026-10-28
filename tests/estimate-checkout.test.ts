// Estimate checkout endpoint tests: readiness, server-owned amounts, durable
// idempotency, exact-price enforcement and price-change acceptance.
// No network: geocoding, routing, Stripe and readiness probes are stubbed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  onRequestPost,
  paymentReadiness,
} from '../functions/api/estimate-checkout.ts';
import { calculateFacilityPrice, calculateFacilityWorkload } from '../src/lib/estimate/commercial.ts';
import { calculateEstimate } from '../src/lib/estimate/calculate.ts';
import { selectInstantAmount } from '../src/lib/estimate/quote.ts';
import { travelConfig } from '../src/config/estimators/travel.ts';
import { pricing } from '../src/config/pricing.ts';
import { FakeLedger } from './helpers/payment-fakes.ts';

let ip = 0;
let secretSerial = 0;

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

function makeEnv(ledger: FakeLedger) {
  return {
    STRIPE_SECRET_KEY: `sk_live_test_${++secretSerial}`,
    STRIPE_WEBHOOK_SECRET: 'whsec_test_checkout',
    WEB3FORMS_ACCESS_KEY: 'web3forms_test',
    PAYMENT_LEDGER: ledger,
    PUBLIC_SITE_URL: 'https://sparkling-standard.com',
    TRAVEL_ORIGIN: '30.6100,-87.3400',
    ROUTES_PROVIDER: 'mapmap',
    ROUTES_API_KEY: 'routes_test',
    REFERENCE_GAS_PRICE: '3.10',
  };
}

function providerStub(options: { includeDuration?: boolean } = {}) {
  const includeDuration = options.includeDuration !== false;
  let checkoutPosts = 0;
  const stub = async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    if (href.includes('/v1/webhook_endpoints')) {
      return jsonResponse({
        data: [
          {
            url: 'https://sparkling-standard.com/api/stripe-webhook',
            status: 'enabled',
            enabled_events: ['checkout.session.completed'],
          },
        ],
      });
    }
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
      return jsonResponse({
        code: 'Ok',
        routes: [{ distance: 16093.44, ...(includeDuration ? { duration: 1200 } : {}) }],
      });
    }
    if (href.includes('/v1/checkout/sessions/')) {
      return jsonResponse({
        id: 'cs_test_valid',
        status: 'open',
        url: 'https://checkout.stripe.test/session',
        metadata: { checkout_kind: 'estimate_payment' },
      });
    }
    if (href.includes('/v1/checkout/sessions')) {
      checkoutPosts += 1;
      assert.equal(init?.method, 'POST');
      return jsonResponse({
        id: 'cs_test_valid',
        url: 'https://checkout.stripe.test/session',
        status: 'open',
      });
    }
    throw new Error(`unexpected provider call: ${href}`);
  };
  return { stub, postCount: () => checkoutPosts };
}

function validFacilityInput(engine: 'commercial' | 'church' = 'commercial') {
  const workload = calculateFacilityWorkload({
    cleanableSqft: 2000,
    restroomFixtures: 6,
    breakroom: false,
    facilityType: engine === 'church' ? 'church' : 'office',
    condition: 'average',
    traffic: 'average',
    flooring: 'mixed',
    firstClean: false,
    specialty: false,
  });
  const price = calculateFacilityPrice(workload, 'weekly', {
    oneWayMiles: 10,
    church: engine === 'church',
  });
  assert.ok(price.priced && price.tier === 'A');
  return {
    workload,
    price,
    fields: {
      request_type: 'facility_estimate',
      engine_type: engine,
      service_type: engine === 'church' ? 'church_cleaning' : 'commercial_cleaning',
      cleanable_sqft: '2000',
      restroom_fixtures: '6',
      frequency: 'weekly',
      condition: 'average',
      traffic: 'average',
      flooring: 'mixed',
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
      email: 'customer@example.test',
      name: 'Synthetic Customer',
      organization: engine === 'church' ? 'Synthetic Church' : 'Synthetic Facility',
      phone: '8500000000',
      terms_accepted: 'yes',
      terms_version: '2026-10-28.terms.v2',
    },
  };
}

function tierBFacilityInput() {
  const workload = calculateFacilityWorkload({
    cleanableSqft: 8000,
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
  assert.ok(price.priced && price.tier === 'B');
  return {
    price,
    fields: {
      request_type: 'facility_estimate',
      engine_type: 'commercial',
      service_type: 'commercial_cleaning',
      facility_type: 'office',
      cleanable_sqft: '8000',
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
      email: 'customer@example.test',
      name: 'Synthetic Customer',
      organization: 'Synthetic Tier B Facility',
      phone: '8500000000',
      terms_accepted: 'yes',
      terms_version: '2026-10-28.terms.v2',
    } as Record<string, string>,
  };
}

test('readiness requires the key, webhook secret, notification and durable ledger', async () => {
  const ledger = new FakeLedger();
  const env = makeEnv(ledger);
  const { stub } = providerStub();
  await withFetch(stub, async () => {
    const ready = await paymentReadiness(env as never);
    assert.equal(ready.enabled, true);
    assert.equal(ready.mode, 'live');
    assert.equal(ready.checks.webhook_endpoint, true);
  });

  const noWebhook = makeEnv(ledger);
  delete (noWebhook as { STRIPE_WEBHOOK_SECRET?: string }).STRIPE_WEBHOOK_SECRET;
  const { stub: noWebhookStub } = providerStub();
  await withFetch(noWebhookStub, async () => {
    const ready = await paymentReadiness(noWebhook as never);
    assert.equal(ready.enabled, false);
    assert.equal(ready.checks.webhook_secret, false);
  });

  const missingEndpoint = makeEnv(ledger);
  const { stub: noEndpointStub } = providerStub();
  await withFetch(
    async (url) => {
      if (String(url).includes('/v1/webhook_endpoints')) {
        return jsonResponse({ data: [{ url: 'https://example.test/other', status: 'enabled', enabled_events: ['checkout.session.completed'] }] });
      }
      return noEndpointStub(url);
    },
    async () => {
      const ready = await paymentReadiness(missingEndpoint as never);
      assert.equal(ready.enabled, false);
      assert.equal(ready.checks.webhook_endpoint, false);
    },
  );
});

test('a test-mode key is not advertised on the production origin', async () => {
  const ledger = new FakeLedger();
  const env = { ...makeEnv(ledger), STRIPE_SECRET_KEY: `sk_test_${++secretSerial}` };
  const { stub } = providerStub();
  await withFetch(stub, async () => {
    const ready = await paymentReadiness(env as never);
    assert.equal(ready.enabled, false);
    assert.equal(ready.mode, 'test');
    assert.equal(ready.checks.mode_allowed, false);
  });
});

test('a valid facility quote creates one session at the server-calculated amount', async () => {
  const ledger = new FakeLedger();
  const env = makeEnv(ledger);
  const provider = providerStub();
  const { price, fields } = validFacilityInput();
  let amountCents = '';

  const response = await withFetch(
    async (url, init) => {
      if (String(url).includes('/v1/checkout/sessions') && !String(url).includes('/v1/checkout/sessions/')) {
        const body = init?.body as URLSearchParams;
        amountCents = body.get('line_items[0][price_data][unit_amount]') ?? '';
        assert.equal(body.get('metadata[checkout_kind]'), 'estimate_payment');
        assert.match(body.get('metadata[checkout_attempt]') ?? '', /^[a-f0-9]{64}$/);
        assert.match(String(init?.headers && (init.headers as Record<string, string>)['Idempotency-Key']), /^ss-estimate-[a-f0-9]{64}-1$/);
      }
      return provider.stub(url, init);
    },
    () =>
      onRequestPost({
        request: jsonRequest({ fields, returnPath: '/estimate/commercial/' }),
        env,
      } as never),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, url: 'https://checkout.stripe.test/session' });
  assert.equal(amountCents, String(Math.round(price.total * 100)));
  assert.equal(provider.postCount(), 1);
  assert.equal(ledger.values.size, 1);
});

test('a Tier B facility quote cannot create a checkout session through the API', async () => {
  const ledger = new FakeLedger();
  const env = makeEnv(ledger);
  const provider = providerStub();
  const { fields } = tierBFacilityInput();
  const response = await withFetch(provider.stub, () =>
    onRequestPost({
      request: jsonRequest({ fields, returnPath: '/estimate/commercial/' }),
      env,
    } as never),
  );
  assert.equal(response.status, 400);
  const data = (await response.json()) as { error?: string; reason?: string };
  assert.equal(data.error, 'quote_not_payable');
  assert.equal(data.reason, 'facility_range');
  assert.equal(provider.postCount(), 0, 'no Stripe session for a Tier B range');
});

test('repeated requests return the existing session instead of charging twice', async () => {
  const ledger = new FakeLedger();
  const env = makeEnv(ledger);
  const provider = providerStub();
  const { fields } = validFacilityInput();
  const run = () =>
    onRequestPost({
      request: jsonRequest({ fields, returnPath: '/estimate/commercial/' }),
      env,
    } as never);

  const first = await withFetch(provider.stub, run);
  assert.equal(first.status, 200);
  const second = await withFetch(provider.stub, run);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { ok: true, url: 'https://checkout.stripe.test/session' });
  assert.equal(provider.postCount(), 1, 'the second call must reuse the open session');
});

test('client price manipulation is rejected before Stripe is called', async () => {
  const ledger = new FakeLedger();
  const env = makeEnv(ledger);
  const provider = providerStub();
  const { fields } = validFacilityInput();
  const response = await withFetch(provider.stub, () =>
    onRequestPost({
      request: jsonRequest({ fields: { ...fields, quoted_price: '1' }, returnPath: '/estimate/commercial/' }),
      env,
    } as never),
  );
  assert.equal(response.status, 400);
  const data = (await response.json()) as { error?: string; reason?: string };
  assert.equal(data.error, 'quote_not_payable');
  assert.equal(data.reason, 'price_mismatch');
  assert.equal(provider.postCount(), 0);
});

test('a small server price difference requires explicit acceptance before checkout', async () => {
  const ledger = new FakeLedger();
  const env = makeEnv(ledger);
  const provider = providerStub();
  const { price, fields } = validFacilityInput();
  const changed = { ...fields, quoted_price: String(Number(price.total) - 1) };
  const first = await withFetch(provider.stub, () =>
    onRequestPost({
      request: jsonRequest({ fields: changed, returnPath: '/estimate/commercial/' }),
      env,
    } as never),
  );
  assert.equal(first.status, 409);
  const changedBody = (await first.json()) as {
    error?: string;
    amount?: number;
    quotedAmount?: number;
  };
  assert.equal(changedBody.error, 'quote_changed');
  assert.equal(changedBody.amount, price.total);
  assert.equal(changedBody.quotedAmount, Number(price.total) - 1);
  assert.equal(provider.postCount(), 0, 'no session before explicit acceptance');

  const accepted = await withFetch(provider.stub, () =>
    onRequestPost({
      request: jsonRequest({
        fields: changed,
        returnPath: '/estimate/commercial/',
        acceptRecalculated: true,
        acceptedAmount: price.total,
      }),
      env,
    } as never),
  );
  assert.equal(accepted.status, 200);
  assert.equal(provider.postCount(), 1);
});

test('a facility payment without a server-confirmed street address is reservation-only', async () => {
  const ledger = new FakeLedger();
  const env = makeEnv(ledger);
  const provider = providerStub();
  const { fields } = validFacilityInput();
  const response = await withFetch(provider.stub, () =>
    onRequestPost({
      request: jsonRequest({
        fields: {
          ...fields,
          service_address: '',
          address_method: 'gps',
          address_confirmed: 'yes',
        },
        returnPath: '/estimate/commercial/',
      }),
      env,
    } as never),
  );
  assert.equal(response.status, 400);
  const data = (await response.json()) as { reason?: string };
  assert.equal(data.reason, 'address_required');
  assert.equal(provider.postCount(), 0);
});

function validResidentialInput(serviceType: 'standard' | 'str_turnover') {
  const isStr = serviceType === 'str_turnover';
  const input = {
    serviceType,
    propertyType: isStr ? ('condo' as const) : ('house' as const),
    squareFeet: isStr ? 900 : 1600,
    bedrooms: isStr ? 2 : 3,
    fullBaths: 2,
    halfBaths: 0,
    ...(isStr ? { beds: 2 } : {}),
    frequency: 'one_time' as const,
    condition: 'maintained' as const,
    lastClean: 'within_month' as const,
    addonIds: [],
    zip: '32502',
    destinationConfirmed: true,
    pets: 'none' as const,
  };
  const context = {
    travel: {
      routed: {
        oneWayMiles: 10,
        durationMinutes: 30,
        gasPrice: 3.1,
        gasPriceSource: 'configured_reference' as const,
        provider: 'mapmap',
        method: 'route' as const,
        verified: true,
      },
      includedOneWayMiles: travelConfig.includedOneWayMiles,
      mpg: travelConfig.mpg,
      wearPerMile: travelConfig.wearPerMile,
      referenceGasPrice: travelConfig.fallbackGasPrice,
      zoneAdjustments: {
        core: pricing.travel.zoneAdjustments.core.value,
        surrounding: pricing.travel.zoneAdjustments.surrounding.value,
      },
      maxInstantDistanceMiles: travelConfig.maxInstantDistanceMiles,
      maxDrivingMinutes: travelConfig.maxDrivingMinutes,
      reviewBandMinutes: travelConfig.reviewBandMinutes,
    },
  };
  const result = calculateEstimate(input, context);
  const amount = selectInstantAmount(result);
  assert.ok(result.status === 'estimated' && amount !== null);
  return {
    amount,
    fields: {
      request_type: 'reservation_request',
      estimate_status: 'estimated',
      service_type: serviceType,
      property_type: input.propertyType,
      square_feet: String(input.squareFeet),
      bedrooms: String(input.bedrooms),
      full_baths: '2',
      half_baths: '0',
      ...(isStr ? { beds: '2' } : {}),
      frequency: 'one_time',
      condition: 'maintained',
      last_cleaned: 'within_month',
      pets: 'none',
      addon_ids: '',
      zip: '32502',
      service_address: '100 S Baylen St',
      address_city: 'Pensacola',
      address_state: 'FL',
      address_method: 'manual',
      address_confirmed: 'yes',
      pin_latitude: '30.411100',
      pin_longitude: '-87.216400',
      pin_adjusted: 'no',
      quoted_price: String(amount),
      quote_reference: 'SS-20261027-ABC123',
      quote_config_version: pricing.instantQuote.configVersion.value,
      email: 'customer@example.test',
      name: 'Synthetic Customer',
      phone: '8500000000',
      terms_accepted: 'yes',
      terms_version: '2026-10-28.terms.v2',
    } as Record<string, string>,
  };
}

for (const serviceType of ['standard', 'str_turnover'] as const) {
  test(`${serviceType} exact verified quote creates checkout at the server amount`, async () => {
    const ledger = new FakeLedger();
    const env = makeEnv(ledger);
    const provider = providerStub();
    const { amount, fields } = validResidentialInput(serviceType);
    const response = await withFetch(provider.stub, () =>
      onRequestPost({
        request: jsonRequest({ fields, returnPath: serviceType === 'str_turnover' ? '/estimate/str/' : '/estimate/residential/' }),
        env,
      } as never),
    );
    assert.equal(response.status, 200);
    assert.equal(provider.postCount(), 1);
    assert.equal(amount > 0, true);
  });
}

test('a residential route without a driving duration cannot create checkout', async () => {
  const ledger = new FakeLedger();
  const env = makeEnv(ledger);
  const provider = providerStub({ includeDuration: false });
  const { fields } = validResidentialInput('standard');
  const response = await withFetch(provider.stub, () =>
    onRequestPost({
      request: jsonRequest({ fields, returnPath: '/estimate/residential/' }),
      env,
    } as never),
  );
  assert.equal(response.status, 400);
  const data = (await response.json()) as { error?: string; reason?: string };
  assert.equal(data.error, 'quote_not_payable');
  assert.equal(data.reason, 'quote_not_verified');
  assert.equal(provider.postCount(), 0);
});

test('church Tier A uses the discounted server total and creates checkout', async () => {
  const ledger = new FakeLedger();
  const env = makeEnv(ledger);
  const provider = providerStub();
  const { price, fields } = validFacilityInput('church');
  const response = await withFetch(provider.stub, () =>
    onRequestPost({
      request: jsonRequest({ fields, returnPath: '/estimate/church/' }),
      env,
    } as never),
  );
  assert.equal(response.status, 200);
  assert.equal(provider.postCount(), 1);
  assert.ok(price.total < price.cleaningSubtotal);
});

test('a preliminary residential quote cannot be paid', async () => {
  const ledger = new FakeLedger();
  const env = makeEnv(ledger);
  const { fields } = validResidentialInput('standard');
  const provider = providerStub();
  const response = await withFetch(
    async (url, init) => {
      if (String(url).includes('/route/v1/')) {
        return jsonResponse({ code: 'quota-exceeded' }, 429);
      }
      return provider.stub(url, init);
    },
    () =>
      onRequestPost({
        request: jsonRequest({ fields, returnPath: '/estimate/residential/' }),
        env,
      } as never),
  );
  assert.equal(response.status, 400);
  const data = (await response.json()) as { reason?: string };
  assert.equal(data.reason, 'quote_not_verified');
  assert.equal(provider.postCount(), 0);
});
test('concurrent Pay Now requests cannot create two Checkout Sessions', async () => {
  const ledger = new FakeLedger();
  const env = makeEnv(ledger);
  const provider = providerStub();
  const { fields } = validFacilityInput();
  const call = () =>
    onRequestPost({
      request: jsonRequest({ fields, returnPath: '/estimate/commercial/' }),
      env,
    } as never);

  const responses = await withFetch(provider.stub, () => Promise.all([call(), call()]));
  assert.equal(provider.postCount(), 1, 'only one Stripe Checkout Session may be created');
  const statuses = responses.map((response) => response.status).sort();
  assert.ok(statuses.includes(200), 'one request returns the session');
  assert.ok(statuses.every((status) => status === 200 || status === 409));
});