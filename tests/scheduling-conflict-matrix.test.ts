import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FakeLedger } from './helpers/payment-fakes.ts';
import {
  createBookingHold,
  holdKey,
  listActiveHolds,
} from '../src/lib/booking/holds.ts';
import { writeLedgerJson } from '../src/lib/payments/ledger.ts';
import {
  calculateAvailability,
  type AvailabilityRequest,
  type BookingResourceWindow,
  type ExistingJob,
} from '../src/lib/booking/availability.ts';
import { zonedTimeToUtc } from '../src/lib/booking/time.ts';

const tz = 'America/Chicago';
const ORIGIN = { lat: 30.4, lng: -87.2 };
const DESTINATION = { lat: 30.45, lng: -87.25 };
const OTHER = { lat: 30.5, lng: -87.3 };
const DATE = '2026-12-02';

function resource(id: string, anchor = true, overrides: Partial<BookingResourceWindow> = {}): BookingResourceWindow {
  return { id, anchor, workdays: [0, 1, 2, 3, 4, 5, 6], workdayStart: '07:00', workdayEnd: '19:00', origin: ORIGIN, ...overrides };
}

function request(overrides: Partial<AvailabilityRequest> = {}): AvailabilityRequest {
  return {
    date: DATE,
    timeZone: tz,
    workdayStart: '07:00',
    workdayEnd: '19:00',
    workdays: [0, 1, 2, 3, 4, 5, 6],
    slotMinutes: 15,
    minimumNoticeHours: 0,
    maxAdvanceDays: 60,
    travelBufferMinutes: 15,
    jobBufferMinutes: 15,
    resources: [resource('lead')],
    crewSize: 1,
    minimumJobMinutes: 60,
    maximumJobMinutes: 600,
    durationMinutes: 120,
    destination: DESTINATION,
    jobs: [],
    now: zonedTimeToUtc('2026-11-26', '08:00', tz),
    travelMinutes: async () => 0,
    ...overrides,
  };
}

function at(time: string): string {
  return zonedTimeToUtc(DATE, time, tz).toISOString();
}

function job(start: string, end: string, ids: string[], location = DESTINATION): ExistingJob {
  return { start: zonedTimeToUtc(DATE, start, tz), end: zonedTimeToUtc(DATE, end, tz), location, resourceIds: ids };
}

test('an expired or released hold cannot block a new simultaneous hold', async () => {
  const bucket = new FakeLedger();
  const base = {
    date: DATE,
    start: at('07:00'),
    end: at('09:00'),
    durationMinutes: 120,
    destination: DESTINATION,
    locationText: '100 Test St, Pensacola, FL 32502',
    reference: 'SS-20261202-AAAAAA',
    resourceIds: ['lead'],
    crewSize: 1,
  };
  const created = await createBookingHold(bucket, base);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal((await createBookingHold(bucket, { ...base, reference: 'SS-20261202-BBBBBB' })).ok, false);
  await writeLedgerJson(bucket, holdKey(created.hold.id), {
    ...created.hold,
    expiresAt: '2026-01-01T00:00:00.000Z',
  });
  assert.equal((await listActiveHolds(bucket, DATE)).length, 0);
  assert.equal((await createBookingHold(bucket, { ...base, reference: 'SS-20261202-CCCCCC' })).ok, true);
});

test('two independent cleaners can hold different jobs at the same time, while one cleaner cannot', async () => {
  const bucket = new FakeLedger();
  const base = {
    date: DATE,
    start: at('07:00'),
    end: at('09:00'),
    durationMinutes: 120,
    destination: DESTINATION,
    locationText: '100 Test St, Pensacola, FL 32502',
    reference: 'SS-20261202-AAAAAA',
    crewSize: 1,
  };
  assert.equal((await createBookingHold(bucket, { ...base, resourceIds: ['lead-1'] })).ok, true);
  assert.equal((await createBookingHold(bucket, { ...base, resourceIds: ['lead-1'], reference: 'SS-20261202-BBBBBB' })).ok, false);
  assert.equal((await createBookingHold(bucket, { ...base, resourceIds: ['lead-2'], reference: 'SS-20261202-CCCCCC' })).ok, true);
  assert.equal((await listActiveHolds(bucket, DATE)).length, 2);
});

test('a two-person job consumes both resources and blocks a simultaneous booking', async () => {
  const pair = await calculateAvailability(
    request({ resources: [resource('lead'), resource('helper')], crewSize: 2 }),
    (date) => date.toISOString(),
  );
  const first = pair.slots.find((slot) => slot.start === at('07:00'));
  assert.ok(first);
  assert.equal(first.resourceIds.length, 2);
  const blocked = await calculateAvailability(
    request({
      resources: [resource('lead'), resource('helper')],
      crewSize: 2,
      jobs: [job('07:00', '09:00', ['lead', 'helper'])],
    }),
    (date) => date.toISOString(),
  );
  assert.equal(blocked.slots.some((slot) => slot.start === at('07:00')), false);
});

test('a required crew larger than the available roster is withheld, never silently reduced', async () => {
  const result = await calculateAvailability(
    request({ resources: [resource('lead')], crewSize: 2 }),
    (date) => date.toISOString(),
  );
  assert.equal(result.available, false);
  assert.equal(result.reason, 'crew_unavailable');
  assert.equal(result.slots.length, 0);
});

test('travel and buffer time apply between real jobs but not before the first job', async () => {
  const first = await calculateAvailability(
    request({ travelMinutes: async () => 30 }),
    (date) => date.toISOString(),
  );
  assert.ok(first.slots.some((slot) => slot.start === at('07:00')), 'the first job starts at opening without origin travel');

  const next = await calculateAvailability(
    request({
      jobs: [job('07:00', '09:00', ['lead'])],
      travelMinutes: async () => 30,
    }),
    (date) => date.toISOString(),
  );
  assert.equal(next.slots.some((slot) => slot.start === at('09:00')), false);
  assert.equal(next.slots.some((slot) => slot.start === at('09:15')), false);
  assert.equal(next.slots.some((slot) => slot.start === at('09:45')), false);
  assert.ok(next.slots.some((slot) => slot.start === at('10:00')), 'combined travel/job buffer + 30-minute travel');
});

test('branch time zones produce distinct UTC instants for the same local start', async () => {
  const chicago = await calculateAvailability(request({ timeZone: 'America/Chicago' }), (date, zone) => date.toISOString());
  const tampa = await calculateAvailability(
    request({
      timeZone: 'America/New_York',
      resources: [resource('lead', true, { origin: { lat: 27.95, lng: -82.45 } })],
      destination: { lat: 27.96, lng: -82.46 },
    }),
    (date) => date.toISOString(),
  );
  assert.ok(chicago.slots.some((slot) => slot.start === '2026-12-02T13:00:00.000Z'));
  assert.ok(tampa.slots.some((slot) => slot.start === '2026-12-02T12:00:00.000Z'));
});

test('an all-day blocked calendar event removes every resource slot that day', async () => {
  const result = await calculateAvailability(
    request({
      resources: [resource('lead'), resource('helper')],
      jobs: [{ start: new Date('2026-12-02T00:00:00.000Z'), end: new Date('2026-12-03T00:00:00.000Z'), location: null, blocksDay: true }],
    }),
    (date) => date.toISOString(),
  );
  assert.equal(result.available, false);
  assert.equal(result.slots.length, 0);
});
