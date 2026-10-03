// Gift-certificate logic tests — codes, formatting, escaping and the
// printable template. Run with: npm test (type-stripped TS).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  certificateCode,
  certificateHtml,
  formatGiftValue,
  isCertificateCode,
  redeemUrl,
} from '../src/lib/gift/certificate.ts';
import { buildGiftFulfillment, giftCertificateCodeFor } from '../src/lib/gift/fulfillment.ts';

test('certificate codes are deterministic, unique per seed and well formed', () => {
  const a1 = certificateCode('evt_123');
  const a2 = certificateCode('evt_123');
  const b = certificateCode('evt_456');
  assert.equal(a1, a2, 'the same seed always yields the same code (retry-safe)');
  assert.notEqual(a1, b);
  assert.match(a1, /^SSGC-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(isCertificateCode(a1), true);
  assert.equal(isCertificateCode('SSGC-SHORT'), false);
  assert.equal(isCertificateCode('not-a-code'), false);
});

test('codes avoid ambiguous characters', () => {
  for (let index = 0; index < 50; index += 1) {
    const code = certificateCode(`seed-${index}`);
    assert.doesNotMatch(code, /[ILO01]/, `code ${code} must avoid ambiguous characters`);
  }
});

test('redeem URLs carry only the code and the canonical origin', () => {
  const url = redeemUrl('ssgc-abcd-2345');
  assert.equal(url, 'https://sparkling-standard.com/gift-certificates/redeem/?ref=SSGC-ABCD-2345');
  assert.doesNotMatch(url, /name|email|@/i);
});

test('gift values format cleanly', () => {
  assert.equal(formatGiftValue(100), '$100');
  assert.equal(formatGiftValue(75.5), '$75.50');
  assert.equal(formatGiftValue(49.994), '$49.99');
});

test('the printable certificate escapes customer text', () => {
  const html = certificateHtml({
    code: 'SSGC-ABCD-2345',
    value: '$100',
    recipientName: '<script>alert(1)</script>',
    purchaserName: 'Ana "Quote"',
    message: 'Enjoy & relax <3',
    issuedOn: '2026-10-03',
    redeemUrl: redeemUrl('SSGC-ABCD-2345'),
    redemptionSteps: ['Contact us with the code'],
  });
  assert.doesNotMatch(html, /<script>alert/, 'raw HTML from the customer must never render');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /Enjoy &amp; relax &lt;3/);
  assert.match(html, /SSGC-ABCD-2345/);
  assert.match(html, /Contact us with the code/);
});

test('the fulfillment summary carries the code, IDs and no card data', () => {
  const purchase = {
    eventId: 'evt_abc123',
    sessionId: 'cs_test_123',
    valueUsd: 100,
    recipientName: 'Recipient',
    purchaserName: 'Purchaser',
    purchaserEmail: 'buyer@example.com',
    message: 'Happy birthday!',
    paidAtIso: '2026-10-03T12:00:00.000Z',
  };
  const fields = buildGiftFulfillment(purchase);
  assert.equal(fields['Certificate code'], giftCertificateCodeFor(purchase));
  assert.equal(fields['Gift value'], '$100');
  assert.match(fields['Redemption URL'], /gift-certificates\/redeem\/\?ref=SSGC-/);
  assert.equal(fields['Stripe event id'], 'evt_abc123');
  assert.match(fields['Next step'], /Do not issue a second certificate/);
  assert.match(fields['PAID — Gift certificate fulfillment'], /exactly one certificate/);
  const serialized = JSON.stringify(fields);
  assert.doesNotMatch(serialized, /card|4242|cvc/i);
});

test('a retried event can never mint a second code', () => {
  assert.equal(giftCertificateCodeFor({ eventId: 'evt_x' }), giftCertificateCodeFor({ eventId: 'evt_x' }));
});
