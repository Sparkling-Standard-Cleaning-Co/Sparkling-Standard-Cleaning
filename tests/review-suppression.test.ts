import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { enrollOwner } from '../src/lib/admin/operations.ts';
import {
  customerReviewState,
  invoiceReviewInvitation,
  markReviewRequestSent,
  queueReviewRequest,
  reviewContextForAppointment,
  reviewEligibility,
  setCustomerReviewState,
} from '../src/lib/reviews/service.ts';

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

function seedCustomer(db: TestD1): void {
  db.raw
    .prepare("UPDATE branches SET review_requests_enabled = 1, review_url = 'https://g.page/r/test/review' WHERE id = 'branch_pensacola'")
    .run();
  db.raw
    .prepare(
      `INSERT INTO customers (id, primary_branch_id, first_name, last_name, status, source)
       VALUES ('cust_review_state', 'branch_pensacola', 'Repeat', 'Customer', 'active', 'website')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO customer_contacts (id, customer_id, kind, value, normalized_value, is_primary)
       VALUES ('contact_review_state', 'cust_review_state', 'email', 'repeat@example.test', 'repeat@example.test', 1)`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO properties (id, customer_id, branch_id, label, line1, city, state, postal_code, status)
       VALUES ('prop_review_state', 'cust_review_state', 'branch_pensacola', 'Home', '2 Review Way', 'Pensacola', 'FL', '32502', 'active')`,
    )
    .run();
  for (const [id, start] of [
    ['appt_review_one', '2026-11-20T18:00:00.000Z'],
    ['appt_review_two', '2026-11-21T18:00:00.000Z'],
    ['appt_review_three', '2026-11-22T18:00:00.000Z'],
  ] as const) {
    db.raw
      .prepare(
        `INSERT INTO appointments
         (id, branch_id, customer_id, property_id, status, start_at, end_at, duration_minutes, reference, source)
         VALUES (?, 'branch_pensacola', 'cust_review_state', 'prop_review_state', 'completed', ?, ?, 120, ?, 'website')`,
      )
      .run(id, start, start, `HC-${id}`);
  }
}

test('customer-level review review status suppresses repeat invitations', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'owner-reviews@example.test',
    name: 'Review Owner',
    password: 'SyntheticOwner!2026',
  });
  seedCustomer(db);

  const first = await reviewContextForAppointment(db, 'appt_review_one');
  assert.equal(reviewEligibility(first).reason, 'eligible');
  assert.equal(invoiceReviewInvitation(first)?.eligible, true);

  await setCustomerReviewState(db, owner.id, 'cust_review_state', 'mark_reviewed', {
    note: 'Owner confirmed the customer reviewed.',
  });
  assert.equal((await customerReviewState(db, 'cust_review_state'))?.status, 'reviewed');
  const reviewed = await reviewContextForAppointment(db, 'appt_review_one');
  assert.equal(reviewEligibility(reviewed).reason, 'already_reviewed');
  assert.equal(invoiceReviewInvitation(reviewed), undefined);
  const blocked = await queueReviewRequest(db, reviewed, { source: 'owner' });
  assert.equal(blocked.queued, false);
  assert.equal(blocked.reason, 'already_reviewed');

  await setCustomerReviewState(db, owner.id, 'cust_review_state', 'mark_eligible');
  const eligibleAgain = await reviewContextForAppointment(db, 'appt_review_one');
  assert.equal(reviewEligibility(eligibleAgain).reason, 'eligible');
  const queued = await queueReviewRequest(db, eligibleAgain, { source: 'owner' });
  assert.equal(queued.queued, true);
  assert.ok(queued.id);
  let state = await customerReviewState(db, 'cust_review_state');
  assert.equal(state?.status, 'queued');
  assert.equal(state?.invitationCount, 0);

  await markReviewRequestSent(db, queued.id!, 'sent');
  state = await customerReviewState(db, 'cust_review_state');
  assert.equal(state?.status, 'sent');
  assert.equal(state?.invitationCount, 1);
  assert.ok(state?.lastInvitedAt);

  const second = await reviewContextForAppointment(db, 'appt_review_two');
  assert.equal(reviewEligibility(second).reason, 'frequency_cap');
  assert.equal(invoiceReviewInvitation(second), undefined);
  const capped = await queueReviewRequest(db, second, { source: 'automation' });
  assert.equal(capped.queued, false);
  assert.equal(capped.reason, 'frequency_cap');

  const recent = reviewEligibility(
    { ...second, maxPerCustomer: 2 },
    { now: new Date() },
  );
  assert.equal(recent.reason, 'recent_invitation');

  await setCustomerReviewState(db, owner.id, 'cust_review_state', 'mark_eligible');
  const third = await reviewContextForAppointment(db, 'appt_review_three');
  assert.equal(reviewEligibility(third).reason, 'eligible');
  const thirdQueued = await queueReviewRequest(db, third, { source: 'owner' });
  assert.equal(thirdQueued.queued, true);
  await markReviewRequestSent(db, thirdQueued.id!, 'failed', 'provider_failed');
  state = await customerReviewState(db, 'cust_review_state');
  assert.equal(state?.status, 'failed');
  assert.equal(state?.invitationCount, 0);
});

test('do-not-ask and opted-out states fail closed', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'owner-suppression@example.test',
    name: 'Suppression Owner',
    password: 'SyntheticOwner!2026',
  });
  seedCustomer(db);
  const context = await reviewContextForAppointment(db, 'appt_review_one');
  assert.equal(reviewEligibility(context).reason, 'eligible');

  await setCustomerReviewState(db, owner.id, 'cust_review_state', 'do_not_ask');
  const noAsk = await reviewContextForAppointment(db, 'appt_review_one');
  assert.equal(reviewEligibility(noAsk).reason, 'customer_do_not_ask');
  assert.equal(invoiceReviewInvitation(noAsk), undefined);

  await setCustomerReviewState(db, owner.id, 'cust_review_state', 'opt_out');
  const optedOut = await reviewContextForAppointment(db, 'appt_review_one');
  assert.equal(reviewEligibility(optedOut).reason, 'customer_opted_out');
  assert.equal((await queueReviewRequest(db, optedOut)).queued, false);

  await setCustomerReviewState(db, owner.id, 'cust_review_state', 'mark_unknown');
  const unknown = await reviewContextForAppointment(db, 'appt_review_one');
  assert.equal((await customerReviewState(db, 'cust_review_state'))?.status, 'unknown');
  assert.equal(unknown?.customerReviewStatus, 'unknown');
  assert.equal(reviewEligibility(unknown).reason, 'review_status_unknown');
  assert.equal(invoiceReviewInvitation(unknown), undefined);
});
