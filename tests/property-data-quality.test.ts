import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { enrollOwner, type AdminActor } from '../src/lib/admin/operations.ts';
import {
  archiveDuplicateProperty,
  listPropertyQualityGroups,
  mergeDuplicateProperty,
} from '../src/lib/admin/property-data-quality.ts';

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
  async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const statement of statements) results.push(await statement.run() as D1Result<T>);
    return results;
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

async function ownerActor(db: TestD1): Promise<AdminActor> {
  const owner = await enrollOwner(db, {
    email: 'property-quality@example.test',
    name: 'Property Owner',
    password: 'SyntheticOwner!2026',
  });
  return {
    id: owner.id,
    email: owner.email,
    name: owner.name,
    role: 'owner',
    branchId: null,
    csrf: 'test-csrf',
    permissions: ['*'],
    mfaEnabled: false,
  };
}

test('normalized property variants are grouped and same-customer duplicates consolidate safely', async () => {
  const db = migratedDb();
  const actor = await ownerActor(db);
  db.raw.prepare("INSERT INTO customers (id, primary_branch_id, first_name, last_name, status) VALUES ('cust_q','branch_pensacola','Same','Customer','active')").run();
  db.raw.prepare("INSERT INTO properties (id, customer_id, branch_id, label, line1, city, state, postal_code, status) VALUES ('prop_a','cust_q','branch_pensacola','Service property','6360 Haupert Ln','Molino','FL','32577','active')").run();
  db.raw.prepare("INSERT INTO properties (id, customer_id, branch_id, label, line1, city, state, postal_code, status) VALUES ('prop_b','cust_q','branch_pensacola','Service property','6360 haupert lane','molino','FL','32577','active')").run();
  db.raw.prepare("INSERT INTO properties (id, customer_id, branch_id, label, line1, city, state, postal_code, status) VALUES ('prop_c','cust_q','branch_pensacola','Service property','6360 Haupert La','Molino','FL','32577','active')").run();
  db.raw.prepare("INSERT INTO leads (id, branch_id, customer_id, property_id, request_type, status, quote_reference) VALUES ('lead_q','branch_pensacola','cust_q','prop_a','residential_estimate','new','SS-Q')").run();

  const review = await listPropertyQualityGroups(db, actor);
  const group = review.groups.find((entry) => entry.rows.some((row) => row.id === 'prop_a'));
  assert.ok(group);
  assert.deepEqual(new Set(group!.rows.map((row) => row.id)), new Set(['prop_a', 'prop_b', 'prop_c']));
  assert.equal(group!.sameCustomer, true);

  await mergeDuplicateProperty(db, actor, 'prop_b', 'prop_a', 'Same normalized address');
  await mergeDuplicateProperty(db, actor, 'prop_c', 'prop_a', 'Same normalized address');
  const source = db.raw.prepare("SELECT status FROM properties WHERE id = 'prop_b'").get() as { status: string };
  assert.equal(source.status, 'archived');
  const lead = db.raw.prepare("SELECT property_id FROM leads WHERE id = 'lead_q'").get() as { property_id: string };
  assert.equal(lead.property_id, 'prop_a');
});

test('different customer associations are not merged and active jobs block archiving', async () => {
  const db = migratedDb();
  const actor = await ownerActor(db);
  db.raw.prepare("INSERT INTO customers (id, primary_branch_id, first_name, last_name, status) VALUES ('cust_a','branch_pensacola','First','Customer','active')").run();
  db.raw.prepare("INSERT INTO customers (id, primary_branch_id, first_name, last_name, status) VALUES ('cust_b','branch_pensacola','Second','Customer','active')").run();
  db.raw.prepare("INSERT INTO properties (id, customer_id, branch_id, label, line1, city, state, postal_code, status) VALUES ('prop_1','cust_a','branch_pensacola','HQ','10 Shared Way','Pensacola','FL','32502','active')").run();
  db.raw.prepare("INSERT INTO properties (id, customer_id, branch_id, label, line1, city, state, postal_code, status) VALUES ('prop_2','cust_b','branch_pensacola','HQ','10 Shared Way','Pensacola','FL','32502','active')").run();
  await assert.rejects(() => mergeDuplicateProperty(db, actor, 'prop_2', 'prop_1', ''), /property_customer_mismatch/i);

  db.raw.prepare("INSERT INTO appointments (id, branch_id, customer_id, property_id, status, start_at, end_at, duration_minutes, reference) VALUES ('appt_q','branch_pensacola','cust_b','prop_2','confirmed','2099-01-01T14:00:00.000Z','2099-01-01T16:00:00.000Z',120,'APPT-Q')").run();
  await assert.rejects(() => archiveDuplicateProperty(db, actor, 'prop_2', ''), /property_has_active_obligations/);
});
