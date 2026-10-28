import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildGiftCertificateEmail } from '../src/lib/gift/delivery.ts';

test('automatic gift delivery contains a code, value, recipient and no-expiry terms', () => {
  const email = buildGiftCertificateEmail({
    code: 'SSGC-ABCD-2345',
    valueUsd: 100,
    recipientName: 'Synthetic Recipient',
    purchaserName: 'Synthetic Purchaser',
    message: 'Enjoy a beautifully kept home.',
    paidAtIso: '2026-10-27T12:00:00.000Z',
    siteUrl: 'https://sparkling-standard.com',
    recipient: 'purchaser',
  });
  assert.match(email.subject, /gift certificate/i);
  assert.match(email.html, /SSGC-ABCD-2345/);
  assert.match(email.html, /\$100/);
  assert.match(email.html, /Synthetic Recipient/);
  assert.match(email.html, /does not expire/i);
  assert.match(email.html, /no post-sale service/i);
  assert.match(email.text, /https:\/\/sparkling-standard\.com\/gift-certificates\/redeem\//);
});
