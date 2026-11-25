import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planCrew } from '../src/lib/booking/crew.ts';
import {
  calculateAvailability,
  type AvailabilityRequest,
  type BookingResourceWindow,
} from '../src/lib/booking/availability.ts';
import { zonedTimeToUtc } from '../src/lib/booking/time.ts';

const tz = 'America/Chicago';
const origin = { lat: 30.61, lng: -87.34 };
const destination = { lat: 30.4111, lng: -87.2164 };
const date = '2026-11-10';

function minutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

function resources(count: number): BookingResourceWindow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index === 0 ? 'hayli' : `helper-${index}`,
    workdays: [0, 1, 2, 3, 4, 5, 6],
    workdayStart: '07:00',
    workdayEnd: '19:00',
    origin,
    anchor: index === 0,
  }));
}

function request(overrides: Partial<AvailabilityRequest> = {}): AvailabilityRequest {
  return {
    date,
    timeZone: tz,
    workdayStart: '07:00',
    workdayEnd: '19:00',
    workdays: [0, 1, 2, 3, 4, 5, 6],
    slotMinutes: 15,
    minimumNoticeHours: 24,
    maxAdvanceDays: 60,
    travelBufferMinutes: 15,
    jobBufferMinutes: 15,
    resources: resources(2),
    crewSize: 1,
    maxCrewSize: 2,
    minimumJobMinutes: 60,
    maximumJobMinutes: 600,
    durationMinutes: 120,
    laborHours: 6,
    crewEfficiency: 0.85,
    destination,
    jobs: [],
    now: new Date('2026-11-01T12:00:00Z'),
    travelMinutes: async () => 20,
    ...overrides,
  };
}

const label = (value: Date) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(value);

test('a six-hour afternoon job plans a mandatory two-cleaner crew', () => {
  const plan = planCrew({
    laborHours: 6,
    startMinutes: minutes('14:30'),
    workdayEndMinutes: minutes('19:00'),
    minimumJobMinutes: 60,
    maximumJobMinutes: 600,
    maxCrewSize: 2,
    efficiency: 0.85,
    slotMinutes: 15,
  });
  assert.equal(plan.feasible, true);
  assert.equal(plan.crewSize, 2);
  assert.ok(plan.durationMinutes <= plan.availableMinutes);
  assert.ok(plan.durationMinutes > 150 && plan.durationMinutes <= 210);
});

test('the same labor starts with one cleaner in the morning', () => {
  const plan = planCrew({
    laborHours: 6,
    startMinutes: minutes('07:00'),
    workdayEndMinutes: minutes('19:00'),
    minimumJobMinutes: 60,
    maximumJobMinutes: 600,
    maxCrewSize: 2,
    efficiency: 0.85,
    slotMinutes: 15,
  });
  assert.equal(plan.feasible, true);
  assert.equal(plan.crewSize, 1);
  assert.equal(plan.durationMinutes, 360);
});

test('a job that cannot finish before closing is not offered', () => {
  const plan = planCrew({
    laborHours: 10,
    startMinutes: minutes('14:30'),
    workdayEndMinutes: minutes('19:00'),
    minimumJobMinutes: 60,
    maximumJobMinutes: 600,
    maxCrewSize: 2,
    efficiency: 0.85,
    slotMinutes: 15,
  });
  assert.equal(plan.feasible, false);

  const tooLate = planCrew({
    laborHours: 1,
    startMinutes: minutes('18:30'),
    workdayEndMinutes: minutes('19:00'),
    minimumJobMinutes: 60,
    maximumJobMinutes: 600,
    maxCrewSize: 2,
    efficiency: 0.85,
  });
  assert.equal(tooLate.feasible, false);
});

test('availability offers 2:30 PM for a six-hour job with the required crew', async () => {
  const result = await calculateAvailability(request(), label);
  assert.equal(result.available, true);
  const afternoon = result.slots.find((slot) => label(new Date(slot.start)) === '2:30 PM');
  assert.ok(afternoon, 'the afternoon start remains available');
  assert.equal(afternoon.crewSize, 2);
  assert.equal(afternoon.resourceIds.length, 2);
  assert.equal(afternoon.endLabel, '5:45 PM');
  const lastSlot = result.slots.at(-1)!;
  assert.ok(new Date(lastSlot.end) <= zonedTimeToUtc(date, '19:00', tz));
});

test('a slot is still offered when only one cleaner is currently available', async () => {
  const result = await calculateAvailability(
    request({
      jobs: [
        {
          start: zonedTimeToUtc(date, '14:00', tz),
          end: zonedTimeToUtc(date, '17:00', tz),
          location: destination,
          resourceIds: ['helper-1'],
        },
      ],
    }),
    label,
  );
  const afternoon = result.slots.find((slot) => label(new Date(slot.start)) === '2:30 PM');
  assert.ok(afternoon, 'the time is operationally feasible');
  assert.equal(afternoon.crewSize, 2);
  assert.equal(afternoon.resourceIds.length, 1, 'the missing seat is staffing-pending');
});

test('legacy fixed-duration availability is unchanged without labor hours', async () => {
  const result = await calculateAvailability(
    request({ laborHours: undefined, durationMinutes: 120 }),
    label,
  );
  const afternoon = result.slots.find((slot) => label(new Date(slot.start)) === '2:30 PM');
  assert.ok(afternoon);
  assert.equal(afternoon.crewSize, 1);
  assert.equal(afternoon.endLabel, '4:30 PM');
});
