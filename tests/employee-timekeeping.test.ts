import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { createOpsSession, enrollOwner, readOpsActor } from '../src/lib/admin/operations.ts';
import { createCustomer } from '../src/lib/admin/crm.ts';
import {
  centralDateKey,
  employeeJobWindow,
  formatMinutes,
  isMissingClockOut,
  summarizeIntervals,
  workweekBounds,
} from '../src/lib/employee/timekeeping.ts';
import { onRequestGet as employeeMe } from '../functions/api/employee/me.ts';
import { onRequestPost as employeeClock } from '../functions/api/employee/clock.ts';
import { onRequestPost as employeeCorrection } from '../functions/api/employee/correction.ts';
import { onRequestGet as adminTimekeepingGet, onRequestPost as adminTimekeepingPost } from '../functions/api/admin/timekeeping.ts';
import { onRequestGet as overviewGet } from '../functions/api/admin/overview.ts';
import { onRequestGet as adminRequestsGet } from '../functions/api/admin/requests.ts';

class SqlStatement implements D1PreparedStatement {
  private values: unknown[] = [];
  private readonly db: DatabaseSync;
  private readonly sql: string;
  constructor(db: DatabaseSync, sql: string) {
    this.db = db;
    this.sql = sql;
  }
  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values;
    return this;
  }
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
  prepare(query: string): D1PreparedStatement {
    return new SqlStatement(this.raw, query);
  }
}

function migratedDb(): TestD1 {
  const db = new TestD1();
  db.raw.exec('PRAGMA foreign_keys = ON');
  for (const file of fs.readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
    db.raw.exec(fs.readFileSync(path.join('migrations', file), 'utf8'));
  }
  return db;
}

function request(cookie = '', body?: unknown, csrf = ''): Request {
  return new Request('https://example.test/api/employee/me', {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function sessionFor(db: TestD1, userId: string): Promise<{ cookie: string; csrf: string }> {
  const session = await createOpsSession(db, userId, request());
  const actor = await readOpsActor(db, request(`ss_ops=${session.token}`));
  assert.ok(actor);
  return { cookie: `ss_ops=${session.token}`, csrf: actor.csrf };
}

function addEmployee(db: TestD1, email: string, role = 'cleaner'): { userId: string; teamMemberId: string } {
  const userId = `admin_${crypto.randomUUID()}`;
  const teamMemberId = `tm_${crypto.randomUUID()}`;
  db.raw
    .prepare(
      "INSERT INTO admin_users (id, role_id, email, password_hash, display_name, status) VALUES (?, ?, ?, 'x', ?, 'active')",
    )
    .run(userId, role, email, email.split('@')[0]);
  db.raw
    .prepare(
      "INSERT INTO team_members (id, branch_id, admin_user_id, display_name, email, status) VALUES (?, 'branch_pensacola', ?, ?, ?, 'active')",
    )
    .run(teamMemberId, userId, email.split('@')[0], email);
  return { userId, teamMemberId };
}

test('the Central-Time workweek is Monday to Monday and handles the DST change', () => {
  const before = workweekBounds(new Date('2026-10-30T12:00:00Z'));
  assert.equal(before.startDate, '2026-10-26');
  assert.equal(before.endDate, '2026-11-01');
  assert.equal(before.startIso, '2026-10-26T05:00:00.000Z');
  assert.equal(before.endIso, '2026-11-02T06:00:00.000Z');
  assert.equal(centralDateKey(new Date('2026-11-01T05:30:00Z')), '2026-11-01');
});

test('paid work, compensated rest breaks, unpaid meals and overtime are summarized correctly', () => {
  const now = new Date('2026-10-30T22:00:00Z');
  const totals = summarizeIntervals(
    [
      { kind: 'work', rate_type: 'regular', rate_cents: 1800, started_at: '2026-10-30T13:00:00Z', ended_at: '2026-10-30T15:00:00Z' },
      { kind: 'break', rate_type: 'regular', rate_cents: 1800, paid: 1, started_at: '2026-10-30T15:00:00Z', ended_at: '2026-10-30T15:15:00Z' },
      { kind: 'work', rate_type: 'regular', rate_cents: 1800, started_at: '2026-10-30T15:15:00Z', ended_at: '2026-10-30T17:00:00Z' },
      { kind: 'meal', rate_type: 'regular', rate_cents: 1800, paid: 0, started_at: '2026-10-30T17:00:00Z', ended_at: '2026-10-30T17:30:00Z' },
      { kind: 'work', rate_type: 'regular', rate_cents: 1800, started_at: '2026-10-30T17:30:00Z', ended_at: '2026-10-30T21:00:00Z' },
    ],
    now,
  );
  assert.equal(totals.workMinutes, 435);
  assert.equal(totals.breakMinutes, 15);
  assert.equal(totals.mealMinutes, 30);
  assert.equal(totals.paidMinutes, 450, 'rest breaks are paid; fully relieved meals are not');
  assert.equal(totals.grossCents, 13500);
  assert.equal(totals.overtimeMinutes, 0);

  const overtime = summarizeIntervals(
    [
      { kind: 'work', rate_type: 'lead', rate_cents: 2200, started_at: '2026-10-26T13:00:00Z', ended_at: '2026-10-26T21:00:00Z' },
      { kind: 'work', rate_type: 'lead', rate_cents: 2200, started_at: '2026-10-27T13:00:00Z', ended_at: '2026-10-29T05:00:00Z' },
    ],
    now,
  );
  assert.equal(overtime.overtimeMinutes, 480);
  assert.equal(formatMinutes(480), '8h 00m');
});

test('a long open work interval is flagged as a missing clock-out', () => {
  const now = new Date('2026-10-31T12:00:00Z');
  assert.equal(
    isMissingClockOut({ kind: 'work', started_at: '2026-10-30T12:00:00Z', ended_at: null }, now),
    true,
  );
  assert.equal(
    isMissingClockOut({ kind: 'work', started_at: '2026-10-31T06:00:00Z', ended_at: null }, now),
    false,
  );
});

test('an employee can clock work, a paid break, an unpaid meal and clock out', async () => {
  const db = migratedDb();
  const employee = addEmployee(db, 'cleaner@example.test');
  const session = await sessionFor(db, employee.userId);

  const clock = async (action: string, location: Record<string, unknown> = { status: 'captured', lat: 30.4, lng: -87.2, accuracy: 12 }) =>
    employeeClock({
      request: request(session.cookie, { action, location }, session.csrf),
      env: { DB: db },
    } as never);

  assert.equal((await clock('clock_in')).status, 200);
  assert.equal((await clock('start_break')).status, 200);
  assert.equal((await clock('end_break')).status, 200);
  assert.equal((await clock('start_meal')).status, 200);
  assert.equal((await clock('end_meal')).status, 200);
  assert.equal((await clock('clock_out')).status, 200);

  const intervals = db.raw
    .prepare('SELECT kind, paid, ended_at, status FROM time_intervals ORDER BY started_at')
    .all() as Array<{ kind: string; paid: number; ended_at: string | null; status: string }>;
  assert.deepEqual(intervals.map((interval) => interval.kind), ['work', 'break', 'work', 'meal', 'work']);
  assert.equal(intervals.find((interval) => interval.kind === 'break')?.paid, 1);
  assert.equal(intervals.find((interval) => interval.kind === 'meal')?.paid, 0);
  assert.ok(intervals.every((interval) => interval.ended_at !== null));

  const events = db.raw
    .prepare('SELECT action, location_status, lat FROM time_events ORDER BY occurred_at')
    .all() as Array<{ action: string; location_status: string; lat: number }>;
  assert.equal(events.length, 6);
  assert.ok(events.every((event) => event.location_status === 'captured'));
  assert.ok(events.every((event) => Number(event.lat) === 30.4));
});

test('denied location is recorded honestly and never blocks compensable time', async () => {
  const db = migratedDb();
  const employee = addEmployee(db, 'gps-denied@example.test');
  const session = await sessionFor(db, employee.userId);
  const response = await employeeClock({
    request: request(
      session.cookie,
      { action: 'clock_in', location: { status: 'denied', lat: null, lng: null } },
      session.csrf,
    ),
    env: { DB: db },
  } as never);
  assert.equal(response.status, 200);
  const event = db.raw.prepare('SELECT location_status, lat, lng FROM time_events').get() as {
    location_status: string;
    lat: number | null;
    lng: number | null;
  };
  assert.equal(event.location_status, 'denied');
  assert.equal(event.lat, null);
  assert.equal(event.lng, null);
  const interval = db.raw.prepare('SELECT kind, ended_at FROM time_intervals').get() as {
    kind: string;
    ended_at: string | null;
  };
  assert.equal(interval.kind, 'work');
  assert.equal(interval.ended_at, null);
});

test('the employee board shows only assigned jobs in the next three days', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'owner-board@example.test',
    name: 'Owner',
    password: 'SyntheticOwner!2026',
  });
  const ownerSession = await sessionFor(db, owner.id);
  const ownerActor = await readOpsActor(db, request(ownerSession.cookie));
  assert.ok(ownerActor);
  const employee = addEmployee(db, 'board@example.test');
  const other = addEmployee(db, 'other@example.test');
  const customer = await createCustomer(db, ownerActor!, {
    firstName: 'Board',
    lastName: 'Customer',
    addressLine1: '100 S Baylen St',
    city: 'Pensacola',
    state: 'FL',
    postalCode: '32502',
  });
  const property = db.raw.prepare("SELECT id FROM properties WHERE customer_id = ?").get(customer.id) as { id: string };
  const insertAppointment = db.raw.prepare(
    `INSERT INTO appointments
     (id, branch_id, customer_id, property_id, status, start_at, end_at, duration_minutes, crew_size, reference)
     VALUES (?, 'branch_pensacola', ?, ?, 'confirmed', ?, ?, 120, 1, ?)`,
  );
  const now = Date.now();
  const at = (offsetHours: number) => new Date(now + offsetHours * 3_600_000).toISOString();
  const ids = ['JOB-1', 'JOB-2', 'JOB-3', 'JOB-4'];
  ids.forEach((id, index) => {
    insertAppointment.run(id, customer.id, property.id, at([2, 26, 40, 120][index]!), at([4, 28, 42, 122][index]!), id);
    db.raw
      .prepare('INSERT INTO appointment_resources (appointment_id, team_member_id) VALUES (?, ?)')
      .run(id, index === 3 ? other.teamMemberId : employee.teamMemberId);
  });
  const session = await sessionFor(db, employee.userId);
  const response = await employeeMe({ request: request(session.cookie), env: { DB: db } } as never);
  assert.equal(response.status, 200);
  const data = (await response.json()) as Record<string, unknown>;
  const jobs = (data.jobs as Array<Record<string, unknown>>).map((job) => job.id);
  assert.deepEqual(jobs, ['JOB-1', 'JOB-2', 'JOB-3'], 'only the assigned three-day window is returned');
  assert.equal((data.profile as Record<string, unknown>).defaultRateType, 'regular');
});

test('managers can review timecards and cleaners cannot use the manager API', async () => {
  const db = migratedDb();
  const manager = addEmployee(db, 'manager@example.test', 'manager');
  const cleaner = addEmployee(db, 'cleaner-api@example.test');
  const managerSession = await sessionFor(db, manager.userId);
  const cleanerSession = await sessionFor(db, cleaner.userId);

  const denied = await adminTimekeepingGet({
    request: request(cleanerSession.cookie),
    env: { DB: db },
  } as never);
  assert.equal(denied.status, 403);

  const allowed = await adminTimekeepingGet({
    request: request(managerSession.cookie),
    env: { DB: db },
  } as never);
  assert.equal(allowed.status, 200);
  const payload = (await allowed.json()) as Record<string, unknown>;
  assert.ok(Array.isArray(payload.employees));

  const correction = await employeeCorrection({
    request: request(
      cleanerSession.cookie,
      { message: 'I forgot to clock out for lunch.' },
      cleanerSession.csrf,
    ),
    env: { DB: db },
  } as never);
  assert.equal(correction.status, 200);
  const correctionId = ((await correction.json()) as { id: string }).id;
  const review = await adminTimekeepingPost({
    request: request(
      managerSession.cookie,
      { action: 'review_correction', correctionId, approve: true },
      managerSession.csrf,
    ),
    env: { DB: db },
  } as never);
  assert.equal(review.status, 200);
  const row = db.raw.prepare('SELECT status FROM time_correction_requests WHERE id = ?').get(correctionId) as {
    status: string;
  };
  assert.equal(row.status, 'approved');
});


test('cleaners cannot read the owner dashboard or request customer data', async () => {
  const db = migratedDb();
  const employee = addEmployee(db, 'no-owner-access@example.test');
  const session = await sessionFor(db, employee.userId);
  const overview = await overviewGet({ request: request(session.cookie), env: { DB: db } } as never);
  assert.equal(overview.status, 403);
  const requests = await adminRequestsGet({ request: request(session.cookie), env: { DB: db } } as never);
  assert.equal(requests.status, 403);
  const times = await adminTimekeepingGet({ request: request(session.cookie), env: { DB: db } } as never);
  assert.equal(times.status, 403);
});
