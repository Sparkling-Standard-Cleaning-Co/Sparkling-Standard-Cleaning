import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bookingConfig } from '../src/config/booking.ts';
import {
  calendarJobsForDate,
  calendarStatus,
  createCalendarEvent,
} from '../src/lib/booking/google-calendar.ts';
import { onRequestGet as availabilityGet } from '../functions/api/availability.ts';
import { FakeLedger } from './helpers/payment-fakes.ts';
import { onRequestPost as bookingAdminPost } from '../functions/api/booking-admin.ts';
import { createBookingHold, getBookingHold } from '../src/lib/booking/holds.ts';

const env = {
  GOOGLE_CLIENT_ID: 'client',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_REFRESH_TOKEN: 'refresh',
  GOOGLE_CALENDAR_ID: 'bookings@example.test',
  TRAVEL_ORIGIN: '30.6100,-87.3400',
  PAYMENT_LEDGER: new FakeLedger(),
  ROUTES_PROVIDER: 'mapmap',
  ROUTES_API_KEY: 'routes',
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let nextDate = '';
function futureDate(): string {
  if (!nextDate) {
    nextDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(Date.now() + 10 * 86_400_000));
  }
  return nextDate;
}

async function withFetch<T>(
  stub: (url: string, init?: RequestInit) => Promise<Response>,
  run: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    stub(String(input), init)) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function googleStub(events: unknown[] = []) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.includes('oauth2.googleapis.com/token')) {
      assert.equal(init?.method, 'POST');
      return jsonResponse({ access_token: 'access', expires_in: 3600 });
    }
    if (url.includes('/calendar/v3/calendars/') && url.includes('/events')) {
      return jsonResponse({ items: events });
    }
    if (url.includes('/calendar/v3/calendars/')) {
      return jsonResponse({ summary: 'Sparkling Standard — Bookings', timeZone: 'America/Chicago' });
    }
    if (url.includes('api.mapmap.ai/route/v1/')) {
      return jsonResponse({ routes: [{ distance: 16093, duration: 1200 }] });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
}

test('calendar status and jobs use the dedicated calendar, not any other calendar', async () => {
  await withFetch(googleStub([
    {
      id: 'job-1',
      summary: 'Cleaning',
      location: '100 S Baylen St, Pensacola, FL 32502',
      start: { dateTime: '2026-11-10T14:00:00Z' },
      end: { dateTime: '2026-11-10T16:00:00Z' },
    },
    {
      id: 'free-1',
      summary: 'Personal',
      start: { dateTime: '2026-11-10T17:00:00Z' },
      end: { dateTime: '2026-11-10T18:00:00Z' },
      transparency: 'transparent',
    },
    {
      id: 'cancelled',
      summary: 'Cancelled',
      status: 'cancelled',
      start: { dateTime: '2026-11-10T18:00:00Z' },
      end: { dateTime: '2026-11-10T19:00:00Z' },
    },
  ]), async () => {
    const status = await calendarStatus(env as never);
    assert.equal(status.connected, true);
    assert.equal(status.calendarName, 'Sparkling Standard — Bookings');
    const jobs = await calendarJobsForDate(env as never, '2026-11-10', 'America/Chicago');
    assert.equal(jobs.ok, true);
    assert.equal(jobs.jobs.length, 1);
    assert.equal(jobs.jobs[0]?.id, 'job-1');
  });
});

test('creating a confirmed calendar event sends the exact held interval', async () => {
  let body: Record<string, unknown> = {};
  await withFetch(
    async (url, init) => {
      if (url.includes('oauth2.googleapis.com/token')) return jsonResponse({ access_token: 'access', expires_in: 3600 });
      if (url.includes('/events')) {
        body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        return jsonResponse({ id: 'created-event' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
    async () => {
      const created = await createCalendarEvent(env as never, {
        summary: 'Cleaning — SS-20261027-ABC123',
        description: 'Customer request',
        location: '100 S Baylen St, Pensacola, FL 32502',
        start: '2026-11-10T15:00:00Z',
        end: '2026-11-10T17:00:00Z',
        timeZone: 'America/Chicago',
        reference: 'SS-20261027-ABC123',
      });
      assert.equal(created.ok, true);
      assert.equal(created.eventId, 'created-event');
    },
  );
  assert.equal((body.start as { dateTime?: string }).dateTime, '2026-11-10T15:00:00Z');
  assert.equal((body.extendedProperties as { private?: { sparkling_reference?: string } }).private?.sparkling_reference, 'SS-20261027-ABC123');
});

test('availability stays off until the owner enables booking and calendar credentials exist', async () => {
  const request = new Request(
    `https://example.test/api/availability?date=${futureDate()}&durationMinutes=120&lat=30.4111&lng=-87.2164`,
  );
  const disabled = await availabilityGet({ request, env: {} } as never);
  const disabledData = (await disabled.json()) as { enabled?: boolean; reason?: string; slots?: unknown[] };
  assert.equal(disabled.status, 200);
  assert.equal(disabledData.enabled, false);
  assert.equal(disabledData.reason, 'booking_not_enabled');
  assert.deepEqual(disabledData.slots, []);
});

test('enabled availability returns real slots and never includes customer details', async () => {
  const config = bookingConfig as { enabled: boolean };
  const original = config.enabled;
  config.enabled = true;
  try {
    await withFetch(googleStub([]), async () => {
      const request = new Request(
        `https://example.test/api/availability?date=${futureDate()}&durationMinutes=120&lat=30.4111&lng=-87.2164`,
      );
      const response = await availabilityGet({ request, env } as never);
      assert.equal(response.status, 200);
      const data = (await response.json()) as {
        enabled?: boolean;
        available?: boolean;
        timeZone?: string;
        slots?: Array<{ start: string; end: string; startLabel: string }>;
      };
      assert.equal(data.enabled, true);
      assert.equal(data.timeZone, 'America/Chicago');
      assert.equal(data.available, true);
      assert.ok((data.slots?.length ?? 0) > 0);
      const serialized = JSON.stringify(data);
      assert.doesNotMatch(serialized, /customer|recipient|address/i);
    });
  } finally {
    config.enabled = original;
  }
});

test('owner confirmation revalidates the slot and writes one calendar event', async () => {
  const config = bookingConfig as { enabled: boolean };
  const original = config.enabled;
  config.enabled = true;
  try {
    const bucket = new FakeLedger();
    const created = await createBookingHold(bucket, {
      date: '2026-11-10',
      start: '2026-11-10T15:00:00.000Z',
      end: '2026-11-10T17:00:00.000Z',
      durationMinutes: 120,
      destination: { lat: 30.4111, lng: -87.2164 },
      locationText: '100 S Baylen St, Pensacola, FL 32502',
      reference: 'SS-20261027-ABC123',
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    let createdEvent = 0;
    await withFetch(
      async (url, init) => {
        if (url.includes('oauth2.googleapis.com/token')) return jsonResponse({ access_token: 'access', expires_in: 3600 });
        if (url.includes('/calendar/v3/calendars/') && url.includes('/events') && init?.method === 'POST') {
          createdEvent += 1;
          return jsonResponse({ id: 'evt-confirmed' });
        }
        if (url.includes('/calendar/v3/calendars/') && url.includes('/events')) return jsonResponse({ items: [] });
        if (url.includes('/calendar/v3/calendars/')) return jsonResponse({ summary: 'Sparkling Standard — Bookings', timeZone: 'America/Chicago' });
        if (url.includes('api.mapmap.ai/route/v1/')) return jsonResponse({ routes: [{ distance: 16093, duration: 900 }] });
        throw new Error(`unexpected fetch: ${url}`);
      },
      async () => {
        const request = new Request('https://example.test/api/booking-admin', {
          method: 'POST',
          headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: created.hold.id, action: 'confirm' }),
        });
        const response = await bookingAdminPost({
          request,
          env: { ...env, PAYMENT_LEDGER: bucket, BOOKING_OWNER_TOKEN: 'owner' } as never,
        } as never);
        assert.equal(response.status, 200);
      },
    );
    assert.equal(createdEvent, 1);
    const confirmed = await getBookingHold(bucket, created.hold.id);
    assert.equal(confirmed?.status, 'confirmed');
    assert.equal(confirmed?.calendarEventId, 'evt-confirmed');
  } finally {
    config.enabled = original;
  }
});

test('booking admin is owner-token protected', async () => {
  const request = new Request('https://example.test/api/booking-admin?id=not-a-hold');
  const response = await bookingAdminPost({ request, env: {} } as never);
  assert.equal(response.status, 401);
});