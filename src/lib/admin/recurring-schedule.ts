import { bookingConfig } from '../../config/booking.ts';
import { availabilityForDate, type BookingEnv } from '../booking/service.ts';
import {
  createCalendarEvent,
  deleteCalendarEvent,
  findCalendarEventByReference,
  getCalendarEvent,
  inspectCalendarEvent,
  updateCalendarEvent,
  type CalendarEventState,
} from '../booking/google-calendar.ts';
import { addDays, zonedTimeToUtc } from '../booking/time.ts';
import type { AdminActor } from './operations.ts';
import { AdminAuthError, audit } from './operations.ts';
import type { D1Database } from './d1.ts';
import type { AdminDbEnv } from './d1.ts';

export interface RecurringDependencies {
  availability: typeof availabilityForDate;
  findEvent: typeof findCalendarEventByReference;
  getEvent: typeof getCalendarEvent;
  inspectEvent: typeof inspectCalendarEvent;
  createEvent: typeof createCalendarEvent;
  updateEvent: typeof updateCalendarEvent;
  deleteEvent: typeof deleteCalendarEvent;
}

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
  next_visit_date?: string | null;
  sync_status?: string;
  sync_error?: string;
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

async function cancelFutureOccurrences(env: RecurringEnv, db: D1Database, planId: string, deleter: typeof deleteCalendarEvent = deleteCalendarEvent): Promise<string[]> {
  const today = localToday();
  const rows = await db.prepare(
    `SELECT o.id, o.calendar_event_id, o.appointment_id
     FROM recurring_occurrences o
     WHERE o.plan_id = ? AND o.occurrence_date >= ? AND o.status = 'scheduled'`,
  ).bind(planId, today).all<{ id: string; calendar_event_id: string | null; appointment_id: string | null }>();
  const errors: string[] = [];
  for (const row of rows.results ?? []) {
    if (row.calendar_event_id) {
      const deleted = await deleter(env, row.calendar_event_id);
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
  status:
    | 'fully_scheduled'
    | 'partially_scheduled'
    | 'conflict'
    | 'sync_failed'
    | 'paused'
    | 'cancelled'
    | 'completed';
  created: number;
  updated: number;
  skipped: number;
  conflicts: Array<{ date: string; reason: string }>;
  errors: string[];
}

export interface ProposedRecurringSchedule {
  frequency?: string;
  startDate?: string;
  window?: string;
  startTime?: string;
  durationMinutes?: number;
  firstDurationMinutes?: number;
  crewSize?: number;
}

export interface EffectiveRecurringSchedule {
  frequency: string;
  startDate: string;
  window: string;
  startTime: string;
  durationMinutes: number;
  firstDurationMinutes: number;
  crewSize: number;
}

export interface PreparedRecurringSchedule {
  ok: boolean;
  conflicts: Array<{ date: string; reason: string }>;
  dates: Array<{ date: string; start: string; end: string; resourceIds: string[] }>;
  schedule?: EffectiveRecurringSchedule;
}

export function effectiveRecurringSchedule(
  plan: Pick<PlanRow, 'frequency' | 'start_date' | 'window' | 'start_time' | 'duration_minutes' | 'first_duration_minutes' | 'crew_size'>,
  proposed: ProposedRecurringSchedule = {},
): EffectiveRecurringSchedule {
  const frequency = proposed.frequency ?? plan.frequency;
  const startDate = (proposed.startDate ?? plan.start_date ?? '').slice(0, 10);
  const window = proposed.window ?? plan.window ?? '';
  const startTime = proposed.startTime ?? plan.start_time ?? '';
  const durationMinutes = Math.round(Number(proposed.durationMinutes ?? plan.duration_minutes));
  const firstDurationMinutes = Math.round(
    Number(proposed.firstDurationMinutes ?? plan.first_duration_minutes ?? durationMinutes),
  );
  const crewSize = Math.max(1, Math.round(Number(proposed.crewSize ?? plan.crew_size ?? 1)));
  if (!['weekly', 'biweekly', 'monthly'].includes(frequency)) {
    throw new AdminAuthError(400, 'frequency_invalid');
  }
  if (!['morning', 'afternoon'].includes(window)) {
    throw new AdminAuthError(400, 'recurring_window_invalid');
  }
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(startTime);
  const minutes = timeMatch ? Number(timeMatch[1]) * 60 + Number(timeMatch[2]) : Number.NaN;
  const insideWindow = window === 'morning'
    ? minutes >= 7 * 60 && minutes <= 8 * 60 + 30
    : minutes >= 12 * 60 + 30 && minutes <= 14 * 60 + 30;
  if (!Number.isFinite(minutes) || minutes % 15 !== 0 || !insideWindow) {
    throw new AdminAuthError(400, 'recurring_start_outside_window');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new AdminAuthError(400, 'recurring_start_date_invalid');
  if (!Number.isFinite(durationMinutes) || durationMinutes < 30 || durationMinutes > 600) {
    throw new AdminAuthError(400, 'recurring_duration_invalid');
  }
  if (!Number.isFinite(firstDurationMinutes) || firstDurationMinutes < 30 || firstDurationMinutes > 600) {
    throw new AdminAuthError(400, 'recurring_duration_invalid');
  }
  if (crewSize > bookingConfig.maxCrewSize) throw new AdminAuthError(400, 'recurring_crew_invalid');
  return { frequency, startDate, window, startTime, durationMinutes, firstDurationMinutes, crewSize };
}

async function occurrenceEventIds(db: D1Database, planId: string): Promise<string[]> {
  const rows = await db
    .prepare(
      "SELECT calendar_event_id FROM recurring_occurrences WHERE plan_id = ? AND status = 'scheduled' AND calendar_event_id IS NOT NULL",
    )
    .bind(planId)
    .all<{ calendar_event_id: string }>();
  return (rows.results ?? []).map((row) => row.calendar_event_id).filter(Boolean);
}

export async function prepareRecurringScheduleChange(
  env: RecurringEnv,
  db: D1Database,
  actor: AdminActor,
  planId: string,
  proposed: ProposedRecurringSchedule,
  deps: Partial<RecurringDependencies> = {},
): Promise<PreparedRecurringSchedule> {
  const plan = await loadPlan(db, actor, planId);
  const schedule = effectiveRecurringSchedule(plan, proposed);
  const today = localToday();
  const horizon = addDays(today, bookingConfig.maxAdvanceDays);
  const dates = occurrenceDatesWithin(schedule.startDate, schedule.frequency, today, horizon);
  const conflicts: PreparedRecurringSchedule['conflicts'] = [];
  const prepared: PreparedRecurringSchedule['dates'] = [];
  const destination = { lat: Number(plan.latitude), lng: Number(plan.longitude) };
  if (!Number.isFinite(destination.lat) || !Number.isFinite(destination.lng)) {
    return { ok: false, conflicts: [{ date: schedule.startDate, reason: 'property_coordinates_missing' }], dates: [], schedule };
  }
  const availability = deps.availability ?? availabilityForDate;
  const excludeEventIds = await occurrenceEventIds(db, planId);
  for (const date of dates) {
    const duration = date === schedule.startDate ? schedule.firstDurationMinutes : schedule.durationMinutes;
    const start = zonedTimeToUtc(date, schedule.startTime, bookingConfig.timeZone);
    const result = await availability(env, {
      date,
      durationMinutes: duration,
      destination,
      crewSize: schedule.crewSize,
      excludeEventIds,
    });
    if (!result.ok) {
      conflicts.push({ date, reason: result.reason });
      continue;
    }
    const exact = result.availability.slots.find((slot) => slot.start === start.toISOString());
    if (!exact) {
      conflicts.push({ date, reason: 'slot_unavailable' });
      continue;
    }
    prepared.push({ date, start: exact.start, end: exact.end, resourceIds: exact.resourceIds });
  }
  return {
    ok: conflicts.length === 0 && prepared.length === dates.length,
    conflicts,
    dates: prepared,
    schedule,
  };
}

/**
 * Applies a prepared schedule without destroying confirmed visits first.
 * New commitments are written and verified before the plan row changes; if any
 * external write fails, the previous schedule is reconciled and reported.
 */
export async function applyRecurringScheduleChange(
  env: RecurringEnv,
  db: D1Database,
  actor: AdminActor,
  planId: string,
  proposed: ProposedRecurringSchedule,
  deps: Partial<RecurringDependencies> = {},
): Promise<PreparedRecurringSchedule & { sync?: RecurringSyncResult; rolledBack?: boolean }> {
  const prepared = await prepareRecurringScheduleChange(env, db, actor, planId, proposed, deps);
  if (!prepared.ok || !prepared.schedule) return prepared;
  const planBefore = await loadPlan(db, actor, planId);
  const snapshot = await occurrenceSnapshot(db, planId);
  const sync = await syncRecurringPlan(env, db, actor, planId, {
    schedule: prepared.schedule,
    cancelSuperseded: true,
    deps,
  });
  if (!sync.ok) {
    const restored = await restoreRecurringSnapshot(env, db, planId, planBefore, snapshot, deps);
    return {
      ...prepared,
      ok: false,
      sync: {
        ...sync,
        errors: [
          ...sync.errors,
          `rollback:${restored.ok ? 'restored' : 'failed'}`,
          ...restored.errors,
        ],
      },
      rolledBack: restored.ok,
    };
  }
  const schedule = prepared.schedule;
  await db.prepare(
    `UPDATE recurring_plans SET frequency = ?, start_date = ?, window = ?, start_time = ?,
       duration_minutes = ?, first_duration_minutes = ?, crew_size = ?, next_visit_date = ?,
       sync_status = ?, sync_error = '', updated_at = ? WHERE id = ?`,
  ).bind(
    schedule.frequency,
    schedule.startDate,
    schedule.window,
    schedule.startTime,
    schedule.durationMinutes,
    schedule.firstDurationMinutes,
    schedule.crewSize,
    prepared.dates[0]?.date ?? null,
    sync.status,
    new Date().toISOString(),
    planId,
  ).run();
  return { ...prepared, sync };
}

export async function setRecurringStatus(
  env: RecurringEnv,
  db: D1Database,
  actor: AdminActor,
  planId: string,
  status: 'active' | 'paused' | 'cancelled' | 'completed',
  deps: Partial<RecurringDependencies> = {},
): Promise<RecurringSyncResult> {
  const plan = await loadPlan(db, actor, planId);
  await db
    .prepare('UPDATE recurring_plans SET status = ?, next_visit_date = ?, updated_at = ? WHERE id = ?')
    .bind(status, status === 'active' ? plan.start_date : null, new Date().toISOString(), planId)
    .run();
  if (status === 'active') {
    return syncRecurringPlan(env, db, actor, planId, { cancelSuperseded: true, deps });
  }
  return syncRecurringPlan(env, db, actor, planId, { replaceFuture: true, deps });
}

async function persistRecurringResources(
  db: D1Database,
  appointmentId: string,
  resourceIds: ReadonlyArray<string>,
): Promise<void> {
  const unique = [...new Set(resourceIds.map((value) => value.trim()).filter(Boolean))];
  await db.prepare('DELETE FROM appointment_resources WHERE appointment_id = ?').bind(appointmentId).run();
  if (unique.length === 0) return;
  const placeholders = unique.map(() => '?').join(',');
  const members = await db
    .prepare(
      `SELECT id, is_solo, is_lead FROM team_members
       WHERE booking_resource_id IN (${placeholders})`,
    )
    .bind(...unique)
    .all<{ id: string; is_solo: number; is_lead: number }>();
  for (const member of members.results ?? []) {
    const role = Number(member.is_solo) === 1 ? 'solo' : Number(member.is_lead) === 1 ? 'lead' : 'cleaner';
    await db
      .prepare(
        'INSERT OR REPLACE INTO appointment_resources (appointment_id, team_member_id, role) VALUES (?, ?, ?)',
      )
      .bind(appointmentId, member.id, role)
      .run();
  }
}

export async function syncRecurringPlan(
  env: RecurringEnv,
  db: D1Database,
  actor: AdminActor,
  planId: string,
  options: {
    replaceFuture?: boolean;
    cancelSuperseded?: boolean;
    schedule?: ProposedRecurringSchedule;
    deps?: Partial<RecurringDependencies>;
  } = {},
): Promise<RecurringSyncResult> {
  const deps: RecurringDependencies = {
    availability: availabilityForDate,
    findEvent: findCalendarEventByReference,
    getEvent: getCalendarEvent,
    inspectEvent: inspectCalendarEvent,
    createEvent: createCalendarEvent,
    updateEvent: updateCalendarEvent,
    deleteEvent: deleteCalendarEvent,
    ...options.deps,
  };
  const plan = await loadPlan(db, actor, planId);
  const result: RecurringSyncResult = {
    ok: false,
    status: 'sync_failed',
    created: 0,
    updated: 0,
    skipped: 0,
    conflicts: [],
    errors: [],
  };
  if (options.replaceFuture) {
    result.errors.push(...(await cancelFutureOccurrences(env, db, planId, deps.deleteEvent)));
  }
  if (plan.status !== 'active') {
    result.ok = result.errors.length === 0;
    result.status =
      plan.status === 'paused'
        ? 'paused'
        : plan.status === 'cancelled'
          ? 'cancelled'
          : plan.status === 'completed'
            ? 'completed'
            : 'sync_failed';
    return result;
  }

  const schedule = effectiveRecurringSchedule(plan, options.schedule);
  const destination = { lat: Number(plan.latitude), lng: Number(plan.longitude) };
  if (!Number.isFinite(destination.lat) || !Number.isFinite(destination.lng)) {
    throw new AdminAuthError(400, 'recurring_property_coordinates_missing');
  }
  const today = localToday();
  const horizon = addDays(today, bookingConfig.maxAdvanceDays);
  const location = [plan.line1, plan.city, plan.state, plan.postal_code].filter(Boolean).join(', ');
  const desiredDates = occurrenceDatesWithin(schedule.startDate, schedule.frequency, today, horizon);
  const desiredSet = new Set(desiredDates);
  const ownEventIds = await occurrenceEventIds(db, planId);

  for (const date of desiredDates) {
    const duration = date === schedule.startDate ? schedule.firstDurationMinutes : schedule.durationMinutes;
    const start = zonedTimeToUtc(date, schedule.startTime, bookingConfig.timeZone);
    const occurrenceReference = reference(planId, date);
    const existing = await db
      .prepare(
        `SELECT ro.id, ro.status, ro.appointment_id, ro.calendar_event_id,
                a.status AS appointment_status
         FROM recurring_occurrences ro
         LEFT JOIN appointments a ON a.id = ro.appointment_id
         WHERE ro.plan_id = ? AND ro.occurrence_date = ? LIMIT 1`,
      )
      .bind(planId, date)
      .first<{
        id: string;
        status: string;
        appointment_id: string | null;
        calendar_event_id: string | null;
        appointment_status: string | null;
      }>();

    // A cancelled/completed occurrence or appointment is an owner decision,
    // not a missing event. Never resurrect it during a later sync.
    if (
      existing &&
      (['cancelled', 'completed'].includes(existing.status) ||
        (existing.appointment_status !== null &&
          ['cancelled', 'completed'].includes(existing.appointment_status)))
    ) {
      result.skipped += 1;
      continue;
    }

    const availability = await deps.availability(env, {
      date,
      durationMinutes: duration,
      destination,
      crewSize: schedule.crewSize,
      excludeEventIds: ownEventIds,
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
    const endIso = exact.end;

    let eventId = existing?.calendar_event_id ?? (await deps.findEvent(env, occurrenceReference));
    let createdEvent = false;
    let updatedEvent = false;
    if (eventId) {
      const inspection = await deps
        .inspectEvent(env, eventId)
        .catch((): CalendarEventState => ({ state: 'unavailable' }));
      if (inspection.state === 'auth_failed' || inspection.state === 'unavailable') {
        result.errors.push(`${date}:calendar_unverified`);
        await recordOccurrenceFailure(db, planId, date, `${inspection.state}:calendar_unverified`);
        continue;
      }
      if (inspection.state === 'missing' || inspection.state === 'cancelled') {
        result.conflicts.push({ date, reason: 'calendar_event_missing' });
        await recordOccurrenceFailure(db, planId, date, 'calendar_event_missing');
        continue;
      } else {
        const event = inspection.event;
        const sameTime =
          event.start === start.toISOString() && event.end === endIso;
        const sameResources =
          JSON.stringify([...(event.resourceIds ?? [])].sort()) ===
          JSON.stringify([...resourceIds].sort());
        if (!sameTime || !sameResources) {
          const patched = await deps.updateEvent(env, eventId, {
            start: start.toISOString(),
            end: endIso,
            timeZone: bookingConfig.timeZone,
            resourceIds,
          });
          if (!patched.ok) {
            result.errors.push(`${date}:calendar_update_failed`);
            await recordOccurrenceFailure(db, planId, date, 'calendar_update_failed');
            continue;
          }
          updatedEvent = true;
        }
      }
    }

    if (!eventId) {
      const created = await deps.createEvent(env, {
        summary: `Sparkling Standard Recurring Cleaning - ${[plan.first_name, plan.last_name].filter(Boolean).join(' ') || planId}`,
        description: `Recurring plan ${planId}. ${schedule.frequency} service. ${schedule.crewSize} cleaner(s).`,
        location,
        start: start.toISOString(),
        end: endIso,
        timeZone: bookingConfig.timeZone,
        reference: occurrenceReference,
        resourceIds,
      });
      if (!created.ok || !created.eventId) {
        result.errors.push(`${date}:calendar_write_failed`);
        await recordOccurrenceFailure(db, planId, date, 'calendar_write_failed');
        continue;
      }
      eventId = created.eventId;
      createdEvent = true;
    }

    const priorAppointment = await db
      .prepare('SELECT id FROM appointments WHERE reference = ? LIMIT 1')
      .bind(occurrenceReference)
      .first<{ id: string }>();
    const appointmentId = existing?.appointment_id ?? priorAppointment?.id ?? `appt_${crypto.randomUUID()}`;
    const appointmentExists = await db
      .prepare('SELECT id FROM appointments WHERE id = ? LIMIT 1')
      .bind(appointmentId)
      .first<{ id: string }>();
    try {
      if (appointmentExists) {
        await db
          .prepare(
            `UPDATE appointments
             SET status = 'confirmed', start_at = ?, end_at = ?, duration_minutes = ?, crew_size = ?,
                 cancelled_at = NULL, updated_at = ?
             WHERE id = ?`,
          )
          .bind(start.toISOString(), endIso, duration, schedule.crewSize, new Date().toISOString(), appointmentId)
          .run();
      } else {
        await db
          .prepare(
            `INSERT INTO appointments
             (id, branch_id, customer_id, property_id, recurring_plan_id, status, start_at, end_at,
              timezone, duration_minutes, crew_size, source, reference, notes)
             VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, 'recurring', ?, 'Recurring cleaning')`,
          )
          .bind(
            appointmentId,
            plan.branch_id,
            plan.customer_id,
            plan.property_id,
            planId,
            start.toISOString(),
            endIso,
            bookingConfig.timeZone,
            duration,
            schedule.crewSize,
            occurrenceReference,
          )
          .run();
      }
      await persistRecurringResources(db, appointmentId, resourceIds);
      await db
        .prepare(
          `INSERT OR REPLACE INTO recurring_occurrences
           (id, plan_id, occurrence_date, appointment_id, calendar_event_id, status, resource_ids, sync_error)
           VALUES (?, ?, ?, ?, ?, 'scheduled', ?, '')`,
        )
        .bind(occurrenceId(planId, date), planId, date, appointmentId, eventId, JSON.stringify(resourceIds))
        .run();
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
      if (createdEvent) result.created += 1;
      else if (updatedEvent) result.updated += 1;
      else result.skipped += 1;
    } catch (error) {
      if (createdEvent && eventId) await deps.deleteEvent(env, eventId);
      result.errors.push(`${date}:d1_write_failed:${(error as Error).message}`);
      await recordOccurrenceFailure(db, planId, date, `d1_write_failed:${(error as Error).message}`);
    }
  }

  // Only remove superseded commitments after every desired occurrence has been
  // written successfully. A failure preserves the previous schedule.
  if (options.cancelSuperseded && result.errors.length === 0 && result.conflicts.length === 0) {
    const stale = await db
      .prepare(
        `SELECT id, occurrence_date, calendar_event_id, appointment_id
         FROM recurring_occurrences
         WHERE plan_id = ? AND status = 'scheduled' AND occurrence_date >= ?`,
      )
      .bind(planId, today)
      .all<{
        id: string;
        occurrence_date: string;
        calendar_event_id: string | null;
        appointment_id: string | null;
      }>();
    for (const row of stale.results ?? []) {
      if (desiredSet.has(row.occurrence_date)) continue;
      if (row.calendar_event_id) {
        const deleted = await deps.deleteEvent(env, row.calendar_event_id);
        if (!deleted.ok) {
          result.errors.push(`${row.id}:calendar_cancel_failed`);
          continue;
        }
      }
      await db.prepare("UPDATE recurring_occurrences SET status = 'cancelled' WHERE id = ?").bind(row.id).run();
      if (row.appointment_id) {
        await db
          .prepare(
            "UPDATE appointments SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ? AND status IN ('pending','confirmed')",
          )
          .bind(new Date().toISOString(), new Date().toISOString(), row.appointment_id)
          .run();
      }
    }
  }

  await db
    .prepare(
      'UPDATE recurring_plans SET next_visit_date = ?, sync_status = ?, sync_error = ?, updated_at = ? WHERE id = ?',
    )
    .bind(
      desiredDates[0] ?? null,
      result.errors.length > 0
        ? 'sync_failed'
        : result.conflicts.length > 0
          ? result.created + result.updated > 0
            ? 'partially_scheduled'
            : 'conflict'
          : 'fully_scheduled',
      result.errors.join('; ').slice(0, 1000),
      new Date().toISOString(),
      planId,
    )
    .run();
  await audit(db, {
    actorUserId: actor.id === 'system' ? null : actor.id,
    action: 'recurring.occurrences_synced',
    entityType: 'recurring_plan',
    entityId: planId,
    detail: `created=${result.created} updated=${result.updated} skipped=${result.skipped} conflicts=${result.conflicts.length} errors=${result.errors.length}`,
  });
  result.ok = result.errors.length === 0 && result.conflicts.length === 0;
  result.status =
    result.errors.length > 0
      ? 'sync_failed'
      : result.conflicts.length > 0
        ? result.created + result.updated > 0
          ? 'partially_scheduled'
          : 'conflict'
        : 'fully_scheduled';
  return result;
}

async function recordOccurrenceFailure(
  db: D1Database,
  planId: string,
  date: string,
  error: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO recurring_occurrences (id, plan_id, occurrence_date, status, sync_error)
       VALUES (?, ?, ?, 'failed', ?)
       ON CONFLICT(plan_id, occurrence_date) DO UPDATE SET status = 'failed', sync_error = excluded.sync_error`,
    )
    .bind(occurrenceId(planId, date), planId, date, error.slice(0, 500))
    .run();
}

interface OccurrenceSnapshotRow {
  id: string;
  occurrence_date: string;
  calendar_event_id: string | null;
  appointment_id: string | null;
  resource_ids: string;
  start_at: string | null;
  end_at: string | null;
  duration_minutes: number | null;
  crew_size: number | null;
}

async function occurrenceSnapshot(
  db: D1Database,
  planId: string,
): Promise<OccurrenceSnapshotRow[]> {
  const today = localToday();
  const rows = await db
    .prepare(
      `SELECT o.id, o.occurrence_date, o.calendar_event_id, o.appointment_id, o.resource_ids,
              a.start_at, a.end_at, a.duration_minutes, a.crew_size
       FROM recurring_occurrences o
       LEFT JOIN appointments a ON a.id = o.appointment_id
       WHERE o.plan_id = ? AND o.status = 'scheduled' AND o.occurrence_date >= ?
       ORDER BY o.occurrence_date`,
    )
    .bind(planId, today)
    .all<OccurrenceSnapshotRow>();
  return rows.results ?? [];
}

async function restoreRecurringSnapshot(
  env: RecurringEnv,
  db: D1Database,
  planId: string,
  planBefore: PlanRow,
  snapshot: OccurrenceSnapshotRow[],
  deps: Partial<RecurringDependencies>,
): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = [];
  const today = localToday();
  const snapshotIds = new Set(snapshot.map((row) => row.id));
  const current = await db
    .prepare(
      `SELECT id, calendar_event_id, appointment_id FROM recurring_occurrences
       WHERE plan_id = ? AND status = 'scheduled' AND occurrence_date >= ?`,
    )
    .bind(planId, today)
    .all<{ id: string; calendar_event_id: string | null; appointment_id: string | null }>();
  for (const row of current.results ?? []) {
    if (snapshotIds.has(row.id)) continue;
    if (row.calendar_event_id) {
      const deleted = await deps.deleteEvent!(env, row.calendar_event_id);
      if (!deleted.ok) errors.push(`${row.id}:rollback_calendar_cancel_failed`);
    }
    await db.prepare("UPDATE recurring_occurrences SET status = 'cancelled' WHERE id = ?").bind(row.id).run();
    if (row.appointment_id) {
      await db
        .prepare(
          "UPDATE appointments SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ? AND status IN ('pending','confirmed')",
        )
        .bind(new Date().toISOString(), new Date().toISOString(), row.appointment_id)
        .run();
    }
  }
  for (const row of snapshot) {
    if (!row.start_at || !row.end_at) {
      errors.push(`${row.id}:rollback_appointment_missing`);
      continue;
    }
    const resourceIds = (() => {
      try {
        const parsed = JSON.parse(row.resource_ids || '[]') as unknown;
        return Array.isArray(parsed) ? parsed.map((value) => String(value)).filter(Boolean) : [];
      } catch {
        return [];
      }
    })();
    if (row.calendar_event_id) {
      const patched = await deps.updateEvent!(env, row.calendar_event_id, {
        start: row.start_at,
        end: row.end_at,
        timeZone: bookingConfig.timeZone,
        resourceIds,
      });
      if (!patched.ok) errors.push(`${row.id}:rollback_calendar_failed`);
    }
    if (row.appointment_id) {
      await db
        .prepare(
          `UPDATE appointments SET status = 'confirmed', start_at = ?, end_at = ?, duration_minutes = ?,
             crew_size = ?, cancelled_at = NULL, updated_at = ? WHERE id = ?`,
        )
        .bind(
          row.start_at,
          row.end_at,
          Number(row.duration_minutes) || 120,
          Math.max(1, Number(row.crew_size) || 1),
          new Date().toISOString(),
          row.appointment_id,
        )
        .run();
    }
    await db
      .prepare(
        `UPDATE recurring_occurrences
         SET status = 'scheduled', calendar_event_id = ?, appointment_id = ?, resource_ids = ?, sync_error = ''
         WHERE id = ?`,
      )
      .bind(row.calendar_event_id, row.appointment_id, row.resource_ids, row.id)
      .run();
  }
  await db
    .prepare(
      `UPDATE recurring_plans SET frequency = ?, start_date = ?, window = ?, start_time = ?,
         duration_minutes = ?, first_duration_minutes = ?, crew_size = ?, next_visit_date = ?,
         sync_status = ?, sync_error = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(
      planBefore.frequency,
      planBefore.start_date,
      planBefore.window,
      planBefore.start_time,
      planBefore.duration_minutes,
      planBefore.first_duration_minutes,
      planBefore.crew_size,
      planBefore.next_visit_date ?? null,
      planBefore.sync_status ?? 'pending',
      planBefore.sync_error ?? '',
      new Date().toISOString(),
      planId,
    )
    .run();
  return { ok: errors.length === 0, errors };
}
