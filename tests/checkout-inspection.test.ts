import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyCheckoutSession } from '../src/lib/payments/checkout-inspection.ts';

const now = Date.parse('2026-11-26T12:00:00.000Z');

test('checkout inspection distinguishes setup failures, provider failures and abandoned sessions', () => {
  const setup = classifyCheckoutSession(
    { status: 'failed', stripe_session_id: null, created_at: '2026-11-26T11:00:00.000Z' },
    now,
  );
  assert.equal(setup.category, 'Setup failure');
  assert.equal(setup.actionable, true);

  const provider = classifyCheckoutSession(
    { status: 'failed', stripe_session_id: 'cs_test_123', created_at: '2026-11-26T11:00:00.000Z' },
    now,
  );
  assert.equal(provider.category, 'Provider/session failure');
  assert.equal(provider.actionable, true);

  const abandoned = classifyCheckoutSession(
    {
      status: 'open',
      stripe_session_id: 'cs_test_123',
      created_at: '2026-11-26T10:00:00.000Z',
      expires_at: '2026-11-26T11:00:00.000Z',
    },
    now,
  );
  assert.equal(abandoned.category, 'Abandoned checkout');
  assert.equal(abandoned.actionable, false);
});

test('a completed session is never labelled a failure', () => {
  const completed = classifyCheckoutSession(
    { status: 'completed', stripe_session_id: 'cs_test_123', created_at: '2026-11-26T11:00:00.000Z' },
    now,
  );
  assert.equal(completed.category, 'Completed');
  assert.equal(completed.actionable, false);
});
