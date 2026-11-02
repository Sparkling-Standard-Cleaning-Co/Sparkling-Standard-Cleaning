import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import {
  ensureFinancialParty,
  projectEstimatePayment,
  projectGiftSale,
} from '../src/lib/payments/d1-projection.ts';

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

function customer(db: TestD1, email: string): string {
  const customerId = `cust_${crypto.randomUUID()}`;
  db.raw
    .prepare("INSERT INTO customers (id, primary_branch_id, first_name, last_name, status) VALUES (?, 'branch_pensacola', 'Existing', 'Customer', 'active')")
    .run(customerId);
  db.raw
    .prepare("INSERT INTO customer_contacts (id, customer_id, kind, value, normalized_value, is_primary) VALUES (?, ?, 'email', ?, ?, 1)")
    .run(`contact_${crypto.randomUUID()}`, customerId, email, email.toLowerCase());
  return customerId;
}

const paidAt = '2026-11-02T12:00:00.000Z';

test('a gift purchaser is a financial party, not a manufactured cleaning customer', async () => {
  const db = migratedDb();
  const beforeCustomers = db.raw.prepare('SELECT COUNT(*) AS n FROM customers').get() as { n: number };
  const first = await projectGiftSale(db, {
    code: 'SSGC-TEST-0001',
    sessionId: 'cs_gift_1',
    amountCents: 15000,
    valueCents: 15000,
    purchaserName: 'Gift Buyer',
    purchaserEmail: 'buyer@example.test',
    recipientName: 'Gift Recipient',
    recipientEmail: 'recipient@example.test',
    deliveryMethod: 'recipient_email',
    eventId: 'evt_gift_1',
    paidAt,
  });
  assert.equal(first.duplicate, false);
  const payment = db.raw
    .prepare("SELECT customer_id, payer_party_id, gift_certificate_id, amount_cents FROM payments WHERE id = ?")
    .get(first.paymentId) as Record<string, unknown>;
  assert.equal(payment.customer_id, null);
  assert.ok(payment.payer_party_id);
  assert.equal(payment.gift_certificate_id, first.giftCertificateId);
  assert.equal(Number(payment.amount_cents), 15000);
  const parties = db.raw.prepare('SELECT kind, email_normalized, customer_id FROM financial_parties ORDER BY kind').all() as Array<Record<string, unknown>>;
  assert.deepEqual(parties.map((party) => party.kind), ['gift_purchaser', 'gift_recipient']);
  assert.ok(parties.every((party) => party.customer_id === null));
  const afterCustomers = db.raw.prepare('SELECT COUNT(*) AS n FROM customers').get() as { n: number };
  assert.equal(afterCustomers.n, beforeCustomers.n);

  const retry = await projectGiftSale(db, {
    code: 'SSGC-TEST-0001',
    sessionId: 'cs_gift_1',
    amountCents: 15000,
    valueCents: 15000,
    purchaserName: 'Gift Buyer',
    purchaserEmail: 'buyer@example.test',
    recipientName: 'Gift Recipient',
    recipientEmail: 'recipient@example.test',
    deliveryMethod: 'recipient_email',
    eventId: 'evt_gift_1',
    paidAt,
  });
  assert.equal(retry.duplicate, true);
  assert.equal((db.raw.prepare('SELECT COUNT(*) AS n FROM payments').get() as { n: number }).n, 1);
  assert.equal((db.raw.prepare('SELECT COUNT(*) AS n FROM gift_certificates').get() as { n: number }).n, 1);
  assert.equal((db.raw.prepare('SELECT COUNT(*) AS n FROM gift_transactions').get() as { n: number }).n, 1);
});

test('a gift purchaser with an exact customer email links to that customer once', async () => {
  const db = migratedDb();
  const existingCustomer = customer(db, 'known@example.test');
  const projected = await projectGiftSale(db, {
    code: 'SSGC-TEST-0002',
    sessionId: 'cs_gift_2',
    amountCents: 5000,
    valueCents: 5000,
    purchaserName: 'Known Customer',
    purchaserEmail: 'KNOWN@example.test',
    recipientName: 'Recipient',
    deliveryMethod: 'print',
    eventId: 'evt_gift_2',
    paidAt,
  });
  const payment = db.raw
    .prepare('SELECT customer_id, payer_party_id FROM payments WHERE id = ?')
    .get(projected.paymentId) as Record<string, unknown>;
  assert.equal(payment.customer_id, existingCustomer);
  const party = db.raw
    .prepare("SELECT customer_id FROM financial_parties WHERE kind = 'gift_purchaser'")
    .get() as { customer_id: string };
  assert.equal(party.customer_id, existingCustomer);
  assert.equal((db.raw.prepare('SELECT COUNT(*) AS n FROM customers').get() as { n: number }).n, 1);
});

test('an estimate payment is projected with its booking and duplicate retry is safe', async () => {
  const db = migratedDb();
  db.raw
    .prepare(
      `INSERT INTO booking_requests
       (id, hold_id, status, quote_reference, requested_date, start_at, end_at, duration_minutes)
       VALUES ('br_1', '2026-11-03__aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'pending',
               'SS-TEST-1', '2026-11-03', ?, ?, 120)`,
    )
    .run(paidAt, '2026-11-03T14:00:00.000Z');
  const projected = await projectEstimatePayment(db, {
    sessionId: 'cs_estimate_1',
    paymentIntentId: 'pi_estimate_1',
    amountCents: 10000,
    holdId: '2026-11-03__aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    quoteReference: 'SS-TEST-1',
    giftAppliedCents: 5000,
    totalCents: 15000,
    customerName: 'Estimate Payer',
    customerEmail: 'payer@example.test',
    paidAt,
  });
  const payment = db.raw
    .prepare('SELECT customer_id, payer_party_id, booking_request_id, amount_cents, metadata_json FROM payments WHERE id = ?')
    .get(projected.paymentId) as Record<string, unknown>;
  assert.equal(payment.customer_id, null);
  assert.ok(payment.payer_party_id);
  assert.equal(payment.booking_request_id, 'br_1');
  assert.equal(Number(payment.amount_cents), 10000);
  assert.match(String(payment.metadata_json), /gift_applied_cents/);
  const retry = await projectEstimatePayment(db, {
    sessionId: 'cs_estimate_1',
    amountCents: 10000,
    holdId: '2026-11-03__aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    quoteReference: 'SS-TEST-1',
    paidAt,
  });
  assert.equal(retry.duplicate, true);
  assert.equal((db.raw.prepare('SELECT COUNT(*) AS n FROM payments').get() as { n: number }).n, 1);
});

test('financial party reuse is deterministic by kind and normalized email', async () => {
  const db = migratedDb();
  const first = await ensureFinancialParty(db, {
    kind: 'gift_recipient',
    name: 'Recipient',
    email: 'Recipient@Example.test',
  });
  const second = await ensureFinancialParty(db, {
    kind: 'gift_recipient',
    name: 'Recipient Again',
    email: 'recipient@example.test',
  });
  assert.equal(second.id, first.id);
  assert.equal((db.raw.prepare('SELECT COUNT(*) AS n FROM financial_parties').get() as { n: number }).n, 1);
});
