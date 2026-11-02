import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recurringSchedulingEnabled } from '../src/lib/booking/recurring-gate.ts';

test('recurring is enabled by default and can be explicitly disabled', () => {
  assert.equal(recurringSchedulingEnabled({}), true);
  assert.equal(recurringSchedulingEnabled({ RECURRING_SCHEDULING_ENABLED: 'true' }), true);
  assert.equal(recurringSchedulingEnabled({ RECURRING_SCHEDULING_ENABLED: ' false ' }), false);
  assert.equal(recurringSchedulingEnabled({ RECURRING_SCHEDULING_ENABLED: 'FALSE' }), false);
});
