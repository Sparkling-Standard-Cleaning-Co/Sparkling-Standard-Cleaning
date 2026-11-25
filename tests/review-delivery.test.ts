import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { processDueReviewRequests } from '../src/lib/reviews/delivery.ts';

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

function fixture(enabled: number, scheduledAt: string) {
  const db = migratedDb();
  db.raw.prepare("UPDATE branches SET review_requests_enabled = ?, review_url = 'https://g.page/r/test/review' WHERE id = 'branch_pensacola'").run(enabled);
  db.raw.prepare(
    `INSERT INTO customers (id, primary_branch_id, first_name, last_name, status, source)
     VALUES ('cust_review_delivery', 'branch_pensacola', 'Review', 'Customer', 'active', 'website')`,
  ).run();
  db.raw.prepare(
    `INSERT INTO customer_contacts (id, customer_id, kind, value, normalized_value, is_primary)
     VALUES ('contact_review_delivery', 'cust_review_delivery', 'email', 'review@example.test', 'review@example.test', 1)`,
  ).run();
  db.raw.prepare(
    `INSERT INTO properties (id, customer_id, branch_id, label, line1, city, state, postal_code, status)
     VALUES ('prop_review_delivery', 'cust_review_delivery', 'branch_pensacola', 'Home', '1 Review Way', 'Pensacola', 'FL', '32502', 'active')`,
  ).run();
  db.raw.prepare(
    `INSERT INTO appointments
     (id, branch_id, customer_id, property_id, status, start_at, end_at, duration_minutes, reference, source)
     VALUES ('appt_review_delivery', 'branch_pensacola', 'cust_review_delivery', 'prop_review_delivery', 'completed',
             '2026-11-23T18:00:00.000Z', '2026-11-23T20:00:00.000Z', 120, 'HC-REVIEW-TEST', 'website')`,
  ).run();
  db.raw.prepare(
    `INSERT INTO review_requests
     (id, branch_id, customer_id, appointment_id, status, channel, recipient, review_url,
      scheduled_at, dedupe_key, created_at, updated_at)
     VALUES ('rev_delivery_test', 'branch_pensacola', 'cust_review_delivery', 'appt_review_delivery', 'queued', 'email',
             'review@example.test', 'https://g.page/r/test/review', ?, 'review:test:delivery', ?, ?)`,
  ).run(scheduledAt, scheduledAt, scheduledAt);
  return db;
}

test('review delivery worker honors the automation switch and never flushes an old backlog', async () => {
  const now = new Date('2026-11-24T12:00:00.000Z');
  let sends = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    sends += 1;
    return new Response(JSON.stringify({ id: 'provider-review-test' }), { status: 200 });
  }) as typeof fetch;
  try {
    const disabled = fixture(0, '2026-11-24T11:50:00.000Z');
    const disabledResult = await processDueReviewRequests(disabled, { RESEND_API_KEY: 're_test' }, { now });
    assert.equal(disabledResult.skipped, 1);
    assert.equal(disabledResult.sent, 0);
    assert.equal(sends, 0);

    const stale = fixture(1, '2026-11-24T04:00:00.000Z');
    const staleResult = await processDueReviewRequests(stale, { RESEND_API_KEY: 're_test' }, { now });
    assert.equal(staleResult.scanned, 0);
    assert.equal(sends, 0);
    assert.equal(
      (stale.raw.prepare("SELECT status FROM review_requests WHERE id = 'rev_delivery_test'").get() as { status: string }).status,
      'queued',
    );

    const enabled = fixture(1, '2026-11-24T11:50:00.000Z');
    const sent = await processDueReviewRequests(enabled, { RESEND_API_KEY: 're_test' }, { now });
    assert.equal(sent.sent, 1);
    assert.equal(sends, 1);
    assert.equal(
      (enabled.raw.prepare("SELECT status FROM review_requests WHERE id = 'rev_delivery_test'").get() as { status: string }).status,
      'sent',
    );
    assert.equal(
      (enabled.raw.prepare("SELECT COUNT(*) AS n FROM notification_delivery_events WHERE event_key = 'review_request' AND status = 'sent'").get() as { n: number }).n,
      1,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
