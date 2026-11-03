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
import { commitConfirmedBooking, type CommitmentInput } from './commitment.ts';
import {
  createSigningRequest,
  evaluateDocumentGate,
  rotateSigningRequestToken,
} from '../documents/service.ts';

export type AutoConfirmResult =
  | {
      ok: true;
      eventId: string;
      hold: BookingHold;
      appointmentId?: string;
      planId?: string;
      recurringStatus?: string;
    }
  | {
      ok: false;
      reason: string;
      documentRequest?: { token: string; bundleCode: string; email: string };
    };

/**
 * Confirms a paid, fully eligible booking without owner intervention.
 * When D1 is available the shared commitment service creates the operational
 * appointment and any eligible recurring plan as well as the calendar event.
 * The legacy R2-only path remains for environments without D1.
 */
export async function autoConfirmPaidBooking(
  env: BookingEnv,
  holdId: string,
  expectedReference = '',
  details: Partial<CommitmentInput> = {},
): Promise<AutoConfirmResult> {
  if (!bookingConfig.autoConfirmAllowed || bookingConfig.confirmationMode !== 'auto_confirm') {
    return { ok: false, reason: 'auto_confirm_disabled' };
  }

  const holdIdentity = /^[0-9]{4}-[0-9]{2}-[0-9]{2}__[a-f0-9-]{36}$/i;
  if (
    expectedReference &&
    !expectedReference.match(/^SS-[0-9]{8}-[0-9A-Z]{6}$/) &&
    !holdIdentity.test(expectedReference)
  ) {
    return { ok: false, reason: 'reference_invalid' };
  }

  const bucket = bookingStore(env);
  if (!bucket) return { ok: false, reason: 'booking_store_not_configured' };
  const hold = await getBookingHold(bucket, holdId);
  if (
    expectedReference &&
    hold?.reference !== expectedReference &&
    hold?.id !== expectedReference
  ) {
    return { ok: false, reason: 'hold_reference_mismatch' };
  }
  if (hold?.status === 'confirmed' && hold.calendarEventId && !env.DB) {
    return { ok: true, eventId: hold.calendarEventId, hold };
  }
  if (!hold || !['held', 'confirmed'].includes(hold.status)) {
    return { ok: false, reason: 'hold_not_active' };
  }
  if (hold.status === 'held' && Date.parse(hold.expiresAt) <= Date.now()) {
    return { ok: false, reason: 'hold_expired' };
  }

  if (env.DB) {
    // A paid booking may still have required signatures that enforce at
    // confirmation rather than at payment. Never commit an unsigned agreement:
    // create a fresh signing link so the customer has a recovery path.
    const requestRow = await env.DB
      .prepare(
        `SELECT id, customer_id, property_id, quote_reference, payload_json
         FROM booking_requests
         WHERE hold_id = ? OR quote_reference = ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(hold.id, expectedReference || hold.reference)
      .first<{
        id: string;
        customer_id: string | null;
        property_id: string | null;
        quote_reference: string;
        payload_json: string;
      }>()
      .catch(() => null);
    let requestFields: Record<string, string> = {};
    try {
      const parsed = JSON.parse(requestRow?.payload_json ?? '{}') as Record<string, unknown>;
      requestFields = Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => typeof value === 'string'),
      ) as Record<string, string>;
    } catch {
      requestFields = {};
    }
    const documentContext = {
      subjectType: 'customer' as const,
      ...(requestRow?.customer_id ? { customerId: requestRow.customer_id } : {}),
      ...(requestRow?.property_id ? { propertyId: requestRow.property_id } : {}),
      ...(requestRow?.id ? { bookingRequestId: requestRow.id } : {}),
      serviceCode: details.serviceCode ?? requestFields.service_type ?? 'residential-cleaning',
      frequency: details.frequency ?? requestFields.ongoing_frequency ?? requestFields.frequency ?? '',
      bookingReference: expectedReference || requestRow?.quote_reference || hold.reference,
      accessAuthorization: requestFields.access_authorization === 'yes',
      customerProducts: requestFields.customer_products === 'yes',
    };
    const gate = await evaluateDocumentGate(env.DB, documentContext, 'before_confirmation');
    if (!gate.satisfied) {
      const pending = await env.DB
        .prepare(
          `SELECT id FROM signing_requests
           WHERE status IN ('pending','partially_signed') AND subject_type = 'customer'
             AND (customer_id = ? OR (customer_id IS NULL AND booking_reference = ?))
           ORDER BY created_at DESC LIMIT 1`,
        )
        .bind(documentContext.customerId ?? '', documentContext.bookingReference)
        .first<{ id: string }>()
        .catch(() => null);
      if (pending) {
        const rotated = await rotateSigningRequestToken(env.DB, null, pending.id);
        return {
          ok: false,
          reason: 'documents_required',
          documentRequest: {
            token: rotated.token,
            bundleCode: rotated.bundleCode,
            email: rotated.email || details.customerEmail || requestFields.email || '',
          },
        };
      }
      const created = await createSigningRequest(env.DB, documentContext);
      if (created.token) {
        return {
          ok: false,
          reason: 'documents_required',
          documentRequest: {
            token: created.token,
            bundleCode: created.bundleCode ?? 'documents',
            email: details.customerEmail || requestFields.email || '',
          },
        };
      }
      return { ok: false, reason: 'documents_required' };
    }

    const committed = await commitConfirmedBooking(env, env.DB, {
      reference: expectedReference || hold.reference,
      holdId: hold.id,
      ...details,
    });
    if (!committed.ok) return { ok: false, reason: committed.reason ?? 'commitment_failed' };
    const confirmedEventId = committed.eventId ?? hold.calendarEventId;
    const confirmedHold: BookingHold = {
      ...hold,
      status: 'confirmed',
      ...(confirmedEventId ? { calendarEventId: confirmedEventId } : {}),
      ...(hold.resourceIds ? { resourceIds: hold.resourceIds } : {}),
      ...(hold.crewSize ? { crewSize: hold.crewSize } : {}),
    };
    return {
      ok: true,
      eventId: confirmedEventId ?? '',
      hold: confirmedHold,
      ...(committed.appointmentId ? { appointmentId: committed.appointmentId } : {}),
      ...(committed.planId ? { planId: committed.planId } : {}),
      ...(committed.recurringStatus ? { recurringStatus: committed.recurringStatus } : {}),
    };
  }

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
