import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { calculateAvailability, type BookingResourceWindow, type ExistingJob } from '../src/lib/booking/availability.ts';
import { loadStaffResources } from '../src/lib/booking/resources.ts';
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
const DATE = addDays(todayCentral(), 7);
const ORIGIN = { lat: 30.4, lng: -87.2 };
const DESTINATION = { lat: 30.45, lng: -87.25 };

function resource(id: string, anchor: boolean, workdays = [0, 1, 2, 3, 4, 5, 6]): BookingResourceWindow {
  return { id, anchor, workdays, workdayStart: '07:00', workdayEnd: '18:00', origin: ORIGIN };
}

async function availability(
  resources: BookingResourceWindow[],
  options: { crewSize?: number; jobs?: ExistingJob[]; durationMinutes?: number } = {},
) {
  return calculateAvailability(
    {
      date: DATE,
      timeZone: 'America/Chicago',
      workdayStart: '07:00',
      workdayEnd: '18:00',
      workdays: [0, 1, 2, 3, 4, 5, 6],
      slotMinutes: 15,
      minimumNoticeHours: 0,
      maxAdvanceDays: 60,
      travelBufferMinutes: 15,
      jobBufferMinutes: 15,
      resources,
      crewSize: options.crewSize ?? 1,
      minimumJobMinutes: 60,
      maximumJobMinutes: 600,
      durationMinutes: options.durationMinutes ?? 120,
      destination: DESTINATION,
      jobs: options.jobs ?? [],
      now: new Date(),
      travelMinutes: async () => 0,
    },
    (date) => date.toISOString(),
  );
}

function at(time: string): Date {
  return zonedTimeToUtc(DATE, time, 'America/Chicago');
}
function job(start: string, end: string, resourceIds: string[]): ExistingJob {
  return { start: at(start), end: at(end), location: DESTINATION, resourceIds };
}

test('Hayli alone permits one independent booking and later availability remains', async () => {
  const hayli = resource('hayli', true);
  const result = await availability([hayli], { jobs: [job('07:00', '09:00', ['hayli'])] });
  assert.equal(result.available, true);
  assert.equal(result.slots.some((slot) => slot.start === at('07:00').toISOString()), false);
  assert.ok(result.slots.some((slot) => slot.start === at('09:30').toISOString()));
});

test('Hayli plus a helper still permits only one independent crew', async () => {
  const result = await availability(
    [resource('hayli', true), resource('helper-1', false)],
    { jobs: [job('07:00', '09:00', ['hayli'])] },
  );
  assert.equal(result.available, true);
  assert.equal(result.slots.some((slot) => slot.start === at('07:00').toISOString()), false);
  assert.ok(result.slots.some((slot) => slot.start === at('09:30').toISOString()));
});

test('two solo-qualified cleaners permit two simultaneous independent bookings', async () => {
  const result = await availability(
    [resource('hayli', true), resource('solo-2', true)],
    { jobs: [job('07:00', '09:00', ['hayli'])] },
  );
  const simultaneous = result.slots.find((slot) => slot.start === at('07:00').toISOString());
  assert.ok(simultaneous);
  assert.deepEqual(simultaneous.resourceIds, ['solo-2']);
});

test('a lead plus helper forms one crew and a two-person job consumes both', async () => {
  const lead = resource('lead-1', true);
  const helper = resource('helper-1', false);
  const pair = await availability([lead, helper], { crewSize: 2 });
  const first = pair.slots.find((slot) => slot.start === at('07:00').toISOString());
  assert.ok(first);
  assert.equal(first.resourceIds.length, 2);

  const next = await availability([lead, helper], {
    jobs: [job('07:00', '09:00', ['lead-1', 'helper-1'])],
  });
  assert.equal(next.slots.some((slot) => slot.start === at('07:00').toISOString()), false);
  assert.ok(next.slots.some((slot) => slot.start === at('09:30').toISOString()));
});

test('helpers cannot independently create a bookable slot', async () => {
  const single = await availability([resource('helper-1', false), resource('helper-2', false)]);
  assert.equal(single.available, false);
  assert.equal(single.slots.length, 0);
  const pair = await availability([resource('helper-1', false), resource('helper-2', false)], { crewSize: 2 });
  assert.equal(pair.available, false);
  assert.equal(pair.slots.length, 0);
});

test('morning bookings do not erase a valid afternoon appointment', async () => {
  const result = await availability([resource('hayli', true)], {
    jobs: [job('07:00', '11:00', ['hayli'])],
  });
  assert.ok(result.slots.some((slot) => slot.start === at('12:30').toISOString()));
});

test('the database roster drives qualifications, bookability and time off', async () => {
  const db = migratedDb();
  db.raw.prepare("UPDATE team_members SET is_bookable = 0 WHERE id = 'team_hayli'").run();
  db.raw.prepare(
    `INSERT INTO team_members
     (id, branch_id, display_name, email, status, is_bookable, booking_resource_id, is_solo, is_lead, workdays)
     VALUES ('team_solo', 'branch_pensacola', 'Second Solo', 'solo@example.test', 'active', 1, 'solo-2', 1, 0, '1,2,3,4,5')`,
  ).run();
  db.raw.prepare(
    `INSERT INTO team_members
     (id, branch_id, display_name, email, status, is_bookable, booking_resource_id, is_solo, is_lead)
     VALUES ('team_helper', 'branch_pensacola', 'Helper', 'helper@example.test', 'active', 1, 'helper-1', 0, 0)`,
  ).run();
  db.raw.prepare(
    `INSERT INTO team_members
     (id, branch_id, display_name, email, status, is_bookable, booking_resource_id, is_solo, is_lead)
     VALUES ('team_inactive', 'branch_pensacola', 'Inactive', 'inactive@example.test', 'inactive', 1, 'inactive-1', 1, 1)`,
  ).run();
  const roster = await loadStaffResources(db, DATE);
  assert.deepEqual(roster.map((member) => member.bookingResourceId).sort(), ['helper-1', 'solo-2']);
  assert.equal(roster.find((member) => member.bookingResourceId === 'solo-2')?.anchor, true);
  assert.equal(roster.find((member) => member.bookingResourceId === 'helper-1')?.anchor, false);

  db.raw.prepare(
    "INSERT INTO team_time_off (id, team_member_id, start_at, end_at, reason) VALUES ('off-1', 'team_solo', ?, ?, 'synthetic')",
  ).run(at('00:00').toISOString(), new Date(at('00:00').getTime() + 86_400_000).toISOString());
  const afterTimeOff = await loadStaffResources(db, DATE);
  assert.deepEqual(afterTimeOff.map((member) => member.bookingResourceId), ['helper-1']);
  const noAnchor = await availability(
    afterTimeOff.map((member) => resource(member.bookingResourceId, member.anchor)),
  );
  assert.equal(noAnchor.available, false);
});

test('an entirely inactive or unbookable roster yields zero capacity, never a fallback cleaner', async () => {
  const db = migratedDb();
  db.raw.prepare("UPDATE team_members SET status = 'inactive'").run();
  const roster = await loadStaffResources(db, DATE);
  assert.deepEqual(roster, []);
});
