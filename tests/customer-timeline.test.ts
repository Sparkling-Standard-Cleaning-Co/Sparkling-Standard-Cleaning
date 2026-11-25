import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { enrollOwner, type AdminActor } from '../src/lib/admin/operations.ts';
import { getCustomer } from '../src/lib/admin/crm.ts';

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

test('the customer file returns payments, communications and one chronological timeline', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'owner-timeline@example.test',
    name: 'Timeline Owner',
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
  db.raw.prepare(
    `INSERT INTO customers (id, primary_branch_id, first_name, last_name, status, source)
     VALUES ('cust_timeline', 'branch_pensacola', 'Timeline', 'Customer', 'active', 'website')`,
  ).run();
  db.raw.prepare(
    `INSERT INTO customer_contacts (id, customer_id, kind, value, normalized_value, is_primary)
     VALUES ('contact_timeline', 'cust_timeline', 'email', 'timeline@example.test', 'timeline@example.test', 1)`,
  ).run();
  db.raw.prepare(
    `INSERT INTO properties (id, customer_id, branch_id, label, line1, city, state, postal_code, status)
     VALUES ('prop_timeline', 'cust_timeline', 'branch_pensacola', 'Home', '4 Timeline Way', 'Pensacola', 'FL', '32502', 'active')`,
  ).run();
  db.raw.prepare(
    `INSERT INTO appointments
       (id, branch_id, customer_id, property_id, status, start_at, end_at, duration_minutes, reference, source, created_at, updated_at)
     VALUES ('appt_timeline', 'branch_pensacola', 'cust_timeline', 'prop_timeline', 'completed',
             '2026-11-22T18:00:00.000Z', '2026-11-22T20:00:00.000Z', 120, 'HC-TIMELINE', 'website',
             '2026-11-20T12:00:00.000Z', '2026-11-22T20:05:00.000Z')`,
  ).run();
  db.raw.prepare(
    `INSERT INTO invoices
       (id, branch_id, customer_id, property_id, appointment_id, number, status, issue_date, due_date,
        subtotal_cents, total_cents, balance_cents, created_at)
     VALUES ('inv_timeline', 'branch_pensacola', 'cust_timeline', 'prop_timeline', 'appt_timeline',
             'INV-TIMELINE', 'paid', '2026-11-22', '2026-11-22', 27500, 27500, 0, '2026-11-22T20:10:00.000Z')`,
  ).run();
  db.raw.prepare(
    `INSERT INTO payments
       (id, branch_id, customer_id, invoice_id, appointment_id, provider, status, amount_cents,
        service_cents, tip_cents, idempotency_key, received_at, created_at)
     VALUES ('pay_timeline', 'branch_pensacola', 'cust_timeline', 'inv_timeline', 'appt_timeline', 'stripe',
             'succeeded', 30000, 27500, 2500, 'idem-timeline', '2026-11-22T20:20:00.000Z', '2026-11-22T20:20:00.000Z')`,
  ).run();
  db.raw.prepare(
    `INSERT INTO signing_requests
       (id, branch_id, bundle_code, packet_name, subject_type, customer_id, appointment_id, status,
        signer_email, executed_at, created_at)
     VALUES ('sign_timeline', 'branch_pensacola', 'customer.deep', 'Residential Deep Cleaning Packet',
             'customer', 'cust_timeline', 'appt_timeline', 'signed', 'timeline@example.test',
             '2026-11-22T19:00:00.000Z', '2026-11-20T12:30:00.000Z')`,
  ).run();
  db.raw.prepare(
    `INSERT INTO review_requests
       (id, branch_id, customer_id, appointment_id, invoice_id, status, channel, recipient, review_url,
        scheduled_at, sent_at, dedupe_key, created_at, updated_at)
     VALUES ('review_timeline', 'branch_pensacola', 'cust_timeline', 'appt_timeline', 'inv_timeline',
             'sent', 'email', 'timeline@example.test', 'https://g.page/r/test/review',
             '2026-11-23T20:00:00.000Z', '2026-11-23T20:00:00.000Z', 'review:timeline',
             '2026-11-23T20:00:00.000Z', '2026-11-23T20:00:00.000Z')`,
  ).run();
  db.raw.prepare(
    `INSERT INTO communications
       (id, customer_id, appointment_id, channel, direction, template, status, subject, created_at)
     VALUES ('comm_timeline', 'cust_timeline', 'appt_timeline', 'email', 'outbound', 'receipt',
             'delivered', 'Your cleaning receipt', '2026-11-22T20:25:00.000Z')`,
  ).run();
  db.raw.prepare(
    `INSERT INTO job_media (id, appointment_id, kind, r2_key, content_type, created_at)
     VALUES ('media_timeline', 'appt_timeline', 'after', 'private/media.jpg', 'image/jpeg', '2026-11-22T20:30:00.000Z')`,
  ).run();
  db.raw.prepare(
    `INSERT INTO customer_notes (id, customer_id, author_user_id, visibility, body, created_at)
     VALUES ('note_timeline', 'cust_timeline', ?, 'internal', 'Customer asked for extra attention on the kitchen.', '2026-11-22T21:00:00.000Z')`,
  ).run(owner.id);

  const detail = await getCustomer(db, actor, 'cust_timeline');
  assert.ok(detail);
  assert.equal((detail!.payments as Array<Record<string, unknown>>).length, 1);
  assert.equal(Number((detail!.payments as Array<Record<string, unknown>>)[0]?.tip_cents), 2500);
  assert.equal((detail!.communications as Array<Record<string, unknown>>).length, 1);
  const timeline = detail!.timeline as Array<Record<string, unknown>>;
  const titles = timeline.map((event) => String(event.title));
  for (const expected of [
    'Service Completed',
    'Invoice INV-TIMELINE',
    'Payment Succeeded',
    'Agreement executed',
    'Review invitation Sent',
    'Email Outbound',
    'Photo added',
    'Internal note',
  ]) {
    assert.ok(titles.includes(expected), `timeline should include ${expected}`);
  }
  const timestamps = timeline.map((event) => String(event.at));
  assert.deepEqual([...timestamps].sort().reverse(), timestamps, 'timeline is newest first');
  assert.equal(timeline[0]?.title, 'Review invitation Sent');
});
