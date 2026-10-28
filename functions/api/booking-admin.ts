// Owner-only booking hold lookup, confirmation and release.
//
// GET  /api/booking-admin?id=<holdId>
// POST /api/booking-admin { id, action: 'confirm' | 'release' }
//
// Confirmation revalidates availability, writes the Google Calendar event, then
// marks the hold confirmed. A calendar failure leaves the hold active for retry.
import { bookingConfig } from '../../src/config/booking.ts';
import {
  bookingStore,
  getBookingHold,
  holdIsActive,
  holdKey,
  type BookingStorageEnv,
} from '../../src/lib/booking/holds.ts';
import { availabilityForDate, type BookingEnv } from '../../src/lib/booking/service.ts';
import { createCalendarEvent, deleteCalendarEvent } from '../../src/lib/booking/google-calendar.ts';
import { writeLedgerJson } from '../../src/lib/payments/ledger.ts';

interface Env extends BookingEnv, BookingStorageEnv {
  BOOKING_OWNER_TOKEN?: string;
  GIFT_OWNER_TOKEN?: string;
  PHOTO_OWNER_TOKEN?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

function authorized(request: Request, env: Env): boolean {
  const expected =
    env.BOOKING_OWNER_TOKEN?.trim() ||
    env.GIFT_OWNER_TOKEN?.trim() ||
    env.PHOTO_OWNER_TOKEN?.trim() ||
    '';
  if (!expected) return false;
  const match = /^Bearer\s+(.+)$/i.exec((request.headers.get('Authorization') ?? '').trim());
  return Boolean(match && constantTimeEqual(match[1]!.trim(), expected));
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (!authorized(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);
  const bucket = bookingStore(env);
  if (!bucket) return json({ ok: false, error: 'booking_store_not_configured' }, 503);
  const id = new URL(request.url).searchParams.get('id') ?? '';
  const hold = await getBookingHold(bucket, id);
  if (!hold) return json({ ok: false, error: 'not_found' }, 404);
  return json({ ok: true, hold, active: holdIsActive(hold) });
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (!authorized(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);
  const bucket = bookingStore(env);
  if (!bucket) return json({ ok: false, error: 'booking_store_not_configured' }, 503);
  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }
  const id = typeof payload.id === 'string' ? payload.id : '';
  const action = payload.action === 'release' ? 'release' : payload.action === 'cancel' ? 'cancel' : 'confirm';
  const hold = await getBookingHold(bucket, id);
  if (!hold) return json({ ok: false, error: 'not_found' }, 404);

  if (action === 'release' || action === 'cancel') {
    if (action === 'cancel' && hold.calendarEventId) {
      const deleted = await deleteCalendarEvent(env, hold.calendarEventId);
      if (!deleted.ok) return json({ ok: false, error: deleted.reason ?? 'calendar_delete_failed' }, 502);
    }
    const released = { ...hold, status: 'released' as const };
    await writeLedgerJson(bucket, holdKey(id), released);
    return json({ ok: true, hold: released });
  }

  if (!holdIsActive(hold)) return json({ ok: false, error: 'hold_expired' }, 409);
  const availability = await availabilityForDate(env, {
    date: hold.date,
    durationMinutes: hold.durationMinutes,
    destination: hold.destination,
    ignoreHoldId: hold.id,
  });
  if (!availability.ok) return json({ ok: false, error: availability.reason }, 409);
  const exact = availability.availability.slots.some(
    (slot) => slot.start === hold.start && slot.end === hold.end,
  );
  if (!exact) return json({ ok: false, error: 'slot_unavailable' }, 409);

  const created = await createCalendarEvent(env, {
    summary: `Sparkling Standard Cleaning — ${hold.reference || 'Booking'}`,
    description: `Owner-confirmed booking for request ${hold.reference || 'unknown'}. Hold ${hold.id}.`,
    location: hold.locationText,
    start: hold.start,
    end: hold.end,
    timeZone: bookingConfig.timeZone,
    reference: hold.reference,
  });
  if (!created.ok) return json({ ok: false, error: created.reason ?? 'calendar_write_failed' }, 502);

  const confirmed = {
    ...hold,
    status: 'confirmed' as const,
    calendarEventId: created.eventId,
  };
  await writeLedgerJson(bucket, holdKey(id), confirmed);
  return json({ ok: true, hold: confirmed, eventId: created.eventId });
}
