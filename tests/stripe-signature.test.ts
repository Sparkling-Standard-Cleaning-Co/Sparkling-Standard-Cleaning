// Stripe webhook signature verification tests (WebCrypto HMAC).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { verifyStripeSignature } from '../src/lib/gift/stripe-signature.ts';

const SECRET = 'whsec_test_secret';

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sign(payload: string, timestamp: number, secret = SECRET): Promise<string> {
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

test('a correctly signed payload verifies', async () => {
  const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
  const now = 1_800_000_000_000;
  const header = await sign(payload, Math.floor(now / 1000));
  const result = await verifyStripeSignature(payload, header, SECRET, { nowMs: now });
  assert.equal(result.ok, true);
});

test('a tampered payload fails', async () => {
  const now = 1_800_000_000_000;
  const header = await sign('{"amount":100}', Math.floor(now / 1000));
  const result = await verifyStripeSignature('{"amount":10000}', header, SECRET, { nowMs: now });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'mismatch');
});

test('a wrong secret fails', async () => {
  const now = 1_800_000_000_000;
  const header = await sign('{"id":"evt_1"}', Math.floor(now / 1000), 'whsec_wrong');
  const result = await verifyStripeSignature('{"id":"evt_1"}', header, SECRET, { nowMs: now });
  assert.equal(result.ok, false);
});

test('an old timestamp is rejected as expired', async () => {
  const now = 1_800_000_000_000;
  const header = await sign('{"id":"evt_1"}', Math.floor(now / 1000) - 3600);
  const result = await verifyStripeSignature('{"id":"evt_1"}', header, SECRET, { nowMs: now });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'expired');
});

test('missing and malformed headers fail closed', async () => {
  assert.equal((await verifyStripeSignature('{}', null, SECRET)).reason, 'missing');
  assert.equal((await verifyStripeSignature('{}', 'garbage', SECRET)).reason, 'malformed');
  assert.equal((await verifyStripeSignature('{}', 't=abc,v1=', SECRET)).reason, 'malformed');
});

test('one valid signature among several is accepted (Stripe rotates secrets)', async () => {
  const now = 1_800_000_000_000;
  const valid = await sign('{"id":"evt_2"}', Math.floor(now / 1000));
  const validPart = valid.split(',')[1];
  const header = `t=${Math.floor(now / 1000)},v1=${'0'.repeat(64)},${validPart}`;
  const result = await verifyStripeSignature('{"id":"evt_2"}', header, SECRET, { nowMs: now });
  assert.equal(result.ok, true);
});
