// Durable Stripe webhook tests: duplicate delivery, retry after a failed owner
// notification, checkout reconciliation and gift/estimate separation.
// No network: Web3Forms is stubbed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost } from '../functions/api/stripe-webhook.ts';
import { ledgerKey, writeLedgerJson } from '../src/lib/payments/ledger.ts';
import { FakeLedger } from './helpers/payment-fakes.ts';
import {
  issueGiftCertificate,
  lookupGiftCertificate,
  reserveGiftCredit,
  type GiftCertificateRecord,
} from '../src/lib/gift/ledger.ts';

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
    async (url, init) => {
      if (String(url).includes('api.resend.com')) return jsonResponse({ id: 'email-1' });
      notification = JSON.parse(String(init?.body)) as Record<string, string>;
      return jsonResponse({ success: true });
    },
    () =>
      onRequestPost({
        request,
        env: {
          STRIPE_WEBHOOK_SECRET: secret,
          WEB3FORMS_ACCESS_KEY: 'web3forms_test',
          RESEND_API_KEY: 'resend_test',
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

test('a paid estimate sends an itemized customer receipt from the stored checkout record', async () => {
  const ledger = new FakeLedger();
  const secret = 'whsec_receipt_test';
  const attempt = 'b'.repeat(64);
  const event = estimateEvent('evt_estimate_receipt');
  event.data.object.metadata.checkout_attempt = attempt;
  event.data.object.metadata.quote_reference = 'SS-20261029-ABC123';
  event.data.object.amount_total = 15050;
  await writeLedgerJson(ledger, ledgerKey('checkouts', attempt), {
    version: 1,
    status: 'open',
    generation: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    reference: 'SS-20261029-ABC123',
    amountCents: 15050,
    serviceType: 'commercial_cleaning',
    receipt: {
      service: 'Commercial Cleaning',
      serviceLocation: '100 S Baylen St, Pensacola, FL 32502',
      customerName: 'Synthetic Customer',
      customerEmail: 'customer@example.test',
      lines: [
        { label: 'Cleaning service — Commercial Cleaning', amountCents: 14000, kind: 'charge' },
      ],
      subtotalCents: 14000,
      taxCents: 1050,
      taxRatePercent: 7.5,
      taxJurisdiction: 'Escambia County, FL',
      totalCents: 15050,
    },
  });
  let receiptBodies: Array<Record<string, unknown>> = [];
  let notifications = 0;
  const payload = JSON.stringify(event);
  const request = await signedWebhook(payload, secret);

  const response = await withFetch(
    async (url, init) => {
      const target = String(url);
      if (target.includes('api.resend.com/emails')) {
        receiptBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return jsonResponse({ id: 'email_1' });
      }
      notifications += 1;
      return jsonResponse({ success: true });
    },
    () =>
      onRequestPost({
        request,
        env: {
          STRIPE_WEBHOOK_SECRET: secret,
          WEB3FORMS_ACCESS_KEY: 'web3forms_test',
          RESEND_API_KEY: 'resend_test',
          PAYMENT_LEDGER: ledger,
        },
      } as never),
  );
  assert.equal(response.status, 200);
  assert.equal(notifications, 1);
  assert.equal(receiptBodies.length, 1);
  assert.match(String(receiptBodies[0]?.subject), /SS-20261029-ABC123/);
  assert.match(String(receiptBodies[0]?.html), /Commercial Cleaning/);
  assert.match(String(receiptBodies[0]?.html), /Escambia County/);
  assert.match(String(receiptBodies[0]?.html), /\$150\.50/);
});
async function reservedGift(
  ledger: FakeLedger,
  code: string,
  amountCents: number,
): Promise<{ record: GiftCertificateRecord; reservationId: string }> {
  const record: GiftCertificateRecord = {
    version: 1,
    code,
    status: 'active',
    valueCents: 100_000,
    redeemedCents: 0,
    recipientName: 'Synthetic Recipient',
    purchaserName: 'Synthetic Purchaser',
    purchaserEmail: 'buyer@example.test',
    activatesAt: '2026-10-01T05:00:00.000Z',
    activationTimezone: 'America/Chicago',
    stripeEventId: 'evt_synthetic_gift',
    stripeSessionId: 'cs_synthetic_gift',
    issuedAt: '2026-10-01T12:00:00.000Z',
    history: [],
  };
  await issueGiftCertificate(ledger, record);
  const reserved = await reserveGiftCredit(ledger, code, amountCents, 'SS-20261027-GIFT01');
  assert.equal(reserved.ok, true);
  if (!reserved.ok) throw new Error(reserved.error);
  return { record: reserved.record, reservationId: reserved.reservation.id };
}

test('a paid estimate commits its gift reservation and keeps the gift-adjusted total', async () => {
  const ledger = new FakeLedger();
  const secret = 'whsec_gift_commit';
  const attempt = 'b'.repeat(64);
  const code = 'SSGC-GIFT-2345';
  const reserved = await reservedGift(ledger, code, 12_500);
  await writeLedgerJson(ledger, ledgerKey('checkouts', attempt), {
    version: 1,
    status: 'open',
    reference: 'SS-20261027-GIFT01',
    amountCents: 20_000,
    chargeAmountCents: 7_500,
    gift: {
      code,
      reservationId: reserved.reservationId,
      appliedCents: 12_500,
      totalCents: 20_000,
      paidByGift: false,
    },
    receipt: {
      service: 'Commercial Cleaning',
      serviceLocation: '100 S Baylen St, Pensacola, FL 32502',
      customerName: 'Synthetic Customer',
      customerEmail: 'customer@example.test',
      lines: [{ label: 'Cleaning service - Commercial Cleaning', amountCents: 18_500, kind: 'charge' }],
      subtotalCents: 18_500,
      taxCents: 1_500,
      taxRatePercent: 7.5,
      taxJurisdiction: 'Escambia County, FL',
      totalCents: 20_000,
    },
  });
  const event = {
    id: 'evt_gift_estimate_1',
    type: 'checkout.session.completed',
    created: 1_790_000_000,
    data: {
      object: {
        id: 'cs_gift_1',
        payment_status: 'paid',
        amount_total: 7_500,
        customer_details: { email: 'customer@example.test', name: 'Synthetic Customer' },
        metadata: {
          checkout_kind: 'estimate_payment',
          quote_reference: 'SS-20261027-GIFT01',
          service_type: 'commercial_cleaning',
          checkout_attempt: attempt,
          total_amount_cents: '20000',
          gift_applied_cents: '12500',
        },
      },
    },
  };
  const payload = JSON.stringify(event);
  const request = await signedWebhook(payload, secret);
  let receiptHtml = '';

  const response = await withFetch(
    async (url, init) => {
      if (String(url).includes('api.resend.com/emails')) {
        receiptHtml = String(
          (JSON.parse(String(init?.body ?? '{}')) as { html?: string }).html ?? '',
        );
        return jsonResponse({ id: 'email_gift_1' });
      }
      return jsonResponse({ success: true });
    },
    () =>
      onRequestPost({
        request,
        env: {
          STRIPE_WEBHOOK_SECRET: secret,
          WEB3FORMS_ACCESS_KEY: 'web3forms_test',
          RESEND_API_KEY: 'resend_test',
          PAYMENT_LEDGER: ledger,
        },
      } as never),
  );
  assert.equal(response.status, 200);
  assert.match(receiptHtml, /\$200\.00/);
  assert.match(receiptHtml, /gift-certificate credit/i);

  const gift = await lookupGiftCertificate(ledger, code);
  assert.equal(gift?.redeemedCents, 12_500);
  assert.equal(gift?.reservations?.[0]?.status, 'committed');
  const checkout = ledger.json<{
    status?: string;
    amountCents?: number;
    chargeAmountCents?: number;
    gift?: { paidByGift?: boolean };
  }>(ledgerKey('checkouts', attempt));
  assert.equal(checkout?.status, 'completed');
  assert.equal(checkout?.amountCents, 20_000);
  assert.equal(checkout?.chargeAmountCents, 7_500);
  assert.equal(checkout?.gift?.paidByGift, false);
});

test('an expired estimate checkout releases its gift reservation', async () => {
  const ledger = new FakeLedger();
  const secret = 'whsec_gift_expired';
  const attempt = 'c'.repeat(64);
  const code = 'SSGC-EXPR-2345';
  const reserved = await reservedGift(ledger, code, 9_000);
  await writeLedgerJson(ledger, ledgerKey('checkouts', attempt), {
    version: 1,
    status: 'open',
    reference: 'SS-20261027-GIFT02',
    amountCents: 20_000,
    chargeAmountCents: 11_000,
    gift: {
      code,
      reservationId: reserved.reservationId,
      appliedCents: 9_000,
      totalCents: 20_000,
      paidByGift: false,
    },
  });
  const payload = JSON.stringify({
    id: 'evt_gift_expired_1',
    type: 'checkout.session.expired',
    data: {
      object: {
        id: 'cs_gift_expired',
        metadata: { checkout_kind: 'estimate_payment', checkout_attempt: attempt },
      },
    },
  });
  const request = await signedWebhook(payload, secret);
  const response = await onRequestPost({
    request,
    env: { STRIPE_WEBHOOK_SECRET: secret, PAYMENT_LEDGER: ledger },
  } as never);
  assert.equal(response.status, 200);

  const gift = await lookupGiftCertificate(ledger, code);
  assert.equal(gift?.redeemedCents, 0);
  assert.equal(gift?.reservations?.[0]?.status, 'released');
  const checkout = ledger.json<{ status?: string }>(ledgerKey('checkouts', attempt));
  assert.equal(checkout?.status, 'failed');
});

test('a paid event claiming gift credit without a reservation fails retryably', async () => {
  const ledger = new FakeLedger();
  const secret = 'whsec_gift_missing_record';
  const event = estimateEvent('evt_gift_missing_record');
  event.data.object.metadata.checkout_attempt = 'd'.repeat(64);
  event.data.object.metadata.gift_applied_cents = '5000';
  event.data.object.metadata.total_amount_cents = '20000';
  const payload = JSON.stringify(event);
  const request = await signedWebhook(payload, secret);
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
  assert.equal(response.status, 500);
  assert.equal(((await response.json()) as { error?: string }).error, 'gift_reservation_missing');
  assert.equal(notifications, 0);
});
