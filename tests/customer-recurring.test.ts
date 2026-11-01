import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { commitConfirmedBooking, type CommitmentDependencies } from '../src/lib/booking/commitment.ts';
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
  for (const file of fs.readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
    db.raw.exec(fs.readFileSync(path.join('migrations', file), 'utf8'));
  }
  return db;
}
function addDays(date: string, days: number): string {
  return new Date(Date.parse(date + 'T12:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);
}
function todayCentral(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function at(date: string, time: string): string {
  return zonedTimeToUtc(date, time, 'America/Chicago').toISOString();
}

function makeCalendar(conflictDates = new Set<string>(), startTime = '07:00') {
  const events = new Map<string, { id: string; reference: string; start: string; end: string; resourceIds: string[]; status: string }>();
  let sequence = 0;
  const deps: Partial<CommitmentDependencies> = {
    availability: (async (_env: unknown, input: { date: string; durationMinutes: number; crewSize?: number }) => {
      if (conflictDates.has(input.date)) {
        return {
          ok: true, enabled: true, date: input.date, durationMinutes: input.durationMinutes,
          crewSize: input.crewSize ?? 1,
          availability: { available: false, enabled: true, reason: 'fully_booked', slots: [] },
        };
      }
      const start = zonedTimeToUtc(input.date, startTime, 'America/Chicago');
      const end = new Date(start.getTime() + input.durationMinutes * 60_000);
      return {
        ok: true, enabled: true, date: input.date, durationMinutes: input.durationMinutes,
        crewSize: input.crewSize ?? 1,
        availability: {
          available: true, enabled: true,
          slots: [{ start: start.toISOString(), end: end.toISOString(), startLabel: '7:00 AM', endLabel: '10:00 AM', resourceIds: ['hayli'] }],
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
    createEvent: (async (_env: unknown, job: { reference: string; start: string; end: string; resourceIds: string[] }) => {
      sequence += 1;
      const id = `evt_${sequence}`;
      events.set(id, { id, reference: job.reference, start: job.start, end: job.end, resourceIds: [...job.resourceIds], status: 'confirmed' });
      return { ok: true, eventId: id };
    }) as never,
    updateEvent: (async (_env: unknown, id: string, patch: { start?: string; end?: string; resourceIds?: string[] }) => {
      const event = events.get(id);
      if (!event) return { ok: false, reason: 'calendar_unavailable' };
      if (patch.start) event.start = patch.start;
      if (patch.end) event.end = patch.end;
      if (patch.resourceIds) event.resourceIds = [...patch.resourceIds];
      return { ok: true };
    }) as never,
    deleteEvent: (async (_env: unknown, id: string) => { events.delete(id); return { ok: true }; }) as never,
  };
  return { events, deps };
}

async function fixture(conflictDates = new Set<string>()) {
  const db = migratedDb();
  const customerId = `cust_${crypto.randomUUID()}`;
  const propertyId = `prop_${crypto.randomUUID()}`;
  db.raw.prepare("INSERT INTO customers (id, primary_branch_id, first_name, last_name, status) VALUES (?, 'branch_pensacola', 'Paid', 'Customer', 'active')").run(customerId);
  db.raw.prepare("INSERT INTO properties (id, customer_id, branch_id, label, line1, city, state, postal_code, latitude, longitude, status) VALUES (?, ?, 'branch_pensacola', 'Home', '10 Test Street', 'Pensacola', 'FL', '32502', 30.4111, -87.2164, 'active')").run(propertyId, customerId);
  const startDate = addDays(todayCentral(), 7);
  const reference = `SS-${startDate.replaceAll('-', '')}-ABC123`;
  const start = at(startDate, '07:00');
  const end = new Date(Date.parse(start) + 180 * 60_000).toISOString();
  const requestId = `req_${crypto.randomUUID()}`;
  db.raw.prepare(
    `INSERT INTO booking_requests
     (id, hold_id, branch_id, customer_id, property_id, status, quote_reference, requested_date,
      start_at, end_at, duration_minutes, payload_json)
     VALUES (?, ?, 'branch_pensacola', ?, ?, 'pending', ?, ?, ?, ?, 180, ?)`,
  ).run(
    requestId,
    `hold_${crypto.randomUUID()}`,
    customerId,
    propertyId,
    reference,
    startDate,
    start,
    end,
    JSON.stringify({
      name: 'Paid Customer',
      email: 'paid-customer@example.test',
      service_type: 'residential-cleaning',
      frequency: 'biweekly',
      ongoing_frequency: 'biweekly',
      ongoing_price_per_visit: '120',
      terms_version: '2026-11-01.test',
      service_address: '10 Test Street',
      address_city: 'Pensacola',
      address_state: 'FL',
      zip: '32502',
      pin_latitude: '30.4111',
      pin_longitude: '-87.2164',
      booking_slot_start: start,
      booking_slot_end: end,
    }),
  );
  const calendar = makeCalendar(conflictDates);
  return { db, customerId, propertyId, reference, startDate, start, end, calendar };
}

test('a verified paid recurring booking creates one plan and future confirmed occurrences', async () => {
  const f = await fixture();
  const env = { DB: f.db } as never;
  const committed = await commitConfirmedBooking(
    env,
    f.db,
    {
      reference: f.reference,
      customerId: f.customerId,
      propertyId: f.propertyId,
      ongoingDurationMinutes: 120,
    },
    f.calendar.deps,
  );
  assert.equal(committed.ok, true);
  assert.ok(committed.planId);
  assert.equal(committed.recurringStatus, 'fully_scheduled');
  const plan = f.db.raw.prepare('SELECT * FROM recurring_plans WHERE id = ?').get(committed.planId!) as Record<string, unknown>;
  assert.equal(plan.frequency, 'biweekly');
  assert.equal(plan.status, 'active');
  assert.equal(plan.ongoing_price_cents, 12000);
  assert.equal(plan.duration_minutes, 120);
  assert.equal(plan.first_duration_minutes, 180);
  assert.equal(plan.booking_reference, f.reference);
  assert.equal(plan.sync_status, 'fully_scheduled');
  const first = f.db.raw.prepare('SELECT * FROM appointments WHERE reference = ?').get(f.reference) as Record<string, unknown>;
  assert.equal(first.status, 'confirmed');
  assert.equal(first.start_at, f.start);
  assert.equal(first.duration_minutes, 180);
  const occurrences = f.db.raw.prepare('SELECT * FROM recurring_occurrences WHERE plan_id = ? ORDER BY occurrence_date').all(committed.planId!) as Array<Record<string, unknown>>;
  assert.ok(occurrences.length > 1);
  assert.ok(occurrences.every((row) => row.status === 'scheduled'));
  assert.ok(occurrences.every((row) => row.resource_ids === JSON.stringify(['hayli'])));
  assert.equal(f.calendar.events.size, occurrences.length);
  assert.equal((f.db.raw.prepare('SELECT COUNT(*) AS n FROM payments').get() as { n: number }).n, 0);

  const repeated = await commitConfirmedBooking(
    env,
    f.db,
    { reference: f.reference, customerId: f.customerId, propertyId: f.propertyId },
    f.calendar.deps,
  );
  assert.equal(repeated.ok, true);
  assert.equal((f.db.raw.prepare('SELECT COUNT(*) AS n FROM recurring_plans').get() as { n: number }).n, 1);
  assert.equal((f.db.raw.prepare('SELECT COUNT(*) AS n FROM appointments WHERE reference = ?').get(f.reference) as { n: number }).n, 1);
  assert.equal(f.calendar.events.size, occurrences.length);
});

test('a future recurring conflict is reported honestly while the paid first visit is confirmed', async () => {
  const f = await fixture();
  const laterConflict = addDays(f.startDate, 14);
  f.calendar = makeCalendar(new Set([laterConflict]));
  const committed = await commitConfirmedBooking(
    { DB: f.db } as never,
    f.db,
    {
      reference: f.reference,
      customerId: f.customerId,
      propertyId: f.propertyId,
      ongoingDurationMinutes: 120,
    },
    f.calendar.deps,
  );
  assert.equal(committed.ok, true);
  assert.ok(committed.planId);
  assert.ok((committed.recurringConflicts ?? 0) > 0);
  assert.notEqual(committed.recurringStatus, 'fully_scheduled');
  const first = f.db.raw.prepare('SELECT status FROM appointments WHERE reference = ?').get(f.reference) as { status: string };
  assert.equal(first.status, 'confirmed');
  const plan = f.db.raw.prepare('SELECT sync_status FROM recurring_plans WHERE id = ?').get(committed.planId!) as { sync_status: string };
  assert.equal(plan.sync_status, 'partially_scheduled');
});
