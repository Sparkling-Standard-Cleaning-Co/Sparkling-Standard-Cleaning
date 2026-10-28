import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FakeLedger } from './helpers/payment-fakes.ts';
import {
  giftKey,
  issueGiftCertificate,
  lookupGiftCertificate,
  redeemGiftCertificate,
  refundGiftCertificate,
  remainingCents,
  voidGiftCertificate,
  type GiftCertificateRecord,
} from '../src/lib/gift/ledger.ts';
import { onRequestGet as adminGet, onRequestPost as adminPost } from '../functions/api/gift-admin.ts';
import {
  ADMIN_COOKIE,
  createAdmin,
  createSession,
  hashPassword,
} from '../src/lib/admin/auth.ts';

const ADMIN_PASSWORD = 'Correct-Horse-9-Battery!';

async function adminAccess(bucket: FakeLedger): Promise<{
  env: { PHOTOS_BUCKET: FakeLedger };
  cookie: string;
  csrf: string;
  password: string;
}> {
  await createAdmin(bucket, {
    version: 1,
    passwordHash: await hashPassword(ADMIN_PASSWORD),
    recoveryEmailVerified: false,
    recoveryPhoneVerified: false,
    createdAt: '2026-10-28T12:00:00.000Z',
    updatedAt: '2026-10-28T12:00:00.000Z',
  });
  const { token, session } = await createSession(bucket, {});
  return {
    env: { PHOTOS_BUCKET: bucket },
    cookie: `${ADMIN_COOKIE}=${token}`,
    csrf: session.csrf,
    password: ADMIN_PASSWORD,
  };
}

function authedRequest(url: string, access: Awaited<ReturnType<typeof adminAccess>>, body?: unknown): Request {
  return new Request(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Cookie: access.cookie,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': access.csrf }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function record(overrides: Partial<GiftCertificateRecord> = {}): GiftCertificateRecord {
  return {
    version: 1,
    code: 'SSGC-ABCD-2345',
    status: 'active',
    valueCents: 10000,
    redeemedCents: 0,
    recipientName: 'Synthetic Recipient',
    purchaserName: 'Synthetic Purchaser',
    purchaserEmail: 'buyer@example.test',
    stripeEventId: 'evt_test_1',
    stripeSessionId: 'cs_test_1',
    issuedAt: '2026-10-27T12:00:00.000Z',
    history: [],
    ...overrides,
  };
}

test('issuance is idempotent and never creates a second balance for one event', async () => {
  const bucket = new FakeLedger();
  const first = await issueGiftCertificate(bucket, record());
  const second = await issueGiftCertificate(bucket, record({ valueCents: 20000 }));
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.record.valueCents, 10000);
  assert.equal(bucket.puts.filter((key) => key === giftKey('SSGC-ABCD-2345')).length, 1);
});

test('partial redemption reduces the balance and records history', async () => {
  const bucket = new FakeLedger();
  await issueGiftCertificate(bucket, record());
  const result = await redeemGiftCertificate(
    bucket,
    'SSGC-ABCD-2345',
    2500,
    'Partial redemption',
    'JOB-1',
    new Date('2026-10-28T12:00:00Z'),
  );
  assert.equal(result.ok, true);
  const stored = await lookupGiftCertificate(bucket, 'SSGC-ABCD-2345');
  assert.ok(stored);
  assert.equal(stored.redeemedCents, 2500);
  assert.equal(remainingCents(stored), 7500);
  assert.equal(stored.history.length, 1);
  assert.equal(stored.history[0]?.reference, 'JOB-1');
});

test('simultaneous redemptions cannot spend the same balance twice', async () => {
  const bucket = new FakeLedger();
  await issueGiftCertificate(bucket, record());
  const [first, second] = await Promise.all([
    redeemGiftCertificate(bucket, 'SSGC-ABCD-2345', 6000, 'Concurrent A', 'JOB-A'),
    redeemGiftCertificate(bucket, 'SSGC-ABCD-2345', 6000, 'Concurrent B', 'JOB-B'),
  ]);
  assert.equal([first.ok, second.ok].filter(Boolean).length, 1);
  const stored = await lookupGiftCertificate(bucket, 'SSGC-ABCD-2345');
  assert.ok(stored);
  assert.equal(stored.redeemedCents, 6000);
  assert.equal(remainingCents(stored), 4000);
  assert.equal(stored.history.length, 1);
});

test('over-redemption and duplicate full redemption are rejected', async () => {
  const bucket = new FakeLedger();
  await issueGiftCertificate(bucket, record({ valueCents: 5000 }));
  const tooMuch = await redeemGiftCertificate(bucket, 'SSGC-ABCD-2345', 6000, '', 'JOB-1');
  assert.equal(tooMuch.ok, false);
  if (!tooMuch.ok) assert.equal(tooMuch.error, 'insufficient_balance');
  const full = await redeemGiftCertificate(bucket, 'SSGC-ABCD-2345', 5000, '', 'JOB-2');
  assert.equal(full.ok, true);
  const again = await redeemGiftCertificate(bucket, 'SSGC-ABCD-2345', 100, '', 'JOB-3');
  assert.equal(again.ok, false);
  if (!again.ok) assert.equal(again.error, 'inactive');
});

test('owner admin lookup requires an authenticated session and returns the balance', async () => {
  const bucket = new FakeLedger();
  await issueGiftCertificate(bucket, record());
  const access = await adminAccess(bucket);

  const denied = await adminGet({
    request: new Request('https://example.test/api/gift-admin?code=SSGC-ABCD-2345'),
    env: access.env,
  } as never);
  assert.equal(denied.status, 401);

  const allowed = await adminGet({
    request: authedRequest('https://example.test/api/gift-admin?code=SSGC-ABCD-2345', access),
    env: access.env,
  } as never);
  assert.equal(allowed.status, 200);
  const payload = (await allowed.json()) as { certificate?: { remainingCents?: number } };
  assert.equal(payload.certificate?.remainingCents, 10000);
});

test('photo or booking bearer tokens cannot perform gift financial actions', async () => {
  const bucket = new FakeLedger();
  await issueGiftCertificate(bucket, record());
  const response = await adminGet({
    request: new Request('https://example.test/api/gift-admin?code=SSGC-ABCD-2345', {
      headers: { Authorization: 'Bearer photo-only-token' },
    }),
    env: {
      PHOTOS_BUCKET: bucket,
      PHOTO_OWNER_TOKEN: 'photo-only-token',
      GIFT_OWNER_TOKEN: 'legacy-token',
    } as never,
  } as never);
  assert.equal(response.status, 401);
});

test('owner gift summary distinguishes issued, redeemed and outstanding value', async () => {
  const bucket = new FakeLedger();
  await issueGiftCertificate(bucket, record());
  await issueGiftCertificate(
    bucket,
    record({ code: 'SSGC-WXYZ-6789', valueCents: 5000, stripeEventId: 'evt_test_2' }),
  );
  await redeemGiftCertificate(bucket, 'SSGC-ABCD-2345', 2500, '', 'JOB-1');
  const access = await adminAccess(bucket);
  const response = await adminGet({
    request: authedRequest('https://example.test/api/gift-admin?summary=1', access),
    env: access.env,
  } as never);
  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    summary?: {
      issuedCount: number;
      activeCount: number;
      totalOriginalCents: number;
      totalRedeemedCents: number;
      totalOutstandingCents: number;
    };
  };
  assert.equal(payload.summary?.issuedCount, 2);
  assert.equal(payload.summary?.activeCount, 2);
  assert.equal(payload.summary?.totalOriginalCents, 15000);
  assert.equal(payload.summary?.totalRedeemedCents, 2500);
  assert.equal(payload.summary?.totalOutstandingCents, 12500);
});

test('owner redemption writes a durable financial record', async () => {
  const bucket = new FakeLedger();
  await issueGiftCertificate(bucket, record());
  const access = await adminAccess(bucket);
  const request = authedRequest('https://example.test/api/gift-admin', access, {
    code: 'SSGC-ABCD-2345',
    password: access.password,
    amountCents: 3000,
    note: 'Applied to invoice 1001',
    reference: 'INV-1001',
  });
  const response = await adminPost({ request, env: access.env } as never);
  assert.equal(response.status, 200);
  const stored = await lookupGiftCertificate(bucket, 'SSGC-ABCD-2345');
  assert.equal(stored?.redeemedCents, 3000);
});

test('an unused certificate can be refunded once and the remaining value becomes zero', async () => {
  const bucket = new FakeLedger();
  await issueGiftCertificate(bucket, record());
  const first = await refundGiftCertificate(
    bucket,
    'SSGC-ABCD-2345',
    'Unused within 14 days',
    'REF-1',
    're_test_1',
    new Date('2026-10-28T12:00:00Z'),
  );
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.record.status, 'refunded');
  assert.equal(remainingCents(first.record), 0);
  assert.equal(first.record.adjustments?.[0]?.stripeRefundId, 're_test_1');
  assert.equal(first.record.adjustments?.[0]?.amountCents, 10000);
  const second = await refundGiftCertificate(bucket, 'SSGC-ABCD-2345', '', '', 're_test_1');
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.already, true);
  assert.equal(bucket.puts.filter((key) => key === giftKey('SSGC-ABCD-2345')).length, 2, 'one issue + one refund');
});

test('a redeemed certificate cannot be refunded or voided', async () => {
  const bucket = new FakeLedger();
  await issueGiftCertificate(bucket, record());
  await redeemGiftCertificate(bucket, 'SSGC-ABCD-2345', 1000, '', 'JOB-1');
  const refund = await refundGiftCertificate(bucket, 'SSGC-ABCD-2345', '', '', 're_test_1');
  assert.equal(refund.ok, false);
  if (!refund.ok) assert.equal(refund.error, 'redeemed');
  const voided = await voidGiftCertificate(bucket, 'SSGC-ABCD-2345', '', '');
  assert.equal(voided.ok, false);
  if (!voided.ok) assert.equal(voided.error, 'redeemed');
});

test('a void records the action without changing money and is idempotent', async () => {
  const bucket = new FakeLedger();
  await issueGiftCertificate(bucket, record());
  const first = await voidGiftCertificate(bucket, 'SSGC-ABCD-2345', 'Duplicate code', 'TICKET-1');
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.record.status, 'void');
  assert.equal(first.record.redeemedCents, 0);
  assert.equal(remainingCents(first.record), 0);
  assert.equal(first.record.adjustments?.[0]?.kind, 'void');
  const second = await voidGiftCertificate(bucket, 'SSGC-ABCD-2345', '', '');
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.already, true);
});

test('owner refund uses the server refund provider before marking the ledger', async () => {
  const bucket = new FakeLedger();
  await issueGiftCertificate(bucket, record());
  const access = await adminAccess(bucket);
  let calledWith = '';
  const response = await adminPost({
    request: authedRequest('https://example.test/api/gift-admin', access, {
      action: 'refund',
      code: 'SSGC-ABCD-2345',
      password: access.password,
      note: 'Owner-approved refund',
      reference: 'REF-1',
    }),
    env: {
      ...access.env,
      STRIPE_REFUNDER: async (sessionId: string, code: string) => {
        calledWith = `${sessionId}:${code}`;
        return { ok: true, refundId: 're_test_1' };
      },
    },
  } as never);
  assert.equal(response.status, 200);
  assert.equal(calledWith, 'cs_test_1:SSGC-ABCD-2345');
  const stored = await lookupGiftCertificate(bucket, 'SSGC-ABCD-2345');
  assert.equal(stored?.status, 'refunded');
  assert.equal(stored?.adjustments?.[0]?.stripeRefundId, 're_test_1');
});

test('owner refund fails closed without Stripe or a server refund provider', async () => {
  const bucket = new FakeLedger();
  await issueGiftCertificate(bucket, record());
  const access = await adminAccess(bucket);
  const response = await adminPost({
    request: authedRequest('https://example.test/api/gift-admin', access, {
      action: 'refund',
      code: 'SSGC-ABCD-2345',
      password: access.password,
    }),
    env: access.env,
  } as never);
  assert.equal(response.status, 503);
  assert.equal((await response.json() as { error?: string }).error, 'stripe_not_configured');
  const stored = await lookupGiftCertificate(bucket, 'SSGC-ABCD-2345');
  assert.equal(stored?.status, 'active');
});

test('the owner inventory is paginated and searchable without exposing all records at once', async () => {
  const bucket = new FakeLedger();
  await issueGiftCertificate(bucket, record({ code: 'SSGC-AAAA-1111' }));
  await issueGiftCertificate(bucket, record({ code: 'SSGC-BBBB-2222', recipientName: 'Second Recipient' }));
  await issueGiftCertificate(bucket, record({ code: 'SSGC-CCCC-3333', recipientName: 'Third Recipient' }));
  const access = await adminAccess(bucket);
  const response = await adminGet({
    request: authedRequest('https://example.test/api/gift-admin?list=1&page=1&pageSize=5', access),
    env: access.env,
  } as never);
  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    total?: number;
    page?: number;
    totalPages?: number;
    items?: Array<{ code?: string }>;
  };
  assert.equal(payload.total, 3);
  assert.equal(payload.page, 1);
  assert.equal(payload.totalPages, 1);
  assert.equal(payload.items?.length, 3);

  const filtered = await adminGet({
    request: authedRequest('https://example.test/api/gift-admin?list=1&q=Third', access),
    env: access.env,
  } as never);
  const filteredPayload = (await filtered.json()) as { total?: number; items?: Array<{ code?: string }> };
  assert.equal(filteredPayload.total, 1);
  assert.equal(filteredPayload.items?.[0]?.code, 'SSGC-CCCC-3333');
});
