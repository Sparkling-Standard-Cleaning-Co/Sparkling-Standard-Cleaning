// POST /api/booking-hold — create an atomic, expiring hold for one available
// slot. A hold is never a confirmed booking.
import { bookingConfig } from '../../src/config/booking.ts';
import { availabilityForDate, type BookingEnv } from '../../src/lib/booking/service.ts';
import { bookingStore, createBookingHold, type BookingStorageEnv } from '../../src/lib/booking/holds.ts';

interface Env extends BookingEnv, BookingStorageEnv {}

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
  return entry.count > 12;
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (throttled(request)) return json({ ok: false, error: 'rate_limited' }, 429);
  if (!bookingConfig.enabled) return json({ ok: false, error: 'booking_not_enabled' }, 403);
  const bucket = bookingStore(env);
  if (!bucket) return json({ ok: false, error: 'booking_store_not_configured' }, 503);
  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }
  const date = typeof payload.date === 'string' ? payload.date : '';
  const start = typeof payload.start === 'string' ? payload.start : '';
  const end = typeof payload.end === 'string' ? payload.end : '';
  const reference = typeof payload.reference === 'string' ? payload.reference : '';
  const locationText = typeof payload.location === 'string' ? payload.location : '';
  const durationMinutes = Number(payload.durationMinutes);
  const destination = payload.destination as { lat?: unknown; lng?: unknown } | undefined;
  const lat = Number(destination?.lat);
  const lng = Number(destination?.lng);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(start)) ||
    !Number.isFinite(Date.parse(end)) ||
    !Number.isFinite(durationMinutes) ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    !reference.trim() ||
    locationText.trim().length < 5
  ) {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }

  const requestedStart = new Date(start).toISOString();
  const requestedEnd = new Date(end).toISOString();

  // Two customers can select the same time in the same instant. The first hold
  // takes one cleaner; a conflicting second request re-reads availability so
  // the other cleaner can still be offered instead of failing the customer.
  let lastError = 'slot_unavailable';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const availability = await availabilityForDate(env, {
      date,
      durationMinutes,
      destination: { lat, lng },
    });
    if (!availability.ok) {
      return json({ ok: false, error: availability.reason }, 409);
    }
    const exact = availability.availability.slots.find(
      (slot) => slot.start === requestedStart && slot.end === requestedEnd,
    );
    if (!exact || exact.resourceIds.length === 0) {
      return json({ ok: false, error: 'slot_unavailable' }, 409);
    }
    const created = await createBookingHold(bucket, {
      date,
      start: requestedStart,
      end: requestedEnd,
      durationMinutes: availability.durationMinutes,
      destination: { lat, lng },
      locationText,
      reference,
      resourceIds: exact.resourceIds,
      crewSize: availability.crewSize,
    });
    if (created.ok) {
      return json({
        ok: true,
        holdId: created.hold.id,
        expiresAt: created.hold.expiresAt,
        start: created.hold.start,
        end: created.hold.end,
        timeZone: bookingConfig.timeZone,
        status: 'held',
        notice:
          'Temporary hold - not a confirmed appointment. Sparkling Standard confirms the booking personally.',
      });
    }
    lastError = created.error === 'overlap' ? 'slot_unavailable' : created.error;
    if (created.error === 'busy') break;
  }
  return json({ ok: false, error: lastError }, lastError === 'busy' ? 503 : 409);
}

export async function onRequestGet(): Promise<Response> {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
