import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  activationInstant,
  activationInstantFor,
  activationLabel,
  isGiftActive,
  isValidCalendarDate,
} from '../src/lib/gift/activation.ts';
import {
  issueGiftCertificate,
  redeemGiftCertificate,
  type GiftCertificateRecord,
} from '../src/lib/gift/ledger.ts';
import { FakeLedger } from './helpers/payment-fakes.ts';

function record(validFromDate: string): GiftCertificateRecord {
  return {
    version: 1,
    code: 'SSGC-ABCD-2345',
    status: 'active',
    valueCents: 10000,
    redeemedCents: 0,
    recipientName: 'Synthetic Recipient',
    purchaserName: 'Synthetic Purchaser',
    purchaserEmail: 'buyer@example.test',
    validFromDate,
    activatesAt: activationInstant(validFromDate),
    activationTimezone: 'America/Chicago',
    stripeEventId: 'evt_test_1',
    stripeSessionId: 'cs_test_1',
    issuedAt: '2026-10-28T12:00:00.000Z',
    history: [],
  };
}

test('activation is exactly midnight America/Chicago in standard and daylight time', () => {
  assert.equal(activationInstant('2026-12-25'), '2026-12-25T06:00:00.000Z');
  assert.equal(activationInstant('2026-07-04'), '2026-07-04T05:00:00.000Z');
  assert.equal(
    activationLabel('2026-12-25'),
    'Valid beginning 2026-12-25 at 12:00 AM Central Time.',
  );
});

test('calendar dates fail closed when malformed or impossible', () => {
  assert.equal(isValidCalendarDate('2026-12-25'), true);
  assert.equal(isValidCalendarDate('2026-02-29'), false);
  assert.equal(isValidCalendarDate('2026-13-01'), false);
  assert.equal(isValidCalendarDate('12/25/2026'), false);
});

test('a certificate is inactive before activation and active at the exact instant', () => {
  const certificate = record('2026-12-25');
  assert.equal(isGiftActive(certificate, new Date('2026-12-25T05:59:59.999Z')), false);
  assert.equal(isGiftActive(certificate, new Date('2026-12-25T06:00:00.000Z')), true);
  assert.equal(isGiftActive(certificate, new Date('2026-12-25T06:00:00.001Z')), true);
  assert.equal(activationInstantFor(certificate), '2026-12-25T06:00:00.000Z');
});

test('ledger redemption rejects early use and allows it at midnight Central', async () => {
  const bucket = new FakeLedger();
  await issueGiftCertificate(bucket, record('2026-12-25'));
  const early = await redeemGiftCertificate(
    bucket,
    'SSGC-ABCD-2345',
    2500,
    'Early attempt',
    'JOB-EARLY',
    new Date('2026-12-25T05:59:59.999Z'),
  );
  assert.equal(early.ok, false);
  if (!early.ok) assert.equal(early.error, 'not_active_yet');
  const storedBefore = await import('../src/lib/gift/ledger.ts').then((module) =>
    module.lookupGiftCertificate(bucket, 'SSGC-ABCD-2345'),
  );
  assert.equal(storedBefore?.redeemedCents, 0);

  const atMidnight = await redeemGiftCertificate(
    bucket,
    'SSGC-ABCD-2345',
    2500,
    'Activation boundary',
    'JOB-MIDNIGHT',
    new Date('2026-12-25T06:00:00.000Z'),
  );
  assert.equal(atMidnight.ok, true);
});
