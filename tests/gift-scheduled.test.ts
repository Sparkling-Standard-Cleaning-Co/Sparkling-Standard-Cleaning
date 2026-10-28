import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost as stripeWebhook } from '../functions/api/stripe-webhook.ts';
import { onRequestPost as giftDeliveryPost } from '../functions/api/gift-delivery.ts';
import { onRequestPost as giftAdminPost } from '../functions/api/gift-admin.ts';
import { giftCertificateCodeFor } from '../src/lib/gift/fulfillment.ts';
import { issueGiftCertificate, voidGiftCertificate } from '../src/lib/gift/ledger.ts';
import {
  createScheduledGiftDelivery,
  scheduledDeliveryKey,
  type ScheduledGiftDelivery,
} from '../src/lib/gift/scheduled-delivery.ts';
import { ADMIN_COOKIE, createAdmin, createSession, hashPassword } from '../src/lib/admin/auth.ts';
import { FakeLedger } from './helpers/payment-fakes.ts';

const ADMIN_PASSWORD = 'Correct-Horse-9-Battery!';

async function adminFixture(ledger: FakeLedger): Promise<{ cookie: string; csrf: string }> {
  await createAdmin(ledger, {
    version: 1,
    passwordHash: await hashPassword(ADMIN_PASSWORD),
    recoveryEmailVerified: false,
    recoveryPhoneVerified: false,
    createdAt: '2026-10-28T12:00:00.000Z',
    updatedAt: '2026-10-28T12:00:00.000Z',
  });
  const { token, session } = await createSession(ledger, {});
  return { cookie: `${ADMIN_COOKIE}=${token}`, csrf: session.csrf };
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

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
  const digest = toHex(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`)),
  );
  return `t=${timestamp},v1=${digest}`;
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

function scheduledRecord(): ScheduledGiftDelivery {
  const now = new Date().toISOString();
  return {
    version: 1,
    code: 'SSGC-SCHD-2345',
    valueUsd: 100,
    recipientName: 'Recipient',
    recipientEmail: 'recipient@example.test',
    purchaserName: 'Purchaser',
    purchaserEmail: 'buyer@example.test',
    deliveryDate: '2020-01-01',
    deliveryMethod: 'recipient_email',
    deliveryTiming: 'scheduled',
    paidAtIso: '2026-10-28T12:00:00.000Z',
    stripeEventId: 'evt_scheduled_1',
    stripeSessionId: 'cs_scheduled_1',
    status: 'pending',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
}

test('a future scheduled gift is stored durably and is not emailed immediately', async () => {
  const ledger = new FakeLedger();
  const secret = 'whsec_scheduled_gift';
  const payload = JSON.stringify({
    id: 'evt_scheduled_1',
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'cs_scheduled_1',
        payment_status: 'paid',
        amount_total: 10000,
        customer_details: { email: 'buyer@example.test' },
        metadata: {
          gift_value_usd: '100',
          recipient_name: 'Recipient',
          purchaser_name: 'Purchaser',
          recipient_email: 'recipient@example.test',
          delivery_method: 'recipient_email',
          delivery_timing: 'scheduled',
          delivery_date: '2099-01-01',
        },
      },
    },
  });
  const emailCalls: Array<Record<string, unknown>> = [];
  const stub = async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes('api.resend.com')) {
      emailCalls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonResponse({ id: 're_1' });
    }
    if (String(url).includes('api.web3forms.com')) return jsonResponse({ success: true });
    throw new Error(`unexpected fetch: ${String(url)}`);
  };
  const signature = await sign(payload, secret);
  const response = await withFetch(stub, () =>
    stripeWebhook({
      request: new Request('https://example.test/api/stripe-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'stripe-signature': signature },
        body: payload,
      }),
      env: {
        STRIPE_WEBHOOK_SECRET: secret,
        PAYMENT_LEDGER: ledger,
        RESEND_API_KEY: 'resend_test',
        WEB3FORMS_ACCESS_KEY: 'web3_test',
      },
    } as never),
  );
  assert.equal(response.status, 200);
  assert.equal(
    emailCalls.filter((call) => Array.isArray(call.to) && call.to.includes('recipient@example.test')).length,
    0,
    'scheduled recipient email is not sent at purchase time',
  );
  assert.equal(emailCalls.length, 1, 'purchaser confirmation is still sent');
  const code = giftCertificateCodeFor({ eventId: 'evt_scheduled_1' });
  const record = ledger.json<ScheduledGiftDelivery>(scheduledDeliveryKey(code));
  assert.ok(record);
  assert.equal(record?.status, 'pending');
  assert.equal(record?.deliveryDate, '2099-01-01');
});

test('the owner delivery processor sends due scheduled certificates idempotently', async () => {
  const ledger = new FakeLedger();
  const record = scheduledRecord();
  await issueGiftCertificate(ledger, {
    version: 1,
    code: record.code,
    status: 'active',
    valueCents: 10000,
    redeemedCents: 0,
    recipientName: record.recipientName,
    purchaserName: record.purchaserName,
    purchaserEmail: record.purchaserEmail,
    recipientEmail: record.recipientEmail,
    stripeEventId: record.stripeEventId,
    stripeSessionId: record.stripeSessionId,
    issuedAt: record.paidAtIso,
    history: [],
  });
  await createScheduledGiftDelivery(ledger, record);
  const calls: Array<Record<string, unknown>> = [];
  const stub = async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes('api.resend.com')) {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonResponse({ id: 're_scheduled' });
    }
    throw new Error(`unexpected fetch: ${String(url)}`);
  };
  const request = () =>
    new Request('https://example.test/api/gift-delivery', {
      method: 'POST',
      headers: { Authorization: 'Bearer owner-secret' },
    });
  const response = await withFetch(stub, () =>
    giftDeliveryPost({
      request: request(),
      env: {
        PAYMENT_LEDGER: ledger,
        GIFT_OWNER_TOKEN: 'owner-secret',
        RESEND_API_KEY: 'resend_test',
        PUBLIC_SITE_URL: 'https://sparkling-standard.com',
      },
    } as never),
  );
  assert.equal(response.status, 200);
  const result = (await response.json()) as { sent: number; failed: number };
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.to, ['recipient@example.test']);
  const stored = ledger.json<ScheduledGiftDelivery>(scheduledDeliveryKey(record.code));
  assert.equal(stored?.status, 'sent');

  const again = await withFetch(stub, () =>
    giftDeliveryPost({
      request: request(),
      env: {
        PAYMENT_LEDGER: ledger,
        GIFT_OWNER_TOKEN: 'owner-secret',
        RESEND_API_KEY: 'resend_test',
      },
    } as never),
  );
  assert.equal(again.status, 200);
  assert.equal(((await again.json()) as { sent: number }).sent, 0);
  assert.equal(calls.length, 1, 'sent records are not resent');
});

test('a refunded or void certificate is never emailed by the scheduled processor', async () => {
  const ledger = new FakeLedger();
  const record = scheduledRecord();
  await issueGiftCertificate(ledger, {
    version: 1,
    code: record.code,
    status: 'active',
    valueCents: 10000,
    redeemedCents: 0,
    recipientName: record.recipientName,
    purchaserName: record.purchaserName,
    purchaserEmail: record.purchaserEmail,
    recipientEmail: record.recipientEmail,
    stripeEventId: record.stripeEventId,
    stripeSessionId: record.stripeSessionId,
    issuedAt: record.paidAtIso,
    history: [],
  });
  await createScheduledGiftDelivery(ledger, record);
  await voidGiftCertificate(ledger, record.code, 'Owner void', 'TICKET-1');
  let emailCalls = 0;
  const stub = async (url: string | URL) => {
    if (String(url).includes('api.resend.com')) {
      emailCalls += 1;
      return jsonResponse({ id: 're_scheduled' });
    }
    throw new Error(`unexpected fetch: ${String(url)}`);
  };
  const response = await withFetch(stub, () =>
    giftDeliveryPost({
      request: new Request('https://example.test/api/gift-delivery', {
        method: 'POST',
        headers: { Authorization: 'Bearer owner-secret' },
      }),
      env: {
        PAYMENT_LEDGER: ledger,
        GIFT_OWNER_TOKEN: 'owner-secret',
        RESEND_API_KEY: 'resend_test',
      },
    } as never),
  );
  assert.equal(response.status, 200);
  const result = (await response.json()) as { sent: number; cancelled: number };
  assert.equal(result.sent, 0);
  assert.equal(result.cancelled, 1);
  assert.equal(emailCalls, 0);
  const stored = ledger.json<ScheduledGiftDelivery>(scheduledDeliveryKey(record.code));
  assert.equal(stored?.status, 'cancelled');
});

test('an owner void cancels a pending scheduled delivery record', async () => {
  const ledger = new FakeLedger();
  const record = scheduledRecord();
  await issueGiftCertificate(ledger, {
    version: 1,
    code: record.code,
    status: 'active',
    valueCents: 10000,
    redeemedCents: 0,
    recipientName: record.recipientName,
    purchaserName: record.purchaserName,
    purchaserEmail: record.purchaserEmail,
    recipientEmail: record.recipientEmail,
    stripeEventId: record.stripeEventId,
    stripeSessionId: record.stripeSessionId,
    issuedAt: record.paidAtIso,
    history: [],
  });
  await createScheduledGiftDelivery(ledger, record);
  const access = await adminFixture(ledger);
  const response = await giftAdminPost({
    request: new Request('https://example.test/api/gift-admin', {
      method: 'POST',
      headers: {
        Cookie: access.cookie,
        'X-CSRF-Token': access.csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'void',
        code: record.code,
        password: ADMIN_PASSWORD,
        note: 'Duplicate certificate',
        reference: 'TICKET-1',
      }),
    }),
    env: { PAYMENT_LEDGER: ledger },
  } as never);
  assert.equal(response.status, 200);
  const payload = (await response.json()) as { cancelledDelivery?: boolean };
  assert.equal(payload.cancelledDelivery, true);
  const stored = ledger.json<ScheduledGiftDelivery>(scheduledDeliveryKey(record.code));
  assert.equal(stored?.status, 'cancelled');
});
