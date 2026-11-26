import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { createOpsSession, enrollOwner, readOpsActor } from '../src/lib/admin/operations.ts';
import { createCustomer } from '../src/lib/admin/crm.ts';
import { createInvoice } from '../src/lib/admin/billing.ts';
import { onRequestPost as financePost } from '../functions/api/admin/finance.ts';

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

test('routine invoice void works from an authenticated MFA session without a fresh code', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'routine-void@example.test',
    name: 'Routine Void Owner',
    password: 'SyntheticOwner!2026',
  });
  db.raw.prepare('UPDATE admin_users SET mfa_enabled = 1 WHERE id = ?').run(owner.id);
  const request = new Request('https://example.test/api/admin/overview');
  const session = await createOpsSession(db, owner.id, request);
  const actor = await readOpsActor(db, new Request('https://example.test/api/admin/overview', { headers: { Cookie: `ss_ops=${session.token}` } }));
  assert.ok(actor?.mfaEnabled);
  assert.equal(actor?.stepUpAt, null);
  const customer = await createCustomer(db, actor!, {
    firstName: 'Routine',
    lastName: 'Customer',
    email: 'routine-customer@example.test',
    addressLine1: '100 Routine Street',
    city: 'Pensacola',
    state: 'FL',
    postalCode: '32502',
  });
  const invoice = await createInvoice(db, actor!, {
    customerId: customer.id,
    serviceCode: 'residential-cleaning',
    lines: [{ kind: 'service', description: 'Routine cleaning', quantity: 1, unitAmountCents: 15000, totalCents: 15000 }],
  });
  const response = await financePost({
    request: new Request('https://example.test/api/admin/finance', {
      method: 'POST',
      headers: {
        Cookie: `ss_ops=${session.token}`,
        'X-CSRF-Token': session.csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'invoice_status', invoiceId: invoice.id, status: 'void' }),
    }),
    env: { DB: db },
  } as never);
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const row = db.raw.prepare('SELECT status FROM invoices WHERE id = ?').get(invoice.id) as { status: string };
  assert.equal(row.status, 'void');
});

test('sensitive invoice creation still requires a fresh step-up code', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'sensitive-create@example.test',
    name: 'Sensitive Create Owner',
    password: 'SyntheticOwner!2026',
  });
  db.raw.prepare('UPDATE admin_users SET mfa_enabled = 1 WHERE id = ?').run(owner.id);
  const session = await createOpsSession(db, owner.id, new Request('https://example.test/api/admin/overview'));
  const response = await financePost({
    request: new Request('https://example.test/api/admin/finance', {
      method: 'POST',
      headers: {
        Cookie: `ss_ops=${session.token}`,
        'X-CSRF-Token': session.csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'create_invoice', customerId: 'missing', lines: [] }),
    }),
    env: { DB: db },
  } as never);
  assert.equal(response.status, 403);
  assert.equal(((await response.json()) as { error?: string }).error, 'mfa_step_up_required');
});
