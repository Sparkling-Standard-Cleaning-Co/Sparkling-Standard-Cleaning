// Durable Stripe Customer resolution for public cleaning checkout.
// The D1 customer is the identity authority; email alone never merges records.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { resolveCheckoutStripeCustomer } from '../src/lib/payments/stripe-customers.ts';

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
  for (const file of fs
    .readdirSync('migrations')
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    db.raw.exec(fs.readFileSync(path.join('migrations', file), 'utf8'));
  }
  return db;
}

function seedCustomer(db: TestD1, quoteReference = 'SS-CUSTOMER-1'): string {
  const customerId = 'cust_stripe_sync';
  db.raw
    .prepare(
      `INSERT INTO customers (id, primary_branch_id, first_name, last_name, company_name, status)
       VALUES (?, 'branch_pensacola', 'Synthetic', 'Customer', '', 'active')`,
    )
    .run(customerId);
  db.raw
    .prepare(
      `INSERT INTO customer_contacts (id, customer_id, kind, value, normalized_value, is_primary)
       VALUES ('ct_stripe_email', ?, 'email', 'customer@example.test', 'customer@example.test', 1)`,
    )
    .run(customerId);
  db.raw
    .prepare(
      `INSERT INTO booking_requests
       (id, hold_id, branch_id, customer_id, status, quote_reference, requested_date, start_at, end_at, duration_minutes)
       VALUES ('br_stripe', '2026-12-01__00000000-0000-0000-0000-000000000001', 'branch_pensacola',
               ?, 'pending', ?, '2026-12-01', '2026-12-01T15:00:00', '2026-12-01T17:00:00', 120)`,
    )
    .run(customerId, quoteReference);
  return customerId;
}

function stripeStub(existing: Map<string, string> = new Map()) {
  const created = new Map<string, string>();
  let posts = 0;
  const deleted = new Set<string>();
  const stub = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const href = String(url);
    const method = init?.method ?? 'GET';
    if (method === 'GET' && href.includes('/v1/customers/')) {
      const id = decodeURIComponent(href.split('/').pop() ?? '');
      if (deleted.has(id) || !existing.has(id)) {
        return new Response(JSON.stringify({ error: { code: 'resource_missing' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ id, metadata: { customer_id: existing.get(id) } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (method === 'POST' && href.endsWith('/v1/customers')) {
      posts += 1;
      const body = init?.body as URLSearchParams;
      const customerId = body.get('metadata[customer_id]') ?? '';
      const key = (init?.headers as Record<string, string>)?.['Idempotency-Key'] ?? '';
      if (created.has(key)) {
        return new Response(JSON.stringify({ id: created.get(key) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const id = `cus_synthetic_${created.size + 1}`;
      created.set(key, id);
      existing.set(id, customerId);
      return new Response(JSON.stringify({ id }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`unexpected Stripe call: ${method} ${href}`);
  };
  return { stub, posts: () => posts, created, deleted };
}

async function withFetch<T>(
  stub: (url: string | URL, init?: RequestInit) => Promise<Response>,
  run: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = stub as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const env = { STRIPE_SECRET_KEY: 'sk_live_synthetic' };

test('a linked Stripe Customer is reused and never duplicated', async () => {
  const db = migratedDb();
  const customerId = seedCustomer(db);
  const existing = new Map([['cus_linked', customerId]]);
  const stripe = stripeStub(existing);
  db.raw.prepare('UPDATE customers SET stripe_customer_id = ? WHERE id = ?').run('cus_linked', customerId);
  const result = await withFetch(stripe.stub, () =>
    resolveCheckoutStripeCustomer(db, env, {
      reference: 'SS-CUSTOMER-1',
      email: 'customer@example.test',
      name: 'Synthetic Customer',
    }),
  );
  assert.equal(result.customerId, customerId);
  assert.equal(result.stripeCustomerId, 'cus_linked');
  assert.equal(result.source, 'linked');
  assert.equal(stripe.posts(), 0);
});

test('a missing Stripe Customer is created once with a deterministic idempotency key', async () => {
  const db = migratedDb();
  const customerId = seedCustomer(db);
  const stripe = stripeStub();
  const result = await withFetch(stripe.stub, () =>
    resolveCheckoutStripeCustomer(db, env, {
      reference: 'SS-CUSTOMER-1',
      email: 'customer@example.test',
      name: 'Synthetic Customer',
    }),
  );
  assert.equal(result.customerId, customerId);
  assert.equal(result.source, 'created');
  assert.equal(stripe.posts(), 1);
  assert.equal(
    db.raw.prepare('SELECT stripe_customer_id FROM customers WHERE id = ?').get(customerId).stripe_customer_id,
    result.stripeCustomerId,
  );
});

test('simultaneous attempts cannot create two Stripe Customers', async () => {
  const db = migratedDb();
  seedCustomer(db);
  const stripe = stripeStub();
  const call = () =>
    resolveCheckoutStripeCustomer(db, env, {
      reference: 'SS-CUSTOMER-1',
      email: 'customer@example.test',
      name: 'Synthetic Customer',
    });
  const results = await withFetch(stripe.stub, () => Promise.all([call(), call(), call()]));
  assert.equal(new Set(results.map((entry) => entry.stripeCustomerId)).size, 1);
  assert.equal(stripe.created.size, 1);
  assert.equal(stripe.posts(), 3, 'each request hits Stripe, but the idempotency key returns one customer');
});

test('email alone never links an unrelated customer', async () => {
  const db = migratedDb();
  const stripe = stripeStub();
  const result = await withFetch(stripe.stub, () =>
    resolveCheckoutStripeCustomer(db, env, {
      reference: 'UNKNOWN-QUOTE',
      email: 'customer@example.test',
    }),
  );
  assert.equal(result.customerId, null);
  assert.equal(result.stripeCustomerId, null);
  assert.equal(result.source, 'guest');
  assert.equal(stripe.posts(), 0);
});

test('a legacy projected Stripe Customer is adopted without creating a new one', async () => {
  const db = migratedDb();
  const customerId = seedCustomer(db);
  db.raw.prepare('UPDATE customers SET stripe_customer_id = NULL WHERE id = ?').run(customerId);
  db.raw
    .prepare(
      `INSERT INTO financial_parties (id, kind, display_name, email, email_normalized, stripe_customer_id, customer_id)
       VALUES ('party_legacy', 'service_payer', 'Synthetic', 'customer@example.test', 'customer@example.test', 'cus_legacy', ?)`,
    )
    .run(customerId);
  const stripe = stripeStub(new Map([['cus_legacy', customerId]]));
  const result = await withFetch(stripe.stub, () =>
    resolveCheckoutStripeCustomer(db, env, {
      reference: 'SS-CUSTOMER-1',
      email: 'customer@example.test',
    }),
  );
  assert.equal(result.stripeCustomerId, 'cus_legacy');
  assert.equal(result.source, 'legacy_projection');
  assert.equal(stripe.posts(), 0);
  assert.equal(
    db.raw.prepare('SELECT stripe_customer_id FROM customers WHERE id = ?').get(customerId).stripe_customer_id,
    'cus_legacy',
  );
});

test('a deleted linked Stripe Customer is replaced exactly once', async () => {
  const db = migratedDb();
  const customerId = seedCustomer(db);
  db.raw.prepare('UPDATE customers SET stripe_customer_id = ? WHERE id = ?').run('cus_deleted', customerId);
  const existing = new Map([['cus_deleted', customerId]]);
  const stripe = stripeStub(existing);
  stripe.deleted.add('cus_deleted');
  const result = await withFetch(stripe.stub, () =>
    resolveCheckoutStripeCustomer(db, env, {
      reference: 'SS-CUSTOMER-1',
      email: 'customer@example.test',
    }),
  );
  assert.notEqual(result.stripeCustomerId, 'cus_deleted');
  assert.equal(result.source, 'created');
  assert.equal(stripe.created.size, 1);
  assert.equal(stripe.posts(), 1);
});
