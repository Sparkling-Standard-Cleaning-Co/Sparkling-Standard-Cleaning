import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addDays,
  localWeekday,
  zonedTimeToUtc,
} from '../src/lib/booking/time.ts';
import { calculateAvailability, type AvailabilityRequest } from '../src/lib/booking/availability.ts';

const tz = 'America/Chicago';
const origin = { lat: 30.61, lng: -87.34 };
const destination = { lat: 30.4111, lng: -87.2164 };

function request(overrides: Partial<AvailabilityRequest> = {}): AvailabilityRequest {
  return {
    date: '2026-11-10',
    timeZone: tz,
    workdayStart: '08:00',
    workdayEnd: '18:00',
    workdays: [0, 1, 2, 3, 4, 5, 6],
    slotMinutes: 30,
    minimumNoticeHours: 24,
    maxAdvanceDays: 60,
    travelBufferMinutes: 15,
    jobBufferMinutes: 15,
    crewCount: 1,
    maxConcurrentJobs: 1,
    minimumJobMinutes: 60,
    maximumJobMinutes: 600,
    durationMinutes: 120,
    origin,
    destination,
    jobs: [],
    now: new Date('2026-11-07T12:00:00Z'),
    travelMinutes: async () => 20,
    ...overrides,
  };
}

const label = (date: Date) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(date);

test('Central Time conversion handles standard time and spring-forward DST', () => {
  assert.equal(zonedTimeToUtc('2026-11-10', '08:00', tz).toISOString(), '2026-11-10T14:00:00.000Z');
  assert.equal(zonedTimeToUtc('2026-03-08', '01:30', tz).toISOString(), '2026-03-08T07:30:00.000Z');
  assert.equal(zonedTimeToUtc('2026-03-08', '08:00', tz).toISOString(), '2026-03-08T13:00:00.000Z');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(localWeekday('2026-11-10', tz), 2);
});

test('a free day offers only slots that fit the workday, travel and notice period', async () => {
  const result = await calculateAvailability(request(), label);
  assert.equal(result.enabled, true);
  assert.equal(result.available, true);
  const first = result.slots[0]!;
  assert.equal(label(new Date(first.start)), '9:00 AM');
  const last = result.slots.at(-1)!;
  assert.ok(new Date(last.end) <= zonedTimeToUtc('2026-11-10', '18:00', tz));
});

test('a nearby previous job consumes travel time before the new job', async () => {
  const result = await calculateAvailability(
    request({
      jobs: [
        {
          start: zonedTimeToUtc('2026-11-10', '08:00', tz),
          end: zonedTimeToUtc('2026-11-10', '09:30', tz),
          location: destination,
        },
      ],
    }),
    label,
  );
  assert.equal(result.available, true);
  assert.equal(label(new Date(result.slots[0]!.start)), '10:30 AM');
});

test('a next job limits the latest end time by transition travel and buffer', async () => {
  const result = await calculateAvailability(
    request({
      jobs: [
        {
          start: zonedTimeToUtc('2026-11-10', '14:00', tz),
          end: zonedTimeToUtc('2026-11-10', '15:00', tz),
          location: destination,
        },
      ],
      travelMinutes: async () => 20,
    }),
    label,
  );
  assert.equal(result.available, true);
  const beforeNextJob = result.slots.filter(
    (slot) => new Date(slot.start) < zonedTimeToUtc('2026-11-10', '14:00', tz),
  );
  assert.ok(beforeNextJob.length > 0);
  for (const slot of beforeNextJob) {
    const end = new Date(slot.end);
    assert.ok(
      end <= zonedTimeToUtc('2026-11-10', '13:10', tz),
      `${slot.endLabel} must leave 30 min buffer + 20 min travel before 2 PM`,
    );
  }
});

test('a job without a location blocks the day instead of inventing travel', async () => {
  const result = await calculateAvailability(
    request({
      jobs: [
        {
          start: zonedTimeToUtc('2026-11-10', '08:00', tz),
          end: zonedTimeToUtc('2026-11-10', '08:30', tz),
          location: null,
        },
      ],
    }),
    label,
  );
  assert.equal(result.available, false);
  assert.equal(result.reason, 'travel_unavailable');
});

test('an unavailable route withholds every slot and never guesses', async () => {
  const result = await calculateAvailability(
    request({ travelMinutes: async () => null }),
    label,
  );
  assert.equal(result.available, false);
  assert.equal(result.reason, 'travel_unavailable');
  assert.equal(result.slots.length, 0);
});

test('closed days, short-notice dates and invalid durations fail closed', async () => {
  assert.equal((await calculateAvailability(request({ workdays: [1] }), label)).reason, 'day_closed');
  assert.equal(
    (await calculateAvailability(request({ now: new Date('2026-11-10T12:00:00Z') }), label)).reason,
    'past_cutoff',
  );
  assert.equal(
    (await calculateAvailability(request({ durationMinutes: 10 }), label)).reason,
    'duration_invalid',
  );
});
