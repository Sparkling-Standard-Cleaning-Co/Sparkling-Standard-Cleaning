// Owner-only booking request/hold lookup, confirmation, cancellation,
// rescheduling, resource reassignment and release.
//
// GET  /api/booking-admin?id=<requestId|holdId>
// POST /api/booking-admin { id, action, ... }
//   confirm    { crewSize?, durationMinutes?, resourceIds? }
//   cancel | decline | release
//   reassign   { resourceIds, durationMinutes? }
//   reschedule { date, start, end, durationMinutes?, crewSize?, resourceIds? }
//
// A 20-minute hold protects checkout capacity temporarily. A durable pending
// request survives after the hold expires. Pending requests are non-guaranteed
// and do not block availability; confirmation always revalidates the slot for
// the actual cleaning resources.
import { bookingConfig, bookingResources, validResourceIds } from '../../src/config/booking.ts';
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
import {
  createCalendarEvent,
  deleteCalendarEvent,
  findCalendarEventByReference,
  getCalendarEvent,
  updateCalendarEvent,
} from '../../src/lib/booking/google-calendar.ts';
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
  resourceIds: string[];
  crewSize: number;
}

const ACTIONS = [
  'confirm',
  'cancel',
  'decline',
  'release',
  'reassign',
  'reschedule',
] as const;
type Action = (typeof ACTIONS)[number];

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
  const resourceIds = request.resourceIds ?? [];
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
    resourceIds,
    crewSize: request.crewSize ?? Math.max(1, resourceIds.length),
  };
}

function slotFromHold(hold: BookingHold): BookingSlot {
  const resourceIds = hold.resourceIds ?? [];
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
    resourceIds,
    crewSize: hold.crewSize ?? Math.max(1, resourceIds.length),
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

function sameResources(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

function requestedResourceIds(payload: Record<string, unknown>): string[] | null {
  if (!Array.isArray(payload.resourceIds)) return null;
  const ids = payload.resourceIds.filter((value): value is string => typeof value === 'string');
  if (!validResourceIds(ids)) return [];
  return ids;
}

function requestedCrewSize(payload: Record<string, unknown>): number | null {
  const value = Number(payload.crewSize);
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < 1 || rounded > bookingConfig.maxCrewSize) return null;
  return rounded;
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
    resourceNames: bookingResources
      .filter((resource) => slot.resourceIds.includes(resource.id))
      .map((resource) => resource.name),
    pendingRequest: resolved.request?.status === 'pending',
    calendarEventId: eventId ?? null,
    calendarEvent,
  });
}

/** Writes the chosen assignment/timing to the surviving records. */
async function persistSlot(
  bucket: NonNullable<ReturnType<typeof bookingStore>>,
  pending: PendingBookingRequest | null,
  hold: BookingHold | null,
  slot: BookingSlot,
  options: {
    status?: PendingBookingRequest['status'];
    calendarEventId?: string;
  } = {},
): Promise<void> {
  const patch = {
    date: slot.date,
    start: slot.start,
    end: slot.end,
    durationMinutes: slot.durationMinutes,
    resourceIds: slot.resourceIds,
    crewSize: slot.crewSize,
    ...(options.status ? { status: options.status } : {}),
    ...(options.calendarEventId ? { calendarEventId: options.calendarEventId } : {}),
  };
  if (pending) await updatePendingBookingRequest(bucket, pending, patch);
  if (hold) {
    // Holds are keyed by their original date. A reschedule to another day
    // must release the old key rather than leave a stale capacity block.
    const movedToAnotherDay = slot.date !== hold.date;
    await writeLedgerJson(bucket, holdKey(hold.id), {
      ...hold,
      ...patch,
      ...(options.status === 'confirmed'
        ? { status: 'confirmed' as const }
        : options.status === 'released' || options.status === 'declined'
          ? { status: 'released' as const }
          : movedToAnotherDay && !slot.calendarEventId
            ? { status: 'released' as const }
            : {}),
    });
  }
}

async function validatedSlot(
  env: Env,
  slot: BookingSlot,
  input: {
    date?: string;
    start?: string;
    end?: string;
    durationMinutes?: number;
    crewSize?: number;
    resourceIds?: string[] | null;
  },
): Promise<{ ok: true; slot: BookingSlot } | { ok: false; error: string }> {
  const date = input.date ?? slot.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'invalid_date' };
  const start = new Date(input.start ?? slot.start);
  const end = new Date(input.end ?? slot.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    return { ok: false, error: 'invalid_slot' };
  }
  const explicitResources = input.resourceIds && input.resourceIds.length > 0 ? input.resourceIds : null;
  const crewSize =
    input.crewSize ??
    (explicitResources ? explicitResources.length : slot.crewSize) ??
    bookingConfig.defaultCrewSize;
  const durationMinutes =
    input.durationMinutes ?? Math.round((end.getTime() - start.getTime()) / 60_000);
  // A customer's held assignment is honored on confirmation. An owner who
  // changes the crew size (joint job) or explicitly names resources gets a
  // fresh server-selected assignment instead.
  const requiredResources =
    explicitResources ??
    (slot.resourceIds.length === crewSize ? slot.resourceIds : null);

  const availability = await availabilityForDate(env, {
    date,
    durationMinutes,
    destination: slot.destination,
    crewSize,
    ...(requiredResources ? { requiredResourceIds: requiredResources } : {}),
    ignoreHoldId: slot.holdId,
  });
  if (!availability.ok) return { ok: false, error: availability.reason };
  const exact = availability.availability.slots.find(
    (candidate) =>
      candidate.start === start.toISOString() &&
      candidate.end === end.toISOString() &&
      (requiredResources
        ? sameResources(candidate.resourceIds, requiredResources)
        : candidate.resourceIds.length === crewSize),
  );
  if (!exact) return { ok: false, error: 'slot_unavailable' };
  return {
    ok: true,
    slot: {
      ...slot,
      date,
      start: exact.start,
      end: exact.end,
      durationMinutes: availability.durationMinutes,
      resourceIds: exact.resourceIds,
      crewSize: exact.resourceIds.length,
    },
  };
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
  if (!ACTIONS.includes(requestedAction as Action)) {
    return json({ ok: false, error: 'invalid_action' }, 400);
  }
  const action = requestedAction as Action;
  const resolved = await resolveBooking(bucket, id);
  const { request: pending, hold } = resolved;
  if (!pending && !hold) return json({ ok: false, error: 'not_found' }, 404);
  let slot = pending ? slotFromRequest(pending) : slotFromHold(hold!);

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

  const explicitResourceIds = requestedResourceIds(payload);
  if (explicitResourceIds && explicitResourceIds.length === 0) {
    return json({ ok: false, error: 'invalid_resources' }, 400);
  }
  const durationOverrideRaw = Number(payload.durationMinutes);
  const durationOverride =
    payload.durationMinutes !== undefined && Number.isFinite(durationOverrideRaw)
      ? Math.round(durationOverrideRaw)
      : undefined;
  const crewSizeOverride = requestedCrewSize(payload);

  if (action === 'confirm') {
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

    const validated = await validatedSlot(env, slot, {
      ...(durationOverride ? { durationMinutes: durationOverride } : {}),
      ...(crewSizeOverride ? { crewSize: crewSizeOverride } : {}),
      ...(explicitResourceIds ? { resourceIds: explicitResourceIds } : {}),
    });
    if (!validated.ok) return json({ ok: false, error: validated.error }, 409);
    slot = validated.slot;

    const existingEventId = await findCalendarEventByReference(env, slot.reference);
    if (existingEventId) {
      await persistSlot(bucket, pending, hold, slot, {
        status: 'confirmed',
        calendarEventId: existingEventId,
      });
      return json({ ok: true, duplicate: true, eventId: existingEventId, slot, status: 'confirmed' });
    }

    const created = await createCalendarEvent(env, {
      summary: `Sparkling Standard Cleaning — ${slot.reference || 'Booking'}`,
      description: `Owner-confirmed booking for request ${slot.reference || 'unknown'}. Hold ${slot.holdId}. Resources: ${slot.resourceIds.join(', ')}.`,
      location: slot.locationText,
      start: slot.start,
      end: slot.end,
      timeZone: bookingConfig.timeZone,
      reference: slot.reference,
      resourceIds: slot.resourceIds,
    });
    if (!created.ok) return json({ ok: false, error: created.reason ?? 'calendar_write_failed' }, 502);

    await persistSlot(bucket, pending, hold, slot, {
      status: 'confirmed',
      ...(created.eventId ? { calendarEventId: created.eventId } : {}),
    });
    if (pending) {
      const confirmed = await getPendingBookingRequest(bucket, pending.id);
      return json({ ok: true, request: confirmed, eventId: created.eventId, slot, status: 'confirmed' });
    }
    return json({ ok: true, eventId: created.eventId, slot, status: 'confirmed' });
  }

  if (action === 'reassign') {
    if (!explicitResourceIds) return json({ ok: false, error: 'resources_required' }, 400);
    const validated = await validatedSlot(env, slot, {
      resourceIds: explicitResourceIds,
      ...(durationOverride ? { durationMinutes: durationOverride } : {}),
      crewSize: explicitResourceIds.length,
    });
    if (!validated.ok) return json({ ok: false, error: validated.error }, 409);
    slot = validated.slot;
    if (slot.calendarEventId) {
      const updated = await updateCalendarEvent(env, slot.calendarEventId, {
        start: slot.start,
        end: slot.end,
        timeZone: bookingConfig.timeZone,
        resourceIds: slot.resourceIds,
      });
      if (!updated.ok) return json({ ok: false, error: updated.reason ?? 'calendar_write_failed' }, 502);
    }
    await persistSlot(bucket, pending, hold, slot);
    return json({ ok: true, slot, status: slot.calendarEventId ? 'confirmed' : 'pending' });
  }

  // reschedule
  const date = typeof payload.date === 'string' ? payload.date : '';
  const start = typeof payload.start === 'string' ? payload.start : '';
  const end = typeof payload.end === 'string' ? payload.end : '';
  if (!date && !start && !end) return json({ ok: false, error: 'new_slot_required' }, 400);
  const validated = await validatedSlot(env, slot, {
    ...(date ? { date } : {}),
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
    ...(durationOverride ? { durationMinutes: durationOverride } : {}),
    ...(crewSizeOverride ? { crewSize: crewSizeOverride } : {}),
    ...(explicitResourceIds ? { resourceIds: explicitResourceIds } : {}),
  });
  if (!validated.ok) return json({ ok: false, error: validated.error }, 409);
  slot = validated.slot;
  if (slot.calendarEventId) {
    const updated = await updateCalendarEvent(env, slot.calendarEventId, {
      start: slot.start,
      end: slot.end,
      timeZone: bookingConfig.timeZone,
      resourceIds: slot.resourceIds,
    });
    if (!updated.ok) return json({ ok: false, error: updated.reason ?? 'calendar_write_failed' }, 502);
  }
  await persistSlot(bucket, pending, hold, slot);
  return json({ ok: true, slot, status: slot.calendarEventId ? 'confirmed' : 'pending' });
}
