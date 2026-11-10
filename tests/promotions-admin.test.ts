import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import {
  createPromotion,
  evaluatePromotionForQuote,
  listPromotions,
  redeemPromotionRedemption,
  releasePromotionRedemption,
  reservePromotionRedemption,
  updatePromotion,
} from '../src/lib/promotions/service.ts';
import { onRequestPost as promotionQuotePost } from '../functions/api/promotion.ts';

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
    return {
      success: true,
      results: this.db.prepare(this.sql).all(...(this.values as never[])) as T[],
    };
  }
  async run(): Promise<D1Result> {
    const result = this.db.prepare(this.sql).run(...(this.values as never[]));
    return { success: true, meta: { changes: Number(result.changes) } };
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
  db.raw.exec('PRAGMA foreign_keys = ON');
  for (const file of fs
    .readdirSync('migrations')
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    db.raw.exec(fs.readFileSync(path.join('migrations', file), 'utf8'));
  }
  db.raw
    .prepare(
      `INSERT OR IGNORE INTO admin_users (id, email, password_hash, display_name, role_id, status)
       VALUES ('admin_test', 'promo-admin@example.test', 'synthetic', 'Promo Admin', 'owner', 'active')`,
    )
    .run();
  return db;
}

async function active(db: TestD1, overrides: Record<string, unknown> = {}) {
  const created = await createPromotion(db, 'admin_test', {
    name: 'Synthetic promotion',
    code: `TEST${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    kind: 'fixed',
    valueCents: 7500,
    services: ['deep'],
    branches: ['branch_pensacola'],
    minPurchaseCents: 10000,
    maxDiscountCents: 0,
    startsAt: '2026-01-01T00:00:00Z',
    expiresAt: '2027-12-31T23:59:59Z',
    maxRedemptions: 0,
    perCustomerLimit: 1,
    firstVisitOnly: true,
    status: 'active',
    ...overrides,
  });
  return created;
}

function seedCustomer(db: TestD1): string {
  db.raw
    .prepare(
      `INSERT INTO customers (id, primary_branch_id, first_name, last_name, status)
       VALUES ('cust_promo', 'branch_pensacola', 'Synthetic', 'Customer', 'active')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO booking_requests
       (id, hold_id, branch_id, customer_id, status, quote_reference, requested_date, start_at, end_at, duration_minutes)
       VALUES ('br_promo', '2026-12-01__00000000-0000-0000-0000-000000000002', 'branch_pensacola',
               'cust_promo', 'pending', 'SS-PROMO', '2026-12-01', '2026-12-01T15:00:00', '2026-12-01T17:00:00', 120)`,
    )
    .run();
  return 'cust_promo';
}

const quote = {
  cleaningAmountCents: 20000,
  serviceType: 'deep',
  branchId: 'branch_pensacola',
  frequency: 'one_time',
  quoteReference: 'SS-PROMO',
  holdId: '2026-12-01__00000000-0000-0000-0000-000000000002',
};

test('fixed and percentage promotions compute the correct discount', async () => {
  const db = migratedDb();
  seedCustomer(db);
  const fixed = await active(db);
  const fixedResult = await evaluatePromotionForQuote(db, { ...quote, code: fixed.code });
  assert.equal(fixedResult.ok, true);
  assert.equal(fixedResult.discountCents, 7500);

  const percent = await active(db, {
    kind: 'percent',
    percent: 15,
    valueCents: 0,
    maxDiscountCents: 2500,
  });
  const percentResult = await evaluatePromotionForQuote(db, { ...quote, code: percent.code });
  assert.equal(percentResult.ok, true);
  assert.equal(percentResult.discountCents, 2500, 'percentage is capped');
});

test('expired, wrong-service, wrong-branch and minimum failures fail closed', async () => {
  const db = migratedDb();
  seedCustomer(db);
  const expired = await active(db, { startsAt: '2019-01-01T00:00:00Z', expiresAt: '2020-01-01T00:00:00Z' });
  assert.equal((await evaluatePromotionForQuote(db, { ...quote, code: expired.code })).reason, 'promotion_expired');
  const wrongService = await active(db);
  assert.equal(
    (await evaluatePromotionForQuote(db, { ...quote, code: wrongService.code, serviceType: 'standard' })).reason,
    'promotion_service_ineligible',
  );
  const wrongBranch = await active(db);
  assert.equal(
    (await evaluatePromotionForQuote(db, { ...quote, code: wrongBranch.code, branchId: 'branch_tampa' })).reason,
    'promotion_branch_ineligible',
  );
  const minimum = await active(db, { minPurchaseCents: 50000 });
  assert.equal(
    (await evaluatePromotionForQuote(db, { ...quote, code: minimum.code })).reason,
    'promotion_minimum_not_met',
  );
});

test('redemption reservation is atomic, limited and releasable', async () => {
  const db = migratedDb();
  seedCustomer(db);
  const promotion = await active(db, { maxRedemptions: 1, perCustomerLimit: 1 });
  const first = await reservePromotionRedemption(db, promotion.id, {
    code: promotion.code,
    customerId: 'cust_promo',
    checkoutAttempt: 'a'.repeat(64),
    quoteReference: 'SS-PROMO',
    amountCents: 7500,
  });
  assert.equal(first.ok, true);
  const second = await reservePromotionRedemption(db, promotion.id, {
    code: promotion.code,
    customerId: 'cust_promo',
    checkoutAttempt: 'b'.repeat(64),
    quoteReference: 'SS-PROMO',
    amountCents: 7500,
  });
  assert.equal(second.ok, false);
  await releasePromotionRedemption(db, 'a'.repeat(64));
  const third = await reservePromotionRedemption(db, promotion.id, {
    code: promotion.code,
    customerId: 'cust_promo',
    checkoutAttempt: 'c'.repeat(64),
    quoteReference: 'SS-PROMO',
    amountCents: 7500,
  });
  assert.equal(third.ok, true);
  await redeemPromotionRedemption(db, 'c'.repeat(64), 'cs_test_promo');
  const row = db.raw
    .prepare('SELECT status FROM promotion_redemptions WHERE checkout_attempt = ?')
    .get('c'.repeat(64)) as { status: string };
  assert.equal(row.status, 'redeemed');
});

test('the Thanksgiving draft exists and is not active', async () => {
  const db = migratedDb();
  const promotions = await listPromotions(db);
  const draft = promotions.find((promotion) => promotion.code === 'THANKS75');
  assert.ok(draft);
  assert.equal(draft.status, 'draft');
  assert.equal(draft.kind, 'fixed');
  assert.equal(draft.valueCents, 7500);
  assert.deepEqual(draft.services, ['deep']);
  assert.deepEqual(draft.branches, ['branch_pensacola']);
});

test('admin updates can activate a reviewed promotion without changing its code', async () => {
  const db = migratedDb();
  const created = await active(db, { status: 'draft' });
  await updatePromotion(db, 'admin_test', created.id, { status: 'active' });
  const promotions = await listPromotions(db);
  const updated = promotions.find((promotion) => promotion.id === created.id);
  assert.equal(updated?.status, 'active');
  assert.equal(updated?.code, created.code);
});


test('the public promotion endpoint returns only an eligible discount summary', async () => {
  const db = migratedDb();
  seedCustomer(db);
  const promotion = await active(db);
  const response = await promotionQuotePost({
    request: new Request('https://example.test/api/promotion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: promotion.code,
        cleaningAmountCents: 20000,
        serviceType: 'deep',
        branchId: 'branch_pensacola',
        frequency: 'one_time',
        quoteReference: 'SS-PROMO',
        holdId: quote.holdId,
      }),
    }),
    env: { DB: db },
  } as never);
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ok?: boolean;
    name?: string;
    discountCents?: number;
    promotion?: unknown;
  };
  assert.equal(body.ok, true);
  assert.equal(body.name, 'Synthetic promotion');
  assert.equal(body.discountCents, 7500);
  assert.equal(body.promotion, undefined, 'internal promotion data is not exposed');
});
