import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import {
  authenticate,
  createOpsSession,
  enrollOwner,
  rateLimit,
  readOpsActor,
  requireActor,
  requireCsrf,
} from '../src/lib/admin/operations.ts';
import { hashPassword } from '../src/lib/admin/auth.ts';
import { persistLeadSubmission } from '../src/lib/admin/lead-persistence.ts';
import { onRequestGet as overviewGet } from '../functions/api/admin/overview.ts';
import { onRequestPost as authPost } from '../functions/api/admin/auth.ts';

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
  for (const file of [
    '0001_operational_foundation.sql',
    '0002_admin_security_and_seeds.sql',
    '0003_admin_session_hardening.sql',
    '0004_branch_scope.sql',
  ]) {
    db.raw.exec(fs.readFileSync(path.join('migrations', file), 'utf8'));
  }
  return db;
}

function request(cookie = ''): Request {
  return new Request('https://example.test/api/admin/overview', {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

test('the cleaning-only migrations apply and preserve core integrity', () => {
  const db = migratedDb();
  const tables = db.raw
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((row) => String((row as { name: string }).name));
  assert.ok(tables.includes('customers'));
  assert.ok(tables.includes('admin_users'));
  assert.ok(tables.includes('gift_certificates'));
  assert.equal(tables.includes('businesses'), false, 'no multi-business schema');
  assert.equal(tables.includes('ownership_organizations'), false, 'no holding-company schema');

  const branches = db.raw.prepare('SELECT id, status FROM branches ORDER BY id').all() as Array<{
    id: string;
    status: string;
  }>;
  assert.deepEqual(branches.map((branch) => branch.id), ['branch_pensacola', 'branch_tampa']);

  const ownerPermissions = db.raw
    .prepare("SELECT COUNT(*) AS count FROM admin_role_permissions WHERE role_id = 'owner'")
    .get() as { count: number };
  assert.ok(ownerPermissions.count >= 10);

  const moneyColumns = db.raw.prepare('PRAGMA table_info(invoices)').all() as Array<{
    name: string;
    type: string;
  }>;
  for (const name of ['subtotal_cents', 'tax_cents', 'total_cents', 'balance_cents']) {
    const column = moneyColumns.find((entry) => entry.name === name);
    assert.equal(column?.type, 'INTEGER', `${name} must be integer cents`);
  }

  const fk = db.raw.prepare('PRAGMA foreign_key_check').all();
  assert.deepEqual(fk, []);
});

test('owner enrollment, login, sessions, expiration and CSRF work', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'owner@example.test',
    name: 'Synthetic Owner',
    password: 'SyntheticOwner!2026',
  });
  assert.equal(owner.role, 'owner');
  assert.equal(await authenticate(db, 'owner@example.test', 'wrong-password'), null);
  assert.equal((await authenticate(db, 'owner@example.test', 'SyntheticOwner!2026'))?.id, owner.id);

  const session = await createOpsSession(db, owner.id, request());
  const actor = await readOpsActor(db, request(`ss_ops=${session.token}`));
  assert.equal(actor?.email, 'owner@example.test');
  assert.ok(actor?.permissions.includes('finance.write'));
  requireCsrf(
    new Request('https://example.test/api/admin/auth', {
      method: 'POST',
      headers: { 'X-CSRF-Token': session.csrf },
    }),
    actor!,
  );
  assert.throws(
    () =>
      requireCsrf(
        new Request('https://example.test/api/admin/auth', {
          method: 'POST',
          headers: { 'X-CSRF-Token': 'wrong' },
        }),
        actor!,
      ),
    /csrf_failed/,
  );

  db.raw
    .prepare("UPDATE admin_sessions SET expires_at = ? WHERE user_id = ?")
    .run('2020-01-01T00:00:00.000Z', owner.id);
  assert.equal(await readOpsActor(db, request(`ss_ops=${session.token}`)), null);
});

test('the setup endpoint enrolls exactly one owner and rejects the code afterward', async () => {
  const db = migratedDb();
  const env = { DB: db, ADMIN_SETUP_CODE: 'synthetic-setup-code' };
  const body = {
    action: 'setup',
    setupCode: 'synthetic-setup-code',
    name: 'Synthetic Owner',
    email: 'owner@example.test',
    password: 'SyntheticOwner!2026',
  };
  const first = await authPost({
    request: new Request('https://example.test/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
  } as never);
  assert.equal(first.status, 200);
  const cookie = first.headers.get('Set-Cookie') ?? '';
  assert.match(cookie, /^ss_ops=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal((await first.json() as { ok: boolean }).ok, true);

  const second = await authPost({
    request: new Request('https://example.test/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
  } as never);
  assert.equal(second.status, 409);
});

test('the setup endpoint rate-limits repeated wrong codes', async () => {
  const db = migratedDb();
  const env = { DB: db, ADMIN_SETUP_CODE: 'synthetic-setup-code' };
  let last: Response | null = null;
  for (let attempt = 0; attempt < 11; attempt += 1) {
    last = await authPost({
      request: new Request('https://example.test/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' },
        body: JSON.stringify({ action: 'setup', setupCode: 'wrong-code' }),
      }),
      env,
    } as never);
  }
  assert.equal(last?.status, 429);
});

test('roles enforce server-side permissions and branch scope', async () => {
  const db = migratedDb();
  const managerId = 'admin_manager_test';
  const hash = await hashPassword('SyntheticManager!2026');
  db.raw
    .prepare(
      `INSERT INTO admin_users (id, role_id, branch_id, email, password_hash, display_name, status)
       VALUES (?, 'manager', 'branch_pensacola', ?, ?, 'Synthetic Manager', 'active')`,
    )
    .run(managerId, 'manager@example.test', hash);
  const session = await createOpsSession(db, managerId, request());
  const actor = await readOpsActor(db, request(`ss_ops=${session.token}`));
  assert.ok(actor);
  await requireActor(db, request(`ss_ops=${session.token}`), 'customer.read');
  await assert.rejects(
    requireActor(db, request(`ss_ops=${session.token}`), 'finance.write'),
    /forbidden/,
  );

  db.raw
    .prepare(
      `INSERT INTO customers (id, primary_branch_id, first_name, status)
       VALUES ('cust_pensacola', 'branch_pensacola', 'Pensacola', 'active'),
              ('cust_tampa', 'branch_tampa', 'Tampa', 'active')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO leads (id, branch_id, customer_id, request_type, status, idempotency_key)
       VALUES ('lead_pensacola', 'branch_pensacola', 'cust_pensacola', 'residential_estimate', 'new', 'seed-p'),
              ('lead_tampa', 'branch_tampa', 'cust_tampa', 'residential_estimate', 'new', 'seed-t')`,
    )
    .run();
  const response = await overviewGet({
    request: request(`ss_ops=${session.token}`),
    env: { DB: db },
  } as never);
  const payload = (await response.json()) as {
    counts: { customers: number; leads: number };
    recentLeads: Array<{ id: string }>;
  };
  assert.equal(payload.counts.customers, 1);
  assert.equal(payload.counts.leads, 1);
  assert.deepEqual(payload.recentLeads.map((lead) => lead.id), ['lead_pensacola']);
});

test('lead persistence is idempotent and creates a customer, property and request', async () => {
  const db = migratedDb();
  const fields: Record<string, string> = {
    request_type: 'reservation_request',
    name: 'Synthetic Lead',
    email: 'lead@example.test',
    phone: '8505550100',
    service_address: '100 S Baylen St',
    address_city: 'Pensacola',
    address_state: 'FL',
    zip: '32502',
    quote_reference: 'SS-20261030-LEAD01',
    service_type: 'standard',
    pin_latitude: '30.4111',
    pin_longitude: '-87.2164',
    pin_precision: 'exact',
  };
  const first = await persistLeadSubmission(db, fields);
  const second = await persistLeadSubmission(db, fields);
  assert.ok(first);
  assert.deepEqual(second, first);
  const leads = db.raw.prepare('SELECT COUNT(*) AS count FROM leads').get() as { count: number };
  const customers = db.raw.prepare('SELECT COUNT(*) AS count FROM customers').get() as { count: number };
  const properties = db.raw.prepare('SELECT COUNT(*) AS count FROM properties').get() as { count: number };
  assert.equal(leads.count, 1);
  assert.equal(customers.count, 1);
  assert.equal(properties.count, 1);
  const lead = db.raw.prepare('SELECT branch_id, customer_id, property_id FROM leads').get() as {
    branch_id: string;
    customer_id: string;
    property_id: string;
  };
  assert.equal(lead.branch_id, 'branch_pensacola');
  assert.equal(lead.customer_id, first.customerId);
  assert.equal(lead.property_id, first.propertyId);
});

test('rate limiting is durable and blocks after the configured threshold', async () => {
  const db = migratedDb();
  assert.equal(await rateLimit(db, 'test:login', 2, 15, 15), true);
  assert.equal(await rateLimit(db, 'test:login', 2, 15, 15), true);
  assert.equal(await rateLimit(db, 'test:login', 2, 15, 15), false);
  const row = db.raw.prepare('SELECT attempts, blocked_until FROM admin_rate_limits').get() as {
    attempts: number;
    blocked_until: string;
  };
  assert.equal(row.attempts, 3);
  assert.ok(Date.parse(row.blocked_until) > Date.now());
});
