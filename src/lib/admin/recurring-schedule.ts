import { bookingConfig } from '../../config/booking.ts';
import { availabilityForDate, type BookingEnv } from '../booking/service.ts';
import { createCalendarEvent, deleteCalendarEvent, findCalendarEventByReference, getCalendarEvent } from '../booking/google-calendar.ts';
import { addDays, zonedTimeToUtc } from '../booking/time.ts';
import type { AdminActor } from './operations.ts';
import { AdminAuthError, audit } from './operations.ts';
import type { D1Database } from './d1.ts';
import type { AdminDbEnv } from './d1.ts';

export interface RecurringEnv extends BookingEnv, AdminDbEnv {}

interface PlanRow extends Record<string, unknown> {
  id: string;
  customer_id: string;
  property_id: string;
  branch_id: string | null;
  frequency: string;
  status: string;
  start_date: string;
  window: string | null;
  start_time: string | null;
  duration_minutes: number | null;
  first_duration_minutes: number | null;
  crew_size: number | null;
  line1: string;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  first_name: string | null;
  last_name: string | null;
}

function localToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: bookingConfig.timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function monthAnchored(startDate: string, months: number): string {
  const [year, month, day] = startDate.slice(0, 10).split('-').map(Number);
  const targetMonth = (month ?? 1) - 1 + months;
  const targetYear = (year ?? 1970) + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const days = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0, 12)).getUTCDate();
  const targetDay = Math.min(day ?? 1, days);
  return `${targetYear}-${String(normalizedMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
}

export function occurrenceDate(startDate: string, frequency: string, index: number): string {
  if (frequency === 'weekly') return addDays(startDate, index * 7);
  if (frequency === 'biweekly') return addDays(startDate, index * 14);
  return monthAnchored(startDate, index);
}

export function occurrenceDatesWithin(startDate: string, frequency: string, fromDate: string, toDate: string): string[] {
  if (!['weekly', 'biweekly', 'monthly'].includes(frequency)) return [];
  const dates: string[] = [];
  let index = 0;
  if (frequency === 'weekly' || frequency === 'biweekly') {
    const step = frequency === 'weekly' ? 7 : 14;
    const days = Math.floor((Date.parse(fromDate + 'T12:00:00Z') - Date.parse(startDate + 'T12:00:00Z')) / 86_400_000);
    index = Math.max(0, Math.floor(days / step));
    while (occurrenceDate(startDate, frequency, index) < fromDate) index += 1;
  } else {
    const [sy = 1970, sm = 1] = startDate.split('-').map(Number);
    const [fy = 1970, fm = 1] = fromDate.split('-').map(Number);
    index = Math.max(0, (fy - sy) * 12 + (fm - sm) - 1);
    while (occurrenceDate(startDate, frequency, index) < fromDate) index += 1;
  }
  for (let i = index; i < index + 200; i += 1) {
    const date = occurrenceDate(startDate, frequency, i);
    if (date > toDate) break;
    dates.push(date);
  }
  return dates;
}

function occurrenceId(planId: string, date: string): string {
  return `occ_${planId}_${date}`;
}

function reference(planId: string, date: string): string {
  return `RECURRING-${planId}-${date}`;
}

async function loadPlan(db: D1Database, actor: AdminActor, planId: string): Promise<PlanRow> {
  const branch = actor.role === 'owner' ? { sql: '', bind: [] as unknown[] }
    : actor.branchId ? { sql: ' AND r.branch_id = ?', bind: [actor.branchId] } : { sql: ' AND 1 = 0', bind: [] as unknown[] };
  const row = await db.prepare(
    `SELECT r.*, p.line1, p.city, p.state, p.postal_code, p.latitude, p.longitude,
            c.first_name, c.last_name
     FROM recurring_plans r
     JOIN properties p ON p.id = r.property_id
     JOIN customers c ON c.id = r.customer_id
     WHERE r.id = ? ${branch.sql} LIMIT 1`,
  ).bind(planId, ...branch.bind).first<PlanRow>();
  if (!row) throw new AdminAuthError(404, 'recurring_not_found');
  return row;
}

async function cancelFutureOccurrences(env: RecurringEnv, db: D1Database, planId: string): Promise<string[]> {
  const today = localToday();
  const rows = await db.prepare(
    `SELECT o.id, o.calendar_event_id, o.appointment_id
     FROM recurring_occurrences o
     WHERE o.plan_id = ? AND o.occurrence_date >= ? AND o.status = 'scheduled'`,
  ).bind(planId, today).all<{ id: string; calendar_event_id: string | null; appointment_id: string | null }>();
  const errors: string[] = [];
  for (const row of rows.results ?? []) {
    if (row.calendar_event_id) {
      const deleted = await deleteCalendarEvent(env, row.calendar_event_id);
      if (!deleted.ok) {
        errors.push(`${row.id}:calendar_cancel_failed`);
        continue;
      }
    }
    await db.prepare("UPDATE recurring_occurrences SET status = 'cancelled' WHERE id = ?").bind(row.id).run();
    if (row.appointment_id) {
      await db.prepare(
        "UPDATE appointments SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ? AND status IN ('pending','confirmed')",
      ).bind(new Date().toISOString(), new Date().toISOString(), row.appointment_id).run();
    }
  }
  return errors;
}

export interface RecurringSyncResult {
  ok: boolean;
  status: 'fully_scheduled' | 'partially_scheduled' | 'conflict' | 'sync_failed' | 'paused' | 'cancelled';
  created: number;
  skipped: number;
  conflicts: Array<{ date: string; reason: string }>;
  errors: string[];
}

export async function syncRecurringPlan(
  env: RecurringEnv,
  db: D1Database,
  actor: AdminActor,
  planId: string,
  options: { replaceFuture?: boolean } = {},
): Promise<RecurringSyncResult> {
  const plan = await loadPlan(db, actor, planId);
  const result: RecurringSyncResult = { ok: false, status: 'sync_failed', created: 0, skipped: 0, conflicts: [], errors: [] };
  if (options.replaceFuture) result.errors.push(...await cancelFutureOccurrences(env, db, planId));
  if (plan.status !== 'active') {
    result.ok = result.errors.length === 0;
    result.status = plan.status === 'paused' ? 'paused' : plan.status === 'cancelled' ? 'cancelled' : 'sync_failed';
    return result;
  }
  if (!plan.window || !plan.start_time || !plan.duration_minutes) {
    throw new AdminAuthError(400, 'recurring_schedule_incomplete');
  }
  if (!['weekly', 'biweekly', 'monthly'].includes(plan.frequency)) {
    throw new AdminAuthError(400, 'frequency_invalid');
  }
  const destination = {
    lat: Number(plan.latitude),
    lng: Number(plan.longitude),
  };
  if (!Number.isFinite(destination.lat) || !Number.isFinite(destination.lng)) {
    throw new AdminAuthError(400, 'recurring_property_coordinates_missing');
  }
  const durationOngoing = Number(plan.duration_minutes);
  const durationFirst = Number(plan.first_duration_minutes) || durationOngoing;
  const today = localToday();
  const horizon = addDays(today, bookingConfig.maxAdvanceDays);
  const location = [plan.line1, plan.city, plan.state, plan.postal_code].filter(Boolean).join(plan.start_date.slice(0, 10), plan.frequency, today, horizon);
  for (const date of proposedDates) {
    const existing = await db.prepare(
      'SELECT id, status, appointment_id, calendar_event_id FROM recurring_occurrences WHERE plan_id = ? AND occurrence_date = ? LIMIT 1',
    ).bind(planId, date).first<{ id: string; status: string; appointment_id: string | null; calendar_event_id: string | null }>();
    if (existing && existing.status === 'scheduled' && existing.appointment_id && existing.calendar_event_id) {
      const appointment = await db.prepare('SELECT status FROM appointments WHERE id = ? LIMIT 1').bind(existing.appointment_id).first<{ status: string }>();
      const event = await getCalendarEvent(env, existing.calendar_event_id).catch(() => null);
      if (appointment && ['pending', 'confirmed'].includes(appointment.status) && event && event.status !== 'cancelled') {
        result.skipped += 1;
        continue;
      }
    }
    const duration = date === plan.start_date.slice(0, 10) ? durationFirst : durationOngoing;
    const start = zonedTimeToUtc(date, plan.start_time, bookingConfig.timeZone);
    const availability = await availabilityForDate(env, {
      date,
      durationMinutes: duration,
      destination,
      crewSize: Math.max(1, Number(plan.crew_size) || 1),
    });
    if (!availability.ok) {
      result.conflicts.push({ date, reason: availability.reason });
      continue;
    }
    const exact = availability.availability.slots.find((slot) => slot.start === start.toISOString());
    if (!exact) {
      result.conflicts.push({ date, reason: 'slot_unavailable' });
      continue;
    }
    const resourceIds = exact.resourceIds;
    const end = new Date(exact.end);
    const occurrenceReference = reference(planId, date);
    let eventId = existing?.calendar_event_id ?? await findCalendarEventByReference(env, occurrenceReference);
    let createdByThisAttempt = false;
    if (!eventId) {
      const created = await createCalendarEvent(env, {
        summary: `Sparkling Standard Recurring Cleaning - ${[plan.first_name, plan.last_name].filter(Boolean).join(' ') || planId}`,
        description: `Recurring plan ${planId}. ${plan.frequency} service. ${plan.crew_size ?? 1} cleaner(s).`,
        location,
        start: start.toISOString(),
        end: end.toISOString(),
        timeZone: bookingConfig.timeZone,
        reference: occurrenceReference,
        resourceIds,
      });
      if (!created.ok || !created.eventId) {
        result.errors.push(`${date}:calendar_write_failed`);
        await db.prepare(
          `INSERT INTO recurring_occurrences (id, plan_id, occurrence_date, status) VALUES (?, ?, ?, 'failed')
           ON CONFLICT(plan_id, occurrence_date) DO UPDATE SET status = 'failed'`,
        ).bind(occurrenceId(planId, date), planId, date).run();
        continue;
      }
      eventId = created.eventId;
      createdByThisAttempt = true;
    }
    const appointmentId = existing?.appointment_id ?? `appt_${crypto.randomUUID()}`;
    try {
      if (!existing?.appointment_id) {
        await db.prepare(
          `INSERT INTO appointments
           (id, branch_id, customer_id, property_id, recurring_plan_id, status, start_at, end_at,
            timezone, duration_minutes, crew_size, source, reference, notes)
           VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, 'recurring', ?, 'Recurring cleaning')`,
        ).bind(appointmentId, plan.branch_id, plan.customer_id, plan.property_id, planId,
          start.toISOString(), end.toISOString(), bookingConfig.timeZone, duration,
          Math.max(1, Number(plan.crew_size) || 1), occurrenceReference).run();
      }
      await db.prepare(
        `INSERT OR REPLACE INTO recurring_occurrences
         (id, plan_id, occurrence_date, appointment_id, calendar_event_id, status)
         VALUES (?, ?, ?, ?, ?, 'scheduled')`,
      ).bind(occurrenceId(planId, date), planId, date, appointmentId, eventId).run();
      const link = await db.prepare('SELECT id FROM calendar_links WHERE provider = ? AND provider_event_id = ? LIMIT 1')
        .bind('google', eventId).first<{ id: string }>();
      if (!link) {
        await db.prepare(
          `INSERT INTO calendar_links (id, appointment_id, provider, provider_event_id, sync_status, last_synced_at)
           VALUES (?, ?, 'google', ?, 'synced', ?)`,
        ).bind(`cal_${crypto.randomUUID()}`, appointmentId, eventId, new Date().toISOString()).run();
      }
      result.created += 1;
    } catch {
      if (createdByThisAttempt && eventId) await deleteCalendarEvent(env, eventId);
      result.errors.push(`${date}:d1_write_failed`);
    }
  }
  await db.prepare('UPDATE recurring_plans SET updated_at = ? WHERE id = ?').bind(new Date().toISOString(), planId).run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'recurring.occurrences_synced',
    entityType: 'recurring_plan',
    entityId: planId,
    detail: `created=${result.created} skipped=${result.skipped} conflicts=${result.conflicts.length} errors=${result.errors.length}`,
  });
  result.ok = result.errors.length === 0 && result.conflicts.length === 0;
  result.status = result.errors.length > 0
    ? 'sync_failed'
    : result.conflicts.length > 0
      ? result.created > 0 ? 'partially_scheduled' : 'conflict'
      : 'fully_scheduled';
  return result;
}
