import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bookingHoldContextKey } from '../src/lib/booking/context.ts';

const base = {
  durationMinutes: 180,
  preferredDate: '2026-11-27',
  locationKey: '30.4111,-87.2164',
};

test('a held time survives quote-reference and price recalculation', () => {
  const first = bookingHoldContextKey(base);
  const nextMinute = bookingHoldContextKey({ ...base });
  assert.equal(first, nextMinute);
  assert.notEqual(first, '');
});

test('a hold is invalidated when its date, duration or destination changes', () => {
  assert.notEqual(bookingHoldContextKey(base), bookingHoldContextKey({ ...base, preferredDate: '2026-11-28' }));
  assert.notEqual(bookingHoldContextKey(base), bookingHoldContextKey({ ...base, durationMinutes: 240 }));
  assert.notEqual(bookingHoldContextKey(base), bookingHoldContextKey({ ...base, locationKey: '30.5000,-87.3000' }));
});

test('an incomplete scheduling context produces no key and therefore no hold', () => {
  assert.equal(bookingHoldContextKey({ ...base, durationMinutes: 0 }), '');
  assert.equal(bookingHoldContextKey({ ...base, durationMinutes: Number.NaN }), '');
  assert.equal(bookingHoldContextKey({ ...base, preferredDate: '11/27/2026' }), '');
  assert.equal(bookingHoldContextKey({ ...base, locationKey: '' }), '');
});
