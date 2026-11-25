import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import {
  createPortalServiceRequest,
  portalSnapshot,
  readPortalSession,
  requirePortalCsrf,
  requestPortalAccess,
  revokePortalSession,
  verifyPortalToken,
} from '../src/lib/portal/service.ts';
import { createPortalBillingSession } from '../src/lib/admin/stripe-billing.ts';

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
  const directory = path.join(process.cwd(), 'migrations');
  for (const file of fs.readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) {
    db.raw.exec(fs.readFileSync(path.join(directory, file), 'utf8'));
  }
  return db;
}

function seedCustomer(db: TestD1, id: string, email: string, firstName: string): void {
  db.raw.prepare(
    "INSERT INTO customers (id, first_name, last_name, status, primary_branch_id) VALUES (?, ?, 'Customer', 'active', 'branch_pensacola')",
  ).run(id, firstName);
  db.raw.prepare(
    "INSERT INTO customer_contacts (id, customer_id, kind, value, normalized_value, is_primary) VALUES (?, ?, 'email', ?, ?, 1)",
  ).run(`contact_${id}`, id, email, email.toLowerCase());
  const phone = `850555-${id}`;
  db.raw.prepare(
    "INSERT INTO customer_contacts (id, customer_id, kind, value, normalized_value, is_primary) VALUES (?, ?, 'phone', ?, ?, 0)",
  ).run(`phone_${id}`, id, phone, phone);
  db.raw.prepare(
    "INSERT INTO properties (id, customer_id, branch_id, label, line1, city, state, postal_code, is_primary) VALUES (?, ?, 'branch_pensacola', 'Home', '100 Synthetic Street', 'Pensacola', 'FL', '32502', 1)",
  ).run(`property_${id}`, id);
}

function portalRequest(cookie = ''): Request {
  return new Request('https://example.test/api/portal/data', {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

test('portal access never discloses whether an email is on file', async () => {
  const db = migratedDb();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ id: 'email_portal' }), { status: 200 });
  }) as typeof fetch;
  try {
    const unknown = await requestPortalAccess(db, { RESEND_API_KEY: 're_test' }, { email: 'nobody@example.test' });
    assert.deepEqual(unknown, { ok: true });
    assert.equal(calls, 0);
    const rows = db.raw.prepare('SELECT COUNT(*) AS count FROM customer_portal_tokens').get() as { count: number };
    assert.equal(rows.count, 0);

    seedCustomer(db, 'cust_portal', 'client@example.test', 'Jordan');
    const known = await requestPortalAccess(db, { RESEND_API_KEY: 're_test' }, { email: 'client@example.test' });
    assert.deepEqual(known, { ok: true });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a secure link is single use, hashed at rest and creates a customer-scoped session', async () => {
  const db = migratedDb();
  seedCustomer(db, 'cust_portal', 'client@example.test', 'Jordan');
  const originalFetch = globalThis.fetch;
  let sentLink = '';
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { text?: string };
    sentLink = String(body.text ?? '');
    return new Response(JSON.stringify({ id: 'email_portal' }), { status: 200 });
  }) as typeof fetch;
  try {
    await requestPortalAccess(db, { RESEND_API_KEY: 're_test' }, { email: 'CLIENT@example.test' });
    const token = new URL(sentLink.match(/https?:\/\/\S+/)![0]).searchParams.get('token') ?? '';
    assert.ok(token.length > 20);
    const stored = db.raw.prepare('SELECT token_hash, email FROM customer_portal_tokens LIMIT 1').get() as { token_hash: string; email: string };
    assert.notEqual(stored.token_hash, token);
    assert.equal(stored.token_hash.length, 64);
    assert.equal(stored.email, 'client@example.test');

    const session = await verifyPortalToken(db, token);
    assert.ok(session);
    assert.equal(session.customerId, 'cust_portal');
    assert.ok(session.csrf.length > 20);
    const cookie = `__Host-ss_portal=${session.sessionToken}`;
    const loaded = await readPortalSession(db, portalRequest(cookie));
    assert.equal(loaded?.customerId, 'cust_portal');
    assert.equal(loaded?.csrf, session.csrf);

    assert.equal(await verifyPortalToken(db, token), null);
    requirePortalCsrf(loaded!, loaded!.csrf);
    assert.throws(() => requirePortalCsrf(loaded!, 'wrong'), /csrf_invalid/);

    await revokePortalSession(db, portalRequest(cookie));
    assert.equal(await readPortalSession(db, portalRequest(cookie)), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('expired portal links are rejected and cannot create a session', async () => {
  const db = migratedDb();
  seedCustomer(db, 'cust_portal', 'client@example.test', 'Jordan');
  const originalFetch = globalThis.fetch;
  let sentLink = '';
  globalThis.fetch = (async (_input, init) => {
    sentLink = String((JSON.parse(String(init?.body ?? '{}')) as { text?: string }).text ?? '');
    return new Response(JSON.stringify({ id: 'email_portal' }), { status: 200 });
  }) as typeof fetch;
  try {
    await requestPortalAccess(db, { RESEND_API_KEY: 're_test' }, { email: 'client@example.test' });
    const token = new URL(sentLink.match(/https?:\/\/\S+/)![0]).searchParams.get('token') ?? '';
    db.raw.prepare("UPDATE customer_portal_tokens SET expires_at = '2020-01-01T00:00:00.000Z'").run();
    assert.equal(await verifyPortalToken(db, token), null);
    const sessions = db.raw.prepare('SELECT COUNT(*) AS count FROM customer_portal_sessions').get() as { count: number };
    assert.equal(sessions.count, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('portal snapshots never include another customer records', async () => {
  const db = migratedDb();
  seedCustomer(db, 'cust_a', 'a@example.test', 'Avery');
  seedCustomer(db, 'cust_b', 'b@example.test', 'Blake');
  db.raw.prepare(
    "INSERT INTO appointments (id, reference, customer_id, property_id, branch_id, status, start_at, end_at, duration_minutes) VALUES ('appt_a', 'A-1', 'cust_a', 'property_cust_a', 'branch_pensacola', 'confirmed', '2026-12-01T15:00:00.000Z', '2026-12-01T17:00:00.000Z', 120)",
  ).run();
  db.raw.prepare(
    "INSERT INTO appointments (id, reference, customer_id, property_id, branch_id, status, start_at, end_at, duration_minutes) VALUES ('appt_b', 'B-1', 'cust_b', 'property_cust_b', 'branch_pensacola', 'confirmed', '2026-12-02T15:00:00.000Z', '2026-12-02T17:00:00.000Z', 120)",
  ).run();
  db.raw.prepare(
    "INSERT INTO invoices (id, branch_id, customer_id, number, status, issue_date, due_date, total_cents, balance_cents) VALUES ('inv_a', 'branch_pensacola', 'cust_a', 'INV-A', 'open', '2026-11-20', '2026-12-04', 20000, 20000)",
  ).run();
  const snapshot = await portalSnapshot(db, {
    sessionId: 's', customerId: 'cust_a', csrf: 'c', email: 'a@example.test', name: 'Avery',
  });
  const appointments = snapshot.appointments as Array<Record<string, unknown>>;
  const invoices = snapshot.invoices as Array<Record<string, unknown>>;
  assert.deepEqual(appointments.map((row) => row.reference), ['A-1']);
  assert.deepEqual(invoices.map((row) => row.number), ['INV-A']);
});

test('portal service requests are customer-scoped and routed to customer service', async () => {
  const db = migratedDb();
  seedCustomer(db, 'cust_a', 'a@example.test', 'Avery');
  seedCustomer(db, 'cust_b', 'b@example.test', 'Blake');
  db.raw.prepare(
    "INSERT INTO appointments (id, reference, customer_id, property_id, branch_id, status, start_at, end_at, duration_minutes) VALUES ('appt_b', 'B-1', 'cust_b', 'property_cust_b', 'branch_pensacola', 'confirmed', '2026-12-02T15:00:00.000Z', '2026-12-02T17:00:00.000Z', 120)",
  ).run();
  const session = { sessionId: 's', customerId: 'cust_a', csrf: 'c', email: 'a@example.test', name: 'Avery' };
  const originalFetch = globalThis.fetch;
  const recipients: string[] = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { to?: string[] };
    recipients.push(...(body.to ?? []));
    return new Response(JSON.stringify({ id: 'email_request' }), { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => createPortalServiceRequest(db, { RESEND_API_KEY: 're_test' }, session, {
        kind: 'question', message: 'Synthetic question', appointmentId: 'appt_b',
      }),
      /appointment_not_found/,
    );
    const created = await createPortalServiceRequest(db, { RESEND_API_KEY: 're_test' }, session, {
      kind: 'question', message: 'Please confirm the arrival window.',
    });
    assert.ok(created.id.startsWith('preq_'));
    assert.deepEqual(recipients, [
      'customer-service@sparkling-standard.com',
      'owner@sparkling-standard.com',
    ]);
    const row = db.raw.prepare('SELECT customer_id, message, status FROM customer_portal_requests WHERE id = ?').get(created.id) as Record<string, unknown>;
    assert.equal(row.customer_id, 'cust_a');
    assert.equal(row.status, 'received');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('portal billing creates a Stripe customer once and a portal session without charging', async () => {
  const db = migratedDb();
  seedCustomer(db, 'cust_portal', 'client@example.test', 'Jordan');
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/customers')) return new Response(JSON.stringify({ id: 'cus_portal' }), { status: 200 });
    if (url.includes('/billing_portal/sessions')) {
      return new Response(JSON.stringify({ id: 'bps_portal', url: 'https://billing.stripe.test/portal' }), { status: 200 });
    }
    return new Response('{}', { status: 500 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => createPortalBillingSession(db, 'cust_portal', 'client@example.test', { STRIPE_SECRET_KEY: 'sk_test' }),
      /portal_billing_disabled/,
    );
    const session = await createPortalBillingSession(db, 'cust_portal', 'client@example.test', {
      STRIPE_SECRET_KEY: 'sk_test',
      PORTAL_BILLING_ENABLED: 'true',
      PUBLIC_SITE_URL: 'https://example.test',
    });
    assert.equal(session.sessionId, 'bps_portal');
    const customer = db.raw.prepare('SELECT stripe_customer_id FROM customers WHERE id = ?').get('cust_portal') as { stripe_customer_id: string };
    assert.equal(customer.stripe_customer_id, 'cus_portal');
    assert.equal(calls.filter((call) => call.endsWith('/customers')).length, 1);
    assert.equal(calls.some((call) => call.includes('/charges') || call.includes('/payment_intents')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
