import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FakeLedger } from './helpers/payment-fakes.ts';
import { issueGiftCertificate, voidGiftCertificate, type GiftCertificateRecord } from '../src/lib/gift/ledger.ts';
import { onRequestGet as balanceGet } from '../functions/api/gift-balance.ts';

function record(): GiftCertificateRecord {
  return {
    version: 1,
    code: 'SSGC-ABCD-2345',
    status: 'active',
    valueCents: 10000,
    redeemedCents: 2500,
    recipientName: 'Synthetic Recipient',
    purchaserName: 'Synthetic Purchaser',
    purchaserEmail: 'buyer@example.test',
    stripeEventId: 'evt_balance_1',
    stripeSessionId: 'cs_balance_1',
    issuedAt: '2026-10-27T12:00:00.000Z',
    history: [],
  };
}

test('public balance lookup returns only code/status/value, never names or contact data', async () => {
  const bucket = new FakeLedger();
  await issueGiftCertificate(bucket, record());
  const request = new Request('https://example.test/api/gift-balance?code=SSGC-ABCD-2345');
  const response = await balanceGet({ request, env: { PHOTOS_BUCKET: bucket } } as never);
  assert.equal(response.status, 200);
  const raw = await response.text();
  assert.doesNotMatch(raw, /Synthetic|buyer@example/);
  const data = JSON.parse(raw) as { remainingCents?: number; status?: string };
  assert.equal(data.remainingCents, 7500);
  assert.equal(data.status, 'active');
});

test('unknown and malformed codes do not expose a ledger record', async () => {
  const bucket = new FakeLedger();
  const unknown = await balanceGet({
    request: new Request('https://example.test/api/gift-balance?code=SSGC-ABCD-9999'),
    env: { PHOTOS_BUCKET: bucket },
  } as never);
  assert.equal(unknown.status, 404);
  const malformed = await balanceGet({
    request: new Request('https://example.test/api/gift-balance?code=<script>'),
    env: { PHOTOS_BUCKET: bucket },
  } as never);
  assert.equal(malformed.status, 400);
});

test('a void certificate reports zero remaining value without exposing private fields', async () => {
  const bucket = new FakeLedger();
  await issueGiftCertificate(bucket, { ...record(), redeemedCents: 0 });
  await voidGiftCertificate(bucket, 'SSGC-ABCD-2345', 'Owner void', 'TICKET-1');
  const response = await balanceGet({
    request: new Request('https://example.test/api/gift-balance?code=SSGC-ABCD-2345'),
    env: { PHOTOS_BUCKET: bucket },
  } as never);
  assert.equal(response.status, 200);
  const data = (await response.json()) as { remainingCents?: number; status?: string };
  assert.equal(data.status, 'void');
  assert.equal(data.remainingCents, 0);
});
