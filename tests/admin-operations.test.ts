import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import {
  formatDurationHours,
  formatDurationMinutes,
  formatLaborAndSite,
  roundHoursToIncrement,
  roundMinutesToIncrement,
} from '../src/lib/format/duration.ts';
import { applyAlertAction, readAlertStates } from '../src/lib/admin/operational-alerts.ts';
import { listCustomers } from '../src/lib/admin/crm.ts';

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

const owner = {
  id: 'admin_test_owner',
  email: 'owner@example.test',
  name: 'Owner',
  role: 'owner',
  branchId: null,
  csrf: 'csrf-test',
  permissions: ['*'],
  mfaEnabled: true,
};

test('duration presentation rounds to the 15-minute grid and never leaks floating-point artifacts', () => {
  assert.equal(roundMinutesToIncrement(420), 420);
  assert.equal(roundHoursToIncrement(6.99732), 7);
  assert.equal(formatDurationHours(6.99732), '7 hours');
  assert.equal(formatDurationHours(4.12), '4 hours');
  assert.equal(formatDurationHours(4.18), '4 hours 15 minutes');
  assert.equal(formatDurationHours(5.63), '5 hours 45 minutes');
  assert.equal(formatDurationMinutes(420), '7 hours');
  assert.equal(formatLaborAndSite(6.99732, 420), 'Estimated labor: 7 hours · Expected time on site: 7 hours');
});

test('operational alert lifecycle records acknowledgement and resolution with a note', async () => {
  const db = migratedDb();
  db.raw
    .prepare(
      "INSERT INTO admin_users (id, role_id, email, password_hash, display_name, status) VALUES (?, 'owner', 'owner@example.test', 'synthetic', 'Owner', 'active')",
    )
    .run(owner.id);
  await applyAlertAction(db, owner, {
    alertKey: 'requests.pending',
    action: 'acknowledge',
    title: 'Pending requests',
    kind: 'pending_requests',
  });
  let states = await readAlertStates(db, ['requests.pending']);
  assert.equal(states.get('requests.pending')?.status, 'acknowledged');
  await applyAlertAction(db, owner, {
    alertKey: 'requests.pending',
    action: 'resolve',
    note: 'Archived 12 internal test requests and confirmed the remaining customer request.',
    title: 'Pending requests',
    kind: 'pending_requests',
  });
  states = await readAlertStates(db, ['requests.pending']);
  assert.equal(states.get('requests.pending')?.status, 'resolved');
  assert.match(states.get('requests.pending')?.resolution_note ?? '', /Archived 12/);
  await applyAlertAction(db, owner, {
    alertKey: 'requests.pending',
    action: 'reopen',
    title: 'Pending requests',
    kind: 'pending_requests',
  });
  states = await readAlertStates(db, ['requests.pending']);
  assert.equal(states.get('requests.pending')?.status, 'new');
});

test('deleted customers are excluded from active lists and available through the deleted view', async () => {
  const db = migratedDb();
  db.raw.prepare("INSERT INTO branches (id, name, state, status) VALUES ('branch_test', 'Test', 'FL', 'active')").run();
  db.raw
    .prepare("INSERT INTO customers (id, primary_branch_id, first_name, last_name, status, source) VALUES ('cust_active', 'branch_test', 'Active', 'Customer', 'active', '')")
    .run();
  db.raw
    .prepare("INSERT INTO customers (id, primary_branch_id, first_name, last_name, status, source, archived_at) VALUES ('cust_deleted', 'branch_test', 'Deleted', 'Customer', 'archived', '', '2026-11-20T00:00:00.000Z')")
    .run();
  const active = await listCustomers(db, owner, { status: 'active', limit: 25, offset: 0 });
  assert.equal(active.some((row) => row.id === 'cust_deleted'), false);
  const deleted = await listCustomers(db, owner, { status: 'deleted', limit: 25, offset: 0 });
  assert.equal(deleted.some((row) => row.id === 'cust_deleted'), true);
  assert.equal(deleted.some((row) => row.id === 'cust_active'), false);
});
