import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { enrollOwner, type AdminActor } from '../src/lib/admin/operations.ts';
import { createCustomer } from '../src/lib/admin/crm.ts';
import { createInvoice, getInvoice } from '../src/lib/admin/billing.ts';
import { applyInvoiceCheckoutPayment } from '../src/lib/admin/stripe-reconcile.ts';
import { createInvoiceCheckoutSession } from '../src/lib/admin/stripe-billing.ts';
import { beginRefund, completeRefund } from '../src/lib/admin/refunds.ts';
import {
  assignTipParticipants,
  equalSplit,
  listInvoiceTips,
} from '../src/lib/tips/service.ts';
import { createInvoicePayToken, verifyInvoicePayToken } from '../src/lib/tips/token.ts';
import { normalizeTipCents } from '../src/config/tips.ts';
import { onRequestGet as invoicePayGet, onRequestPost as invoicePayPost } from '../functions/api/invoice-pay.ts';

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
  db.raw.exec('PRAGMA foreign_keys = ON');
  for (const file of fs.readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
    db.raw.exec(fs.readFileSync(path.join('migrations', file), 'utf8'));
  }
  return db;
}

async function fixture(): Promise<{ db: TestD1; actor: AdminActor; customerId: string }> {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'tips@example.test',
    name: 'Tips Owner',
    password: 'SyntheticOwner!2026',
  });
  const actor: AdminActor = {
    id: owner.id,
    email: owner.email,
    name: owner.name,
    role: 'owner',
    branchId: null,
    csrf: 'csrf',
    permissions: ['*'],
    mfaEnabled: false,
  };
  const customer = await createCustomer(db, actor, {
    firstName: 'Francesca',
    lastName: 'Customer',
    email: 'francesca@example.test',
    addressLine1: '100 Example Street',
    city: 'Pensacola',
    state: 'FL',
    postalCode: '32502',
  });
  return { db, actor, customerId: String(customer.id) };
}

async function invoiceFixture(db: TestD1, actor: AdminActor, customerId: string) {
  return createInvoice(db, actor, {
    customerId,
    lines: [
      { kind: 'service', description: 'Move-Out Cleaning', quantity: 1, unitAmountCents: 27500, totalCents: 27500 },
    ],
  });
}

test('tip tokens are signed, bound to the invoice and reject tampering or expiry', async () => {
  const env = { TIPS_LINK_SECRET: 'synthetic-tip-secret' };
  const token = await createInvoicePayToken(env, 'inv_test_123', 'invoice');
  const verified = await verifyInvoicePayToken(env, token);
  assert.equal(verified?.invoiceId, 'inv_test_123');
  assert.equal(verified?.mode, 'invoice');
  assert.equal(await verifyInvoicePayToken(env, `${token}x`), null);
  const [payload] = token.split('.');
  assert.equal(await verifyInvoicePayToken(env, `${payload}.forged`), null);
  const expired = await createInvoicePayToken(env, 'inv_test_123', 'tip', {
    now: new Date('2020-01-01T00:00:00Z'),
    ttlDays: 1,
  });
  assert.equal(await verifyInvoicePayToken(env, expired, { now: new Date('2026-11-23T00:00:00Z') }), null);
});

test('a $275 invoice with a voluntary $25 tip records service and gratuity separately', async () => {
  const { db, actor, customerId } = await fixture();
  const invoice = await invoiceFixture(db, actor, customerId);
  const applied = await applyInvoiceCheckoutPayment(db, {
    id: 'cs_tip_paid',
    payment_intent: 'pi_tip_paid',
    customer: 'cus_tip',
    amount_total: 30000,
    metadata: {
      invoice_id: invoice.id,
      checkout_kind: 'invoice_payment',
      service_amount_cents: '27500',
      tip_cents: '2500',
    },
  });
  assert.equal(applied.applied, true);
  assert.equal(applied.serviceCents, 27500);
  assert.equal(applied.tipCents, 2500);
  const detail = await getInvoice(db, actor, invoice.id);
  assert.equal((detail?.invoice as Record<string, unknown>).status, 'paid');
  assert.equal((detail?.invoice as Record<string, unknown>).balance_cents, 0);
  assert.equal((detail?.invoice as Record<string, unknown>).amount_paid_cents, 27500);
  assert.equal((detail?.invoice as Record<string, unknown>).stripe_checkout_session_id, null);
  const payment = (detail?.payments as Array<Record<string, unknown>>)[0];
  assert.equal(payment.amount_cents, 30000);
  assert.equal(payment.service_cents, 27500);
  assert.equal(payment.tip_cents, 2500);
  const tips = await listInvoiceTips(db, invoice.id);
  assert.equal(tips.summary.collectedCents, 2500);
  assert.equal(tips.summary.unallocatedCents, 2500, 'unrecorded participation remains unallocated');
  assert.equal(tips.allocations[0]?.team_member_id, null);

  const duplicate = await applyInvoiceCheckoutPayment(db, {
    id: 'cs_tip_paid',
    amount_total: 30000,
    metadata: { invoice_id: invoice.id, checkout_kind: 'invoice_payment', tip_cents: '2500' },
  });
  assert.equal(duplicate.duplicate, true);
  const count = db.raw.prepare('SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ?').get(invoice.id) as { n: number };
  assert.equal(count.n, 1, 'a repeated webhook never credits the payment twice');
});

test('choosing no tip settles the service normally with no gratuity record', async () => {
  const { db, actor, customerId } = await fixture();
  const invoice = await invoiceFixture(db, actor, customerId);
  const applied = await applyInvoiceCheckoutPayment(db, {
    id: 'cs_no_tip',
    amount_total: 27500,
    metadata: {
      invoice_id: invoice.id,
      checkout_kind: 'invoice_payment',
      service_amount_cents: '27500',
      tip_cents: '0',
    },
  });
  assert.equal(applied.tipCents, 0);
  const detail = await getInvoice(db, actor, invoice.id);
  assert.equal((detail?.invoice as Record<string, unknown>).status, 'paid');
  const tips = await listInvoiceTips(db, invoice.id);
  assert.equal(tips.payments.length, 0);
  assert.equal(tips.allocations.length, 0);
});

test('a prepaid tip-only payment never charges the service again', async () => {
  const { db, actor, customerId } = await fixture();
  const invoice = await invoiceFixture(db, actor, customerId);
  await applyInvoiceCheckoutPayment(db, {
    id: 'cs_prepaid_service',
    amount_total: 27500,
    metadata: {
      invoice_id: invoice.id,
      checkout_kind: 'invoice_payment',
      service_amount_cents: '27500',
      tip_cents: '0',
    },
  });
  const before = await getInvoice(db, actor, invoice.id);
  const applied = await applyInvoiceCheckoutPayment(db, {
    id: 'cs_prepaid_tip',
    amount_total: 2500,
    metadata: {
      invoice_id: invoice.id,
      checkout_kind: 'invoice_tip',
      service_amount_cents: '0',
      tip_cents: '2500',
    },
  });
  assert.equal(applied.applied, true);
  assert.equal(applied.serviceCents, 0);
  assert.equal(applied.tipCents, 2500);
  const after = await getInvoice(db, actor, invoice.id);
  assert.equal((after?.invoice as Record<string, unknown>).amount_paid_cents, (before?.invoice as Record<string, unknown>).amount_paid_cents);
  assert.equal((after?.invoice as Record<string, unknown>).balance_cents, 0);
  assert.equal((after?.invoice as Record<string, unknown>).status, 'paid');
  const tips = await listInvoiceTips(db, invoice.id);
  assert.equal(tips.summary.collectedCents, 2500);
});

test('tips never charge service on an unpaid invoice through the tip-only kind', async () => {
  const { db, actor, customerId } = await fixture();
  const invoice = await invoiceFixture(db, actor, customerId);
  await assert.rejects(
    () =>
      applyInvoiceCheckoutPayment(db, {
        id: 'cs_illegal_tip',
        amount_total: 2500,
        metadata: { invoice_id: invoice.id, checkout_kind: 'invoice_tip', tip_cents: '2500' },
      }),
    /invoice_tip_requires_paid_invoice/,
  );
});

test('equal split is deterministic and totals exactly the collected cents', () => {
  assert.deepEqual(equalSplit(2500, ['team_b', 'team_a']), [
    { teamMemberId: 'team_a', amountCents: 1250 },
    { teamMemberId: 'team_b', amountCents: 1250 },
  ]);
  const three = equalSplit(2500, ['c', 'a', 'b']);
  assert.deepEqual(three.map((entry) => entry.amountCents), [834, 833, 833]);
  assert.equal(three.reduce((sum, entry) => sum + entry.amountCents, 0), 2500);
  assert.equal(equalSplit(1, ['a', 'b']).length, 1);
  assert.equal(normalizeTipCents(100_001), 100_000);
  assert.equal(normalizeTipCents(-5), 0);
});

test('an unallocated tip can be confirmed against actual participating cleaners', async () => {
  const { db, actor, customerId } = await fixture();
  const invoice = await invoiceFixture(db, actor, customerId);
  await applyInvoiceCheckoutPayment(db, {
    id: 'cs_allocate_tip',
    amount_total: 30000,
    metadata: {
      invoice_id: invoice.id,
      checkout_kind: 'invoice_payment',
      service_amount_cents: '27500',
      tip_cents: '2500',
    },
  });
  const payment = db.raw
    .prepare("SELECT id FROM payments WHERE invoice_id = ? AND tip_cents > 0")
    .get(invoice.id) as { id: string };
  const result = await assignTipParticipants(db, actor, payment.id, ['team_hayli']);
  assert.equal(result.allocations[0]?.amountCents, 2500);
  const tips = await listInvoiceTips(db, invoice.id);
  assert.equal(tips.summary.unallocatedCents, 0);
  assert.equal(tips.summary.allocatedCents, 2500);
  assert.ok(tips.allocations.some((allocation) => allocation.team_member_id === 'team_hayli'));
});

test('a full refund reverses the gratuity allocation and reopens only the service balance', async () => {
  const { db, actor, customerId } = await fixture();
  const invoice = await invoiceFixture(db, actor, customerId);
  await applyInvoiceCheckoutPayment(db, {
    id: 'cs_refund_tip',
    amount_total: 30000,
    metadata: {
      invoice_id: invoice.id,
      checkout_kind: 'invoice_payment',
      service_amount_cents: '27500',
      tip_cents: '2500',
    },
  });
  const payment = db.raw
    .prepare('SELECT id FROM payments WHERE invoice_id = ?')
    .get(invoice.id) as { id: string };
  const refund = await beginRefund(db, actor, {
    paymentId: payment.id,
    amountCents: 30000,
    reason: 'Full customer refund',
    idempotencyKey: 'tip-refund-test',
    status: 'succeeded',
  });
  await completeRefund(db, actor, refund.id);
  const detail = await getInvoice(db, actor, invoice.id);
  assert.equal((detail?.invoice as Record<string, unknown>).balance_cents, 27500);
  const tips = await listInvoiceTips(db, invoice.id);
  assert.equal(tips.summary.refundedCents, 2500);
  assert.equal(tips.summary.unallocatedCents, 0);
  assert.equal(tips.allocations[0]?.status, 'reversed');
});

test('checkout sessions place the service and gratuity on separate Stripe lines', async () => {  const { db, actor, customerId } = await fixture();
  const invoice = await invoiceFixture(db, actor, customerId);
  const calls: Array<Record<string, string>> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/customers')) {
      return new Response(JSON.stringify({ id: 'cus_tip_session' }), { status: 200 });
    }
    if (url.includes('/checkout/sessions')) {
      calls.push(Object.fromEntries(new URLSearchParams(String(init?.body ?? ''))));
      return new Response(
        JSON.stringify({ id: 'cs_tip_session', url: 'https://checkout.stripe.test/cs_tip_session' }),
        { status: 200 },
      );
    }
    return new Response('{}', { status: 500 });
  };
  try {
    const env = {
      STRIPE_SECRET_KEY: 'sk_test_synthetic',
      ADMIN_STRIPE_BILLING_ENABLED: 'true',
      TIPS_LINK_SECRET: 'synthetic-tip-secret',
      PUBLIC_SITE_URL: 'https://example.test',
    };
    const tip = await createInvoiceCheckoutSession(db, invoice.id, env, { tipCents: 2500, mode: 'invoice' });
    assert.equal(tip.serviceCents, 27500);
    assert.equal(tip.tipCents, 2500);
    assert.equal(tip.totalCents, 30000);
    const form = calls[0] ?? {};
    assert.equal(form['line_items[0][price_data][unit_amount]'], '27500');
    assert.equal(form['line_items[1][price_data][unit_amount]'], '2500');
    assert.equal(form['metadata[checkout_kind]'], 'invoice_payment');
    assert.equal(form['metadata[tip_cents]'], '2500');
    assert.match(form['line_items[1][price_data][product_data][name]'] ?? '', /Optional gratuity/);

    await applyInvoiceCheckoutPayment(db, {
      id: 'cs_tip_session',
      amount_total: 30000,
      metadata: {
        invoice_id: invoice.id,
        checkout_kind: 'invoice_payment',
        service_amount_cents: '27500',
        tip_cents: '2500',
      },
    });
    calls.length = 0;
    const tipOnly = await createInvoiceCheckoutSession(db, invoice.id, env, { tipCents: 1500, mode: 'tip' });
    assert.equal(tipOnly.serviceCents, 0);
    assert.equal(tipOnly.totalCents, 1500);
    const tipForm = calls.find((form) => form['line_items[0][price_data][unit_amount]'] === '1500') ?? {};
    assert.equal(tipForm['line_items[0][price_data][unit_amount]'], '1500');
    assert.equal(tipForm['line_items[1][price_data][unit_amount]'], undefined, 'tip-only checkout has no service line');
    assert.equal(tipForm['metadata[checkout_kind]'], 'invoice_tip');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the public payment endpoint returns a zero-default invoice view and creates the exact tipped session', async () => {
  const { db, actor, customerId } = await fixture();
  const invoice = await invoiceFixture(db, actor, customerId);
  const env = {
    DB: db,
    STRIPE_SECRET_KEY: 'sk_test_synthetic',
    ADMIN_STRIPE_BILLING_ENABLED: 'true',
    TIPS_LINK_SECRET: 'synthetic-tip-secret',
    PUBLIC_SITE_URL: 'https://example.test',
  };
  const token = await createInvoicePayToken(env, invoice.id, 'invoice');
  const viewResponse = await invoicePayGet({
    request: new Request(`https://example.test/api/invoice-pay?token=${encodeURIComponent(token)}`),
    env,
  } as never);
  assert.equal(viewResponse.status, 200);
  const view = (await viewResponse.json()) as { invoice: Record<string, unknown> };
  assert.equal(view.invoice.invoiceNumber, invoice.number);
  assert.equal(view.invoice.serviceBalanceCents, 27500);
  assert.equal(view.invoice.defaultTipCents, 0);
  assert.deepEqual(view.invoice.suggestionsCents, [1000, 1500, 2500]);
  assert.equal(view.invoice.tipOnly, false);

  const originalFetch = globalThis.fetch;
  const forms: Array<Record<string, string>> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/customers')) return new Response(JSON.stringify({ id: 'cus_public' }), { status: 200 });
    if (url.includes('/checkout/sessions')) {
      forms.push(Object.fromEntries(new URLSearchParams(String(init?.body ?? ''))));
      return new Response(JSON.stringify({ id: 'cs_public_tip', url: 'https://checkout.stripe.test/cs_public_tip' }), { status: 200 });
    }
    return new Response('{}', { status: 500 });
  };
  try {
    const postResponse = await invoicePayPost({
      request: new Request('https://example.test/api/invoice-pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, tipCents: 2500 }),
      }),
      env,
    } as never);
    assert.equal(postResponse.status, 200);
    const created = (await postResponse.json()) as Record<string, unknown>;
    assert.equal(created.totalCents, 30000);
    assert.equal(created.serviceCents, 27500);
    assert.equal(created.tipCents, 2500);
    const form = forms[0] ?? {};
    assert.equal(form['line_items[0][price_data][unit_amount]'], '27500');
    assert.equal(form['line_items[1][price_data][unit_amount]'], '2500');
    assert.equal(form['metadata[service_amount_cents]'], '27500');
    assert.equal(form['metadata[tip_cents]'], '2500');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the public endpoint refuses a tip-only token while the service balance remains', async () => {
  const { db, actor, customerId } = await fixture();
  const invoice = await invoiceFixture(db, actor, customerId);
  const env = {
    DB: db,
    STRIPE_SECRET_KEY: 'sk_test_synthetic',
    ADMIN_STRIPE_BILLING_ENABLED: 'true',
    TIPS_LINK_SECRET: 'synthetic-tip-secret',
    PUBLIC_SITE_URL: 'https://example.test',
  };
  const token = await createInvoicePayToken(env, invoice.id, 'tip');
  const response = await invoicePayGet({
    request: new Request(`https://example.test/api/invoice-pay?token=${encodeURIComponent(token)}`),
    env,
  } as never);
  assert.equal(response.status, 409);
  const post = await invoicePayPost({
    request: new Request('https://example.test/api/invoice-pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, tipCents: 2500 }),
    }),
    env,
  } as never);
  assert.equal(post.status, 409);
});

test('the public endpoint rejects tampered or expired tokens without revealing the invoice', async () => {
  const { db, actor, customerId } = await fixture();
  const invoice = await invoiceFixture(db, actor, customerId);
  const env = {
    DB: db,
    STRIPE_SECRET_KEY: 'sk_test_synthetic',
    ADMIN_STRIPE_BILLING_ENABLED: 'true',
    TIPS_LINK_SECRET: 'synthetic-tip-secret',
    PUBLIC_SITE_URL: 'https://example.test',
  };
  const token = await createInvoicePayToken(env, invoice.id, 'invoice');
  const tampered = `${token.slice(0, -2)}xx`;
  const response = await invoicePayGet({
    request: new Request(`https://example.test/api/invoice-pay?token=${encodeURIComponent(tampered)}`),
    env,
  } as never);
  assert.equal(response.status, 404);
});
