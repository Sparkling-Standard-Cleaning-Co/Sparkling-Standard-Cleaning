import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { createOpsSession, enrollOwner, readOpsActor } from '../src/lib/admin/operations.ts';
import { createRecurring } from '../src/lib/admin/scheduling.ts';
import { applyRecurringScheduleChange, prepareRecurringScheduleChange, setRecurringStatus, syncRecurringPlan, updateRecurringOccurrence, type RecurringDependencies } from '../src/lib/admin/recurring-schedule.ts';
import { zonedTimeToUtc } from '../src/lib/booking/time.ts';

class SqlStatement implements D1PreparedStatement {
  private values: unknown[] = [];
  private readonly db: DatabaseSync;
  private readonly sql: string;
  constructor(db: DatabaseSync, sql: string) { this.db = db; this.sql = sql; }
  bind(...values: unknown[]): D1PreparedStatement { this.values = values; return this; }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...(this.values as never[])) as T | undefined) ?? null;
  }
  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return { success: true, results: this.db.prepare(this.sql).all(...(this.values as never[])) as T[] };
  }
  async run(): Promise<D1Result> {
    this.db.prepare(this.sql).run(...(this.values as never[]));
    return { success: true };
  }
}
class TestD1 implements D1Database {
  readonly raw = new DatabaseSync(':memory:');
  prepare(query: string): D1PreparedStatement { return new SqlStatement(this.raw, query); }
}
function migratedDb(): TestD1 {
  const db = new TestD1();
  db.raw.exec('PRAGMA foreign_keys = ON');
  const files = fs.readdirSync('migrations').filter((file) => /^\d{4}_.*\.sql$/.test(file)).sort();
  for (const file of files) db.raw.exec(fs.readFileSync(path.join('migrations', file), 'utf8'));
  return db;
}
function request(cookie = ''): Request {
  return new Request('https://example.test/api/admin/overview', { headers: cookie ? { Cookie: cookie } : {} });
}

function todayCentral(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function addDays(date: string, days: number): string {
  return new Date(Date.parse(date + 'T12:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);
}

async function fixture(startOffset = 55) {
  const db = migratedDb();
  const owner = await enrollOwner(db, { email: `lifecycle-${crypto.randomUUID()}@example.test`, name: 'Lifecycle Owner', password: 'SyntheticOwner!2026' });
  const session = await createOpsSession(db, owner.id, request());
  const actor = await readOpsActor(db, request(`ss_ops=${session.token}`));
  assert.ok(actor);
  const branch = db.raw.prepare("SELECT id FROM branches LIMIT 1").get() as { id: string } | undefined;
  const branchId = branch?.id ?? 'branch_lifecycle';
  if (!branch) db.raw.prepare("INSERT INTO branches (id, name, timezone, city, state, status) VALUES (?, 'Lifecycle', 'America/Chicago', 'Pensacola', 'FL', 'active')").run(branchId);
  const customerId = `cust_${crypto.randomUUID()}`;
  const propertyId = `prop_${crypto.randomUUID()}`;
  db.raw.prepare("INSERT INTO customers (id, primary_branch_id, first_name, last_name, status) VALUES (?, ?, 'Synthetic', 'Recurring', 'active')").run(customerId, branchId);
  db.raw.prepare("INSERT OR IGNORE INTO team_members (id, branch_id, display_name, email, status, is_bookable, booking_resource_id, is_solo, is_lead) VALUES ('team_family', ?, 'Family Cleaner', 'family@example.test', 'active', 1, 'family-cleaner', 0, 1)").run(branchId);
  db.raw.prepare("INSERT INTO properties (id, customer_id, branch_id, label, line1, city, state, postal_code, latitude, longitude, status) VALUES (?, ?, ?, 'Home', '100 S Baylen St', 'Pensacola', 'FL', '32502', 30.4111, -87.2164, 'active')").run(propertyId, customerId, branchId);
  return { db, actor: actor!, customerId, propertyId, startDate: addDays(todayCentral(), startOffset) };
}

function makeCalendar(
  resourceIds: string[],
  startTime = '07:00',
  conflictDates = new Set<string>(),
  failUpdateOnce = new Set<string>(),
) {
  const events = new Map<string, { id: string; reference: string; start: string; end: string; resourceIds: string[]; status: string }>();
  let creates = 0;
  let sequence = 0;
  const deps: Partial<RecurringDependencies> = {
    availability: (async (_env: unknown, input: { date: string; durationMinutes: number }) => {
      if (conflictDates.has(input.date)) return { ok: true, enabled: true, date: input.date, durationMinutes: input.durationMinutes, crewSize: 1, availability: { available: false, enabled: true, reason: 'fully_booked', slots: [] } };
      const start = zonedTimeToUtc(input.date, startTime, 'America/Chicago');
      const end = new Date(start.getTime() + input.durationMinutes * 60_000);
      return {
        ok: true, enabled: true, date: input.date,
        durationMinutes: input.durationMinutes, crewSize: 1,
        availability: {
          available: true, enabled: true,
          slots: [{ start: start.toISOString(), end: end.toISOString(), startLabel: '7:00 AM', endLabel: '9:00 AM', resourceIds }],
        },
      };
    }) as never,
    findEvent: (async (_env: unknown, reference: string) => {
      for (const event of events.values()) if (event.reference === reference) return event.id;
      return null;
    }) as never,
    getEvent: (async (_env: unknown, id: string) => events.get(id) ?? null) as never,
    inspectEvent: (async (_env: unknown, id: string) => {
      const event = events.get(id);
      return event ? { state: 'found', event } : { state: 'missing' };
    }) as never,
    updateEvent: (async (_env: unknown, id: string, patch: { start?: string; end?: string; resourceIds?: string[] }) => {
      const event = events.get(id);
      if (!event) return { ok: false, reason: 'calendar_unavailable' };
      if (failUpdateOnce.has(event.reference)) {
        failUpdateOnce.delete(event.reference);
        return { ok: false, reason: 'calendar_unavailable' };
      }
      if (patch.start) event.start = patch.start;
      if (patch.end) event.end = patch.end;
      if (patch.resourceIds) event.resourceIds = [...patch.resourceIds];
      return { ok: true };
    }) as never,
    createEvent: (async (_env: unknown, job: { reference: string; start: string; end: string; resourceIds: string[] }) => {
      creates += 1;
      sequence += 1;
      const id = `evt_synth_${sequence}`;
      events.set(id, { id, reference: job.reference, start: job.start, end: job.end, resourceIds: [...job.resourceIds], status: 'confirmed' });
      return { ok: true, eventId: id };
    }) as never,
    deleteEvent: (async (_env: unknown, id: string) => { events.delete(id); return { ok: true }; }) as never,
  };
  return { events, deps, creates: () => creates };
}

test('recurring sync creates a linked Google event and operational appointment', async () => {
  const f = await fixture();
  const plan = await createRecurring(f.db, f.actor, {
    customerId: f.customerId, propertyId: f.propertyId, frequency: 'monthly', startDate: f.startDate,
    window: 'morning', startTime: '07:00', durationMinutes: 120, crewSize: 1, ongoingPrice: 150,
  });
  const calendar = makeCalendar(['family-cleaner']);
  const result = await syncRecurringPlan({ GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'x', GOOGLE_REFRESH_TOKEN: 'x', GOOGLE_CALENDAR_ID: 'x' } as never, f.db, f.actor, plan.id, { deps: calendar.deps });
  assert.equal(result.ok, true);
  assert.equal(result.created, 1);
  assert.equal(calendar.events.size, 1);
  const event = [...calendar.events.values()][0]!;
  assert.deepEqual(event.resourceIds, ['family-cleaner']);
  assert.equal(event.start, zonedTimeToUtc(f.startDate, '07:00', 'America/Chicago').toISOString());
  assert.equal(event.end, new Date(Date.parse(event.start) + 120 * 60_000).toISOString());
  const appointment = f.db.raw.prepare('SELECT * FROM appointments WHERE recurring_plan_id = ?').get(plan.id) as Record<string, unknown>;
  assert.equal(appointment.status, 'confirmed');
  assert.equal(appointment.start_at, event.start);
  assert.equal(appointment.crew_size, 1);
  const occurrence = f.db.raw.prepare('SELECT * FROM recurring_occurrences WHERE plan_id = ?').get(plan.id) as Record<string, unknown>;
  assert.equal(occurrence.status, 'scheduled');
  assert.equal(occurrence.calendar_event_id, event.id);
  assert.equal(occurrence.appointment_id, appointment.id);
  assert.equal(occurrence.resource_ids, JSON.stringify(['family-cleaner']));
  const link = f.db.raw.prepare('SELECT * FROM calendar_links WHERE appointment_id = ?').get(appointment.id) as Record<string, unknown>;
  assert.equal(link.provider_event_id, event.id);
  const assigned = f.db.raw
    .prepare('SELECT team_member_id, role FROM appointment_resources WHERE appointment_id = ?')
    .all(appointment.id) as Array<{ team_member_id: string; role: string }>;
  assert.deepEqual(assigned.map((row) => ({ ...row })), [{ team_member_id: 'team_family', role: 'lead' }]);
  assert.equal(f.db.raw.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('recurring sync does not recreate an owner-cancelled occurrence', async () => {
  const f = await fixture();
  const plan = await createRecurring(f.db, f.actor, {
    customerId: f.customerId,
    propertyId: f.propertyId,
    frequency: 'monthly',
    startDate: f.startDate,
    window: 'morning',
    startTime: '07:00',
    durationMinutes: 120,
    crewSize: 1,
    ongoingPrice: 150,
  });
  const calendar = makeCalendar(['family-cleaner']);
  const env = { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'x', GOOGLE_REFRESH_TOKEN: 'x', GOOGLE_CALENDAR_ID: 'x' } as never;
  await syncRecurringPlan(env, f.db, f.actor, plan.id, { deps: calendar.deps });
  const occurrence = f.db.raw
    .prepare('SELECT id, calendar_event_id FROM recurring_occurrences WHERE plan_id = ?')
    .get(plan.id) as { id: string; calendar_event_id: string };
  f.db.raw.prepare("UPDATE recurring_occurrences SET status = 'cancelled' WHERE id = ?").run(occurrence.id);
  calendar.events.delete(occurrence.calendar_event_id);
  const before = calendar.creates();

  const result = await syncRecurringPlan(env, f.db, f.actor, plan.id, { deps: calendar.deps });
  assert.equal(result.ok, true);
  assert.equal(calendar.creates(), before, 'no replacement event is created');
  assert.equal(calendar.events.size, 0);
  const after = f.db.raw
    .prepare('SELECT status FROM recurring_occurrences WHERE id = ?')
    .get(occurrence.id) as { status: string };
  assert.equal(after.status, 'cancelled');
});
test('repeated recurring synchronization creates no duplicate bookings', async () => {
  const f = await fixture();
  const plan = await createRecurring(f.db, f.actor, {
    customerId: f.customerId, propertyId: f.propertyId, frequency: 'monthly', startDate: f.startDate,
    window: 'morning', startTime: '07:00', durationMinutes: 120, crewSize: 1, ongoingPrice: 150,
  });
  const calendar = makeCalendar(['family-cleaner']);
  const env = { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'x', GOOGLE_REFRESH_TOKEN: 'x', GOOGLE_CALENDAR_ID: 'x' } as never;
  await syncRecurringPlan(env, f.db, f.actor, plan.id, { deps: calendar.deps });
  const first = f.db.raw.prepare('SELECT id, start_at, end_at FROM appointments WHERE recurring_plan_id = ?').get(plan.id) as Record<string, unknown>;
  const result = await syncRecurringPlan(env, f.db, f.actor, plan.id, { deps: calendar.deps });
  assert.equal(result.ok, true);
  assert.equal(result.created, 0);
  assert.equal(result.skipped, 1);
  assert.equal(calendar.creates(), 1);
  assert.equal(calendar.events.size, 1);
  assert.equal((f.db.raw.prepare('SELECT COUNT(*) AS n FROM appointments WHERE recurring_plan_id = ?').get(plan.id) as { n: number }).n, 1);
  assert.equal((f.db.raw.prepare('SELECT COUNT(*) AS n FROM recurring_occurrences WHERE plan_id = ?').get(plan.id) as { n: number }).n, 1);
  assert.equal((f.db.raw.prepare('SELECT COUNT(*) AS n FROM calendar_links').get() as { n: number }).n, 1);
  const second = f.db.raw.prepare('SELECT id, start_at, end_at FROM appointments WHERE recurring_plan_id = ?').get(plan.id) as Record<string, unknown>;
  assert.deepEqual(second, first);
});

test('recurring sync persists the exact resource returned by availability', async () => {
  const f = await fixture();
  const plan = await createRecurring(f.db, f.actor, {
    customerId: f.customerId, propertyId: f.propertyId, frequency: 'monthly', startDate: f.startDate,
    window: 'morning', startTime: '07:00', durationMinutes: 120, crewSize: 1, ongoingPrice: 150,
  });
  const calendar = makeCalendar(['family-cleaner']);
  const result = await syncRecurringPlan({ GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'x', GOOGLE_REFRESH_TOKEN: 'x', GOOGLE_CALENDAR_ID: 'x' } as never, f.db, f.actor, plan.id, { deps: calendar.deps });
  assert.equal(result.ok, true);
  const event = [...calendar.events.values()][0]!;
  assert.equal(event.resourceIds.includes('hayli'), false);
  assert.deepEqual(event.resourceIds, ['family-cleaner']);
  const occurrence = f.db.raw.prepare('SELECT resource_ids FROM recurring_occurrences WHERE plan_id = ?').get(plan.id) as { resource_ids: string };
  assert.equal(occurrence.resource_ids, JSON.stringify(['family-cleaner']));
});

test('conflicting reschedule preserves the original confirmed booking', async () => {
  const f = await fixture();
  const plan = await createRecurring(f.db, f.actor, { customerId: f.customerId, propertyId: f.propertyId, frequency: 'monthly', startDate: f.startDate, window: 'morning', startTime: '07:00', durationMinutes: 120, crewSize: 1, ongoingPrice: 150 });
  const calendar = makeCalendar(['family-cleaner']);
  const env = { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'x', GOOGLE_REFRESH_TOKEN: 'x', GOOGLE_CALENDAR_ID: 'x' } as never;
  await syncRecurringPlan(env, f.db, f.actor, plan.id, { deps: calendar.deps });
  const originalEvent = [...calendar.events.values()][0]!;
  const originalAppointment = f.db.raw.prepare('SELECT id, start_at, end_at, status FROM appointments WHERE recurring_plan_id = ?').get(plan.id) as Record<string, unknown>;
  const conflictCalendar = makeCalendar(['family-cleaner'], '08:00', new Set([f.startDate]));
  const prepared = await prepareRecurringScheduleChange(env, f.db, f.actor, plan.id, { frequency: 'monthly', startDate: f.startDate, window: 'morning', startTime: '08:00', durationMinutes: 120, crewSize: 1 }, conflictCalendar.deps);
  assert.equal(prepared.ok, false);
  assert.equal(calendar.events.size, 1);
  assert.deepEqual([...calendar.events.values()][0], originalEvent);
  assert.deepEqual(f.db.raw.prepare('SELECT id, start_at, end_at, status FROM appointments WHERE recurring_plan_id = ?').get(plan.id), originalAppointment);
  assert.equal((f.db.raw.prepare('SELECT start_time FROM recurring_plans WHERE id = ?').get(plan.id) as { start_time: string }).start_time, '07:00');
});

test('valid reschedule updates plan, Google event and D1 appointment together', async () => {
  const f = await fixture();
  const plan = await createRecurring(f.db, f.actor, { customerId: f.customerId, propertyId: f.propertyId, frequency: 'monthly', startDate: f.startDate, window: 'morning', startTime: '07:00', durationMinutes: 120, crewSize: 1, ongoingPrice: 150 });
  const initial = makeCalendar(['family-cleaner']);
  const env = { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'x', GOOGLE_REFRESH_TOKEN: 'x', GOOGLE_CALENDAR_ID: 'x' } as never;
  await syncRecurringPlan(env, f.db, f.actor, plan.id, { deps: initial.deps });
  const replacement = makeCalendar(['family-cleaner'], '08:00');
  const applied = await applyRecurringScheduleChange(env, f.db, f.actor, plan.id, { frequency: 'monthly', startDate: f.startDate, window: 'morning', startTime: '08:00', durationMinutes: 120, crewSize: 1 }, { ...initial.deps, availability: replacement.deps.availability });
  assert.equal(applied.ok, true);
  assert.equal(applied.sync?.ok, true);
  assert.equal(initial.events.size, 1);
  const event = [...initial.events.values()][0]!;
  const appointment = f.db.raw.prepare('SELECT start_at, status FROM appointments WHERE recurring_plan_id = ?').get(plan.id) as { start_at: string; status: string };
  assert.equal(event.start, zonedTimeToUtc(f.startDate, '08:00', 'America/Chicago').toISOString());
  assert.equal(appointment.start_at, event.start);
  assert.equal(appointment.status, 'confirmed');
  assert.equal((f.db.raw.prepare('SELECT start_time FROM recurring_plans WHERE id = ?').get(plan.id) as { start_time: string }).start_time, '08:00');
});


test('a later-occurrence conflict preserves every original confirmed booking', async () => {
  const f = await fixture(7);
  const plan = await createRecurring(f.db, f.actor, {
    customerId: f.customerId, propertyId: f.propertyId, frequency: 'weekly', startDate: f.startDate,
    window: 'morning', startTime: '07:00', durationMinutes: 120, crewSize: 1, ongoingPrice: 150,
  });
  const env = { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'x', GOOGLE_REFRESH_TOKEN: 'x', GOOGLE_CALENDAR_ID: 'x' } as never;
  const initial = makeCalendar(['family-cleaner']);
  const created = await syncRecurringPlan(env, f.db, f.actor, plan.id, { deps: initial.deps });
  assert.equal(created.ok, true);
  assert.ok(created.created > 1);
  const originalEvents = [...initial.events.values()].map((event) => ({ ...event }));
  const originalAppointments = f.db.raw
    .prepare('SELECT id, start_at, end_at, status FROM appointments WHERE recurring_plan_id = ? ORDER BY start_at')
    .all(plan.id) as Array<Record<string, unknown>>;
  const laterDate = addDays(f.startDate, 21);
  const conflicting = makeCalendar(['family-cleaner'], '08:00', new Set([laterDate]));
  const prepared = await prepareRecurringScheduleChange(
    env, f.db, f.actor, plan.id,
    { frequency: 'weekly', startDate: f.startDate, window: 'morning', startTime: '08:00', durationMinutes: 120, crewSize: 1 },
    conflicting.deps,
  );
  assert.equal(prepared.ok, false);
  assert.ok(prepared.conflicts.some((conflict) => conflict.date === laterDate));
  assert.deepEqual([...initial.events.values()].map((event) => ({ ...event })), originalEvents);
  assert.deepEqual(
    f.db.raw.prepare('SELECT id, start_at, end_at, status FROM appointments WHERE recurring_plan_id = ? ORDER BY start_at').all(plan.id),
    originalAppointments,
  );
  assert.equal((f.db.raw.prepare('SELECT start_time FROM recurring_plans WHERE id = ?').get(plan.id) as { start_time: string }).start_time, '07:00');
});

test('a partial external failure rolls back to the original schedule without erasing bookings', async () => {
  const f = await fixture(7);
  const plan = await createRecurring(f.db, f.actor, {
    customerId: f.customerId, propertyId: f.propertyId, frequency: 'weekly', startDate: f.startDate,
    window: 'morning', startTime: '07:00', durationMinutes: 120, crewSize: 1, ongoingPrice: 150,
  });
  const env = { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'x', GOOGLE_REFRESH_TOKEN: 'x', GOOGLE_CALENDAR_ID: 'x' } as never;
  const failureDate = addDays(f.startDate, 21);
  const initial = makeCalendar(['family-cleaner'], '07:00', new Set(), new Set([`RECURRING-${plan.id}-${failureDate}`]));
  const created = await syncRecurringPlan(env, f.db, f.actor, plan.id, { deps: initial.deps });
  assert.equal(created.ok, true);
  const replacement = makeCalendar(['family-cleaner'], '08:00');
  const applied = await applyRecurringScheduleChange(
    env, f.db, f.actor, plan.id,
    { frequency: 'weekly', startDate: f.startDate, window: 'morning', startTime: '08:00', durationMinutes: 120, crewSize: 1 },
    { ...initial.deps, availability: replacement.deps.availability },
  );
  assert.equal(applied.ok, false);
  assert.equal(applied.rolledBack, true);
  assert.equal((f.db.raw.prepare('SELECT start_time FROM recurring_plans WHERE id = ?').get(plan.id) as { start_time: string }).start_time, '07:00');
  const expectedStart = zonedTimeToUtc(f.startDate, '07:00', 'America/Chicago').toISOString();
  const events = [...initial.events.values()];
  assert.ok(events.length > 1);
  assert.ok(events.every((event) => event.start === expectedStart || event.start > expectedStart));
  const appointments = f.db.raw
    .prepare('SELECT start_at, status FROM appointments WHERE recurring_plan_id = ?')
    .all(plan.id) as Array<{ start_at: string; status: string }>;
  assert.ok(appointments.length > 1);
  assert.ok(appointments.every((appointment) => appointment.status === 'confirmed'));
  const planRow = f.db.raw.prepare('SELECT sync_status FROM recurring_plans WHERE id = ?').get(plan.id) as { sync_status: string };
  assert.notEqual(planRow.sync_status, 'sync_failed');
});
test('an owner can skip or reschedule one recurring occurrence without touching the plan', async () => {
  const env = { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'x', GOOGLE_REFRESH_TOKEN: 'x', GOOGLE_CALENDAR_ID: 'x' } as never;
  const f = await fixture();
  const plan = await createRecurring(f.db, f.actor, {
    customerId: f.customerId, propertyId: f.propertyId, frequency: 'monthly', startDate: f.startDate,
    window: 'morning', startTime: '07:00', durationMinutes: 120, crewSize: 1, ongoingPrice: 150,
  });
  const calendar = makeCalendar(['family-cleaner']);
  await syncRecurringPlan(env, f.db, f.actor, plan.id, { deps: calendar.deps });
  const occurrence = f.db.raw
    .prepare("SELECT * FROM recurring_occurrences WHERE plan_id = ? AND status = 'scheduled' LIMIT 1")
    .get(plan.id) as Record<string, unknown>;
  const appointment = f.db.raw
    .prepare('SELECT * FROM appointments WHERE id = ?')
    .get(String(occurrence.appointment_id)) as Record<string, unknown>;

  const skipped = await updateRecurringOccurrence(env, f.db, f.actor, plan.id, String(occurrence.id), { action: 'skip' }, calendar.deps);
  assert.equal(skipped.ok, true);
  assert.equal(calendar.events.size, 0);
  assert.equal(
    (f.db.raw.prepare('SELECT status FROM recurring_occurrences WHERE id = ?').get(String(occurrence.id)) as { status: string }).status,
    'cancelled',
  );
  assert.equal(
    (f.db.raw.prepare('SELECT status FROM appointments WHERE id = ?').get(String(occurrence.appointment_id)) as { status: string }).status,
    'cancelled',
  );
  assert.equal(
    (f.db.raw.prepare('SELECT status FROM recurring_plans WHERE id = ?').get(plan.id) as { status: string }).status,
    'active',
  );

  const f2 = await fixture();
  const plan2 = await createRecurring(f2.db, f2.actor, {
    customerId: f2.customerId, propertyId: f2.propertyId, frequency: 'monthly', startDate: f2.startDate,
    window: 'morning', startTime: '07:00', durationMinutes: 120, crewSize: 1, ongoingPrice: 150,
  });
  const calendar2 = makeCalendar(['family-cleaner']);
  await syncRecurringPlan(env, f2.db, f2.actor, plan2.id, { deps: calendar2.deps });
  const occurrence2 = f2.db.raw
    .prepare("SELECT * FROM recurring_occurrences WHERE plan_id = ? AND status = 'scheduled' LIMIT 1")
    .get(plan2.id) as Record<string, unknown>;
  const newDate = addDays(String(occurrence2.occurrence_date), 2);
  const moved = await updateRecurringOccurrence(
    env,
    f2.db,
    f2.actor,
    plan2.id,
    String(occurrence2.id),
    { action: 'reschedule', date: newDate, startTime: '07:00' },
    calendar2.deps,
  );
  assert.equal(moved.ok, true);
  assert.equal(moved.occurrenceDate, newDate);
  assert.equal(
    (f2.db.raw.prepare('SELECT status FROM recurring_occurrences WHERE id = ?').get(String(occurrence2.id)) as { status: string }).status,
    'cancelled',
  );
  const movedRow = f2.db.raw
    .prepare("SELECT * FROM recurring_occurrences WHERE plan_id = ? AND occurrence_date = ?")
    .get(plan2.id, newDate) as Record<string, unknown>;
  assert.equal(movedRow.status, 'scheduled');
  const movedAppointment = f2.db.raw
    .prepare('SELECT * FROM appointments WHERE id = ?')
    .get(String(occurrence2.appointment_id)) as Record<string, unknown>;
  assert.equal(movedAppointment.start_at, zonedTimeToUtc(newDate, '07:00', 'America/Chicago').toISOString());
  assert.equal(
    (f2.db.raw.prepare('SELECT status FROM recurring_plans WHERE id = ?').get(plan2.id) as { status: string }).status,
    'active',
  );
});
test('pause, resume and cancel preserve the horizon without duplicates or owner-skip revival', async () => {
  const env = { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'x', GOOGLE_REFRESH_TOKEN: 'x', GOOGLE_CALENDAR_ID: 'x' } as never;
  const f = await fixture(1);
  const plan = await createRecurring(f.db, f.actor, {
    customerId: f.customerId, propertyId: f.propertyId, frequency: 'weekly', startDate: f.startDate,
    window: 'morning', startTime: '07:00', durationMinutes: 120, crewSize: 1, ongoingPrice: 150,
  });
  const calendar = makeCalendar(['family-cleaner']);
  await syncRecurringPlan(env, f.db, f.actor, plan.id, { deps: calendar.deps });
  const planned = f.db.raw
    .prepare("SELECT COUNT(*) AS n FROM recurring_occurrences WHERE plan_id = ? AND status = 'scheduled'")
    .get(plan.id) as { n: number };
  assert.ok(planned.n > 1, 'future occurrences were generated');
  assert.equal(calendar.events.size, planned.n);

  const paused = await setRecurringStatus(env, f.db, f.actor, plan.id, 'paused', calendar.deps);
  assert.equal(paused.ok, true);
  assert.equal(
    (f.db.raw.prepare("SELECT COUNT(*) AS n FROM recurring_occurrences WHERE plan_id = ? AND status = 'scheduled'").get(plan.id) as { n: number }).n,
    0,
  );
  assert.equal(calendar.events.size, 0, 'pause removed future calendar events');
  assert.equal(
    (f.db.raw.prepare('SELECT status FROM recurring_plans WHERE id = ?').get(plan.id) as { status: string }).status,
    'paused',
  );

  const resumed = await setRecurringStatus(env, f.db, f.actor, plan.id, 'active', calendar.deps);
  assert.equal(resumed.ok, true);
  const afterResume = f.db.raw
    .prepare("SELECT COUNT(*) AS n FROM recurring_occurrences WHERE plan_id = ? AND status = 'scheduled'")
    .get(plan.id) as { n: number };
  assert.equal(afterResume.n, planned.n, 'resume recreated the same horizon without duplicates');
  assert.equal(calendar.events.size, planned.n);
  assert.equal(
    (f.db.raw.prepare('SELECT status FROM recurring_plans WHERE id = ?').get(plan.id) as { status: string }).status,
    'active',
  );

  const skipTarget = f.db.raw
    .prepare("SELECT id FROM recurring_occurrences WHERE plan_id = ? AND status = 'scheduled' ORDER BY occurrence_date LIMIT 1")
    .get(plan.id) as { id: string };
  await updateRecurringOccurrence(env, f.db, f.actor, plan.id, skipTarget.id, { action: 'skip' }, calendar.deps);
  await setRecurringStatus(env, f.db, f.actor, plan.id, 'paused', calendar.deps);
  await setRecurringStatus(env, f.db, f.actor, plan.id, 'active', calendar.deps);
  assert.equal(
    (f.db.raw.prepare('SELECT status FROM recurring_occurrences WHERE id = ?').get(skipTarget.id) as { status: string }).status,
    'cancelled',
    'an owner-skipped occurrence is never revived by pause/resume',
  );
  assert.equal(
    (f.db.raw.prepare("SELECT COUNT(*) AS n FROM recurring_occurrences WHERE plan_id = ? AND status = 'scheduled'").get(plan.id) as { n: number }).n,
    planned.n - 1,
  );

  const cancelled = await setRecurringStatus(env, f.db, f.actor, plan.id, 'cancelled', calendar.deps);
  assert.equal(cancelled.ok, true);
  assert.equal(
    (f.db.raw.prepare("SELECT COUNT(*) AS n FROM recurring_occurrences WHERE plan_id = ? AND status = 'scheduled'").get(plan.id) as { n: number }).n,
    0,
  );
  assert.equal(calendar.events.size, 0);
  assert.equal(
    (f.db.raw.prepare('SELECT status FROM recurring_plans WHERE id = ?').get(plan.id) as { status: string }).status,
    'cancelled',
  );
});
test('a property without saved coordinates is geocoded before recurring scheduling', async () => {
  const env = { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'x', GOOGLE_REFRESH_TOKEN: 'x', GOOGLE_CALENDAR_ID: 'x' } as never;
  const f = await fixture(1);
  f.db.raw.prepare('UPDATE properties SET latitude = NULL, longitude = NULL WHERE id = ?').run(f.propertyId);
  const plan = await createRecurring(f.db, f.actor, {
    customerId: f.customerId, propertyId: f.propertyId, frequency: 'biweekly', startDate: f.startDate,
    window: 'morning', startTime: '08:30', durationMinutes: 270, crewSize: 1, ongoingPrice: 120,
  });
  const calendar = makeCalendar(['family-cleaner'], '08:30');
  const geocoded = {
    label: '228 Promenade Ln, Cantonment, FL 32533',
    lat: 30.5822045,
    lng: -87.3244645,
    source: 'census' as const,
    zip: '32533',
    state: 'FL',
    precise: true,
  };
  const result = await syncRecurringPlan(env, f.db, f.actor, plan.id, {
    deps: { ...calendar.deps, geocode: (async () => geocoded) as never },
  });
  assert.equal(result.ok, true);
  assert.ok(result.created > 0);
  assert.ok(calendar.events.size > 0);
  const occurrence = f.db.raw
    .prepare("SELECT status, occurrence_date FROM recurring_occurrences WHERE plan_id = ? AND status = 'scheduled' LIMIT 1")
    .get(plan.id) as { status: string; occurrence_date: string };
  assert.equal(occurrence.status, 'scheduled');

  const f2 = await fixture(1);
  f2.db.raw.prepare('UPDATE properties SET latitude = NULL, longitude = NULL WHERE id = ?').run(f2.propertyId);
  const plan2 = await createRecurring(f2.db, f2.actor, {
    customerId: f2.customerId, propertyId: f2.propertyId, frequency: 'weekly', startDate: f2.startDate,
    window: 'morning', startTime: '08:30', durationMinutes: 270, crewSize: 1, ongoingPrice: 120,
  });
  const prepared = await prepareRecurringScheduleChange(
    env,
    f2.db,
    f2.actor,
    plan2.id,
    {},
    { geocode: (async () => null) as never },
  );
  assert.equal(prepared.ok, false);
  assert.equal(prepared.conflicts[0]?.reason, 'property_location_missing');
});
test('a partially scheduled plan records its conflict and a retry fills only the missing date', async () => {
  const env = { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'x', GOOGLE_REFRESH_TOKEN: 'x', GOOGLE_CALENDAR_ID: 'x' } as never;
  const f = await fixture(1);
  const plan = await createRecurring(f.db, f.actor, {
    customerId: f.customerId, propertyId: f.propertyId, frequency: 'biweekly', startDate: f.startDate,
    window: 'morning', startTime: '07:00', durationMinutes: 120, crewSize: 1, ongoingPrice: 120,
  });
  const conflicts = new Set([f.startDate]);
  const calendar = makeCalendar(['family-cleaner'], '07:00', conflicts);
  const partial = await syncRecurringPlan(env, f.db, f.actor, plan.id, { deps: calendar.deps });
  assert.equal(partial.ok, false);
  assert.equal(partial.status, 'partially_scheduled');
  assert.ok(partial.conflicts.some((conflict) => conflict.date === f.startDate && conflict.reason === 'slot_unavailable'));
  const stored = f.db.raw.prepare('SELECT sync_status, sync_error FROM recurring_plans WHERE id = ?').get(plan.id) as {
    sync_status: string;
    sync_error: string;
  };
  assert.equal(stored.sync_status, 'partially_scheduled');
  assert.match(stored.sync_error, new RegExp(`${f.startDate}:slot_unavailable`));
  const before = f.db.raw.prepare("SELECT COUNT(*) AS n FROM recurring_occurrences WHERE plan_id = ? AND status = 'scheduled'").get(plan.id) as { n: number };

  conflicts.delete(f.startDate);
  const retried = await syncRecurringPlan(env, f.db, f.actor, plan.id, { deps: calendar.deps });
  assert.equal(retried.ok, true);
  assert.equal(retried.status, 'fully_scheduled');
  const after = f.db.raw.prepare("SELECT COUNT(*) AS n FROM recurring_occurrences WHERE plan_id = ? AND status = 'scheduled'").get(plan.id) as { n: number };
  assert.equal(after.n, before.n + 1, 'retry creates exactly the missing occurrence');
  assert.equal(
    (f.db.raw.prepare('SELECT sync_error FROM recurring_plans WHERE id = ?').get(plan.id) as { sync_error: string }).sync_error,
    '',
  );
});
