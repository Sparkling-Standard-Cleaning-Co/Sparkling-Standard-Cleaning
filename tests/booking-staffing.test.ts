import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { refreshStaffingPendingState } from '../src/lib/booking/staffing.ts';

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
  db.raw.prepare(
    `INSERT INTO customers (id, primary_branch_id, first_name, last_name, status)
     VALUES ('cust_crew', 'branch_pensacola', 'Crew', 'Test', 'active')`,
  ).run();
  db.raw.prepare(
    `INSERT INTO properties (id, customer_id, branch_id, label, line1, city, state, postal_code)
     VALUES ('prop_crew', 'cust_crew', 'branch_pensacola', 'Home', '1 Test Way', 'Pensacola', 'FL', '32502')`,
  ).run();
  db.raw.prepare(
    `INSERT INTO appointments
     (id, branch_id, customer_id, property_id, status, start_at, end_at, duration_minutes,
      crew_size, staffing_pending, staffing_reason, reference)
     VALUES ('appt_crew', 'branch_pensacola', 'cust_crew', 'prop_crew', 'confirmed',
             '2026-12-10T20:30:00.000Z', '2026-12-10T23:45:00.000Z', 195,
             2, 1, 'Requires 2 cleaners', 'SS-20261210-CREW01')`,
  ).run();
  db.raw.prepare(
    `INSERT INTO team_members (id, branch_id, display_name, email, status, is_bookable, booking_resource_id)
     VALUES ('team_helper_crew', 'branch_pensacola', 'Helper Crew', 'helper@example.test', 'active', 1, 'helper-crew')`,
  ).run();
  return db;
}

test('staffing-pending clears only when the required crew is actually assigned', async () => {
  const db = migratedDb();
  db.raw.prepare(
    "INSERT INTO appointment_resources (appointment_id, team_member_id) VALUES ('appt_crew', 'team_hayli')",
  ).run();
  const first = await refreshStaffingPendingState(db, 'appt_crew');
  assert.equal(first.pending, true);
  assert.equal(first.requiredCrew, 2);
  assert.equal(first.assignedCrew, 1);

  db.raw.prepare(
    "INSERT INTO appointment_resources (appointment_id, team_member_id) VALUES ('appt_crew', 'team_helper_crew')",
  ).run();
  const resolved = await refreshStaffingPendingState(db, 'appt_crew');
  assert.equal(resolved.pending, false);
  assert.equal(resolved.assignedCrew, 2);
  const row = db.raw
    .prepare("SELECT staffing_pending, staffing_reason FROM appointments WHERE id = 'appt_crew'")
    .get() as { staffing_pending: number; staffing_reason: string };
  assert.equal(row.staffing_pending, 0);
  assert.equal(row.staffing_reason, '');
});
