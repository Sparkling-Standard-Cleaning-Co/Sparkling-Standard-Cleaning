import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { createOpsSession, enrollOwner, readOpsActor } from '../src/lib/admin/operations.ts';
import { createRecurring } from '../src/lib/admin/scheduling.ts';
import { applyRecurringScheduleChange, prepareRecurringScheduleChange, syncRecurringPlan, type RecurringDependencies } from '../src/lib/admin/recurring-schedule.ts';
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
  const files = fs.readdirSync('migrations').filter((file) => /^00(0[1-9]|1[0-9])_.*\.sql$/.test(file)).sort();
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
  assert.equal(f.db.raw.prepare('PRAGMA foreign_key_check').all().length, 0);
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
