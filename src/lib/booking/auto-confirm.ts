import { bookingConfig } from '../../config/booking.ts';
import { availabilityForDate, type BookingEnv } from './service.ts';
import { bookingStore, getBookingHold, holdKey, type BookingHold } from './holds.ts';
import {
  getPendingBookingRequest,
  requestIdForHold,
  updatePendingBookingRequest,
} from './requests.ts';
import { createCalendarEvent, findCalendarEventByReference } from './google-calendar.ts';
import { writeLedgerJson } from '../payments/ledger.ts';

export type AutoConfirmResult =
  | { ok: true; eventId: string; hold: BookingHold }
  | { ok: false; reason: string };

/**
 * Confirms a paid, fully eligible booking without owner intervention.
 * The hold is revalidated against the current calendar and resource windows
 * first; any manual-review, hold or calendar problem leaves the request pending.
 */
export async function autoConfirmPaidBooking(
  env: BookingEnv,
  holdId: string,
  expectedReference = '',
): Promise<AutoConfirmResult> {
  if (!bookingConfig.autoConfirmAllowed || bookingConfig.confirmationMode !== 'auto_confirm') {
    return { ok: false, reason: 'auto_confirm_disabled' };
  }

  if (expectedReference && !expectedReference.match(/^SS-[0-9]{8}-[0-9A-Z]{6}$/)) {
    return { ok: false, reason: 'reference_invalid' };
  }

  const bucket = bookingStore(env);
  if (!bucket) return { ok: false, reason: 'booking_store_not_configured' };
  const hold = await getBookingHold(bucket, holdId);
  if (expectedReference && hold?.reference !== expectedReference) {
    return { ok: false, reason: 'hold_reference_mismatch' };
  }
  if (hold?.status === 'confirmed' && hold.calendarEventId) {
    return { ok: true, eventId: hold.calendarEventId, hold };
  }
  if (!hold || hold.status !== 'held') return { ok: false, reason: 'hold_not_active' };
  if (Date.parse(hold.expiresAt) <= Date.now()) return { ok: false, reason: 'hold_expired' };

  const availability = await availabilityForDate(env, {
    date: hold.date,
    durationMinutes: hold.durationMinutes,
    destination: hold.destination,
    ignoreHoldId: hold.id,
  });
  if (!availability.ok) return { ok: false, reason: availability.reason };
  const exact = availability.availability.slots.find(
    (slot) => slot.start === hold.start && slot.end === hold.end,
  );
  if (!exact || exact.resourceIds.length === 0) {
    return { ok: false, reason: 'slot_unavailable' };
  }

  const existingEventId = await findCalendarEventByReference(env, hold.reference);
  let eventId = existingEventId;
  if (!eventId) {
    const created = await createCalendarEvent(env, {
      summary: `Sparkling Standard Cleaning - ${hold.reference || 'Booking'}`,
      description: `Paid booking confirmed automatically for request ${hold.reference || 'unknown'}. Hold ${hold.id}. Resources: ${exact.resourceIds.join(', ')}.`,
      location: hold.locationText,
      start: hold.start,
      end: hold.end,
      timeZone: bookingConfig.timeZone,
      reference: hold.reference,
      resourceIds: exact.resourceIds,
    });
    if (!created.ok || !created.eventId) {
      return { ok: false, reason: created.reason ?? 'calendar_write_failed' };
    }
    eventId = created.eventId;
  }

  const updated: BookingHold = {
    ...hold,
    status: 'confirmed',
    calendarEventId: eventId,
    resourceIds: exact.resourceIds,
    crewSize: exact.resourceIds.length,
  };
  await writeLedgerJson(bucket, holdKey(hold.id), updated);
  const request = await getPendingBookingRequest(bucket, requestIdForHold(hold.id));
  if (request && request.status === 'pending') {
    await updatePendingBookingRequest(bucket, request, {
      status: 'confirmed',
      calendarEventId: eventId,
      resourceIds: exact.resourceIds,
      crewSize: exact.resourceIds.length,
    });
  }
  return { ok: true, eventId, hold: updated };
}
