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


test('THANKS75 stores the approved settings and separate deadlines', async () => {
  const db = migratedDb();
  const promotions = await listPromotions(db);
  const thanks = promotions.find((promotion) => promotion.code === 'THANKS75');
  assert.ok(thanks);
  assert.equal(thanks.valueCents, 7500);
  assert.equal(thanks.minPurchaseCents, 20000);
  assert.equal(thanks.maxRedemptions, 20);
  assert.equal(thanks.perCustomerLimit, 1);
  assert.equal(thanks.combinable, false);
  assert.equal(thanks.bookingDeadlineAt, '2026-11-24T05:59:59Z');
  assert.equal(thanks.serviceDeadlineAt, '2026-11-26T05:59:59Z');
});

test('THANKS75 accepts the final eligible evening and rejects the next service day', async () => {
  const db = migratedDb();
  seedCustomer(db);
  const promotions = await listPromotions(db);
  const thanks = promotions.find((promotion) => promotion.code === 'THANKS75');
  assert.ok(thanks);
  await updatePromotion(db, 'admin_test', String(thanks.id), { status: 'active' });
  const accepted = await evaluatePromotionForQuote(db, {
    ...quote,
    code: 'THANKS75',
    cleaningAmountCents: 20000,
    serviceDate: '2026-11-25',
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.discountCents, 7500);
  const rejected = await evaluatePromotionForQuote(db, {
    ...quote,
    code: 'THANKS75',
    cleaningAmountCents: 20000,
    serviceDate: '2026-11-26',
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'promotion_service_deadline_exceeded');
});

test('the $200 minimum is inclusive before any discount', async () => {
  const db = migratedDb();
  seedCustomer(db);
  const promotions = await listPromotions(db);
  const thanks = promotions.find((promotion) => promotion.code === 'THANKS75');
  assert.ok(thanks);
  await updatePromotion(db, 'admin_test', String(thanks.id), { status: 'active' });
  const accepted = await evaluatePromotionForQuote(db, {
    ...quote,
    code: 'THANKS75',
    cleaningAmountCents: 20000,
    serviceDate: '2026-11-20',
  });
  assert.equal(accepted.ok, true);
  const rejected = await evaluatePromotionForQuote(db, {
    ...quote,
    code: 'THANKS75',
    cleaningAmountCents: 19999,
    serviceDate: '2026-11-20',
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'promotion_minimum_not_met');
});


test('THANKS75 rejects standard, STR, Tampa and stacking', async () => {
  const db = migratedDb();
  seedCustomer(db);
  const promotions = await listPromotions(db);
  const thanks = promotions.find((promotion) => promotion.code === 'THANKS75');
  assert.ok(thanks);
  await updatePromotion(db, 'admin_test', String(thanks.id), { status: 'active' });
  const base = { ...quote, code: 'THANKS75', cleaningAmountCents: 30000, serviceDate: '2026-11-20' };
  assert.equal((await evaluatePromotionForQuote(db, { ...base, serviceType: 'standard' })).reason, 'promotion_service_ineligible');
  assert.equal((await evaluatePromotionForQuote(db, { ...base, serviceType: 'str_turnover' })).reason, 'promotion_service_ineligible');
  assert.equal((await evaluatePromotionForQuote(db, { ...base, branchId: 'branch_tampa' })).reason, 'promotion_branch_ineligible');
  assert.equal((await evaluatePromotionForQuote(db, { ...base, hasExistingDiscount: true })).reason, 'promotion_not_combinable');
});

test('a passed booking deadline rejects even before the service deadline', async () => {
  const db = migratedDb();
  seedCustomer(db);
  const promotion = await active(db, {
    bookingDeadlineAt: '2020-01-01T00:00:00Z',
    serviceDeadlineAt: '2099-01-01T00:00:00Z',
    startsAt: '2019-01-01T00:00:00Z',
  });
  const result = await evaluatePromotionForQuote(db, { ...quote, code: promotion.code, serviceDate: '2026-11-20' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'promotion_booking_deadline_passed');
});

test('the 20-redemption cap is enforced under simultaneous reservations', async () => {
  const db = migratedDb();
  seedCustomer(db);
  const promotion = await active(db, { maxRedemptions: 20, perCustomerLimit: 0 });
  const attempts = Array.from({ length: 21 }, (_, index) =>
    reservePromotionRedemption(db, promotion.id, {
      code: promotion.code,
      customerId: null,
      checkoutAttempt: index.toString(16).padStart(64, '0'),
      quoteReference: 'SS-PROMO',
      amountCents: 7500,
    }),
  );
  const results = await Promise.all(attempts);
  assert.equal(results.filter((result) => result.ok).length, 20);
  assert.equal(results.filter((result) => !result.ok).length, 1);
});


test('cleaning promotions cannot discount gifts and gift promotions cannot discount cleaning', async () => {
  const db = migratedDb();
  const giftPromo = await active(db, {
    name: 'Synthetic gift promotion',
    code: 'GIFT10',
    kind: 'percent',
    percent: 10,
    valueCents: 0,
    services: ['gift_certificate'],
    scope: 'gift',
    minPurchaseCents: 0,
  });
  const giftEval = await evaluatePromotionForQuote(db, {
    code: giftPromo.code,
    cleaningAmountCents: 10000,
    serviceType: 'gift_certificate',
    branchId: 'branch_pensacola',
    frequency: 'one_time',
    quoteReference: '',
    holdId: '',
    serviceDate: '2026-11-20',
    scope: 'gift',
  });
  assert.equal(giftEval.ok, true);
  assert.equal(giftEval.discountCents, 1000);
  const cleaningEval = await evaluatePromotionForQuote(db, {
    ...quote,
    code: giftPromo.code,
    cleaningAmountCents: 30000,
    serviceDate: '2026-11-20',
  });
  assert.equal(cleaningEval.ok, false);
  assert.equal(cleaningEval.reason, 'promotion_scope_ineligible');
  const thanks = (await listPromotions(db)).find((promotion) => promotion.code === 'THANKS75');
  assert.ok(thanks);
  await updatePromotion(db, 'admin_test', String(thanks.id), { status: 'active' });
  const thanksGift = await evaluatePromotionForQuote(db, {
    code: 'THANKS75',
    cleaningAmountCents: 10000,
    serviceType: 'gift_certificate',
    branchId: 'branch_pensacola',
    frequency: 'one_time',
    quoteReference: '',
    holdId: '',
    serviceDate: '2026-11-20',
    scope: 'gift',
  });
  assert.equal(thanksGift.ok, false);
  assert.equal(thanksGift.reason, 'promotion_scope_ineligible');
});
