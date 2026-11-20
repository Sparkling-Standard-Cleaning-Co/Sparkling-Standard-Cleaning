import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import type { AdminActor } from '../src/lib/admin/operations.ts';
import { loadDispatchSettings, saveDispatchSettings } from '../src/lib/dispatch/repository.ts';
import { runDispatch, dispatchDashboard, approveDispatchRecommendation, addDispatchTimeOff } from '../src/lib/dispatch/service.ts';

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
    return {
      success: true,
      results: this.db.prepare(this.sql).all(...(this.values as never[])) as T[],
    };
  }
  async run(): Promise<D1Result> {
    const result = this.db.prepare(this.sql).run(...(this.values as never[]));
    return { success: true, meta: { changes: Number(result.changes) } } as D1Result;
  }
}

class TestD1 implements D1Database {
  readonly raw = new DatabaseSync(':memory:');
  prepare(query: string): D1PreparedStatement {
    return new SqlStatement(this.raw, query);
  }
  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    const results: D1Result[] = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

function migratedDb(): TestD1 {
  const db = new TestD1();
  db.raw.exec('PRAGMA foreign_keys = ON');
  const directory = path.join(process.cwd(), 'migrations');
  for (const file of fs.readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) {
    db.raw.exec(fs.readFileSync(path.join(directory, file), 'utf8'));
  }
  db.raw.prepare(
    "INSERT INTO admin_users (id, branch_id, role_id, email, password_hash, display_name, status) VALUES ('admin_owner', 'branch_pensacola', 'owner', 'owner@example.test', 'x', 'Owner', 'active')",
  ).run();
  return db;
}

const owner: AdminActor = {
  id: 'admin_owner',
  email: 'owner@example.test',
  name: 'Owner',
  role: 'owner',
  branchId: null,
  csrf: 'csrf-test',
  permissions: [],
  mfaEnabled: false,
};

const mapmapFetch = async (url: string | URL): Promise<Response> => {
  if (String(url).includes('/route/v1/')) {
    return new Response(JSON.stringify({ routes: [{ distance: 16093.44, duration: 1200 }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  throw new Error('unexpected fetch ' + String(url));
};

async function withMapmap<T>(run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = mapmapFetch as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function env() {
  return {
    DB: undefined,
    ROUTES_PROVIDER: 'mapmap',
    ROUTES_API_KEY: 'route_test',
    MAPMAP_BASE: 'https://api.mapmap.test',
    PUBLIC_SITE_URL: 'https://sparkling-standard.test',
  };
}

function addTeam(db: TestD1, input: { id: string; name: string; branch?: string; solo?: boolean; transport?: string; services?: string[]; origin?: [number, number]; maxWeeklyHours?: number; status?: string }): void {
  const [lat, lng] = input.origin ?? [30.42, -87.22];
  db.raw.prepare(
    `INSERT INTO team_members
     (id, branch_id, display_name, email, status, is_bookable, booking_resource_id, is_solo, is_lead,
      workdays, workday_start, workday_end, pay_rate_regular_cents, pay_rate_lead_cents, pay_rate_solo_cents,
      dispatch_services_json, dispatch_equipment_json, dispatch_transport_mode, dispatch_can_drive,
      dispatch_vehicle_seats, dispatch_can_transport_equipment, dispatch_max_weekly_hours,
      dispatch_overtime_approved, dispatch_origin_address, dispatch_origin_lat, dispatch_origin_lng)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, '0,1,2,3,4,5,6', '07:00', '18:00', 1800, 2200, 2500,
             ?, '["standard-kit"]', ?, 1, 3, 1, ?, 0, '100 Test Way', ?, ?)`,
  ).run(
    input.id,
    input.branch ?? 'branch_pensacola',
    input.name,
    input.name.toLowerCase().replace(/\s+/g, '.') + '@example.test',
    input.status ?? 'active',
    input.id,
    input.solo === false ? 0 : 1,
    input.solo === false ? 0 : 1,
    JSON.stringify(input.services ?? ['standard']),
    input.transport ?? 'independent',
    input.maxWeeklyHours ?? 40,
    lat,
    lng,
  );
}

function addJob(db: TestD1, input: { id: string; reference?: string; start?: string; end?: string; crewSize?: number; assigned?: string[]; status?: string }): void {
  const start = input.start ?? '2026-12-02T14:00:00.000Z';
  const end = input.end ?? '2026-12-02T16:00:00.000Z';
  db.raw.prepare(
    `INSERT INTO customers (id, primary_branch_id, first_name, last_name, status, source)
     VALUES ('cust_dispatch', 'branch_pensacola', 'Test', 'Customer', 'active', 'test')
     ON CONFLICT(id) DO NOTHING`,
  ).run();
  db.raw.prepare(
    `INSERT INTO properties (id, customer_id, branch_id, label, line1, city, state, postal_code, latitude, longitude, precision, is_primary, status)
     VALUES ('prop_dispatch', 'cust_dispatch', 'branch_pensacola', 'Home', '200 Service Lane', 'Pensacola', 'FL', '32502', 30.45, -87.25, 'exact', 1, 'active')
     ON CONFLICT(id) DO NOTHING`,
  ).run();
  db.raw.prepare(
    `INSERT INTO appointments
     (id, branch_id, customer_id, property_id, status, start_at, end_at, timezone, duration_minutes, crew_size, source, reference)
     VALUES (?, 'branch_pensacola', 'cust_dispatch', 'prop_dispatch', ?, ?, ?, 'America/Chicago', 120, ?, 'test', ?)`,
  ).run(input.id, input.status ?? 'confirmed', start, end, input.crewSize ?? 1, input.reference ?? input.id);
  for (const member of input.assigned ?? []) {
    db.raw.prepare("INSERT INTO appointment_resources (appointment_id, team_member_id, role) VALUES (?, ?, 'solo')").run(input.id, member);
  }
}

async function enableAuto(db: TestD1): Promise<void> {
  await saveDispatchSettings(db, 'branch_pensacola', owner.id, {
    mode: 'automatic_unassigned',
    autoAssignEnabled: true,
    reassignmentRecommendations: false,
    paused: false,
  });
}

test('automatic dispatch staffs an unassigned job and records an applied decision', async () => {
  const db = migratedDb();
  addTeam(db, { id: 'team_a', name: 'Avery' });
  addJob(db, { id: 'appt_auto', reference: 'DSP-1' });
  await enableAuto(db);
  const summary = await withMapmap(() => runDispatch({ ...env(), DB: db } as never, db, owner, { branchId: 'branch_pensacola', apply: true }));
  assert.equal(summary.scanned, 1);
  assert.equal(summary.assigned, 1);
  const assigned = db.raw.prepare('SELECT team_member_id FROM appointment_resources WHERE appointment_id = ?').all('appt_auto');
  assert.deepEqual(assigned.map((row) => row.team_member_id), ['team_a']);
  const appointment = db.raw.prepare('SELECT start_at, end_at FROM appointments WHERE id = ?').get('appt_auto');
  assert.equal(appointment?.start_at, '2026-12-02T14:00:00.000Z');
  assert.equal(appointment?.end_at, '2026-12-02T16:00:00.000Z');
  const decision = db.raw.prepare('SELECT status, calendar_status FROM dispatch_decisions WHERE appointment_id = ?').get('appt_auto');
  assert.equal(decision?.status, 'applied');
  assert.equal(decision?.calendar_status, 'synced');
});

test('a second run does not duplicate an existing assignment', async () => {
  const db = migratedDb();
  addTeam(db, { id: 'team_a', name: 'Avery' });
  addJob(db, { id: 'appt_auto', reference: 'DSP-2' });
  await enableAuto(db);
  await withMapmap(() => runDispatch({ ...env(), DB: db } as never, db, owner, { branchId: 'branch_pensacola', apply: true }));
  await withMapmap(() => runDispatch({ ...env(), DB: db } as never, db, owner, { branchId: 'branch_pensacola', apply: true }));
  const rows = db.raw.prepare('SELECT COUNT(*) AS count FROM appointment_resources WHERE appointment_id = ?').get('appt_auto');
  assert.equal(Number(rows?.count), 1);
});

test('simultaneous automatic runs cannot double assign through the branch lock', async () => {
  const db = migratedDb();
  addTeam(db, { id: 'team_a', name: 'Avery' });
  addJob(db, { id: 'appt_auto', reference: 'DSP-3' });
  await enableAuto(db);
  const results = await withMapmap(() => Promise.allSettled([
    runDispatch({ ...env(), DB: db } as never, db, owner, { branchId: 'branch_pensacola', apply: true }),
    runDispatch({ ...env(), DB: db } as never, db, owner, { branchId: 'branch_pensacola', apply: true }),
  ]));
  const fulfilled = results.filter((entry) => entry.status === 'fulfilled');
  assert.equal(fulfilled.length, 1);
  const rows = db.raw.prepare('SELECT COUNT(*) AS count FROM appointment_resources WHERE appointment_id = ?').get('appt_auto');
  assert.equal(Number(rows?.count), 1);
});

test('an already assigned job is not changed by automatic dispatch', async () => {
  const db = migratedDb();
  addTeam(db, { id: 'team_a', name: 'Avery' });
  addTeam(db, { id: 'team_b', name: 'Blake' });
  addJob(db, { id: 'appt_assigned', reference: 'DSP-4', assigned: ['team_b'] });
  await enableAuto(db);
  const summary = await withMapmap(() => runDispatch({ ...env(), DB: db } as never, db, owner, { branchId: 'branch_pensacola', apply: true }));
  assert.equal(summary.scanned, 0);
  const assigned = db.raw.prepare('SELECT team_member_id FROM appointment_resources WHERE appointment_id = ?').all('appt_assigned');
  assert.deepEqual(assigned.map((row) => row.team_member_id), ['team_b']);
});

test('automatic dispatch is refused while the emergency pause is active', async () => {
  const db = migratedDb();
  addTeam(db, { id: 'team_a', name: 'Avery' });
  addJob(db, { id: 'appt_auto', reference: 'DSP-5' });
  await enableAuto(db);
  await saveDispatchSettings(db, 'branch_pensacola', owner.id, { paused: true });
  await assert.rejects(
    withMapmap(() => runDispatch({ ...env(), DB: db } as never, db, owner, { branchId: 'branch_pensacola', apply: true })),
    /automatic_dispatch_paused/,
  );
  const assigned = db.raw.prepare('SELECT COUNT(*) AS count FROM appointment_resources WHERE appointment_id = ?').get('appt_auto');
  assert.equal(Number(assigned?.count), 0);
});

test('an unconfigured employee creates a coverage exception instead of an assignment', async () => {
  const db = migratedDb();
  addTeam(db, { id: 'team_a', name: 'Avery', transport: 'unknown', services: [] });
  addJob(db, { id: 'appt_auto', reference: 'DSP-6' });
  await enableAuto(db);
  const summary = await withMapmap(() => runDispatch({ ...env(), DB: db } as never, db, owner, { branchId: 'branch_pensacola', apply: true }));
  assert.equal(summary.assigned, 0);
  assert.equal(summary.exceptions, 1);
  const decision = db.raw.prepare('SELECT status FROM dispatch_decisions WHERE appointment_id = ?').get('appt_auto');
  assert.equal(decision?.status, 'blocked');
});

test('an existing assignment is only recommended for change and requires owner approval', async () => {
  const db = migratedDb();
  addTeam(db, { id: 'team_a', name: 'Avery' });
  addTeam(db, { id: 'team_b', name: 'Blake' });
  db.raw.prepare("UPDATE team_members SET pay_rate_solo_cents = 5000, pay_rate_lead_cents = 5000, pay_rate_regular_cents = 5000 WHERE id = 'team_b'").run();
  addJob(db, { id: 'appt_assigned', reference: 'DSP-REC', assigned: ['team_b'] });
  await enableAuto(db);
  await saveDispatchSettings(db, 'branch_pensacola', owner.id, { reassignmentRecommendations: true });
  await withMapmap(() => runDispatch({ ...env(), DB: db } as never, db, owner, { branchId: 'branch_pensacola', apply: true }));
  const before = db.raw.prepare('SELECT team_member_id FROM appointment_resources WHERE appointment_id = ?').all('appt_assigned');
  assert.deepEqual(before.map((row) => row.team_member_id), ['team_b']);
  const recommendation = db.raw.prepare("SELECT id, status FROM dispatch_decisions WHERE appointment_id = 'appt_assigned' AND kind = 'recommendation' LIMIT 1").get();
  assert.equal(recommendation?.status, 'proposed');
  await withMapmap(() => approveDispatchRecommendation({ ...env(), DB: db } as never, db, owner, { branchId: 'branch_pensacola', decisionId: String(recommendation?.id) }));
  const after = db.raw.prepare('SELECT team_member_id FROM appointment_resources WHERE appointment_id = ?').all('appt_assigned');
  assert.deepEqual(after.map((row) => row.team_member_id), ['team_a']);
});

test('temporary time off is stored in the branch timezone and blocks automatic staffing', async () => {
  const db = migratedDb();
  addTeam(db, { id: 'team_a', name: 'Avery' });
  addJob(db, { id: 'appt_auto', reference: 'DSP-OFF' });
  await enableAuto(db);
  await addDispatchTimeOff(db, owner, {
    memberId: 'team_a',
    from: '2026-12-02T07:00',
    to: '2026-12-02T18:00',
    reason: 'Synthetic absence',
  });
  const stored = db.raw.prepare('SELECT start_at, end_at FROM team_time_off WHERE team_member_id = ?').get('team_a');
  assert.equal(stored?.start_at, '2026-12-02T13:00:00.000Z');
  assert.equal(stored?.end_at, '2026-12-03T00:00:00.000Z');
  const summary = await withMapmap(() => runDispatch({ ...env(), DB: db } as never, db, owner, { branchId: 'branch_pensacola', apply: true }));
  assert.equal(summary.assigned, 0);
  assert.equal(summary.exceptions, 1);
});

test('the owner dashboard masks private origins from a non-owner actor', async () => {
  const db = migratedDb();
  addTeam(db, { id: 'team_a', name: 'Avery' });
  const manager: AdminActor = { ...owner, id: 'admin_manager', role: 'manager', branchId: 'branch_pensacola', permissions: ['booking.read'] };
  const dashboard = await dispatchDashboard(db, manager, 'branch_pensacola');
  const team = dashboard.team as Array<Record<string, unknown>>;
  assert.equal(team[0]?.originAddress, '');
  assert.equal(team[0]?.originLat, null);
  const ownDashboard = await dispatchDashboard(db, owner, 'branch_pensacola');
  const ownTeam = ownDashboard.team as Array<Record<string, unknown>>;
  assert.equal(ownTeam[0]?.originAddress, '100 Test Way');
});

test('the owner can enable automatic assignment but the default production setting is paused', async () => {
  const db = migratedDb();
  const settings = await loadDispatchSettings(db, 'branch_pensacola');
  assert.equal(settings.autoAssignEnabled, false);
  assert.equal(settings.paused, true);
  const updated = await saveDispatchSettings(db, 'branch_pensacola', owner.id, {
    mode: 'automatic_unassigned',
    autoAssignEnabled: true,
    paused: false,
  });
  assert.equal(updated.autoAssignEnabled, true);
  assert.equal(updated.paused, false);
  assert.equal(updated.mode, 'automatic_unassigned');
});
