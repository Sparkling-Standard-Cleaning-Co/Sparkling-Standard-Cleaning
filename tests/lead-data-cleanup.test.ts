import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { enrollOwner, type AdminActor } from '../src/lib/admin/operations.ts';
import { findCustomerByContact, findCustomerProperty } from '../src/lib/customers/identity.ts';
import {
  archiveLead,
  deleteDisposableLead,
  listLeads,
  markLeadTest,
  previewSuspectedTestLeads,
  restoreLead,
} from '../src/lib/admin/crm.ts';

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

async function ownerActor(db: TestD1, email: string): Promise<AdminActor> {
  const owner = await enrollOwner(db, {
    email,
    name: 'Cleanup Owner',
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

test('linked inquiries archive and restore without deleting customer history', async () => {
  const db = migratedDb();
  const actor = await ownerActor(db, 'archive-linked@example.test');
  db.raw.prepare("INSERT INTO customers (id, primary_branch_id, first_name, last_name, status) VALUES ('cust_1','branch_pensacola','Linked','Customer','active')").run();
  db.raw.prepare("INSERT INTO leads (id, branch_id, customer_id, request_type, status, quote_reference, payload_json) VALUES ('lead_1','branch_pensacola','cust_1','reservation_request','contacted','SS-1','{}')").run();

  await archiveLead(db, actor, 'lead_1');
  const archived = db.raw.prepare("SELECT status, previous_status FROM leads WHERE id = 'lead_1'").get() as { status: string; previous_status: string };
  assert.equal(archived.status, 'archived');
  assert.equal(archived.previous_status, 'contacted');

  await restoreLead(db, actor, 'lead_1');
  const restored = db.raw.prepare("SELECT status, archived_at FROM leads WHERE id = 'lead_1'").get() as { status: string; archived_at: string | null };
  assert.equal(restored.status, 'contacted');
  assert.equal(restored.archived_at, null);
  assert.equal((db.raw.prepare("SELECT COUNT(*) AS n FROM customers WHERE id = 'cust_1'").get() as { n: number }).n, 1);
});

test('ordinary linked inquiries cannot be permanently deleted, but classified tests can', async () => {
  const db = migratedDb();
  const actor = await ownerActor(db, 'delete-linked@example.test');
  db.raw.prepare("INSERT INTO customers (id, primary_branch_id, first_name, last_name, status) VALUES ('cust_2','branch_pensacola','Linked','Customer','active')").run();
  db.raw.prepare("INSERT INTO leads (id, branch_id, customer_id, request_type, status, quote_reference, payload_json) VALUES ('lead_2','branch_pensacola','cust_2','reservation_request','new','SS-2','{}')").run();
  await assert.rejects(() => deleteDisposableLead(db, actor, 'lead_2'), /linked_customer_history_retained/);
  assert.equal((db.raw.prepare("SELECT COUNT(*) AS n FROM leads WHERE id = 'lead_2'").get() as { n: number }).n, 1);

  await markLeadTest(db, actor, 'lead_2', true);
  await deleteDisposableLead(db, actor, 'lead_2');
  assert.equal((db.raw.prepare("SELECT COUNT(*) AS n FROM leads WHERE id = 'lead_2'").get() as { n: number }).n, 0);
  assert.equal((db.raw.prepare("SELECT COUNT(*) AS n FROM customers WHERE id = 'cust_2'").get() as { n: number }).n, 1);
});

test('test classification is excluded from the active pipeline and the preview is evidence-based', async () => {
  const db = migratedDb();
  const actor = await ownerActor(db, 'preview-tests@example.test');
  db.raw.prepare("INSERT INTO customers (id, primary_branch_id, first_name, last_name, status) VALUES ('cust_3','branch_pensacola','Your','Name Here','active')").run();
  db.raw.prepare("INSERT INTO customer_contacts (id, customer_id, kind, value, normalized_value) VALUES ('ct_3','cust_3','email','emailaddress@usa.com','emailaddress@usa.com')").run();
  db.raw.prepare("INSERT INTO leads (id, branch_id, customer_id, request_type, status, quote_reference, payload_json) VALUES ('lead_3','branch_pensacola','cust_3','reservation_request','new','SS-3','{}')").run();
  db.raw.prepare("INSERT INTO customers (id, primary_branch_id, first_name, last_name, status) VALUES ('cust_4','branch_pensacola','Hayli','Bobrowski','active')").run();
  db.raw.prepare("INSERT INTO customer_contacts (id, customer_id, kind, value, normalized_value) VALUES ('ct_4','cust_4','email','haylibobrowski@gmail.com','haylibobrowski@gmail.com')").run();
  db.raw.prepare("INSERT INTO leads (id, branch_id, customer_id, request_type, status, quote_reference, payload_json) VALUES ('lead_4','branch_pensacola','cust_4','residential_estimate','new','SS-4','{}')").run();

  const suspects = await previewSuspectedTestLeads(db, actor);
  assert.deepEqual(suspects.map((entry) => entry.id), ['lead_3']);
  assert.match(suspects[0]!.reasons.join(' '), /Placeholder/i);

  await markLeadTest(db, actor, 'lead_3', true);
  const active = await listLeads(db, actor, { status: 'active', limit: 50 });
  assert.deepEqual(active.map((entry) => entry.id), ['lead_4']);
});

test('repeated checkout-style identities reuse the customer and property', async () => {
  const db = migratedDb();
  db.raw.prepare("INSERT INTO customers (id, primary_branch_id, first_name, last_name, status) VALUES ('cust_reuse','branch_pensacola','Repeat','Customer','active')").run();
  db.raw.prepare("INSERT INTO customer_contacts (id, customer_id, kind, value, normalized_value) VALUES ('ct_email','cust_reuse','email','repeat@example.test','repeat@example.test')").run();
  db.raw.prepare("INSERT INTO customer_contacts (id, customer_id, kind, value, normalized_value) VALUES ('ct_phone','cust_reuse','phone','+1 850 426 8479','18504268479')").run();
  db.raw.prepare("INSERT INTO properties (id, customer_id, branch_id, label, line1, city, state, postal_code, status) VALUES ('prop_reuse','cust_reuse','branch_pensacola','Service property','6360 Haupert Ln','Molino','FL','32577','active')").run();

  assert.equal(await findCustomerByContact(db, { email: 'REPEAT@example.test' }), 'cust_reuse');
  assert.equal(await findCustomerByContact(db, { phone: '850-426-8479' }), 'cust_reuse');
  assert.equal(
    (await findCustomerProperty(db, 'cust_reuse', { line1: '6360 haupert lane', postalCode: '32577' }))?.id,
    'prop_reuse',
  );
  assert.equal(
    await findCustomerProperty(db, 'cust_reuse', { line1: '6360 Haupert Ln', line2: 'Apt 2', postalCode: '32577' }),
    null,
  );
});