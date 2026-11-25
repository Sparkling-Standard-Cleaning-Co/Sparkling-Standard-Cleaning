import './helpers/enable-signing.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { enrollOwner, type AdminActor } from '../src/lib/admin/operations.ts';
import { approveTemplate, createTemplate, signSigningRequest } from '../src/lib/documents/service.ts';
import { createInvoice } from '../src/lib/admin/billing.ts';
import {
  approveChangeOrder,
  changeOrderInvoiceInput,
  createChangeOrder,
  getChangeOrder,
  linkChangeOrderInvoice,
  sendChangeOrder,
} from '../src/lib/change-orders/service.ts';

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

function signingRequest(): Request {
  return new Request('https://example.test/api/document-sign', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': '203.0.113.10', 'User-Agent': 'synthetic-test' },
  });
}

test('a signed change order creates one explicit supplemental invoice and preserves the original', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'owner-change@example.test',
    name: 'Change Owner',
    password: 'SyntheticOwner!2026',
  });
  const actor: AdminActor = {
    id: owner.id,
    email: owner.email,
    name: owner.name,
    role: 'owner',
    branchId: null,
    csrf: 'test-csrf',
    permissions: ['*'],
    mfaEnabled: false,
  };
  const template = await createTemplate(db, owner.id, {
    title: 'Additional Service and Add-On Authorization',
    category: 'residential',
    version: '1.0',
    contentText: 'Additional service authorization for {{customer.legal_name}} at {{property.address}}.',
    familyKey: 'additional-service',
  });
  await approveTemplate(db, owner.id, template.id);

  db.raw.prepare(
    `INSERT INTO customers (id, primary_branch_id, first_name, last_name, status, source)
     VALUES ('cust_change', 'branch_pensacola', 'Change', 'Customer', 'active', 'website')`,
  ).run();
  db.raw.prepare(
    `INSERT INTO customer_contacts (id, customer_id, kind, value, normalized_value, is_primary)
     VALUES ('contact_change', 'cust_change', 'email', 'change@example.test', 'change@example.test', 1)`,
  ).run();
  db.raw.prepare(
    `INSERT INTO properties (id, customer_id, branch_id, label, line1, city, state, postal_code, status)
     VALUES ('prop_change', 'cust_change', 'branch_pensacola', 'Home', '5 Change Way', 'Pensacola', 'FL', '32502', 'active')`,
  ).run();
  db.raw.prepare(
    `INSERT INTO appointments
       (id, branch_id, customer_id, property_id, status, start_at, end_at, duration_minutes, reference, source)
     VALUES ('appt_change', 'branch_pensacola', 'cust_change', 'prop_change', 'confirmed',
             '2026-12-01T18:00:00.000Z', '2026-12-01T20:00:00.000Z', 120, 'HC-CHANGE-ORDER', 'website')`,
  ).run();
  db.raw.prepare(
    `INSERT INTO invoices
       (id, branch_id, customer_id, property_id, appointment_id, number, status, issue_date, due_date,
        subtotal_cents, total_cents, balance_cents, invoice_role)
     VALUES ('inv_change_primary', 'branch_pensacola', 'cust_change', 'prop_change', 'appt_change',
             'INV-CHANGE-PRIMARY', 'open', '2026-12-01', '2026-12-01', 27500, 27500, 27500, 'primary')`,
  ).run();

  const changeOrder = await createChangeOrder(db, owner.id, {
    appointmentId: 'appt_change',
    originalScope: 'Standard deep clean of the home.',
    revisedScope: 'Add interior oven cleaning and two interior windows.',
    reason: 'Customer requested additional services after the original booking.',
    adjustmentCents: 5000,
    effectiveDate: '2026-12-01',
  });
  assert.equal(changeOrder.status, 'pending_approval');
  assert.equal(changeOrder.original_price_cents, 27500);
  assert.equal(changeOrder.revised_price_cents, 32500);
  assert.equal(changeOrder.adjustment_cents, 5000);

  await approveChangeOrder(db, owner.id, changeOrder.id);
  const sent = await sendChangeOrder(db, owner.id, changeOrder.id);
  assert.match(sent.signingUrl, /token=/);
  assert.ok(sent.token);
  const afterSend = await getChangeOrder(db, changeOrder.id);
  assert.equal(afterSend?.effective_status, 'sent');
  assert.ok(afterSend?.signing_request_id);

  const signed = await signSigningRequest(db, sent.token, {
    signerName: 'Change Customer',
    signerEmail: 'change@example.test',
    consent: true,
    signatures: { [template.id]: { value: 'Change Customer' } },
    request: signingRequest(),
  });
  assert.equal(signed.status, 'signed');
  const afterSign = await getChangeOrder(db, changeOrder.id);
  assert.equal(afterSign?.effective_status, 'signed');

  const invoiceInput = await changeOrderInvoiceInput(db, changeOrder.id);
  const invoice = await createInvoice(db, actor, invoiceInput);
  await linkChangeOrderInvoice(db, owner.id, changeOrder.id, invoice.id);
  const billed = await getChangeOrder(db, changeOrder.id);
  assert.equal(billed?.effective_status, 'billed');
  assert.equal(billed?.supplemental_invoice_id, invoice.id);
  const invoiceRow = db.raw
    .prepare('SELECT invoice_role, related_invoice_id, appointment_id, total_cents FROM invoices WHERE id = ?')
    .get(invoice.id) as { invoice_role: string; related_invoice_id: string; appointment_id: string; total_cents: number };
  assert.equal(invoiceRow.invoice_role, 'supplemental');
  assert.equal(invoiceRow.related_invoice_id, 'inv_change_primary');
  assert.equal(invoiceRow.appointment_id, 'appt_change');
  assert.equal(invoiceRow.total_cents, 5000);
  const original = db.raw
    .prepare('SELECT status, total_cents, invoice_role FROM invoices WHERE id = ?')
    .get('inv_change_primary') as { status: string; total_cents: number; invoice_role: string };
  assert.deepEqual({ ...original }, { status: 'open', total_cents: 27500, invoice_role: 'primary' });
});
