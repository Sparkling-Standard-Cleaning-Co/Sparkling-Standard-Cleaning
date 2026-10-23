// QR registry mapping tests — every printed QR must resolve through the
// authoritative marketing-link registry (never a hand-written URL).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { printQrMappings, resolveQrAsset } from '../../scripts/print/qr-map.mjs';

const EXPECTED = {
  'business-card': '/estimate/',
  'quarter-sheet': '/recurring-cleaning/',
  'quarter-sheet-sparkle100': '/estimate/',
  'door-hanger': '/recurring-cleaning/',
  'qr-estimate-card': '/estimate/',
  'event-poster': '/estimate/',
  'foam-board': '/estimate/',
  'community-leave-behind': '/estimate/',
  'realtor-packet': '/move-in-move-out-cleaning/',
};

test('every print QR resolves to its registered, active destination', () => {
  const mappings = printQrMappings();
  assert.equal(mappings.length, 9);
  for (const mapping of mappings) {
    assert.equal(new URL(mapping.url).pathname, EXPECTED[mapping.qrAssetId], mapping.qrAssetId);
    assert.match(mapping.url, /utm_source=/);
    assert.match(mapping.url, /utm_medium=print|utm_medium=outreach/);
  }
});

test('the SPARKLE100 print QR pre-claims the approved promotion', () => {
  const mapping = resolveQrAsset('quarter-sheet-sparkle100');
  const url = new URL(mapping.url);
  assert.equal(url.searchParams.get('promo'), 'SPARKLE100');
  assert.equal(url.searchParams.get('utm_campaign'), 'sparkle100');
});

test('unknown asset ids fail closed', () => {
  assert.throws(() => resolveQrAsset('not-a-real-qr'), /not registered/);
});
