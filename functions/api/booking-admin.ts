// Owner-only booking request/hold lookup, confirmation, cancellation and release.
//
// GET  /api/booking-admin?id=<requestId|holdId>
// POST /api/booking-admin { id, action: 'confirm' | 'cancel' | 'decline' | 'release' }
//
// A 20-minute hold protects checkout capacity temporarily. A durable pending
// request survives after the hold expires. Pending requests are non-guaranteed
// and do not block availability; confirmation always revalidates the slot.
import { bookingConfig } from '../../src/config/booking.ts';
import {
  bookingStore,
  getBookingHold,
  holdIsActive,
  holdKey,
  type BookingHold,
  type BookingStorageEnv,
} from '../../src/lib/booking/holds.ts';
import {
  getPendingBookingRequest,
  requestIdForHold,
  updatePendingBookingRequest,
  type PendingBookingRequest,
} from '../../src/lib/booking/requests.ts';
import { availabilityForDate, type BookingEnv } from '../../src/lib/booking/service.ts';
import { createCalendarEvent, deleteCalendarEvent, findCalendarEventByReference, getCalendarEvent } from '../../src/lib/booking/google-calendar.ts';
import { writeLedgerJson } from '../../src/lib/payments/ledger.ts';

interface Env extends BookingEnv, BookingStorageEnv {
  BOOKING_OWNER_TOKEN?: string;
  GIFT_OWNER_TOKEN?: string;
  PHOTO_OWNER_TOKEN?: string;
}

interface BookingSlot {
  id: string;
  holdId: string;
  date: string;
  start: string;
  end: string;
  durationMinutes: number;
  destination: { lat: number; lng: number };
  locationText: string;
  reference: string;
  calendarEventId?: string;
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

function slotFromRequest(request: PendingBookingRequest): BookingSlot {
  return {
    id: request.id,
    holdId: request.holdId,
    date: request.date,
    start: request.start,
    end: request.end,
    durationMinutes: request.durationMinutes,
    destination: request.destination,
    locationText: request.locationText,
    reference: request.reference,
    ...(request.calendarEventId ? { calendarEventId: request.calendarEventId } : {}),
  };
}

function slotFromHold(hold: BookingHold): BookingSlot {
  return {
    id: hold.id,
    holdId: hold.id,
    date: hold.date,
    start: hold.start,
    end: hold.end,
    durationMinutes: hold.durationMinutes,
    destination: hold.destination,
    locationText: hold.locationText,
    reference: hold.reference,
    ...(hold.calendarEventId ? { calendarEventId: hold.calendarEventId } : {}),
  };
}

async function resolveBooking(
  bucket: NonNullable<ReturnType<typeof bookingStore>>,
  id: string,
): Promise<{ request: PendingBookingRequest | null; hold: BookingHold | null }> {
  let request = id.startsWith('BR-') ? await getPendingBookingRequest(bucket, id) : null;
  let hold: BookingHold | null = null;
  if (request) {
    hold = await getBookingHold(bucket, request.holdId);
  } else {
    hold = await getBookingHold(bucket, id);
    if (hold) request = await getPendingBookingRequest(bucket, requestIdForHold(hold.id));
  }
  return { request, hold };
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (!authorized(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);
  const bucket = bookingStore(env);
  if (!bucket) return json({ ok: false, error: 'booking_store_not_configured' }, 503);
  const id = new URL(request.url).searchParams.get('id') ?? '';
  const resolved = await resolveBooking(bucket, id);
  const slot = resolved.request ? slotFromRequest(resolved.request) : resolved.hold ? slotFromHold(resolved.hold) : null;
  if (!slot) return json({ ok: false, error: 'not_found' }, 404);
  const eventId = resolved.request?.calendarEventId ?? resolved.hold?.calendarEventId;
  const calendarEvent = eventId ? await getCalendarEvent(env, eventId) : null;
  return json({
    ok: true,
    request: resolved.request,
    hold: resolved.hold,
    active: resolved.hold ? holdIsActive(resolved.hold) : false,
    slot,
    pendingRequest: resolved.request?.status === 'pending',
    calendarEventId: eventId ?? null,
    calendarEvent,
  });
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
  const requestedAction = typeof payload.action === 'string' ? payload.action : '';
  if (!['confirm', 'cancel', 'decline', 'release'].includes(requestedAction)) {
    return json({ ok: false, error: 'invalid_action' }, 400);
  }
  const action = requestedAction as 'confirm' | 'cancel' | 'decline' | 'release';
  const resolved = await resolveBooking(bucket, id);
  const { request: pending, hold } = resolved;
  if (!pending && !hold) return json({ ok: false, error: 'not_found' }, 404);
  const slot = pending ? slotFromRequest(pending) : slotFromHold(hold!);

  if (action === 'release' || action === 'cancel' || action === 'decline') {
    const eventId = pending?.calendarEventId ?? hold?.calendarEventId;
    if (eventId && action !== 'cancel') {
      return json({ ok: false, error: 'confirmed_booking_requires_cancel' }, 409);
    }
    if (action === 'cancel' && eventId) {
      const deleted = await deleteCalendarEvent(env, eventId);
      if (!deleted.ok) return json({ ok: false, error: deleted.reason ?? 'calendar_delete_failed' }, 502);
    }
    if (pending) {
      await updatePendingBookingRequest(bucket, pending, {
        status: action === 'decline' ? 'declined' : 'released',
      });
    }
    if (hold) await writeLedgerJson(bucket, holdKey(hold.id), { ...hold, status: 'released' });
    return json({ ok: true, released: true, slot });
  }

  if (pending?.status === 'confirmed' && pending.calendarEventId) {
    return json({ ok: true, duplicate: true, request: pending, eventId: pending.calendarEventId, slot });
  }
  if (hold?.status === 'confirmed' && hold.calendarEventId) {
    return json({ ok: true, duplicate: true, hold, eventId: hold.calendarEventId, slot });
  }
  if (pending && pending.status !== 'pending') {
    return json({ ok: false, error: 'request_not_pending', status: pending.status }, 409);
  }
  const canConfirm = Boolean(pending?.status === 'pending' || (hold && holdIsActive(hold)));
  if (!canConfirm) return json({ ok: false, error: 'hold_expired' }, 409);

  const availability = await availabilityForDate(env, {
    date: slot.date,
    durationMinutes: slot.durationMinutes,
    destination: slot.destination,
    ignoreHoldId: slot.holdId,
  });
  if (!availability.ok) return json({ ok: false, error: availability.reason }, 409);
  const exact = availability.availability.slots.some(
    (candidate) => candidate.start === slot.start && candidate.end === slot.end,
  );
  if (!exact) return json({ ok: false, error: 'slot_unavailable' }, 409);

  const existingEventId = await findCalendarEventByReference(env, slot.reference);
  if (existingEventId) {
    if (pending) {
      await updatePendingBookingRequest(bucket, pending, {
        status: 'confirmed',
        calendarEventId: existingEventId,
      });
    }
    if (hold) {
      await writeLedgerJson(bucket, holdKey(hold.id), {
        ...hold,
        status: 'confirmed',
        calendarEventId: existingEventId,
      });
    }
    return json({ ok: true, duplicate: true, eventId: existingEventId, slot, status: 'confirmed' });
  }

  const created = await createCalendarEvent(env, {
    summary: `Sparkling Standard Cleaning — ${slot.reference || 'Booking'}`,
    description: `Owner-confirmed booking for request ${slot.reference || 'unknown'}. Hold ${slot.holdId}.`,
    location: slot.locationText,
    start: slot.start,
    end: slot.end,
    timeZone: bookingConfig.timeZone,
    reference: slot.reference,
  });
  if (!created.ok) return json({ ok: false, error: created.reason ?? 'calendar_write_failed' }, 502);

  let confirmedRequest: PendingBookingRequest | null = null;
  if (pending) {
    confirmedRequest = await updatePendingBookingRequest(bucket, pending, {
      status: 'confirmed',
      ...(created.eventId ? { calendarEventId: created.eventId } : {}),
    });
  }
  if (hold) {
    await writeLedgerJson(bucket, holdKey(hold.id), {
      ...hold,
      status: 'confirmed',
      ...(created.eventId ? { calendarEventId: created.eventId } : {}),
    });
  }
  return json({
    ok: true,
    request: confirmedRequest,
    eventId: created.eventId,
    slot,
    status: 'confirmed',
  });
}
