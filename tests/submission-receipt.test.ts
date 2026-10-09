// Single-use request summary storage tests — sanitized, session-scoped, and
// best-effort. Run with: npm test.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SUMMARY_STORAGE_KEY,
  saveSubmissionSummary,
  takeSubmissionSummary,
  type StorageLike,
} from '../src/lib/forms/submission-receipt.ts';

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

test('a submitted request is stored sanitized and returned once', () => {
  const storage = memoryStorage();
  saveSubmissionSummary(
    {
      service_type: 'standard',
      frequency: 'biweekly',
      service_address: '100 S Baylen St',
      address_city: 'Pensacola',
      address_state: 'FL',
      zip: '32502',
      quoted_price: '200',
      quote_reference: 'SS-20261002-ABC123',
      name: 'Synthetic Customer',
      phone: '8500000000',
      email: 'synthetic@example.com',
      notes: 'private note that must not be kept client-side',
      extra_ref: 'bot-fill',
      quote_verified: 'mismatch',
    },
    storage,
  );

  const first = takeSubmissionSummary(storage);
  assert.ok(first);
  assert.equal(first.service_type, 'standard');
  assert.equal(first.frequency, 'biweekly');
  assert.equal(first.service_address, '100 S Baylen St');
  assert.equal(first.quoted_price, '200');
  assert.equal(first.quote_reference, 'SS-20261002-ABC123');

  // Not in the allowlist: never stored, never returned.
  assert.equal(first.name, undefined);
  assert.equal(first.phone, undefined);
  assert.equal(first.email, undefined);
  assert.equal(first.notes, undefined);
  assert.equal(first.extra_ref, undefined);
  assert.equal(first.quote_verified, undefined);

  // Single use: the second read is empty.
  assert.equal(takeSubmissionSummary(storage), null);
  assert.equal(storage.data.size, 0);
});

test('empty values are omitted instead of stored as blanks', () => {
  const storage = memoryStorage();
  saveSubmissionSummary({ service_type: '', frequency: '   ', zip: '32502' }, storage);
  const summary = takeSubmissionSummary(storage);
  assert.deepEqual(summary, { zip: '32502' });
});

test('overlong values are capped before storage', () => {
  const storage = memoryStorage();
  saveSubmissionSummary({ service_address: 'x'.repeat(5000) }, storage);
  const summary = takeSubmissionSummary(storage);
  assert.equal(summary?.service_address?.length, 300);
});

test('a broken or hostile stored value is ignored, never thrown', () => {
  const storage = memoryStorage();
  storage.setItem(SUMMARY_STORAGE_KEY, 'not json');
  assert.equal(takeSubmissionSummary(storage), null);

  storage.setItem(SUMMARY_STORAGE_KEY, JSON.stringify(['array']));
  assert.equal(takeSubmissionSummary(storage), null);

  storage.setItem(
    SUMMARY_STORAGE_KEY,
    JSON.stringify({ service_type: 'standard', injected: 'kept?' }),
  );
  const summary = takeSubmissionSummary(storage);
  assert.deepEqual(summary, { service_type: 'standard' }, 'unknown keys are dropped on read');
});

test('storage failures never break the submission flow', () => {
  const throwing: StorageLike = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('full');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  };
  assert.doesNotThrow(() => saveSubmissionSummary({ service_type: 'standard' }, throwing));
  assert.equal(takeSubmissionSummary(throwing), null);
  assert.doesNotThrow(() => saveSubmissionSummary({ service_type: 'standard' }, undefined));
  assert.equal(takeSubmissionSummary(undefined), null);
});
