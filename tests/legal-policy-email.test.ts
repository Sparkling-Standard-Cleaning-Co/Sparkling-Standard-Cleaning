import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeCloudflareEmail } from '../src/scripts/legal-policy-dialog.ts';

function encode(email: string, key: number): string {
  const bytes = [key, ...[...email].map((character) => character.charCodeAt(0) ^ key)];
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

test('Cloudflare email obfuscation decodes back to the real address', () => {
  const encoded = encode('customer-service@sparkling-standard.com', 0x42);
  assert.equal(decodeCloudflareEmail(encoded), 'customer-service@sparkling-standard.com');
});

test('malformed obfuscation payloads fail closed', () => {
  assert.equal(decodeCloudflareEmail(''), null);
  assert.equal(decodeCloudflareEmail('zzzz'), null);
  assert.equal(decodeCloudflareEmail('abc'), null);
  assert.equal(decodeCloudflareEmail(encode('not-an-email', 0x11)), null);
});
