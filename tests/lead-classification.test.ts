import { test } from 'node:test';
import assert from 'node:assert/strict';

import { looksLikeTestLead, suspectTestReasons } from '../src/lib/admin/lead-classification.ts';

test('placeholder and diagnostic records are identified without name guessing', () => {
  assert.equal(looksLikeTestLead({ name: 'Your Name Here', payload: {} }), true);
  assert.equal(looksLikeTestLead({ name: 'CHECKOUT DIAGNOSTIC - IGNORE', payload: {} }), true);
  assert.equal(looksLikeTestLead({ email: 'owner+checkout-diagnostic@sparkling-standard.com' }), true);
  assert.equal(looksLikeTestLead({ phone: '850-000-0000' }), true);
  assert.equal(looksLikeTestLead({ payload: { test_mode: 'yes' } }), true);
});

test('a familiar personal name alone is not classified as a test', () => {
  const reasons = suspectTestReasons({
    name: 'Hayli Bobrowski',
    email: 'haylibobrowski@gmail.com',
    phone: '8504268479',
    payload: { service_type: 'deep' },
  });
  assert.deepEqual(reasons, []);
  assert.equal(looksLikeTestLead({ name: 'Hayli' }), false);
});

test('legitimate customer records are not flagged by ordinary values', () => {
  assert.equal(looksLikeTestLead({ name: 'Christina Sherwin', email: 'christina.sherwin@gmail.com', phone: '850-555-1212' }), false);
});
