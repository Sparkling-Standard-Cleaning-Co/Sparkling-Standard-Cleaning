import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recurringSchedulingEnabled } from '../src/lib/booking/recurring-gate.ts';

test('recurring requires an explicit enabled flag and fails closed', () => {
  assert.equal(recurringSchedulingEnabled({}), false);
  assert.equal(recurringSchedulingEnabled({ RECURRING_SCHEDULING_ENABLED: 'true' }), true);
  assert.equal(recurringSchedulingEnabled({ RECURRING_SCHEDULING_ENABLED: ' false ' }), false);
  assert.equal(recurringSchedulingEnabled({ RECURRING_SCHEDULING_ENABLED: 'FALSE' }), false);
});
