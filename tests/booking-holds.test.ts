import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FakeLedger } from './helpers/payment-fakes.ts';
import {
  createBookingHold,
  getBookingHold,
  holdIsActive,
  listActiveHolds,
} from '../src/lib/booking/holds.ts';

const slot = {
  date: '2026-11-10',
  start: '2026-11-10T15:00:00.000Z',
  end: '2026-11-10T17:00:00.000Z',
  durationMinutes: 120,
  destination: { lat: 30.4111, lng: -87.2164 },
  locationText: '100 S Baylen St, Pensacola, FL 32502',
  reference: 'SS-20261027-ABC123',
};

test('a hold is durable, expiring and readable by opaque id', async () => {
  const bucket = new FakeLedger();
  const created = await createBookingHold(bucket, slot);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.match(created.hold.id, /^2026-11-10__[a-f0-9-]{36}$/);
  assert.equal(holdIsActive(created.hold), true);
  const fetched = await getBookingHold(bucket, created.hold.id);
  assert.equal(fetched?.reference, slot.reference);
  assert.equal(fetched?.locationText, slot.locationText);
  const active = await listActiveHolds(bucket, slot.date);
  assert.equal(active.length, 1);
});

test('overlapping holds for one day are rejected atomically', async () => {
  const bucket = new FakeLedger();
  const first = await createBookingHold(bucket, slot);
  assert.equal(first.ok, true);
  const second = await createBookingHold(bucket, {
    ...slot,
    start: '2026-11-10T16:00:00.000Z',
    end: '2026-11-10T18:00:00.000Z',
    reference: 'SS-20261027-DEF456',
  });
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.error, 'overlap');
  assert.equal((await listActiveHolds(bucket, slot.date)).length, 1);
});

test('adjacent holds do not overlap', async () => {
  const bucket = new FakeLedger();
  assert.equal((await createBookingHold(bucket, slot)).ok, true);
  const next = await createBookingHold(bucket, {
    ...slot,
    start: '2026-11-10T17:00:00.000Z',
    end: '2026-11-10T19:00:00.000Z',
    reference: 'SS-20261027-GHI789',
  });
  assert.equal(next.ok, true);
  assert.equal((await listActiveHolds(bucket, slot.date)).length, 2);
});
