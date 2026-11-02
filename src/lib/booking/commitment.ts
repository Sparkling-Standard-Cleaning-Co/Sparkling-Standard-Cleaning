/**
 * One shared confirmed-booking orchestration path.
 *
 * Customer Pay Now, owner-approved Pay Later, admin bookings and recurring
 * first visits all converge here so a single logical booking has one durable
 * identity across the temporary hold, D1, the Google Calendar and any
 * recurring plan.
 */
import { bookingConfig } from '../../config/booking.ts';
import type { D1Database } from '../admin/d1.ts';
import { audit, type AdminActor } from '../admin/operations.ts';
import { evaluateDocumentGate } from '../documents/service.ts';
import {
  createCalendarEvent,
  deleteCalendarEvent,
  findCalendarEventByReference,
  getCalendarEvent,
  inspectCalendarEvent,
  updateCalendarEvent,
} from './google-calendar.ts';
import { availabilityForDate, type BookingEnv } from './service.ts';
import { recurringSchedulingEnabled } from './recurring-gate.ts';
import {
  bookingStore,
  getBookingHold,
  holdKey,
  type BookingHold,
} from './holds.ts';
import {
  getPendingBookingRequest,
  requestIdForHold,
  updatePendingBookingRequest,
} from './requests.ts';
import { writeLedgerJson } from '../payments/ledger.ts';
import { syncRecurringPlan, occurrenceDate } from '../admin/recurring-schedule.ts';

export interface CommitmentDependencies {
  availability: typeof availabilityForDate;
  findEvent: typeof findCalendarEventByReference;
  getEvent: typeof getCalendarEvent;
  inspectEvent: typeof inspectCalendarEvent;
  createEvent: typeof createCalendarEvent;
  updateEvent: typeof updateCalendarEvent;
  deleteEvent: typeof deleteCalendarEvent;
}

export const SYSTEM_ACTOR: AdminActor = {
  id: 'system',
  email: 'system@sparkling-standard.local',
  name: 'Sparkling Standard system',
  role: 'owner',
  branchId: null,
  csrf: '',
  permissions: [],
  mfaEnabled: false,
};

export interface CommitmentInput {
  reference: string;
  holdId?: string;
  customerId?: string;
  propertyId?: string;
  customerName?: string;
  customerEmail?: string;
  serviceCode?: string;
  frequency?: string;
  ongoingPriceCents?: number;
  ongoingDurationMinutes?: number;
  termsVersion?: string;
  notes?: string;
  source?: string;
  now?: Date;
}

export interface CommitmentResult {
  ok: boolean;
  reason?: string;
  appointmentId?: string;
  eventId?: string;
  planId?: string;
  recurringStatus?: string;
  recurringConflicts?: number;
}

interface BookingRequestRow extends Record<string, unknown> {
  id: string;
  customer_id: string | null;
  property_id: string | null;
  quote_reference: string;
  payload_json: string;
}

function text(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function payload(value: unknown): Record<string, string> {
  try {
    const parsed = JSON.parse(String(value ?? '{}')) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(([, entry]) => typeof entry === 'string'),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

function localDate(instant: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: bookingConfig.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant));
}

function localTime(instant: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: bookingConfig.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(instant));
}

function windowFor(instant: string): 'morning' | 'afternoon' {
  const [hour = 0] = localTime(instant).split(':').map(Number);
  return hour < 12 ? 'morning' : 'afternoon';
}

async function ensureCustomerAndProperty(
  db: D1Database,
  input: CommitmentInput,
  requestRow: BookingRequestRow | null,
  holdLocation = '',
): Promise<{ customerId: string; propertyId: string }> {
  let customerId = text(input.customerId, 100) || text(requestRow?.customer_id, 100);
  let propertyId = text(input.propertyId, 100) || text(requestRow?.property_id, 100);
  if (customerId && propertyId) return { customerId, propertyId };

  const fields = payload(requestRow?.payload_json);
  const email = (text(input.customerEmail, 200) || text(fields.email, 200)).toLowerCase();
  const name = text(input.customerName, 200) || text(fields.name, 200);
  if (!customerId && email) {
    const contact = await db
      .prepare("SELECT customer_id FROM customer_contacts WHERE kind = 'email' AND normalized_value = ? LIMIT 1")
      .bind(email)
      .first<{ customer_id: string }>();
    customerId = contact?.customer_id ?? '';
  }
  if (!customerId && email) {
    const parts = name.split(/\s+/).filter(Boolean);
    customerId = `cust_${crypto.randomUUID()}`;
    await db
      .prepare(
        `INSERT INTO customers (id, primary_branch_id, first_name, last_name, status, source)
         VALUES (?, 'branch_pensacola', ?, ?, 'active', 'website')`,
      )
      .bind(customerId, parts[0] ?? '', parts.slice(1).join(' '))
      .run();
    await db
      .prepare(
        `INSERT INTO customer_contacts (id, customer_id, kind, value, normalized_value, is_primary)
         VALUES (?, ?, 'email', ?, ?, 1)`,
      )
      .bind(`ct_${crypto.randomUUID()}`, customerId, email, email)
      .run();
  }
  if (!customerId) throw new Error('customer_unresolved');

  const line1 = text(fields.service_address, 300) || text(holdLocation, 300);
  const zip = text(fields.zip, 12);
  if (!propertyId && line1) {
    const existing = await db
      .prepare('SELECT id FROM properties WHERE customer_id = ? AND line1 = ? AND postal_code = ? LIMIT 1')
      .bind(customerId, line1, zip)
      .first<{ id: string }>();
    propertyId = existing?.id ?? `prop_${crypto.randomUUID()}`;
    if (!existing) {
      const lat = Number(fields.pin_latitude);
      const lng = Number(fields.pin_longitude);
      await db
        .prepare(
          `INSERT INTO properties
           (id, customer_id, branch_id, label, line1, city, state, postal_code, latitude, longitude,
            precision, is_primary, status)
           VALUES (?, ?, 'branch_pensacola', 'Service property', ?, ?, ?, ?, ?, ?, ?, 1, 'active')`,
        )
        .bind(
          propertyId,
          customerId,
          line1,
          text(fields.address_city, 120),
          text(fields.address_state, 2) || 'FL',
          zip,
          Number.isFinite(lat) ? lat : null,
          Number.isFinite(lng) ? lng : null,
          text(fields.pin_precision, 20) || 'exact',
        )
        .run();
    }
  }
  if (!propertyId) throw new Error('property_unresolved');
  return { customerId, propertyId };
}

async function loadRequestRow(db: D1Database, holdId: string): Promise<BookingRequestRow | null> {
  return db
    .prepare('SELECT * FROM booking_requests WHERE hold_id = ? LIMIT 1')
    .bind(holdId)
    .first<BookingRequestRow>();
}

export async function commitConfirmedBooking(
  env: BookingEnv,
  db: D1Database | null,
  input: CommitmentInput,
  overrides: Partial<CommitmentDependencies> = {},
): Promise<CommitmentResult> {
  if (!db) return { ok: false, reason: 'database_not_configured' };
  const deps: CommitmentDependencies = {
    availability: availabilityForDate,
    findEvent: findCalendarEventByReference,
    getEvent: getCalendarEvent,
    inspectEvent: inspectCalendarEvent,
    createEvent: createCalendarEvent,
    updateEvent: updateCalendarEvent,
    deleteEvent: deleteCalendarEvent,
    ...overrides,
  };
  const bucket = bookingStore(env);
  const hold = input.holdId && bucket ? await getBookingHold(bucket, input.holdId) : null;
  const requestRow = input.holdId
    ? await loadRequestRow(db, input.holdId)
    : await db
        .prepare('SELECT * FROM booking_requests WHERE quote_reference = ? ORDER BY created_at DESC LIMIT 1')
        .bind(input.reference)
        .first<BookingRequestRow>();
  const fields = payload(requestRow?.payload_json);
  const reference = text(input.reference || requestRow?.quote_reference || hold?.reference, 120);
  if (!reference) return { ok: false, reason: 'reference_required' };

  // Idempotent replay: an already confirmed appointment plus its calendar
  // event is the same logical booking. Never re-run availability or create a
  // second commitment because a webhook was delivered again.
  const alreadyConfirmed = await db
    .prepare('SELECT id, status FROM appointments WHERE reference = ? LIMIT 1')
    .bind(reference)
    .first<{ id: string; status: string }>();
  if (alreadyConfirmed?.status === 'confirmed') {
    const eventId = await deps.findEvent(env, reference);
    if (eventId) {
      if (hold && bucket && hold.status !== 'confirmed') {
        await writeLedgerJson(bucket, holdKey(hold.id), {
          ...hold,
          status: 'confirmed',
          calendarEventId: eventId,
        });
        const pending = await getPendingBookingRequest(bucket, requestIdForHold(hold.id));
        if (pending && pending.status === 'pending') {
          await updatePendingBookingRequest(bucket, pending, {
            status: 'confirmed',
            calendarEventId: eventId,
          });
        }
      }
      const plan = await db
        .prepare('SELECT id, sync_status FROM recurring_plans WHERE booking_reference = ? LIMIT 1')
        .bind(reference)
        .first<{ id: string; sync_status: string }>();
      return {
        ok: true,
        appointmentId: alreadyConfirmed.id,
        eventId,
        ...(plan ? { planId: plan.id, recurringStatus: plan.sync_status } : {}),
      };
    }
  }

  let customerId: string;
  let propertyId: string;
  try {
    const resolved = await ensureCustomerAndProperty(db, input, requestRow, hold?.locationText ?? '');
    customerId = resolved.customerId;
    propertyId = resolved.propertyId;
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }

  const serviceCode =
    text(input.serviceCode, 80) || text(fields.service_type, 80) || 'residential-cleaning';
  const frequency =
    text(input.frequency, 20) || text(fields.ongoing_frequency, 20) || text(fields.frequency, 20);
  const gate = await evaluateDocumentGate(
    db,
    {
      subjectType: 'customer',
      customerId,
      propertyId,
      serviceCode,
      frequency,
      bookingReference: reference,
      ...(requestRow?.id ? { bookingRequestId: requestRow.id } : {}),
      accessAuthorization: fields.access_authorization === 'yes',
      customerProducts: fields.customer_products === 'yes',
    },
    'before_confirmation',
  );
  if (!gate.satisfied) {
    return { ok: false, reason: 'documents_required' };
  }

  const start = text(hold?.start, 40) || text(fields.booking_slot_start, 40);
  const end = text(hold?.end, 40) || text(fields.booking_slot_end, 40);
  const duration = Number(hold?.durationMinutes) || Math.max(60, Math.round((Date.parse(end) - Date.parse(start)) / 60_000)) || 120;
  if (!start || !end || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) {
    return { ok: false, reason: 'slot_missing' };
  }
  const destination = hold?.destination ?? {
    lat: Number(fields.pin_latitude),
    lng: Number(fields.pin_longitude),
  };
  if (!Number.isFinite(destination.lat) || !Number.isFinite(destination.lng)) {
    return { ok: false, reason: 'destination_missing' };
  }
  const crewSize = Math.max(1, hold?.crewSize ?? hold?.resourceIds?.length ?? 1);
  const existingEventId = await deps.findEvent(env, reference);
  const existingEvent = existingEventId ? await deps.getEvent(env, existingEventId).catch(() => null) : null;
  const usableEvent = existingEvent && existingEvent.status !== 'cancelled' ? existingEvent : null;
  const availability = await deps.availability(env, {
    date: localDate(start),
    durationMinutes: duration,
    destination,
    crewSize,
    ...(hold?.id ? { ignoreHoldId: hold.id } : {}),
    ...(usableEvent ? { excludeEventIds: [usableEvent.id] } : {}),
  });
  if (!availability.ok) return { ok: false, reason: availability.reason };
  const exact = availability.availability.slots.find(
    (slot) => slot.start === start && slot.end === end,
  );
  if (!exact) return { ok: false, reason: 'slot_unavailable' };
  const resourceIds = exact.resourceIds;

  let eventId = usableEvent?.id;
  let createdEvent = false;
  if (!eventId) {
    const created = await deps.createEvent(env, {
      summary: `Sparkling Standard Cleaning - ${reference}`,
      description: `Confirmed cleaning booking ${reference}. Resources: ${resourceIds.join(', ')}.`,
      location: hold?.locationText ?? text(fields.service_address, 300),
      start,
      end,
      timeZone: bookingConfig.timeZone,
      reference,
      resourceIds,
    });
    if (!created.ok || !created.eventId) return { ok: false, reason: created.reason ?? 'calendar_write_failed' };
    eventId = created.eventId;
    createdEvent = true;
  }

  let appointmentId = '';
  try {
    const existingAppointment = await db
      .prepare('SELECT id FROM appointments WHERE reference = ? LIMIT 1')
      .bind(reference)
      .first<{ id: string }>();
    appointmentId = existingAppointment?.id ?? `appt_${crypto.randomUUID()}`;
    if (existingAppointment) {
      await db
        .prepare(
          `UPDATE appointments
           SET status = 'confirmed', start_at = ?, end_at = ?, duration_minutes = ?, crew_size = ?,
               cancelled_at = NULL, updated_at = ?
           WHERE id = ?`,
        )
        .bind(start, end, duration, resourceIds.length, new Date().toISOString(), appointmentId)
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO appointments
           (id, branch_id, customer_id, property_id, booking_request_id, status, start_at, end_at,
            timezone, duration_minutes, crew_size, source, reference, notes)
           VALUES (?, 'branch_pensacola', ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          appointmentId,
          customerId,
          propertyId,
          requestRow?.id ?? null,
          start,
          end,
          bookingConfig.timeZone,
          duration,
          resourceIds.length,
          text(input.source, 40) || 'website',
          reference,
          text(input.notes, 1000),
        )
        .run();
    }
    const link = await db
      .prepare('SELECT id FROM calendar_links WHERE provider = ? AND provider_event_id = ? LIMIT 1')
      .bind('google', eventId)
      .first<{ id: string }>();
    if (!link) {
      await db
        .prepare(
          `INSERT INTO calendar_links (id, appointment_id, provider, provider_event_id, sync_status, last_synced_at)
           VALUES (?, ?, 'google', ?, 'synced', ?)`,
        )
        .bind(`cal_${crypto.randomUUID()}`, appointmentId, eventId, new Date().toISOString())
        .run();
    }
    if (requestRow) {
      await db
        .prepare("UPDATE booking_requests SET status = 'confirmed', updated_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), requestRow.id)
        .run();
    }
  } catch (error) {
    if (createdEvent && eventId) {
      await deps.deleteEvent(env, eventId).catch(() => undefined);
    }
    return { ok: false, reason: `appointment_write_failed:${(error as Error).message}` };
  }

  if (hold && bucket) {
    const updated: BookingHold = {
      ...hold,
      status: 'confirmed',
      calendarEventId: eventId,
      resourceIds,
      crewSize: resourceIds.length,
    };
    await writeLedgerJson(bucket, holdKey(hold.id), updated);
    const pending = await getPendingBookingRequest(bucket, requestIdForHold(hold.id));
    if (pending && pending.status === 'pending') {
      await updatePendingBookingRequest(bucket, pending, {
        status: 'confirmed',
        calendarEventId: eventId,
        resourceIds,
        crewSize: resourceIds.length,
      });
    }
  }

  let planId = '';
  let recurringStatus = '';
  let recurringConflicts = 0;
  if (recurringSchedulingEnabled(env) && ['weekly', 'biweekly', 'monthly'].includes(frequency)) {
    const ongoingPrice = Math.round(
      Number(input.ongoingPriceCents) ||
        Math.round(Number(fields.ongoing_price_per_visit || 0) * 100),
    );
    if (ongoingPrice > 0) {
      const recurring = await ensureRecurringPlan(env, db, {
        reference,
        customerId,
        propertyId,
        serviceCode,
        frequency,
        start,
        end,
        duration,
        ongoingDuration:
          Number(input.ongoingDurationMinutes) ||
          Number(fields.ongoing_duration_minutes) ||
          duration,
        ongoingPriceCents: ongoingPrice,
        crewSize: resourceIds.length,
        resourceIds,
        appointmentId,
        eventId,
        termsVersion: text(input.termsVersion, 80) || text(fields.terms_version, 80) || 'website.v1',
        deps,
      });
      planId = recurring.planId;
      recurringStatus = recurring.status;
      recurringConflicts = recurring.conflicts;
    }
  }

  await audit(db, {
    actorUserId: null,
    action: 'booking.commitment_confirmed',
    entityType: 'appointment',
    entityId: appointmentId,
    detail: `${reference}:${eventId}:${resourceIds.join(',')}`,
  });
  return {
    ok: true,
    appointmentId,
    eventId,
    ...(planId ? { planId } : {}),
    ...(recurringStatus ? { recurringStatus } : {}),
    ...(recurringConflicts ? { recurringConflicts } : {}),
  };
}

export async function ensureRecurringPlan(
  env: BookingEnv,
  db: D1Database,
  input: {
    reference: string;
    customerId: string;
    propertyId: string;
    serviceCode: string;
    frequency: string;
    start: string;
    end: string;
    duration: number;
    ongoingDuration: number;
    ongoingPriceCents: number;
    crewSize: number;
    resourceIds: string[];
    appointmentId: string;
    eventId: string;
    termsVersion: string;
    deps?: CommitmentDependencies;
  },
): Promise<{ planId: string; status: string; conflicts: number }> {
  const deps: CommitmentDependencies = input.deps ?? {
    availability: availabilityForDate,
    findEvent: findCalendarEventByReference,
    getEvent: getCalendarEvent,
    inspectEvent: inspectCalendarEvent,
    createEvent: createCalendarEvent,
    updateEvent: updateCalendarEvent,
    deleteEvent: deleteCalendarEvent,
  };
  const existing = await db
    .prepare('SELECT id FROM recurring_plans WHERE booking_reference = ? LIMIT 1')
    .bind(input.reference)
    .first<{ id: string }>();
  if (existing) {
    const sync = await syncRecurringPlan(env, db, SYSTEM_ACTOR, existing.id, {
      cancelSuperseded: false,
      deps,
    }).catch(() => null);
    await db
      .prepare('UPDATE recurring_plans SET sync_status = ?, sync_error = ?, updated_at = ? WHERE id = ?')
      .bind(sync?.status ?? 'sync_failed', sync?.errors.join('; ') ?? '', new Date().toISOString(), existing.id)
      .run();
    return {
      planId: existing.id,
      status: sync?.status ?? 'sync_failed',
      conflicts: sync?.conflicts.length ?? 0,
    };
  }
  const planId = `rec_${crypto.randomUUID()}`;
  const startDate = localDate(input.start);
  const startTime = localTime(input.start);
  const nextDate = occurrenceDate(startDate, input.frequency, 1);
  await db
    .prepare(
      `INSERT INTO recurring_plans
       (id, customer_id, property_id, branch_id, service_code, frequency, status,
        ongoing_price_cents, start_date, next_visit_date, terms_version, window, start_time,
        duration_minutes, crew_size, first_duration_minutes, booking_reference, sync_status)
       VALUES (?, ?, ?, 'branch_pensacola', ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    )
    .bind(
      planId,
      input.customerId,
      input.propertyId,
      input.serviceCode,
      input.frequency,
      input.ongoingPriceCents,
      startDate,
      nextDate,
      input.termsVersion,
      windowFor(input.start),
      startTime,
      input.ongoingDuration,
      input.crewSize,
      input.duration,
      input.reference,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO recurring_occurrences
       (id, plan_id, occurrence_date, appointment_id, calendar_event_id, status, resource_ids)
       VALUES (?, ?, ?, ?, ?, 'scheduled', ?)
       ON CONFLICT(plan_id, occurrence_date) DO UPDATE SET
         appointment_id = excluded.appointment_id,
         calendar_event_id = excluded.calendar_event_id,
         status = 'scheduled',
         resource_ids = excluded.resource_ids`,
    )
    .bind(
      `occ_${planId}_${startDate}`,
      planId,
      startDate,
      input.appointmentId,
      input.eventId,
      JSON.stringify(input.resourceIds),
    )
    .run();
  const sync = await syncRecurringPlan(env, db, SYSTEM_ACTOR, planId, {
    cancelSuperseded: false,
    deps,
  }).catch(() => null);
  const status = sync?.status ?? 'sync_failed';
  await db
    .prepare('UPDATE recurring_plans SET sync_status = ?, sync_error = ?, updated_at = ? WHERE id = ?')
    .bind(status, sync?.errors.join('; ') ?? '', new Date().toISOString(), planId)
    .run();
  await audit(db, {
    actorUserId: null,
    action: 'recurring.created_from_paid_booking',
    entityType: 'recurring_plan',
    entityId: planId,
    detail: `${input.reference}:${status}`,
  });
  return { planId, status, conflicts: sync?.conflicts.length ?? 0 };
}
