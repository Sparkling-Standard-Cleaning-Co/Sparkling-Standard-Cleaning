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
    '0005_admin_accounts_and_operations.sql',
    '0006_service_catalog_and_lead_permissions.sql',
    '0007_cleaner_field_scope.sql',
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
  const cleanerCrm = db.raw
    .prepare("SELECT COUNT(*) AS count FROM admin_role_permissions WHERE role_id = 'cleaner' AND permission = 'customer.read'")
    .get() as { count: number };
  assert.equal(cleanerCrm.count, 0);


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
    booking_hold_id: 'hold_test_001',
    booking_request_id: 'request_test_001',
    preferred_date: '2026-12-05',
    preferred_time: '9:30 AM',
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
  const request = db.raw.prepare('SELECT status, start_at, end_at FROM booking_requests WHERE id = ?').get('request_test_001') as {
    status: string;
    start_at: string;
    end_at: string;
  };
  assert.equal(request.status, 'pending');
  assert.equal(request.start_at, '2026-12-05T09:30:00');
  assert.equal(request.end_at, '2026-12-05T11:30:00');
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
import { createHmac } from 'node:crypto';

import {
  createRecurring,
  createTeamMember,
  confirmRequest,
  createChecklist,
  getChecklist,
  listAppointments,
  updateChecklistItem,
} from '../src/lib/admin/scheduling.ts';
import {
  createCredit,
  createInvoice,
  getInvoice,
  recordPayment,
  recordRefund,
} from '../src/lib/admin/billing.ts';
import {
  addCustomerNote,
  addProperty,
  createCustomer,
  listCustomers,
  listLeads,
  retryLeadNotification,
  updateCustomer,
  updateLead,
} from '../src/lib/admin/crm.ts';
import {
  acceptInvite,
  inviteAdmin,
  issuePasswordReset,
  resetPassword,
  updateAdminStatus,
} from '../src/lib/admin/accounts.ts';
import {
  createMfaChallenge,
  enableMfa,
  startMfaEnrollment,
  verifyMfaChallenge,
} from '../src/lib/admin/mfa.ts';
import { operationsReport } from '../src/lib/admin/reporting.ts';

function base32Decode(value: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let current = 0;
  const bytes: number[] = [];
  for (const character of value.toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) continue;
    current = (current << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((current >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function totpCode(secret: string, at = Date.now()): string {
  const counter = Math.floor(at / 1000 / 30);
  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter >>> 0, 4);
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 15;
  const value =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(value % 1_000_000).padStart(6, '0');
}

async function ownerActor(db: TestD1) {
  const owner = await enrollOwner(db, {
    email: 'owner@example.test',
    name: 'Synthetic Owner',
    password: 'SyntheticOwner!2026',
  });
  const session = await createOpsSession(db, owner.id, request());
  const actor = await readOpsActor(db, request(`ss_ops=${session.token}`));
  assert.ok(actor);
  return { owner, actor };
}

test('MFA enrollment, challenge verification and one-time recovery codes work', async () => {
  const db = migratedDb();
  const { owner, actor } = await ownerActor(db);
  const enrollment = await startMfaEnrollment(db, owner.id, owner.email);
  assert.match(enrollment.uri, /^otpauth:\/\/totp\//);
  const codes = await enableMfa(db, owner.id, totpCode(enrollment.secret));
  assert.equal(codes?.length, 8);
  assert.equal((await authenticate(db, owner.email, 'SyntheticOwner!2026'))?.mfaEnabled, true);

  const challenge = await createMfaChallenge(db, owner.id);
  assert.deepEqual(
    await verifyMfaChallenge(db, challenge.token, { code: totpCode(enrollment.secret) }),
    { userId: owner.id },
  );

  const recoveryChallenge = await createMfaChallenge(db, owner.id);
  assert.ok(await verifyMfaChallenge(db, recoveryChallenge.token, { recoveryCode: codes![0]! }));
  const reused = await createMfaChallenge(db, owner.id);
  assert.equal(await verifyMfaChallenge(db, reused.token, { recoveryCode: codes![0]! }), null);
  assert.equal(actor.mfaEnabled, false, 'the existing session remains valid until revoked');
});

test('invitations, password reset and account status are enforced', async () => {
  const db = migratedDb();
  const { actor } = await ownerActor(db);
  const invite = await inviteAdmin(db, actor, {
    email: 'manager@example.test',
    role: 'manager',
    branchId: 'branch_pensacola',
  });
  const manager = await acceptInvite(db, {
    token: invite.token,
    password: 'SyntheticManager!2026',
    name: 'Synthetic Manager',
  });
  assert.equal(manager.role, 'manager');
  assert.equal((await authenticate(db, 'manager@example.test', 'SyntheticManager!2026'))?.role, 'manager');
  await assert.rejects(
    () => acceptInvite(db, { token: invite.token, password: 'SyntheticManager!2026' }),
    /invite_invalid/,
  );

  const reset = await issuePasswordReset(db, actor, manager.id);
  await resetPassword(db, { token: reset.token, password: 'ReplacementManager!2026' });
  assert.ok(await authenticate(db, manager.email, 'ReplacementManager!2026'));
  await assert.rejects(() => resetPassword(db, { token: reset.token, password: 'ReplacementManager!2026' }), /reset_invalid/);

  await updateAdminStatus(db, actor, manager.id, 'disabled');
  assert.equal(await authenticate(db, manager.email, 'ReplacementManager!2026'), null);
});

test('customer CRUD, properties, notes and lead recovery are functional', async () => {
  const db = migratedDb();
  const { actor } = await ownerActor(db);
  const created = await createCustomer(db, actor, {
    firstName: 'Synthetic',
    lastName: 'Customer',
    email: 'customer@example.test',
    phone: '8505550111',
    addressLine1: '100 S Baylen St',
    city: 'Pensacola',
    state: 'FL',
    postalCode: '32502',
  });
  const customers = await listCustomers(db, actor, { q: 'Synthetic' });
  assert.equal(customers.length, 1);
  assert.equal(customers[0]?.email, 'customer@example.test');
  await updateCustomer(db, actor, created.id, {
    firstName: 'Updated',
    lastName: 'Customer',
    email: 'customer@example.test',
    phone: '8505550111',
    doNotContact: true,
  });
  const property = await addProperty(db, actor, created.id, {
    line1: '200 S Palafox St',
    city: 'Pensacola',
    state: 'FL',
    postalCode: '32502',
    label: 'Second property',
  });
  await addCustomerNote(db, actor, created.id, 'Prefers morning appointments.');

  const fields: Record<string, string> = {
    request_type: 'reservation_request',
    name: 'Synthetic Customer',
    email: 'customer@example.test',
    phone: '8505550111',
    service_address: '100 S Baylen St',
    address_city: 'Pensacola',
    address_state: 'FL',
    zip: '32502',
    quote_reference: 'SS-20261030-CRM01',
  };
  await persistLeadSubmission(db, fields);
  const leads = await listLeads(db, actor, { q: 'CRM01' });
  assert.equal(leads.length, 1);
  await updateLead(db, actor, String(leads[0]?.id), { status: 'contacted', note: 'Called customer.' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true }), { status: 200 });
  try {
    assert.deepEqual(
      await retryLeadNotification(db, actor, String(leads[0]?.id), { WEB3FORMS_ACCESS_KEY: 'synthetic' }),
      { delivered: true },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  const updated = db.raw.prepare('SELECT status, delivery_status, delivery_attempts FROM leads WHERE id = ?').get(String(leads[0]?.id)) as {
    status: string;
    delivery_status: string;
    delivery_attempts: number;
  };
  assert.equal(updated.status, 'contacted');
  assert.equal(updated.delivery_status, 'sent');
  assert.equal(updated.delivery_attempts, 1);
  assert.ok(property.id);
});

test('scheduling prevents overlaps, assigns crews and tracks checklists', async () => {
  const db = migratedDb();
  const { actor } = await ownerActor(db);
  const customer = await createCustomer(db, actor, {
    firstName: 'Schedule',
    lastName: 'Customer',
    addressLine1: '300 S Baylen St',
    city: 'Pensacola',
    postalCode: '32502',
  });
  const property = db.raw.prepare('SELECT id FROM properties WHERE customer_id = ?').get(customer.id) as { id: string };
  const team = await createTeamMember(db, actor, { displayName: 'Synthetic Cleaner' });
  const start = new Date(Date.now() + 10 * 86_400_000).toISOString();
  const end = new Date(Date.parse(start) + 2 * 60 * 60 * 1000).toISOString();
  for (const suffix of ['A', 'B']) {
    db.raw.prepare(
      `INSERT INTO booking_requests (id, hold_id, branch_id, customer_id, property_id, status, quote_reference, requested_date, start_at, end_at, duration_minutes)
       VALUES (?, ?, 'branch_pensacola', ?, ?, 'pending', ?, ?, ?, ?, 120)`,
    ).run(`req_${suffix}`, `hold_${suffix}`, customer.id, property.id, `REF-${suffix}`, start.slice(0, 10), start, end);
  }
  const confirmed = await confirmRequest(db, actor, 'req_A', [team.id]);
  assert.match(confirmed.reference, /^APT-/);
  await assert.rejects(() => confirmRequest(db, actor, 'req_B'), /schedule_conflict/);
  const appointments = await listAppointments(db, actor);
  assert.equal(appointments.length, 1);

  const recurring = await createRecurring(db, actor, {
    customerId: customer.id,
    propertyId: property.id,
    frequency: 'biweekly',
    startDate: start.slice(0, 10),
    ongoingPrice: 150,
  });
  assert.ok(recurring.id);

  const checklist = await createChecklist(db, actor, confirmed.appointmentId);
  const detail = await getChecklist(db, actor, confirmed.appointmentId);
  const item = (detail?.items as Array<Record<string, unknown>>)[0];
  await updateChecklistItem(db, actor, String(item?.id), true);
  const after = await getChecklist(db, actor, confirmed.appointmentId);
  assert.equal((after?.items as Array<Record<string, unknown>>)[0]?.completed, 1);
});

test('invoices, manual payments, refunds and credits reconcile in integer cents', async () => {
  const db = migratedDb();
  const { actor } = await ownerActor(db);
  const customer = await createCustomer(db, actor, {
    firstName: 'Billing',
    lastName: 'Customer',
    addressLine1: '400 S Baylen St',
    city: 'Pensacola',
    postalCode: '32502',
  });
  const invoice = await createInvoice(db, actor, {
    customerId: customer.id,
    lines: [
      { kind: 'service', description: 'Deep cleaning', quantity: 1, unitAmountCents: 30000, totalCents: 30000 },
      { kind: 'discount', description: 'Courtesy discount', quantity: 1, unitAmountCents: 2500, totalCents: 2500 },
      { kind: 'tax', description: 'Tax', quantity: 1, unitAmountCents: 0, totalCents: 0 },
    ],
  });
  assert.equal(invoice.totalCents, 27500);
  const payment = await recordPayment(db, actor, {
    invoiceId: invoice.id,
    provider: 'cash',
    amount: 100,
    idempotencyKey: 'cash-1',
  });
  let detail = await getInvoice(db, actor, invoice.id);
  assert.equal((detail?.invoice as Record<string, unknown>).balance_cents, 17500);
  await assert.rejects(
    () => recordPayment(db, actor, { invoiceId: invoice.id, provider: 'cash', amount: 200 }),
    /payment_exceeds_balance/,
  );
  await recordRefund(db, actor, { paymentId: payment.id, amount: 25, reason: 'Synthetic adjustment' });
  detail = await getInvoice(db, actor, invoice.id);
  assert.equal((detail?.invoice as Record<string, unknown>).amount_paid_cents, 7500);
  const credit = await createCredit(db, actor, { customerId: customer.id, amount: 20, source: 'synthetic' });
  assert.ok(credit.id);

  const report = await operationsReport(db, actor);
  assert.ok(Array.isArray(report.invoices));
  assert.ok((report.branches as Array<Record<string, unknown>>).length >= 2);
});

test('the login route requires MFA and issues a session only after verification', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'mfa-route@example.test',
    name: 'MFA Route Owner',
    password: 'SyntheticOwner!2026',
  });
  const enrollment = await startMfaEnrollment(db, owner.id, owner.email);
  await enableMfa(db, owner.id, totpCode(enrollment.secret));
  const env = { DB: db };
  const login = await authPost({
    request: new Request('https://example.test/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', email: owner.email, password: 'SyntheticOwner!2026' }),
    }),
    env,
  } as never);
  assert.equal(login.status, 200);
  assert.equal(login.headers.get('Set-Cookie'), null);
  const payload = (await login.json()) as { mfaRequired?: boolean; challengeToken?: string };
  assert.equal(payload.mfaRequired, true);
  assert.ok(payload.challengeToken);

  const verify = await authPost({
    request: new Request('https://example.test/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mfa_verify', challengeToken: payload.challengeToken, code: totpCode(enrollment.secret) }),
    }),
    env,
  } as never);
  assert.equal(verify.status, 200);
  assert.match(verify.headers.get('Set-Cookie') ?? '', /^ss_ops=/);
});
