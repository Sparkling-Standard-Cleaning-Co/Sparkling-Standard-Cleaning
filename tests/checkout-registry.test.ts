import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import {
  claimCheckoutSlot,
  completeCheckoutSlotByAttempt,
  getActiveCheckoutSlot,
  getCheckoutSlotByAttempt,
  setCheckoutSlotStatus,
  supersedeCheckoutSlot,
} from '../src/lib/payments/checkout-registry.ts';

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
  db.raw.exec(
    fs.readFileSync(path.join(process.cwd(), 'migrations', '0027_checkout_session_registry.sql'), 'utf8'),
  );
  return db;
}

const holdId = '2026-11-10__11111111-1111-4111-8111-111111111111';
const attemptA = 'a'.repeat(64);
const attemptB = 'b'.repeat(64);

test('one active checkout slot is enforced per booking hold', async () => {
  const db = migratedDb();
  const first = await claimCheckoutSlot(db, {
    bookingHoldId: holdId,
    quoteReference: 'SS-20261110-AAAAAA',
    attempt: attemptA,
    amountCents: 30500,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.existing, false);

  const same = await claimCheckoutSlot(db, {
    bookingHoldId: holdId,
    quoteReference: 'SS-20261110-AAAAAA',
    attempt: attemptA,
    amountCents: 30500,
  });
  assert.equal(same.ok, true);
  if (same.ok) assert.equal(same.existing, true);

  const second = await claimCheckoutSlot(db, {
    bookingHoldId: holdId,
    quoteReference: 'SS-20261110-BBBBBB',
    attempt: attemptB,
    amountCents: 31000,
  });
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.reason, 'in_progress');

  await setCheckoutSlotStatus(db, first.row.id, 'open');
  const open = await claimCheckoutSlot(db, {
    bookingHoldId: holdId,
    quoteReference: 'SS-20261110-BBBBBB',
    attempt: attemptB,
    amountCents: 31000,
  });
  assert.equal(open.ok, false);
  if (!open.ok) {
    assert.equal(open.reason, 'open');
    assert.equal(open.row?.attempt, attemptA);
  }
});

test('a superseded session frees the slot for a new attempt', async () => {
  const db = migratedDb();
  const first = await claimCheckoutSlot(db, {
    bookingHoldId: holdId,
    quoteReference: 'SS-20261110-AAAAAA',
    attempt: attemptA,
    amountCents: 30500,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  await setCheckoutSlotStatus(db, first.row.id, 'open');
  assert.equal(await supersedeCheckoutSlot(db, first.row.id, attemptA), true);

  const second = await claimCheckoutSlot(db, {
    bookingHoldId: holdId,
    quoteReference: 'SS-20261110-BBBBBB',
    attempt: attemptB,
    amountCents: 31000,
  });
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.row.attempt, attemptB);

  assert.equal((await getActiveCheckoutSlot(db, holdId))?.attempt, attemptB);
  assert.equal((await getCheckoutSlotByAttempt(db, attemptA))?.status, 'superseded');
});

test('completed and stale slots are handled without creating a second payable session', async () => {
  const db = migratedDb();
  const first = await claimCheckoutSlot(db, {
    bookingHoldId: holdId,
    quoteReference: 'SS-20261110-AAAAAA',
    attempt: attemptA,
    amountCents: 30500,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  await setCheckoutSlotStatus(db, first.row.id, 'open');
  await completeCheckoutSlotByAttempt(db, attemptA, 'cs_test_completed');

  const completed = await claimCheckoutSlot(db, {
    bookingHoldId: holdId,
    quoteReference: 'SS-20261110-BBBBBB',
    attempt: attemptB,
    amountCents: 31000,
  });
  assert.equal(completed.ok, false);
  if (!completed.ok) {
    assert.equal(completed.reason, 'completed');
    assert.equal(completed.row?.attempt, attemptA);
    assert.equal(completed.row?.stripeSessionId, 'cs_test_completed');
  }

  // A stale creating row (crashed isolate) is superseded after the claim window.
  const stale = await claimCheckoutSlot(db, {
    bookingHoldId: '2026-11-11__22222222-2222-4222-8222-222222222222',
    quoteReference: 'SS-20261111-CCCCCC',
    attempt: 'c'.repeat(64),
    amountCents: 20000,
  });
  assert.equal(stale.ok, true);
  if (!stale.ok) return;
  db.raw
    .prepare('UPDATE checkout_sessions SET updated_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 10 * 60_000).toISOString(), stale.row.id);

  const replacement = await claimCheckoutSlot(db, {
    bookingHoldId: '2026-11-11__22222222-2222-4222-8222-222222222222',
    quoteReference: 'SS-20261111-DDDDDD',
    attempt: 'd'.repeat(64),
    amountCents: 21000,
  });
  assert.equal(replacement.ok, true);
  if (replacement.ok) assert.equal(replacement.row.attempt, 'd'.repeat(64));
});

test('the D1 schema itself rejects two active rows for the same hold', async () => {
  const db = migratedDb();
  const insert = (id: string, attempt: string) =>
    db.raw
      .prepare(
        `INSERT INTO checkout_sessions
         (id, booking_hold_id, quote_reference, attempt, status, amount_cents, created_at, updated_at)
         VALUES (?, ?, 'SS-20261110-AAAAAA', ?, 'open', 100, ?, ?)`,
      )
      .run(id, holdId, attempt, new Date().toISOString(), new Date().toISOString());

  insert('one', attemptA);
  assert.throws(() => insert('two', attemptB), /UNIQUE|constraint/i);
});
