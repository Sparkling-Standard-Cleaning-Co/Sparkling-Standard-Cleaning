import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FakeLedger } from './helpers/payment-fakes.ts';
import {
  giftKey,
  issueGiftCertificate,
  lookupGiftCertificate,
  redeemGiftCertificate,
  remainingCents,
  type GiftCertificateRecord,
} from '../src/lib/gift/ledger.ts';
import { onRequestGet as adminGet, onRequestPost as adminPost } from '../functions/api/gift-admin.ts';

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

test('owner admin lookup requires the bearer token and returns the balance', async () => {
  const bucket = new FakeLedger();
  await issueGiftCertificate(bucket, record());
  const request = (auth?: string) =>
    new Request('https://example.test/api/gift-admin?code=SSGC-ABCD-2345', {
      headers: auth ? { Authorization: auth } : {},
    });

  const denied = await adminGet({ request: request(), env: { PHOTOS_BUCKET: bucket, GIFT_OWNER_TOKEN: 'secret' } } as never);
  assert.equal(denied.status, 401);

  const allowed = await adminGet({
    request: request('Bearer secret'),
    env: { PHOTOS_BUCKET: bucket, GIFT_OWNER_TOKEN: 'secret' } as never,
  } as never);
  assert.equal(allowed.status, 200);
  const payload = (await allowed.json()) as { certificate?: { remainingCents?: number } };
  assert.equal(payload.certificate?.remainingCents, 10000);
});

test('owner redemption writes a durable financial record', async () => {
  const bucket = new FakeLedger();
  await issueGiftCertificate(bucket, record());
  const request = new Request('https://example.test/api/gift-admin', {
    method: 'POST',
    headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'SSGC-ABCD-2345',
      amountCents: 3000,
      note: 'Applied to invoice 1001',
      reference: 'INV-1001',
    }),
  });
  const response = await adminPost({
    request,
    env: { PHOTOS_BUCKET: bucket, GIFT_OWNER_TOKEN: 'secret' } as never,
  } as never);
  assert.equal(response.status, 200);
  const stored = await lookupGiftCertificate(bucket, 'SSGC-ABCD-2345');
  assert.equal(stored?.redeemedCents, 3000);
});
