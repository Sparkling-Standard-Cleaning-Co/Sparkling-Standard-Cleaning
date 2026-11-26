import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import {
  branchOperationalReadiness,
  listBranchSettings,
} from '../src/lib/branches/settings.ts';

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

function database(): TestD1 {
  const db = new TestD1();
  db.raw.exec('PRAGMA foreign_keys = ON');
  for (const file of fs.readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
    db.raw.exec(fs.readFileSync(path.join('migrations', file), 'utf8'));
  }
  return db;
}

test('Tampa readiness lists actionable blockers until staffing, calendar and identity are complete', async () => {
  const db = database();
  const settings = await listBranchSettings(db);
  const tampa = settings.find((branch) => branch.id === 'branch_tampa');
  assert.ok(tampa);
  const readiness = await branchOperationalReadiness(db, tampa);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.checklist.length > 0);
  assert.ok(readiness.checklist.some((item) => item.key === 'branch_staffing_missing'));
  assert.ok(readiness.checklist.some((item) => item.key === 'branch_calendar_missing'));
  assert.ok(readiness.checklist.some((item) => item.key === 'branch_timezone_mismatch' && item.status === 'complete'));
  assert.ok(readiness.blockers.includes('branch_staffing_missing'));
});

test('an active bookable Tampa employee clears the staffing blocker but not activation', async () => {
  const db = database();
  db.raw.prepare(
    "INSERT INTO team_members (id, branch_id, display_name, email, status, is_bookable, booking_resource_id) VALUES ('team_tampa', 'branch_tampa', 'Tampa Cleaner', 'tampa@example.test', 'active', 1, 'tampa-1')",
  ).run();
  const settings = await listBranchSettings(db);
  const tampa = settings.find((branch) => branch.id === 'branch_tampa');
  assert.ok(tampa);
  const readiness = await branchOperationalReadiness(db, tampa);
  assert.ok(!readiness.blockers.includes('branch_staffing_missing'));
  assert.equal(readiness.ready, false, 'other launch prerequisites remain outstanding');
});
