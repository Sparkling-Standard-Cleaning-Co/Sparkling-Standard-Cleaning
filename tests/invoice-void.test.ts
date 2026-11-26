import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { updateInvoiceStatus } from '../src/lib/admin/billing.ts';

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
    "INSERT INTO admin_users (id, role_id, email, password_hash, display_name, status) VALUES ('admin_test_owner', 'owner', 'owner@example.test', 'synthetic', 'Owner', 'active')",
  ).run();
  db.raw.prepare(
    "INSERT INTO customers (id, primary_branch_id, first_name, last_name, status) VALUES ('cust_void', 'branch_pensacola', 'Void', 'Customer', 'active')",
  ).run();
  return db;
}

const actor = {
  id: 'admin_test_owner',
  email: 'owner@example.test',
  name: 'Owner',
  role: 'owner',
  branchId: null,
  csrf: 'csrf-test',
  permissions: ['*'],
  mfaEnabled: true,
};

function insertInvoice(db: TestD1, id: string, paid: number): void {
  db.raw.prepare(
    `INSERT INTO invoices
     (id, branch_id, customer_id, number, status, issue_date, due_date, subtotal_cents, total_cents,
      amount_paid_cents, balance_cents, payment_url, stripe_checkout_session_id)
     VALUES (?, 'branch_pensacola', 'cust_void', ?, 'open', '2026-11-26', '2026-11-26', 10000, 10000,
             ?, ?, 'https://checkout.stripe.test/session', 'cs_test_void')`,
  ).run(id, `INV-${id}`, paid, 10000 - paid);
}

test('voiding an invoice clears its payable link and preserves the record', async () => {
  const db = migratedDb();
  insertInvoice(db, 'inv_voidable', 0);
  await updateInvoiceStatus(db, actor, 'inv_voidable', 'void');
  const row = db.raw.prepare('SELECT status, payment_url, stripe_checkout_session_id FROM invoices WHERE id = ?').get('inv_voidable') as Record<string, unknown>;
  assert.equal(row.status, 'void');
  assert.equal(row.payment_url, null);
  assert.equal(row.stripe_checkout_session_id, null);
});

test('an invoice with any recorded payment cannot be voided', async () => {
  const db = migratedDb();
  insertInvoice(db, 'inv_paid', 5000);
  await assert.rejects(() => updateInvoiceStatus(db, actor, 'inv_paid', 'void'), /invoice_has_payments/);
  const row = db.raw.prepare('SELECT status, amount_paid_cents FROM invoices WHERE id = ?').get('inv_paid') as Record<string, unknown>;
  assert.equal(row.status, 'open');
  assert.equal(row.amount_paid_cents, 5000);
});
