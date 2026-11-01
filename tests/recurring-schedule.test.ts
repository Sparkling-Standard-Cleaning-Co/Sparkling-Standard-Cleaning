import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthAnchored, occurrenceDate, occurrenceDatesWithin } from '../src/lib/admin/recurring-schedule.ts';

test('weekly recurrence advances exactly seven days', () => {
  assert.equal(occurrenceDate('2026-01-07', 'weekly', 3), '2026-01-28');
});

test('biweekly recurrence advances exactly fourteen days', () => {
  assert.equal(occurrenceDate('2026-01-07', 'biweekly', 4), '2026-03-04');
});

test('monthly recurrence clamps month-end without cumulative drift', () => {
  assert.equal(monthAnchored('2026-01-31', 1), '2026-02-28');
  assert.equal(monthAnchored('2026-01-31', 2), '2026-03-31');
  assert.equal(monthAnchored('2024-01-31', 1), '2024-02-29');
  assert.equal(monthAnchored('2026-01-31', 13), '2027-02-28');
});

test('long-running recurrence generates the correct 60-day horizon', () => {
  const dates = occurrenceDatesWithin('2024-01-03', 'weekly', '2026-11-01', '2026-12-31');
  assert.ok(dates.length >= 8);
  assert.equal(dates[0], '2026-11-04');
  assert.ok(dates.every((date) => date >= '2026-11-01' && date <= '2026-12-31'));
});

test('future-start weekly plan does not emit dates before its start', () => {
  const dates = occurrenceDatesWithin('2027-01-06', 'weekly', '2026-11-01', '2027-02-01');
  assert.equal(dates[0], '2027-01-06');
});

test('DST transition dates remain on the America/Chicago local date', () => {
  const dates = occurrenceDatesWithin('2026-10-25', 'weekly', '2026-10-25', '2026-11-15');
  assert.deepEqual(dates, ['2026-10-25', '2026-11-01', '2026-11-08', '2026-11-15']);
});

test('month-end horizon generation keeps anchored dates', () => {
  const dates = occurrenceDatesWithin('2026-01-31', 'monthly', '2026-11-01', '2027-03-31');
  assert.deepEqual(dates, ['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31']);
});

test('repeated horizon generation is deterministic and duplicate-free', () => {
  const first = occurrenceDatesWithin('2025-05-14', 'biweekly', '2026-11-01', '2026-12-31');
  const second = occurrenceDatesWithin('2025-05-14', 'biweekly', '2026-11-01', '2026-12-31');
  assert.deepEqual(first, second);
  assert.equal(new Set(first).size, first.length);
});
