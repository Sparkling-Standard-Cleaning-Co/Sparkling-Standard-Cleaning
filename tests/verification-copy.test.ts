// Reservation receipt copy tests — the customer must never be told an
// unverified price was accepted.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reservationReceipt } from '../src/lib/forms/verification-copy.ts';
import type { LeadVerification } from '../src/lib/forms/submit.ts';

const v = (status: LeadVerification['status']): LeadVerification => ({
  status,
  travel_verified: status === 'verified',
  travel_method: status === 'verified' ? 'route' : 'straight_line_estimate',
  config_match: status === 'verified' ? 'match' : 'unknown',
});

test('only the verified verdict is presented as verified', () => {
  const verified = reservationReceipt(v('verified'), 'relay');
  assert.equal(verified.state, 'success');
  assert.match(verified.message, /checked the proposed price/i);
  assert.match(verified.message, /Sparkling Standard will confirm/i);
  assert.match(verified.message, /nothing is booked yet/i);

  for (const status of ['preliminary', 'mismatch', 'unverifiable'] as const) {
    const receipt = reservationReceipt(v(status), 'relay');
    assert.equal(receipt.state, 'warning', `${status} must not be a plain success`);
    assert.doesNotMatch(
      receipt.message,
      /checked the proposed price|verified/i,
      `${status} must not claim full verification`,
    );
  }
});

test('a preliminary verdict names the travel uncertainty', () => {
  const receipt = reservationReceipt(v('preliminary'), 'relay');
  assert.match(receipt.message, /drive time still needs a final check/i);
  assert.match(receipt.message, /before anything is scheduled/i);
});

test('a mismatch verdict never implies the displayed price was accepted', () => {
  const receipt = reservationReceipt(v('mismatch'), 'relay');
  assert.match(receipt.message, /needs a personal review/i);
  assert.match(receipt.message, /confirm the correct price/i);
  assert.doesNotMatch(receipt.message, /accepted/i);
});

test('the direct-provider fallback is honest about the missing server check', () => {
  const receipt = reservationReceipt(v('verified'), 'provider');
  assert.equal(receipt.state, 'warning');
  assert.match(receipt.message, /could not complete our usual check/i);
});

test('a missing verdict (older relay) stays honest and request-only', () => {
  const receipt = reservationReceipt(undefined, 'relay');
  assert.equal(receipt.state, 'warning');
  assert.match(receipt.message, /Sparkling Standard will confirm scope, travel and price/i);
});
