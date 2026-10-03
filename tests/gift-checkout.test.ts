// Gift checkout + Stripe webhook gate tests. No network access: the checkout
// provider call is never reached in these cases (gates and validation only).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { giftCertificateConfig } from '../src/config/gift-certificates.ts';
import { onRequestPost as giftCheckout, resolveGiftAmount } from '../functions/api/gift-checkout.ts';
import { onRequestPost as stripeWebhook } from '../functions/api/stripe-webhook.ts';

const jsonRequest = (body: unknown, ip = '10.10.0.1') =>
  new Request('https://example.test/api/gift', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sign(payload: string, secret: string): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`)));
  return `t=${timestamp},v1=${digest}`;
}

test('amounts are resolved only from approved config', () => {
  // Custom amounts inside the owner-configured bounds.
  assert.equal(resolveGiftAmount(undefined, 100), 100);
  assert.equal(resolveGiftAmount(undefined, '50'), 50);
  assert.equal(resolveGiftAmount(undefined, 24), null, 'below the minimum');
  assert.equal(resolveGiftAmount(undefined, 501), null, 'above the maximum');
  assert.equal(resolveGiftAmount(undefined, 'not-a-number'), null);
  // A denomination is only accepted when the owner has approved that value.
  assert.equal(resolveGiftAmount(100, undefined), null, 'unapproved denomination value');
});

test('gift checkout is refused while sales are disabled', async () => {
  const response = await giftCheckout({
    request: jsonRequest({ purchaserName: 'A', purchaserEmail: 'a@example.com', recipientName: 'B' }),
    env: {},
  } as never);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: 'not_enabled' });
});

test('gift checkout reports missing payment configuration without side effects', async () => {
  const config = giftCertificateConfig as { enabled: boolean };
  const original = config.enabled;
  config.enabled = true;
  try {
    const response = await giftCheckout({
      request: jsonRequest({ purchaserName: 'A', purchaserEmail: 'a@example.com', recipientName: 'B', amountUsd: 100 }, '10.10.0.2'),
      env: {},
    } as never);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, error: 'not_configured' });

    const invalid = await giftCheckout({
      request: jsonRequest({ purchaserName: '', purchaserEmail: 'x', recipientName: '', amountUsd: 5 }, '10.10.0.3'),
      env: { STRIPE_SECRET_KEY: 'sk_test_dummy' },
    } as never);
    assert.equal(invalid.status, 400);
  } finally {
    config.enabled = original;
  }
});

test('gift checkout rejects invalid amounts before any provider call', async () => {
  const config = giftCertificateConfig as { enabled: boolean };
  const original = config.enabled;
  config.enabled = true;
  try {
    const response = await giftCheckout({
      request: jsonRequest(
        { purchaserName: 'A', purchaserEmail: 'a@example.com', recipientName: 'B', amountUsd: 5 },
        '10.10.0.4',
      ),
      env: { STRIPE_SECRET_KEY: 'sk_test_dummy' },
    } as never);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, error: 'invalid_amount' });
  } finally {
    config.enabled = original;
  }
});

test('the webhook refuses unconfigured or badly signed requests', async () => {
  const unconfigured = await stripeWebhook({ request: jsonRequest({}, '10.10.0.5'), env: {} } as never);
  assert.equal(unconfigured.status, 503);

  const payload = JSON.stringify({ id: 'evt_test_1', type: 'checkout.session.completed' });
  const bad = await stripeWebhook({
    request: new Request('https://example.test/api/stripe-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' },
      body: payload,
    }),
    env: { STRIPE_WEBHOOK_SECRET: 'whsec_test' },
  } as never);
  assert.equal(bad.status, 400);
});

test('an unpaid session is acknowledged and never authorizes issuance', async () => {
  const secret = 'whsec_test_unpaid';
  const payload = JSON.stringify({
    id: 'evt_unpaid_1',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_1', payment_status: 'unpaid' } },
  });
  const response = await stripeWebhook({
    request: new Request('https://example.test/api/stripe-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': await sign(payload, secret) },
      body: payload,
    }),
    env: { STRIPE_WEBHOOK_SECRET: secret },
  } as never);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, received: true, ignored: true });
});

test('a paid session with no notification channel returns 500 so Stripe retries', async () => {
  const secret = 'whsec_test_paid';
  const payload = JSON.stringify({
    id: 'evt_paid_1',
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'cs_paid_1',
        payment_status: 'paid',
        customer_details: { email: 'buyer@example.com' },
        metadata: {
          gift_value_usd: '100',
          recipient_name: 'Recipient',
          purchaser_name: 'Purchaser',
        },
      },
    },
  });
  const response = await stripeWebhook({
    request: new Request('https://example.test/api/stripe-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': await sign(payload, secret) },
      body: payload,
    }),
    env: { STRIPE_WEBHOOK_SECRET: secret },
  } as never);
  assert.equal(response.status, 500, 'a paid purchase must never be silently dropped');
});

test('the webhook only accepts POST', async () => {
  const { onRequestGet } = await import('../functions/api/stripe-webhook.ts');
  const response = await onRequestGet();
  assert.equal(response.status, 405);
});
