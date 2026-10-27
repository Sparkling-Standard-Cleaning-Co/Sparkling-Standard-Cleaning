// Durable Stripe webhook tests: duplicate delivery, retry after a failed owner
// notification, checkout reconciliation and gift/estimate separation.
// No network: Web3Forms is stubbed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost } from '../functions/api/stripe-webhook.ts';
import { ledgerKey } from '../src/lib/payments/ledger.ts';
import { FakeLedger } from './helpers/payment-fakes.ts';

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

function signedRequest(payload: string, secret: string): Request {
  return new Request('https://example.test/api/stripe-webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': '',
    },
    body: payload,
  });
}

async function signedWebhook(payload: string, secret: string): Promise<Request> {
  const request = signedRequest(payload, secret);
  const signature = await sign(payload, secret);
  return new Request(request.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': signature },
    body: payload,
  });
}

function estimateEvent(eventId = 'evt_estimate_1') {
  return {
    id: eventId,
    type: 'checkout.session.completed',
    created: 1_790_000_000,
    data: {
      object: {
        id: 'cs_estimate_1',
        payment_status: 'paid',
        amount_total: 12500,
        customer_details: { email: 'customer@example.test', name: 'Synthetic Customer' },
        metadata: {
          checkout_kind: 'estimate_payment',
          quote_reference: 'SS-20261027-ABC123',
          service_type: 'commercial_cleaning',
          checkout_attempt: 'a'.repeat(64),
        },
      },
    },
  };
}

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

test('a paid estimate event is recorded and notified exactly once across duplicate deliveries', async () => {
  const ledger = new FakeLedger();
  const secret = 'whsec_durable_estimate';
  const payload = JSON.stringify(estimateEvent());
  const request = await signedWebhook(payload, secret);
  const requestAgain = await signedWebhook(payload, secret);
  let notifications = 0;

  const response = await withFetch(
    async () => {
      notifications += 1;
      return jsonResponse({ success: true });
    },
    () =>
      onRequestPost({
        request,
        env: {
          STRIPE_WEBHOOK_SECRET: secret,
          WEB3FORMS_ACCESS_KEY: 'web3forms_test',
          PAYMENT_LEDGER: ledger,
        },
      } as never),
  );
  assert.equal(response.status, 200);
  assert.equal(notifications, 1);

  const duplicate = await withFetch(
    async () => {
      notifications += 1;
      return jsonResponse({ success: true });
    },
    () =>
      onRequestPost({
        request: requestAgain,
        env: {
          STRIPE_WEBHOOK_SECRET: secret,
          WEB3FORMS_ACCESS_KEY: 'web3forms_test',
          PAYMENT_LEDGER: ledger,
        },
      } as never),
  );
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), { ok: true, received: true, duplicate: true });
  assert.equal(notifications, 1, 'duplicate delivery must not notify twice');

  const eventKey = ledgerKey('events', 'evt_estimate_1');
  const event = ledger.json<{ status: string; amountCents: number }>(eventKey);
  assert.equal(event?.status, 'notified');
  assert.equal(event?.amountCents, 12500);
  const checkout = ledger.json<{ status: string; sessionId: string }>(
    ledgerKey('checkouts', 'a'.repeat(64)),
  );
  assert.equal(checkout?.status, 'completed');
  assert.equal(checkout?.sessionId, 'cs_estimate_1');
});

test('a failed owner notification is retried without losing the paid event', async () => {
  const ledger = new FakeLedger();
  const secret = 'whsec_retry_notification';
  const payload = JSON.stringify(estimateEvent('evt_estimate_retry'));
  const firstRequest = await signedWebhook(payload, secret);
  const secondRequest = await signedWebhook(payload, secret);
  let attempts = 0;

  const first = await withFetch(
    async () => {
      attempts += 1;
      return jsonResponse({ success: false }, 503);
    },
    () =>
      onRequestPost({
        request: firstRequest,
        env: {
          STRIPE_WEBHOOK_SECRET: secret,
          WEB3FORMS_ACCESS_KEY: 'web3forms_test',
          PAYMENT_LEDGER: ledger,
        },
      } as never),
  );
  assert.equal(first.status, 500);
  assert.equal(attempts, 1);
  assert.equal(ledger.json<{ status: string }>(ledgerKey('events', 'evt_estimate_retry'))?.status, 'failed');

  const second = await withFetch(
    async () => {
      attempts += 1;
      return jsonResponse({ success: true });
    },
    () =>
      onRequestPost({
        request: secondRequest,
        env: {
          STRIPE_WEBHOOK_SECRET: secret,
          WEB3FORMS_ACCESS_KEY: 'web3forms_test',
          PAYMENT_LEDGER: ledger,
        },
      } as never),
  );
  assert.equal(second.status, 200);
  assert.equal(attempts, 2);
  assert.equal(ledger.json<{ status: string }>(ledgerKey('events', 'evt_estimate_retry'))?.status, 'notified');
});

test('a gift event is fulfilled separately from an estimate event', async () => {
  const ledger = new FakeLedger();
  const secret = 'whsec_gift_durable';
  const payload = JSON.stringify({
    id: 'evt_gift_1',
    type: 'checkout.session.completed',
    created: 1_790_000_000,
    data: {
      object: {
        id: 'cs_gift_1',
        payment_status: 'paid',
        amount_total: 10000,
        customer_details: { email: 'buyer@example.test' },
        metadata: {
          gift_value_usd: '100',
          recipient_name: 'Recipient',
          purchaser_name: 'Purchaser',
        },
      },
    },
  });
  const request = await signedWebhook(payload, secret);
  let notification: Record<string, string> | null = null;

  const response = await withFetch(
    async (_url, init) => {
      notification = JSON.parse(String(init?.body)) as Record<string, string>;
      return jsonResponse({ success: true });
    },
    () =>
      onRequestPost({
        request,
        env: {
          STRIPE_WEBHOOK_SECRET: secret,
          WEB3FORMS_ACCESS_KEY: 'web3forms_test',
          PAYMENT_LEDGER: ledger,
        },
      } as never),
  );
  assert.equal(response.status, 200);
  assert.match(notification?.['PAID — Gift certificate fulfillment'] ?? '', /verified/i);
  assert.match(notification?.subject ?? '', /PAID gift certificate/);
  assert.equal(notification?.['Stripe session id'], 'cs_gift_1');
  assert.equal(ledger.json<{ kind: string }>(ledgerKey('events', 'evt_gift_1'))?.kind, 'gift');
});
