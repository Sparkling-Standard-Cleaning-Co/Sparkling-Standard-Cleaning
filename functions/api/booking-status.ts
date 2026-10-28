// GET /api/booking-status — non-secret operational probe for the owner and
// deployment verification. It reports only presence/connection booleans, the
// calendar display name/timezone and event counts. It never returns credentials,
// calendar IDs, customer names, addresses or event details.
import { bookingConfig } from '../../src/config/booking.ts';
import {
  calendarJobsForDate,
  calendarStatus,
  googleConfigured,
  type GoogleCalendarEnv,
} from '../../src/lib/booking/google-calendar.ts';
import { bookingStore, type BookingStorageEnv } from '../../src/lib/booking/holds.ts';
import type { RoutingEnv } from '../../src/lib/travel/server-routing.ts';

interface Env extends GoogleCalendarEnv, BookingStorageEnv, RoutingEnv {
  BOOKING_OWNER_TOKEN?: string;
}

const hits = new Map<string, { count: number; reset: number }>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function throttled(request: Request): boolean {
  const now = Date.now();
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const entry = hits.get(ip);
  if (!entry || entry.reset < now) {
    hits.set(ip, { count: 1, reset: now + 60_000 });
    return false;
  }
  entry.count += 1;
  return entry.count > 20;
}

function localDate(offsetDays: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: bookingConfig.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (throttled(request)) return json({ ok: false, error: 'rate_limited' }, 429);

  const configured = {
    GOOGLE_CALENDAR_ID: Boolean(env.GOOGLE_CALENDAR_ID?.trim()),
    GOOGLE_CLIENT_ID: Boolean(env.GOOGLE_CLIENT_ID?.trim()),
    GOOGLE_CLIENT_SECRET: Boolean(env.GOOGLE_CLIENT_SECRET?.trim()),
    GOOGLE_REFRESH_TOKEN: Boolean(env.GOOGLE_REFRESH_TOKEN?.trim()),
    BOOKING_OWNER_TOKEN: Boolean(env.BOOKING_OWNER_TOKEN?.trim()),
    booking_store: Boolean(bookingStore(env)),
    travel_origin: Boolean(env.TRAVEL_ORIGIN?.trim()),
  };
  if (!googleConfigured(env)) {
    return json({
      ok: true,
      enabled: bookingConfig.enabled,
      configured,
      calendar: { connected: false, reason: 'not_configured' },
    });
  }
  const status = await calendarStatus(env);
  if (!status.connected) {
    return json({
      ok: true,
      enabled: bookingConfig.enabled,
      configured,
      calendar: { connected: false, reason: status.reason ?? 'calendar_unavailable' },
    });
  }
  const today = localDate(0);
  const tomorrow = localDate(1);
  const [todayEvents, tomorrowEvents] = await Promise.all([
    calendarJobsForDate(env, today, bookingConfig.timeZone),
    calendarJobsForDate(env, tomorrow, bookingConfig.timeZone),
  ]);
  return json({
    ok: true,
    enabled: bookingConfig.enabled,
    configured,
    calendar: {
      connected: true,
      name: status.calendarName ?? bookingConfig.calendarName,
      timeZone: status.timeZone ?? null,
      today,
      tomorrow,
      todayEventCount: todayEvents.ok ? todayEvents.jobs.length : null,
      tomorrowEventCount: tomorrowEvents.ok ? tomorrowEvents.jobs.length : null,
      eventReadOk: todayEvents.ok && tomorrowEvents.ok,
    },
    confirmationMode: bookingConfig.confirmationMode,
    autoConfirmAllowed: bookingConfig.autoConfirmAllowed,
    holdsMinutes: bookingConfig.holdMinutes,
  });
}
