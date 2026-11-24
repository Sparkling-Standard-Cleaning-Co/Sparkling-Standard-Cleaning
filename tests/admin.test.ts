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
  requireStepUp,
} from '../src/lib/admin/operations.ts';
import { hashPassword } from '../src/lib/admin/auth.ts';
import { persistLeadSubmission } from '../src/lib/admin/lead-persistence.ts';
import { onRequestGet as overviewGet } from '../functions/api/admin/overview.ts';
import { onRequestPost as authPost } from '../functions/api/admin/auth.ts';
import { onRequestGet as adminRequestsGet, onRequestPost as adminRequestsPost } from '../functions/api/admin/requests.ts';
import { onRequestPost as accountsPost } from '../functions/api/admin/accounts.ts';
import { onRequestGet as adminLeadsGet, onRequestPost as adminLeadsPost } from '../functions/api/admin/leads.ts';
import { onRequestGet as operationsGet } from '../functions/api/admin/operations.ts';
import { onRequestPost as operationsPost } from '../functions/api/admin/operations.ts';
import { onRequestGet as customersGet } from '../functions/api/admin/customers.ts';
import { onRequestGet as storageGet } from '../functions/api/admin/storage.ts';

const MFA_KEY = 'synthetic-mfa-encryption-key-32-bytes-minimum';

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
  for (const file of fs.readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
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

test('cleaner sessions cannot reach admin operations or customer APIs', async () => {
  const db = migratedDb();
  db.raw
    .prepare(
      `INSERT INTO admin_users
       (id, branch_id, role_id, email, password_hash, display_name, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
    )
    .run('user_cleaner', 'branch_pensacola', 'cleaner', 'cleaner@example.test', 'unused', 'Synthetic Cleaner');
  const session = await createOpsSession(db, 'user_cleaner', request());
  const cookie = `ss_ops=${session.token}`;

  const operations = await operationsGet({
    request: new Request('https://example.test/api/admin/operations?view=jobs', {
      headers: { Cookie: cookie },
    }),
    env: { DB: db },
  } as never);
  assert.equal(operations.status, 403);

  const customers = await customersGet({
    request: new Request('https://example.test/api/admin/customers', {
      headers: { Cookie: cookie },
    }),
    env: { DB: db },
  } as never);
  assert.equal(customers.status, 403);
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
  const customers = db.raw
    .prepare("SELECT COUNT(*) AS count FROM customers WHERE id <> 'customer_financial_system'")
    .get() as { count: number };
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
  assert.equal(request.start_at, '2026-12-05T15:30:00.000Z');
  assert.equal(request.end_at, '2026-12-05T17:30:00.000Z');
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
  applyCreditToInvoice,
  createCredit,
  createInvoice,
  getInvoice,
  listCustomerCredits,
  recordPayment,
  recordRefund,
} from '../src/lib/admin/billing.ts';
import { deliverInvoiceReceipt } from '../src/lib/invoicing/invoice-receipt.ts';
import {
  beginRefund,
  completeRefund,
  failRefund,
  projectStripeDispute,
  projectStripeRefund,
  recordReconciliationIssue,
} from '../src/lib/admin/refunds.ts';
import {
  addCustomerNote,
  addProperty,
  createCustomer,
  deleteCustomer,
  getCustomer,
  listCustomers,
  listLeads,
  retryLeadNotification,
  setCustomerStatus,
  updateCustomer,
  updateLead,
  updateProperty,
} from '../src/lib/admin/crm.ts';
import {
  acceptInvite,
  changePassword,
  inviteAdmin,
  issuePasswordReset,
  passwordResetStatus,
  requestPasswordReset,
  resetPassword,
  updateAdminStatus,
} from '../src/lib/admin/accounts.ts';
import {
  passwordConfirmationProblem,
  passwordPolicyMessage,
  passwordProblem,
} from '../src/lib/password-policy.ts';
import {
  createEmailMfaChallenge,
  createMfaChallenge,
  emailMfaChallengeExists,
  enableEmailMfa,
  enableMfa,
  prepareEmailMfaResend,
  startMfaEnrollment,
  verifyEmailMfaChallenge,
  verifyMfaChallenge,
} from '../src/lib/admin/mfa.ts';
import { operationsReport } from '../src/lib/admin/reporting.ts';
import { applyGiftPaymentToInvoice } from '../src/lib/admin/gift-reconcile.ts';
import { applyInvoiceCheckoutPayment } from '../src/lib/admin/stripe-reconcile.ts';
import { createInvoicePaymentLink, refundStripePayment, createSavedCardSetupSession, recordSavedCardSetup, chargeInvoiceWithAuthorization } from '../src/lib/admin/stripe-billing.ts';
import { createPaymentAuthorization, getPaymentAuthorization, signPaymentAuthorization } from '../src/lib/admin/payment-authorization.ts';

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
  const enrollment = await startMfaEnrollment(db, owner.id, owner.email, MFA_KEY);
  assert.match(enrollment.uri, /^otpauth:\/\/totp\//);
  const codes = await enableMfa(db, owner.id, totpCode(enrollment.secret), MFA_KEY);
  assert.equal(codes?.length, 8);
  const stored = db.raw.prepare('SELECT mfa_secret FROM admin_users WHERE id = ?').get(owner.id) as { mfa_secret: string };
  assert.match(stored.mfa_secret, /^v1\./);
  assert.equal((await authenticate(db, owner.email, 'SyntheticOwner!2026'))?.mfaEnabled, true);

  const challenge = await createMfaChallenge(db, owner.id);
  assert.deepEqual(
    await verifyMfaChallenge(db, challenge.token, { code: totpCode(enrollment.secret), encryptionKey: MFA_KEY }),
    { userId: owner.id },
  );

  const recoveryChallenge = await createMfaChallenge(db, owner.id);
  assert.ok(await verifyMfaChallenge(db, recoveryChallenge.token, { recoveryCode: codes![0]!, encryptionKey: MFA_KEY }));
  const reused = await createMfaChallenge(db, owner.id);
  assert.equal(await verifyMfaChallenge(db, reused.token, { recoveryCode: codes![0]!, encryptionKey: MFA_KEY }), null);
  assert.equal(actor.mfaEnabled, false, 'the existing session remains valid until revoked');
});

test('email MFA challenges are hashed, single-use, rate-limited and recoverable', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'email-mfa@example.test',
    name: 'Email MFA Owner',
    password: 'SyntheticOwner!2026',
  });
  const challenge = await createEmailMfaChallenge(db, owner.id, '123456');
  assert.equal(await emailMfaChallengeExists(db, challenge.token), true);
  assert.equal(await verifyEmailMfaChallenge(db, challenge.token, { code: '000000' }), null);
  const cooldown = await prepareEmailMfaResend(db, challenge.token, '654321');
  assert.equal(cooldown.ok, false);
  assert.equal(cooldown.reason, 'cooldown');
  db.raw
    .prepare('UPDATE admin_email_mfa_challenges SET last_sent_at = ?')
    .run(new Date(Date.now() - 120_000).toISOString());
  const resent = await prepareEmailMfaResend(db, challenge.token, '654321');
  assert.equal(resent.ok, true);
  assert.equal(await verifyEmailMfaChallenge(db, challenge.token, { code: '123456' }), null);
  assert.deepEqual(await verifyEmailMfaChallenge(db, challenge.token, { code: '654321' }), {
    userId: owner.id,
  });
  assert.equal(await verifyEmailMfaChallenge(db, challenge.token, { code: '654321' }), null);

  const recoveryCodes = await enableEmailMfa(db, owner.id);
  assert.equal(recoveryCodes.length, 8);
  const authenticated = await authenticate(db, owner.email, 'SyntheticOwner!2026');
  assert.equal(authenticated?.mfaEnabled, true);
  assert.equal(authenticated?.mfaMethod, 'email');
  const recoveryChallenge = await createEmailMfaChallenge(db, owner.id, '111111');
  assert.deepEqual(
    await verifyEmailMfaChallenge(db, recoveryChallenge.token, { recoveryCode: recoveryCodes[0] }),
    { userId: owner.id },
  );
});

test('sensitive actions require a fresh MFA step-up and the step-up route refreshes it', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'step-up@example.test',
    name: 'Step Up Owner',
    password: 'SyntheticOwner!2026',
  });
  const enrollment = await startMfaEnrollment(db, owner.id, owner.email, MFA_KEY);
  await enableMfa(db, owner.id, totpCode(enrollment.secret), MFA_KEY);
  const session = await createOpsSession(db, owner.id, request());
  const cookie = `ss_ops=${session.token}`;
  let actor = await readOpsActor(db, request(cookie));
  assert.ok(actor);
  assert.throws(() => requireStepUp(actor!), /mfa_step_up_required/);

  const start = await authPost({
    request: new Request('https://example.test/api/admin/auth', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'X-CSRF-Token': session.csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'step_up_start' }),
    }),
    env: { DB: db, MFA_ENCRYPTION_KEY: MFA_KEY },
  } as never);
  assert.equal(start.status, 200);
  const started = (await start.json()) as { challengeToken?: string; mfaMethod?: string };
  assert.equal(started.mfaMethod, 'totp');
  assert.ok(started.challengeToken);

  const verify = await authPost({
    request: new Request('https://example.test/api/admin/auth', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'X-CSRF-Token': session.csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'step_up_verify',
        challengeToken: started.challengeToken,
        code: totpCode(enrollment.secret),
      }),
    }),
    env: { DB: db, MFA_ENCRYPTION_KEY: MFA_KEY },
  } as never);
  assert.equal(verify.status, 200);
  actor = await readOpsActor(db, request(cookie));
  assert.ok(actor?.stepUpAt);
  requireStepUp(actor!);

  db.raw
    .prepare('UPDATE admin_sessions SET step_up_at = ? WHERE user_id = ?')
    .run(new Date(Date.now() - 11 * 60_000).toISOString(), owner.id);
  actor = await readOpsActor(db, request(cookie));
  assert.throws(() => requireStepUp(actor!), /mfa_step_up_required/);
});
test('data exports reject a stale MFA session and recover after step-up', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'export-step-up@example.test',
    name: 'Export Owner',
    password: 'SyntheticOwner!2026',
  });
  const enrollment = await startMfaEnrollment(db, owner.id, owner.email, MFA_KEY);
  await enableMfa(db, owner.id, totpCode(enrollment.secret), MFA_KEY);
  const session = await createOpsSession(db, owner.id, request());
  const cookie = `ss_ops=${session.token}`;
  const url = 'https://example.test/api/admin/storage?export=customers&format=csv';
  const blocked = await storageGet({
    request: new Request(url, { headers: { Cookie: cookie } }),
    env: { DB: db },
  } as never);
  assert.equal(blocked.status, 403);
  assert.equal(((await blocked.json()) as { error?: string }).error, 'mfa_step_up_required');

  db.raw
    .prepare('UPDATE admin_sessions SET step_up_at = ? WHERE user_id = ?')
    .run(new Date().toISOString(), owner.id);
  const allowed = await storageGet({
    request: new Request(url, { headers: { Cookie: cookie } }),
    env: { DB: db },
  } as never);
  assert.equal(allowed.status, 200);
  assert.match(allowed.headers.get('Content-Type') ?? '', /text\/csv/);
});
test('email MFA enrollment, verified login and recovery work together with a controlled account', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'email-enrollment@example.test',
    name: 'Email Enrollment Owner',
    password: 'SyntheticOwner!2026',
  });
  const session = await createOpsSession(db, owner.id, request());
  const cookie = `ss_ops=${session.token}`;
  const sent: Array<Record<string, unknown>> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    sent.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return new Response(JSON.stringify({ id: 'email_mfa_controlled' }), { status: 200 });
  }) as typeof fetch;
  try {
    const env = {
      DB: db,
      RESEND_API_KEY: 're_test_synthetic',
      RESEND_FROM_EMAIL: 'notifications@example.test',
      PUBLIC_SITE_URL: 'https://sparkling-standard.com',
    };
    const started = await accountsPost({
      request: new Request('https://example.test/api/admin/accounts', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'X-CSRF-Token': session.csrf,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'mfa_email_start', password: 'SyntheticOwner!2026' }),
      }),
      env,
    } as never);
    assert.equal(started.status, 200);
    const enrollment = (await started.json()) as { challengeToken?: string };
    assert.ok(enrollment.challengeToken);
    assert.equal(sent.length, 1);
    const code = String(sent[0].text ?? '').match(/\b\d{6}\b/)?.[0] ?? '';
    assert.match(code, /^\d{6}$/);

    const enabled = await accountsPost({
      request: new Request('https://example.test/api/admin/accounts', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'X-CSRF-Token': session.csrf,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'mfa_email_enable',
          challengeToken: enrollment.challengeToken,
          code,
        }),
      }),
      env,
    } as never);
    assert.equal(enabled.status, 200);
    const recovery = (await enabled.json()) as { recoveryCodes?: string[] };
    assert.equal(recovery.recoveryCodes?.length, 8);
    const authenticated = await authenticate(db, owner.email, 'SyntheticOwner!2026');
    assert.equal(authenticated?.mfaEnabled, true);
    assert.equal(authenticated?.mfaMethod, 'email');
    const refreshed = await readOpsActor(db, request(cookie));
    assert.equal(refreshed?.mfaEnabled, true);
    assert.equal(refreshed?.stepUpAt, null);

    const disabled = await accountsPost({
      request: new Request('https://example.test/api/admin/accounts', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'X-CSRF-Token': session.csrf,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'mfa_disable',
          password: 'SyntheticOwner!2026',
          recoveryCode: recovery.recoveryCodes?.[0],
        }),
      }),
      env,
    } as never);
    assert.equal(disabled.status, 200);
    assert.equal((await authenticate(db, owner.email, 'SyntheticOwner!2026'))?.mfaEnabled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('the login route sends an email code and accepts it without exposing a session early', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'email-login@example.test',
    name: 'Email Login Owner',
    password: 'SyntheticOwner!2026',
  });
  await enableEmailMfa(db, owner.id);
  const sent: Array<Record<string, unknown>> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    sent.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return new Response(JSON.stringify({ id: 'email_mfa_test' }), { status: 200 });
  }) as typeof fetch;
  try {
    const env = {
      DB: db,
      RESEND_API_KEY: 're_test_synthetic',
      RESEND_FROM_EMAIL: 'notifications@example.test',
      PUBLIC_SITE_URL: 'https://sparkling-standard.com',
    };
    const login = await authPost({
      request: new Request('https://example.test/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', email: owner.email, password: 'SyntheticOwner!2026' }),
      }),
      env,
    } as never);
    const payload = (await login.json()) as {
      mfaRequired?: boolean;
      mfaMethod?: string;
      challengeToken?: string;
    };
    assert.equal(payload.mfaRequired, true);
    assert.equal(payload.mfaMethod, 'email');
    assert.equal(login.headers.get('Set-Cookie'), null);
    assert.equal(sent.length, 1);
    const body = String(sent[0].text ?? '');
    const code = body.match(/\b\d{6}\b/)?.[0] ?? '';
    assert.match(code, /^\d{6}$/);
    const verify = await authPost({
      request: new Request('https://example.test/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mfa_verify', challengeToken: payload.challengeToken, code }),
      }),
      env,
    } as never);
    assert.equal(verify.status, 200);
    assert.match(verify.headers.get('Set-Cookie') ?? '', /^ss_ops=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
    propertyLabel: 'Home',
    propertyType: 'house',
    squareFeet: 1800,
    bedrooms: 3,
    fullBaths: 2,
    halfBaths: 1,
    stories: 1,
    pets: 'none',
    accessNotes: 'Side gate code 1102.',
    parkingNotes: 'Driveway.',
    internalNotes: 'Dog is friendly.',
  });
  const createdDetail = await getCustomer(db, actor, created.id);
  const firstProperty = (createdDetail?.properties as Array<Record<string, unknown>>)?.[0];
  assert.equal(firstProperty?.label, 'Home');
  assert.equal(firstProperty?.property_type, 'house');
  assert.equal(firstProperty?.square_feet, 1800);
  assert.equal(firstProperty?.is_primary, 1);
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
    line2: 'Unit 4',
    city: 'Pensacola',
    state: 'FL',
    postalCode: '32502',
    label: 'Second property',
    propertyType: 'condo',
    squareFeet: 1450,
    bedrooms: 2,
    fullBaths: 2,
    halfBaths: 1,
    stories: 1,
    beds: 2,
    pets: 'one',
    accessNotes: 'Lockbox 4421; use the north stairwell.',
    parkingNotes: 'Guest spaces 12 and 14 only.',
    internalNotes: 'Fragile blinds in the primary bedroom.',
    isPrimary: true,
  });
  await updateProperty(db, actor, property.id, {
    line1: '200 S Palafox St',
    line2: 'Unit 4',
    city: 'Pensacola',
    state: 'FL',
    postalCode: '32502',
    label: 'Second property - updated',
    propertyType: 'condo',
    squareFeet: 1500,
    bedrooms: 2,
    fullBaths: 2,
    halfBaths: 1,
    stories: 2,
    beds: 3,
    pets: 'none',
    accessNotes: 'Lockbox 4421.',
    parkingNotes: 'Guest spaces 12 and 14 only.',
    internalNotes: 'Fragile blinds in the primary bedroom.',
    status: 'active',
  });
  const detail = await getCustomer(db, actor, created.id);
  const savedProperty = (detail?.properties as Array<Record<string, unknown>>)?.find((row) => row.id === property.id);
  assert.equal(savedProperty?.property_type, 'condo');
  assert.equal(savedProperty?.square_feet, 1500);
  assert.equal(savedProperty?.beds, 3);
  assert.equal(savedProperty?.pets, 'none');
  assert.equal(savedProperty?.internal_notes, 'Fragile blinds in the primary bedroom.');
  await assert.rejects(
    () => addProperty(db, actor, created.id, { line1: '3 Bad St', propertyType: 'castle' }),
    (error: unknown) => (error as { code?: string }).code === 'property_type_invalid',
  );
  await assert.rejects(
    () => addProperty(db, actor, created.id, { line1: '3 Bad St', squareFeet: 99999 }),
    (error: unknown) => (error as { code?: string }).code === 'property_square_feet_invalid',
  );
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
  const team = await createTeamMember(db, actor, { displayName: 'Synthetic Cleaner', isSolo: true });
  const start = new Date(Date.now() + 10 * 86_400_000).toISOString();
  const end = new Date(Date.parse(start) + 2 * 60 * 60 * 1000).toISOString();
  for (const suffix of ['A', 'B']) {
    db.raw.prepare(
      `INSERT INTO booking_requests (id, hold_id, branch_id, customer_id, property_id, status, quote_reference, requested_date, start_at, end_at, duration_minutes)
       VALUES (?, ?, 'branch_pensacola', ?, ?, 'pending', ?, ?, ?, ?, 120)`,
    ).run(`req_${suffix}`, `hold_${suffix}`, customer.id, property.id, `REF-${suffix}`, start.slice(0, 10), start, end);
  }
  const hayli = db.raw.prepare("SELECT id FROM team_members WHERE booking_resource_id = 'hayli'").get() as { id: string };
  const confirmed = await confirmRequest(db, actor, 'req_A', [team.id, hayli.id]);
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
    window: 'morning',
    startTime: '07:00',
    durationMinutes: 180,
    crewSize: 1,
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
  const applied = await applyCreditToInvoice(db, actor, {
    invoiceId: invoice.id,
    creditId: credit.id,
    amountCents: 2000,
  });
  assert.equal(applied.appliedCents, 2000);
  assert.equal(applied.remainingCents, 0);
  const afterCredit = await getInvoice(db, actor, invoice.id);
  assert.equal((afterCredit?.invoice as Record<string, unknown>).balance_cents, 18000);
  assert.equal((afterCredit?.invoice as Record<string, unknown>).amount_paid_cents, 9500);
  const credits = await listCustomerCredits(db, actor, customer.id);
  assert.equal(credits[0]?.status, 'used');

  const report = await operationsReport(db, actor);
  assert.ok(Array.isArray(report.invoices));
  assert.ok((report.branches as Array<Record<string, unknown>>).length >= 2);
});

test('refunds are cumulative, idempotent and never over-refund a payment', async () => {
  const db = migratedDb();
  const { actor } = await ownerActor(db);
  const customer = await createCustomer(db, actor, {
    firstName: 'Refund',
    lastName: 'Customer',
    addressLine1: '450 S Baylen St',
    city: 'Pensacola',
    postalCode: '32502',
  });
  const invoice = await createInvoice(db, actor, {
    customerId: customer.id,
    lines: [{ kind: 'service', description: 'Cleaning', quantity: 1, unitAmountCents: 20000, totalCents: 20000 }],
  });
  const payment = await recordPayment(db, actor, {
    invoiceId: invoice.id,
    provider: 'cash',
    amount: 100,
    idempotencyKey: 'refund-cash-1',
  });

  const first = await recordRefund(db, actor, {
    paymentId: payment.id,
    amount: 40,
    idempotencyKey: 'refund-request-1',
  });
  const retry = await recordRefund(db, actor, {
    paymentId: payment.id,
    amount: 40,
    idempotencyKey: 'refund-request-1',
  });
  assert.equal(retry.id, first.id);
  let detail = await getInvoice(db, actor, invoice.id);
  assert.equal((detail?.invoice as Record<string, unknown>).amount_paid_cents, 6000);
  assert.equal((detail?.payments as Array<Record<string, unknown>>)[0]?.status, 'partially_refunded');
  assert.equal((db.raw.prepare('SELECT COUNT(*) AS n FROM refunds').get() as { n: number }).n, 1);

  await recordRefund(db, actor, {
    paymentId: payment.id,
    amount: 60,
    idempotencyKey: 'refund-request-2',
  });
  detail = await getInvoice(db, actor, invoice.id);
  assert.equal((detail?.invoice as Record<string, unknown>).amount_paid_cents, 0);
  assert.equal((detail?.invoice as Record<string, unknown>).status, 'open');
  assert.equal((detail?.payments as Array<Record<string, unknown>>)[0]?.status, 'refunded');

  await assert.rejects(
    () => recordRefund(db, actor, { paymentId: payment.id, amount: 1, idempotencyKey: 'refund-request-3' }),
    /refund_exceeds_remaining/,
  );
});

test('pending and failed refunds do not corrupt invoice balances', async () => {
  const db = migratedDb();
  const { actor } = await ownerActor(db);
  const customer = await createCustomer(db, actor, {
    firstName: 'Pending',
    lastName: 'Refund',
    addressLine1: '475 S Baylen St',
    city: 'Pensacola',
    postalCode: '32502',
  });
  const invoice = await createInvoice(db, actor, {
    customerId: customer.id,
    lines: [{ kind: 'service', description: 'Cleaning', quantity: 1, unitAmountCents: 10000, totalCents: 10000 }],
  });
  const payment = await recordPayment(db, actor, {
    invoiceId: invoice.id,
    provider: 'cash',
    amount: 100,
    idempotencyKey: 'pending-refund-payment',
  });
  const pending = await beginRefund(db, actor, {
    paymentId: payment.id,
    amountCents: 3000,
    idempotencyKey: 'pending-refund-1',
    status: 'pending',
  });
  let detail = await getInvoice(db, actor, invoice.id);
  assert.equal((detail?.invoice as Record<string, unknown>).amount_paid_cents, 10000);
  await completeRefund(db, actor, pending.id);
  detail = await getInvoice(db, actor, invoice.id);
  assert.equal((detail?.invoice as Record<string, unknown>).amount_paid_cents, 7000);
  await completeRefund(db, actor, pending.id);
  detail = await getInvoice(db, actor, invoice.id);
  assert.equal((detail?.invoice as Record<string, unknown>).amount_paid_cents, 7000);
  await assert.rejects(
    () =>
      beginRefund(db, actor, {
        paymentId: payment.id,
        amountCents: 8000,
        idempotencyKey: 'pending-refund-over',
        status: 'pending',
      }),
    /refund_exceeds_remaining/,
  );
  const failing = await beginRefund(db, actor, {
    paymentId: payment.id,
    amountCents: 2000,
    idempotencyKey: 'pending-refund-2',
    status: 'pending',
  });
  await failRefund(db, actor, failing.id, 'synthetic provider failure');
  detail = await getInvoice(db, actor, invoice.id);
  assert.equal((detail?.invoice as Record<string, unknown>).amount_paid_cents, 7000);
});

test('provider refund and dispute events project idempotently', async () => {
  const db = migratedDb();
  const { actor } = await ownerActor(db);
  const customer = await createCustomer(db, actor, {
    firstName: 'Provider',
    lastName: 'Events',
    addressLine1: '480 S Baylen St',
    city: 'Pensacola',
    postalCode: '32502',
  });
  const invoice = await createInvoice(db, actor, {
    customerId: customer.id,
    lines: [{ kind: 'service', description: 'Cleaning', quantity: 1, unitAmountCents: 10000, totalCents: 10000 }],
  });
  const payment = await recordPayment(db, actor, {
    invoiceId: invoice.id,
    provider: 'cash',
    amount: 100,
    idempotencyKey: 'provider-event-payment',
  });
  const first = await projectStripeRefund(db, {
    paymentId: payment.id,
    stripeRefundId: 're_provider_1',
    amountCents: 4000,
    status: 'succeeded',
    reason: 'requested_by_customer',
  });
  const retry = await projectStripeRefund(db, {
    paymentId: payment.id,
    stripeRefundId: 're_provider_1',
    amountCents: 4000,
    status: 'succeeded',
  });
  assert.equal(retry.refundId, first.refundId);
  assert.equal(retry.duplicate, true);
  let detail = await getInvoice(db, actor, invoice.id);
  assert.equal((detail?.invoice as Record<string, unknown>).amount_paid_cents, 6000);
  await projectStripeRefund(db, {
    paymentId: payment.id,
    stripeRefundId: 're_provider_pending',
    amountCents: 6000,
    status: 'pending',
  });
  detail = await getInvoice(db, actor, invoice.id);
  assert.equal((detail?.invoice as Record<string, unknown>).amount_paid_cents, 6000);
  await projectStripeDispute(db, {
    paymentId: payment.id,
    disputeId: 'dp_provider_1',
    status: 'needs_response',
    amountCents: 6000,
    currency: 'usd',
    reason: 'product_not_received',
  });
  await projectStripeDispute(db, {
    paymentId: payment.id,
    disputeId: 'dp_provider_1',
    status: 'won',
    amountCents: 6000,
  });
  const dispute = db.raw
    .prepare("SELECT status FROM payment_disputes WHERE provider_dispute_id = 'dp_provider_1'")
    .get() as { status: string };
  assert.equal(dispute.status, 'won');
  await recordReconciliationIssue(db, {
    eventId: 'evt_unmatched',
    kind: 'refund_payment_unmatched',
    detail: 'synthetic unmatched',
  });
  assert.equal(
    (db.raw.prepare('SELECT COUNT(*) AS n FROM payment_reconciliation_issues').get() as { n: number }).n,
    1,
  );
});

test('the login route requires MFA and issues a session only after verification', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'mfa-route@example.test',
    name: 'MFA Route Owner',
    password: 'SyntheticOwner!2026',
  });
  const enrollment = await startMfaEnrollment(db, owner.id, owner.email, MFA_KEY);
  await enableMfa(db, owner.id, totpCode(enrollment.secret), MFA_KEY);
  const env = { DB: db, MFA_ENCRYPTION_KEY: MFA_KEY };
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

test('invoice payment links and Stripe reconciliation are gated and idempotent', async () => {
  const db = migratedDb();
  const { actor } = await ownerActor(db);
  const customer = await createCustomer(db, actor, {
    firstName: 'Stripe',
    lastName: 'Customer',
    email: 'stripe@example.test',
    addressLine1: '600 S Baylen St',
    city: 'Pensacola',
    postalCode: '32502',
  });
  const invoice = await createInvoice(db, actor, {
    customerId: customer.id,
    lines: [{ kind: 'service', description: 'Recurring cleaning', quantity: 1, unitAmountCents: 12000, totalCents: 12000 }],
  });
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/customers')) return new Response(JSON.stringify({ id: 'cus_test_123' }), { status: 200 });
    if (url.includes('/checkout/sessions')) {
      return new Response(JSON.stringify({ id: 'cs_test_123', url: 'https://checkout.stripe.test/cs_test_123' }), { status: 200 });
    }
    if (url.includes('/refunds')) return new Response(JSON.stringify({ id: 're_test_123' }), { status: 200 });
    return new Response('{}', { status: 500 });
  };
  try {
    await assert.rejects(
      () => createInvoicePaymentLink(db, actor, invoice.id, { STRIPE_SECRET_KEY: 'sk_test_synthetic' }),
      /stripe_billing_disabled/,
    );
    const link = await createInvoicePaymentLink(db, actor, invoice.id, {
      STRIPE_SECRET_KEY: 'sk_test_synthetic',
      ADMIN_STRIPE_BILLING_ENABLED: 'true',
      PUBLIC_SITE_URL: 'https://example.test',
    });
    assert.equal(link.sessionId, 'cs_test_123');
    assert.match(link.url, /checkout\.stripe\.test/);
    assert.ok(calls.some((url) => url.includes('/customers')));
    const stored = db.raw.prepare('SELECT payment_url, stripe_checkout_session_id FROM invoices WHERE id = ?').get(invoice.id) as { payment_url: string; stripe_checkout_session_id: string };
    assert.equal(stored.stripe_checkout_session_id, 'cs_test_123');

    const first = await applyInvoiceCheckoutPayment(db, {
      id: 'cs_test_123',
      payment_intent: 'pi_test_123',
      customer: 'cus_test_123',
      amount_total: 12000,
      metadata: { invoice_id: invoice.id, checkout_kind: 'invoice_payment' },
    });
    assert.equal(first.applied, true);
    const duplicate = await applyInvoiceCheckoutPayment(db, {
      id: 'cs_test_123',
      amount_total: 12000,
      metadata: { invoice_id: invoice.id },
    });
    assert.equal(duplicate.duplicate, true);
    let detail = await getInvoice(db, actor, invoice.id);
    assert.equal((detail?.invoice as Record<string, unknown>).status, 'paid');
    assert.equal((detail?.invoice as Record<string, unknown>).balance_cents, 0);
    const stripePayment = (detail?.payments as Array<Record<string, unknown>>)[0];
    assert.equal(stripePayment?.provider, 'stripe');

    await assert.rejects(
      () => refundStripePayment(db, actor, String(stripePayment?.id), 2500, { STRIPE_SECRET_KEY: 'sk_test_synthetic' }),
      /stripe_refunds_disabled/,
    );
    const refund = await refundStripePayment(db, actor, String(stripePayment?.id), 2500, {
      STRIPE_SECRET_KEY: 'sk_test_synthetic',
      ADMIN_STRIPE_REFUNDS_ENABLED: 'true',
    }, 'refund-request-stripe-1');
    assert.equal(refund.refundId, 're_test_123');
    detail = await getInvoice(db, actor, invoice.id);
    assert.equal((detail?.invoice as Record<string, unknown>).amount_paid_cents, 9500);
    assert.equal((detail?.invoice as Record<string, unknown>).balance_cents, 2500);
    const retry = await refundStripePayment(db, actor, String(stripePayment?.id), 2500, {
      STRIPE_SECRET_KEY: 'sk_test_synthetic',
      ADMIN_STRIPE_REFUNDS_ENABLED: 'true',
    }, 'refund-request-stripe-1');
    assert.equal(retry.refundId, 're_test_123');
    detail = await getInvoice(db, actor, invoice.id);
    assert.equal((detail?.invoice as Record<string, unknown>).amount_paid_cents, 9500);
    assert.equal((detail?.invoice as Record<string, unknown>).balance_cents, 2500);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stale or mismatched invoice checkout sessions are expired before a new link', async () => {
  const db = migratedDb();
  const { actor } = await ownerActor(db);
  const customer = await createCustomer(db, actor, {
    firstName: 'Invoice',
    lastName: 'Link',
    email: 'invoice-link@example.test',
  });
  const invoice = await createInvoice(db, actor, {
    customerId: customer.id,
    lines: [{ kind: 'service', description: 'Cleaning', quantity: 1, unitAmountCents: 12000, totalCents: 12000 }],
  });
  db.raw
    .prepare("UPDATE invoices SET payment_url = 'https://checkout.stripe.test/cs_old', stripe_checkout_session_id = 'cs_old' WHERE id = ?")
    .run(invoice.id);
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.includes('/checkout/sessions/cs_old/expire')) {
      return new Response(JSON.stringify({ id: 'cs_old', status: 'expired' }), { status: 200 });
    }
    if (url.includes('/checkout/sessions/cs_old')) {
      return new Response(JSON.stringify({ id: 'cs_old', status: 'open', amount_total: 10000 }), { status: 200 });
    }
    if (url.includes('/checkout/sessions/cs_new')) {
      return new Response(JSON.stringify({ id: 'cs_new', status: 'open', amount_total: 12000 }), { status: 200 });
    }
    if (url.includes('/checkout/sessions')) {
      return new Response(JSON.stringify({ id: 'cs_new', url: 'https://checkout.stripe.test/cs_new' }), { status: 200 });
    }
    if (url.includes('/customers')) {
      return new Response(JSON.stringify({ id: 'cus_new' }), { status: 200 });
    }
    return new Response('{}', { status: 500 });
  };
  const env = {
    STRIPE_SECRET_KEY: 'sk_test_synthetic',
    ADMIN_STRIPE_BILLING_ENABLED: 'true',
    PUBLIC_SITE_URL: 'https://example.test',
  };
  try {
    const link = await createInvoicePaymentLink(db, actor, invoice.id, env);
    assert.equal(link.sessionId, 'cs_new');
    assert.ok(calls.some((call) => call.includes('/cs_old/expire')));
    const stored = db.raw
      .prepare('SELECT stripe_checkout_session_id FROM invoices WHERE id = ?')
      .get(invoice.id) as { stripe_checkout_session_id: string };
    assert.equal(stored.stripe_checkout_session_id, 'cs_new');

    const reused = await createInvoicePaymentLink(db, actor, invoice.id, env);
    assert.equal(reused.sessionId, 'cs_new');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('signed payment authorization gates saved-card setup and off-session charging', async () => {
  const db = migratedDb();
  const { actor } = await ownerActor(db);
  const customer = await createCustomer(db, actor, {
    firstName: 'Signed',
    lastName: 'Customer',
    email: 'signed@example.test',
    addressLine1: '700 S Baylen St',
    city: 'Pensacola',
    postalCode: '32502',
  });
  const authorization = await createPaymentAuthorization(db, actor, {
    customerId: customer.id,
    serviceCode: 'residential-cleaning',
    amountCents: 10000,
    maxAmountCents: 12000,
    chargeAfterService: true,
  });
  const view = await getPaymentAuthorization(db, authorization.token);
  assert.ok(view);
  assert.match(view.content, /PAYMENT METHOD AUTHORIZATION/);
  assert.match(view.content, /up to \$120\.00/);
  await signPaymentAuthorization(db, authorization.token, {
    signerName: 'Signed Customer',
    consent: true,
  }, new Request('https://example.test/payment-authorization', {
    headers: { 'CF-Connecting-IP': '203.0.113.9', 'User-Agent': 'Synthetic Test' },
  }));
  assert.equal(await getPaymentAuthorization(db, authorization.token), null);
  const signed = db.raw.prepare('SELECT status, signer_name, signed_content_sha256, signature_json FROM agreements').get() as {
    status: string;
    signer_name: string;
    signed_content_sha256: string;
    signature_json: string;
  };
  assert.equal(signed.status, 'signed');
  assert.equal(signed.signer_name, 'Signed Customer');
  assert.match(signed.signature_json, /typed/);
  assert.match(signed.signed_content_sha256, /^[a-f0-9]{64}$/);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/customers')) return new Response(JSON.stringify({ id: 'cus_signed_123' }), { status: 200 });
    if (url.includes('/checkout/sessions')) return new Response(JSON.stringify({ id: 'cs_setup_123', url: 'https://checkout.stripe.test/setup/123' }), { status: 200 });
    if (url.includes('/setup_intents/')) return new Response(JSON.stringify({ payment_method: 'pm_test_123' }), { status: 200 });
    if (url.includes('/payment_methods/')) return new Response(JSON.stringify({ card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 } }), { status: 200 });
    if (url.includes('/payment_intents')) return new Response(JSON.stringify({ id: 'pi_offsession_123', status: 'succeeded' }), { status: 200 });
    return new Response('{}', { status: 500 });
  };
  try {
    const setup = await createSavedCardSetupSession(db, actor, authorization.id, {
      STRIPE_SECRET_KEY: 'sk_test_synthetic',
      ADMIN_STRIPE_SAVED_CARDS_ENABLED: 'true',
      PUBLIC_SITE_URL: 'https://example.test',
    });
    assert.match(setup.url, /checkout\.stripe\.test/);
    const saved = await recordSavedCardSetup(db, {
      id: 'cs_setup_123',
      customer: 'cus_signed_123',
      setup_intent: 'seti_123',
      metadata: { authorization_id: authorization.id, customer_id: customer.id, checkout_kind: 'saved_card_setup' },
    }, { STRIPE_SECRET_KEY: 'sk_test_synthetic' });
    assert.equal(saved.saved, true);
    const active = db.raw.prepare('SELECT status, saved_payment_method_id FROM payment_authorizations WHERE id = ?').get(authorization.id) as { status: string; saved_payment_method_id: string };
    assert.equal(active.status, 'active');
    assert.ok(active.saved_payment_method_id);

    const invoice = await createInvoice(db, actor, {
      customerId: customer.id,
      lines: [{ kind: 'service', description: 'After-service charge', quantity: 1, unitAmountCents: 9000, totalCents: 9000 }],
    });
    const charged = await chargeInvoiceWithAuthorization(db, actor, invoice.id, authorization.id, {
      STRIPE_SECRET_KEY: 'sk_test_synthetic',
      ADMIN_STRIPE_OFF_SESSION_ENABLED: 'true',
    });
    assert.equal(charged.status, 'succeeded');
    const detail = await getInvoice(db, actor, invoice.id);
    assert.equal((detail?.invoice as Record<string, unknown>).status, 'paid');
    assert.equal((detail?.invoice as Record<string, unknown>).balance_cents, 0);
    const used = db.raw.prepare('SELECT status FROM payment_authorizations WHERE id = ?').get(authorization.id) as { status: string };
    assert.equal(used.status, 'used');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Owner password policy and self-service recovery (2026-10-30) ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬

function authRequest(body: unknown, ip = '198.51.100.10', origin?: string): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'CF-Connecting-IP': ip,
  };
  if (origin) headers.Origin = origin;
  return new Request('https://sparkling-standard.com/api/admin/auth', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

test('the owner password policy is exactly eight characters plus one special character', () => {
  for (const allowed of ['Passw0rd!', 'abcdefg!', 'a b c d e f !', 'a long passphrase with spaces and ?']) {
    assert.equal(passwordProblem(allowed), null, allowed);
  }
  assert.equal(passwordProblem(''), 'password_required');
  assert.equal(passwordProblem('Short!1'), 'password_too_short');
  assert.equal(passwordProblem('abcdefgh'), 'password_needs_special');
  assert.equal(passwordProblem('abc defgh'), 'password_needs_special');
  assert.equal(passwordProblem('abcdefghi'), 'password_needs_special');
  assert.equal(passwordProblem(`${'a'.repeat(200)}!`), 'password_too_long');
  assert.equal(passwordProblem(`${'a'.repeat(199)}!`), null);
  assert.equal(passwordPolicyMessage('password_too_short'), 'Use at least 8 characters.');
  assert.equal(passwordPolicyMessage('password_needs_special'), 'Include at least one special character, such as ! @ # $ %.');
  assert.equal(passwordConfirmationProblem('Passw0rd!', 'Passw0rd?'), 'password_mismatch');
});

test('owner enrollment accepts the simplified policy and rejects weaker passwords', async () => {
  const db = migratedDb();
  await assert.rejects(
    () => enrollOwner(db, { email: 'short@example.test', name: 'Short', password: 'Ab!1' }),
    /password_too_short/,
  );
  await assert.rejects(
    () => enrollOwner(db, { email: 'nospecial@example.test', name: 'Plain', password: 'abcdefgh' }),
    /password_needs_special/,
  );
  await enrollOwner(db, { email: 'eight@example.test', name: 'Eight', password: 'abcdefg!' });
  assert.ok(await authenticate(db, 'eight@example.test', 'abcdefg!'));
});

test('self-service reset issues a hashed single-use link and signs every session out', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'recovery@example.test',
    name: 'Recovery Owner',
    password: 'SyntheticOwner!2026',
  });
  db.raw.prepare("UPDATE admin_users SET mfa_enabled = 1, mfa_secret = 'v1.synthetic' WHERE id = ?").run(owner.id);
  const session = await createOpsSession(db, owner.id, request());
  assert.ok(await readOpsActor(db, request(`ss_ops=${session.token}`)));

  const reset = await requestPasswordReset(db, owner.email);
  assert.ok(reset?.token);
  const stored = db.raw.prepare('SELECT token_hash FROM admin_password_resets').get() as { token_hash: string };
  assert.notEqual(stored.token_hash, reset!.token, 'only the hash is stored');
  assert.match(stored.token_hash, /^[0-9a-f]{64}$/);
  assert.equal((await passwordResetStatus(db, reset!.token)).valid, true);

  await assert.rejects(
    () => resetPassword(db, { token: reset!.token, password: 'weakpass' }),
    /password_needs_special/,
  );
  assert.equal((await passwordResetStatus(db, reset!.token)).valid, true, 'a rejected password does not consume the link');

  const result = await resetPassword(db, { token: reset!.token, password: 'NewOwner!2026' });
  assert.equal(result.email, owner.email);
  assert.ok(await authenticate(db, owner.email, 'NewOwner!2026'));
  assert.equal(await readOpsActor(db, request(`ss_ops=${session.token}`)), null, 'existing sessions are revoked');
  assert.equal((await passwordResetStatus(db, reset!.token)).valid, false);
  await assert.rejects(
    () => resetPassword(db, { token: reset!.token, password: 'Another!2026' }),
    /reset_invalid/,
  );
  const mfa = db.raw.prepare('SELECT mfa_enabled, mfa_secret FROM admin_users WHERE id = ?').get(owner.id) as {
    mfa_enabled: number;
    mfa_secret: string;
  };
  assert.equal(mfa.mfa_enabled, 1, 'MFA is preserved');
  assert.equal(mfa.mfa_secret, 'v1.synthetic');
});

test('a new reset link invalidates the previous one and unknown emails reveal nothing', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'rotate@example.test',
    name: 'Rotate Owner',
    password: 'SyntheticOwner!2026',
  });
  const first = await requestPasswordReset(db, owner.email);
  const second = await requestPasswordReset(db, owner.email);
  assert.equal((await passwordResetStatus(db, first!.token)).valid, false);
  assert.equal((await passwordResetStatus(db, second!.token)).valid, true);
  assert.equal(await requestPasswordReset(db, 'nobody@example.test'), null);
  const active = db.raw.prepare('SELECT COUNT(*) AS count FROM admin_password_resets WHERE used_at IS NULL').get() as { count: number };
  assert.equal(active.count, 1);
});

test('expired reset links fail closed', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'expired@example.test',
    name: 'Expired Owner',
    password: 'SyntheticOwner!2026',
  });
  const reset = await requestPasswordReset(db, owner.email);
  db.raw
    .prepare('UPDATE admin_password_resets SET expires_at = ? WHERE user_id = ?')
    .run(new Date(Date.now() - 60_000).toISOString(), owner.id);
  assert.equal((await passwordResetStatus(db, reset!.token)).valid, false);
  await assert.rejects(
    () => resetPassword(db, { token: reset!.token, password: 'Expired!2026' }),
    /reset_invalid/,
  );
});

test('an authenticated password change requires the current password and keeps the current session', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'change@example.test',
    name: 'Change Owner',
    password: 'SyntheticOwner!2026',
  });
  const session = await createOpsSession(db, owner.id, request());
  const actor = await readOpsActor(db, request(`ss_ops=${session.token}`));
  assert.ok(actor);
  await assert.rejects(
    () => changePassword(db, actor!, { currentPassword: 'wrong-password', newPassword: 'Changed!2026' }),
    /reauth_failed/,
  );
  await assert.rejects(
    () => changePassword(db, actor!, { currentPassword: 'SyntheticOwner!2026', newPassword: 'short' }),
    /password_too_short/,
  );
  await changePassword(db, actor!, { currentPassword: 'SyntheticOwner!2026', newPassword: 'Changed!2026' });
  assert.ok(await authenticate(db, owner.email, 'Changed!2026'));
  assert.equal(await authenticate(db, owner.email, 'SyntheticOwner!2026'), null);
  assert.ok(await readOpsActor(db, request(`ss_ops=${session.token}`)), 'the active session stays valid');
});

test('the forgot-password endpoint emails a working link without revealing account state', async (t) => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'forgot@example.test',
    name: 'Forgot Owner',
    password: 'SyntheticOwner!2026',
  });
  const originalFetch = globalThis.fetch;
  const sent: Array<Record<string, unknown>> = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /api\.resend\.com\/emails/);
    sent.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return new Response(JSON.stringify({ id: 'email_test' }), { status: 200 });
  };
  const env = {
    DB: db,
    RESEND_API_KEY: 're_test_synthetic',
    RESEND_FROM_EMAIL: 'notifications@example.test',
    PUBLIC_SITE_URL: 'https://sparkling-standard.com',
  };

  const response = await authPost({
    request: authRequest({ action: 'request_reset', email: owner.email }, '198.51.100.60'),
    env,
  } as never);
  assert.equal(response.status, 200);
  const payload = (await response.json()) as Record<string, unknown>;
  assert.equal(typeof payload.message, 'string');
  assert.equal('token' in payload, false, 'the API never returns a token');
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.to instanceof Array ? (sent[0]!.to as string[])[0] : '', owner.email);
  const text = String(sent[0]!.text ?? '');
  const match = text.match(/https:\/\/sparkling-standard\.com\/admin\/\?reset=([A-Za-z0-9_-]+)/);
  assert.ok(match, 'the email links to the password-setting interface');
  const token = decodeURIComponent(match![1]!);

  const unknown = await authPost({
    request: authRequest({ action: 'request_reset', email: 'nobody@example.test' }, '198.51.100.61'),
    env,
  } as never);
  assert.equal(unknown.status, 200);
  assert.deepEqual(await unknown.json(), payload, 'unknown accounts receive the identical response');
  assert.equal(sent.length, 1, 'no email is sent for an unknown account');

  const check = await authPost({
    request: authRequest({ action: 'reset_check', token }, '198.51.100.62'),
    env,
  } as never);
  assert.deepEqual(await check.json(), { ok: true, valid: true, expiresAt: (await passwordResetStatus(db, token)).expiresAt });

  const set = await authPost({
    request: authRequest({ action: 'reset_password', token, password: 'FreshOwner!1' }, '198.51.100.63'),
    env,
  } as never);
  assert.equal(set.status, 200);
  assert.ok(await authenticate(db, owner.email, 'FreshOwner!1'));

  const reuse = await authPost({
    request: authRequest({ action: 'reset_password', token, password: 'Another!1' }, '198.51.100.64'),
    env,
  } as never);
  assert.equal(reuse.status, 400);
  assert.equal(((await reuse.json()) as { error: string }).error, 'reset_invalid');

  const crossOrigin = await authPost({
    request: authRequest({ action: 'request_reset', email: owner.email }, '198.51.100.65', 'https://evil.example'),
    env,
  } as never);
  assert.equal(crossOrigin.status, 403);
});

test('the login route rejects a cross-origin state-changing request', async () => {
  const db = migratedDb();
  await enrollOwner(db, {
    email: 'origin@example.test',
    name: 'Origin Owner',
    password: 'SyntheticOwner!2026',
  });
  const response = await authPost({
    request: authRequest({ action: 'login', email: 'origin@example.test', password: 'SyntheticOwner!2026' }, '198.51.100.70', 'https://evil.example'),
    env: { DB: db },
  } as never);
  assert.equal(response.status, 403);
});


// ?? Booking request management (2026-10-30) ?????????????????????????????????

test('legacy requests can be opened, flagged as possible duplicates and linked', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'requests@example.test',
    name: 'Requests Owner',
    password: 'SyntheticOwner!2026',
  });
  const session = await createOpsSession(db, owner.id, request());
  const actor = await readOpsActor(db, request(`ss_ops=${session.token}`));
  assert.ok(actor);

  const insert = db.raw.prepare(
    `INSERT INTO booking_requests
     (id, hold_id, status, quote_reference, requested_date, start_at, end_at, duration_minutes, payload_json)
     VALUES (?, ?, 'pending', ?, '2026-10-30', ?, ?, 438, ?)`,
  );
  const payload = JSON.stringify({
    source: 'r2_backfill',
    locationText: '100 S BAYLEN ST - PENSACOLA, FL 32502',
    destination: { lat: 30.719, lng: -87.442 },
  });
  insert.run('BR-1', 'hold-1', 'SS-ONE', '2026-10-30T13:45:00.000Z', '2026-10-30T21:03:00.000Z', payload);
  insert.run('BR-2', 'hold-2', 'SS-TWO', '2026-10-30T14:00:00.000Z', '2026-10-30T21:39:00.000Z', payload);

  const headers = { Cookie: `ss_ops=${session.token}`, Accept: 'application/json' };
  const detailResponse = await adminRequestsGet({
    request: new Request('https://example.test/api/admin/requests?id=BR-1', { headers }),
    env: { DB: db },
  } as never);
  assert.equal(detailResponse.status, 200);
  const detail = (await detailResponse.json()) as Record<string, unknown>;
  assert.equal((detail.request as Record<string, unknown>).customer_id, null);
  assert.equal((detail.payload as Record<string, unknown>).locationText, '100 S BAYLEN ST - PENSACOLA, FL 32502');
  assert.equal((detail.possibleDuplicates as unknown[]).length, 1, 'the second legacy request is flagged');
  assert.equal(detail.email, '');

  const customer = await createCustomer(db, actor!, {
    firstName: 'Verified',
    lastName: 'Customer',
    email: 'verified@example.test',
    addressLine1: '100 S Baylen St',
    city: 'Molino',
    state: 'FL',
    postalCode: '32577',
  });
  const customerDetail = await getCustomer(db, actor!, String(customer.id));
  const property = (customerDetail?.properties as Array<Record<string, unknown>>)[0];

  const linkResponse = await adminRequestsPost({
    request: new Request('https://example.test/api/admin/requests', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'X-CSRF-Token': actor!.csrf },
      body: JSON.stringify({ action: 'link_customer', requestId: 'BR-1', customerId: customer.id, propertyId: property.id }),
    }),
    env: { DB: db },
  } as never);
  assert.equal(linkResponse.status, 200);
  const linked = db.raw.prepare('SELECT customer_id, property_id FROM booking_requests WHERE id = ?').get('BR-1') as {
    customer_id: string;
    property_id: string;
  };
  assert.equal(linked.customer_id, customer.id);
  assert.equal(linked.property_id, property.id);
  const auditRow = db.raw
    .prepare("SELECT action FROM admin_audit WHERE entity_id = 'BR-1' ORDER BY created_at DESC LIMIT 1")
    .get() as { action: string };
  assert.equal(auditRow.action, 'request.customer_linked');
});

test('a request without a customer can create and link a verified customer', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'request-create@example.test',
    name: 'Requests Owner',
    password: 'SyntheticOwner!2026',
  });
  const session = await createOpsSession(db, owner.id, request());
  const actor = await readOpsActor(db, request(`ss_ops=${session.token}`));
  assert.ok(actor);
  db.raw
    .prepare(
      `INSERT INTO booking_requests
       (id, hold_id, status, quote_reference, requested_date, start_at, end_at, duration_minutes, payload_json)
       VALUES ('BR-3', 'hold-3', 'pending', 'SS-THREE', '2026-10-30', '2026-10-30T14:00:00.000Z', '2026-10-30T16:00:00.000Z', 120, '{}')`,
    )
    .run();
  const response = await adminRequestsPost({
    request: new Request('https://example.test/api/admin/requests', {
      method: 'POST',
      headers: {
        Cookie: `ss_ops=${session.token}`,
        'Content-Type': 'application/json',
        'X-CSRF-Token': actor!.csrf,
      },
      body: JSON.stringify({
        action: 'create_customer',
        requestId: 'BR-3',
        firstName: 'New',
        lastName: 'Customer',
        email: 'new-request-customer@example.test',
        addressLine1: '100 S Baylen St',
        city: 'Pensacola',
        state: 'FL',
        postalCode: '32502',
      }),
    }),
    env: { DB: db },
  } as never);
  assert.equal(response.status, 200);
  const linked = db.raw
    .prepare('SELECT customer_id, property_id FROM booking_requests WHERE id = ?')
    .get('BR-3') as { customer_id: string; property_id: string };
  assert.ok(linked.customer_id);
  assert.ok(linked.property_id);
  const count = db.raw
    .prepare("SELECT COUNT(*) AS count FROM customer_contacts WHERE normalized_value = 'new-request-customer@example.test'")
    .get() as { count: number };
  assert.equal(count.count, 1, 'no duplicate customer contact is created');
});


test('a gift redemption is applied to an invoice exactly once', async () => {
  const db = migratedDb();
  const { actor } = await ownerActor(db);
  const customer = await createCustomer(db, actor, {
    firstName: 'Gift',
    lastName: 'Customer',
    email: 'gift-invoice@example.test',
    addressLine1: '200 S Baylen St',
    city: 'Pensacola',
    state: 'FL',
    postalCode: '32502',
  });
  const invoice = await createInvoice(db, actor, {
    customerId: customer.id,
    lines: [{ kind: 'service', description: 'Deep cleaning', quantity: 1, unitAmountCents: 23000, totalCents: 23000 }],
  });
  const first = await applyGiftPaymentToInvoice(db, actor, {
    invoiceId: invoice.id,
    amountCents: 9000,
    giftCode: 'SSGC-AAAA-BBBB',
    reference: 'invoice:test:SSGC-AAAA-BBBB:9000',
  });
  assert.equal(first.duplicate, false);
  assert.equal(first.balanceCents, 14000);
  const detail = await getInvoice(db, actor, invoice.id);
  assert.equal((detail?.invoice as Record<string, unknown>).balance_cents, 14000);
  const payment = db.raw
    .prepare("SELECT provider, amount_cents, status, metadata_json FROM payments WHERE invoice_id = ?")
    .get(invoice.id) as { provider: string; amount_cents: number; status: string; metadata_json: string };
  assert.equal(payment.provider, 'external');
  assert.equal(payment.amount_cents, 9000);
  assert.equal(payment.status, 'succeeded');
  assert.match(payment.metadata_json, /gift_certificate/);
  assert.match(payment.metadata_json, /SSGC-AAAA-BBBB/);

  const duplicate = await applyGiftPaymentToInvoice(db, actor, {
    invoiceId: invoice.id,
    amountCents: 9000,
    giftCode: 'SSGC-AAAA-BBBB',
    reference: 'invoice:test:SSGC-AAAA-BBBB:9000',
  });
  assert.equal(duplicate.duplicate, true);
  const count = db.raw.prepare('SELECT COUNT(*) AS count FROM payments WHERE invoice_id = ?').get(invoice.id) as {
    count: number;
  };
  assert.equal(count.count, 1, 'a retry never credits the invoice twice');

  await assert.rejects(
    () =>
      applyGiftPaymentToInvoice(db, actor, {
        invoiceId: invoice.id,
        amountCents: 99999,
        giftCode: 'SSGC-AAAA-BBBB',
        reference: 'invoice:test:over-balance',
      }),
    /payment_exceeds_balance/,
  );
});

test('closed and archived requests stay searchable and can be reopened', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'lifecycle@example.test',
    name: 'Lifecycle Owner',
    password: 'SyntheticOwner!2026',
  });
  const session = await createOpsSession(db, owner.id, request());
  const actor = await readOpsActor(db, request(`ss_ops=${session.token}`));
  assert.ok(actor);
  db.raw.prepare(
    `INSERT INTO booking_requests
     (id, hold_id, status, quote_reference, requested_date, start_at, end_at, duration_minutes, payload_json)
     VALUES ('BR-LIFE', 'hold-life', 'released', 'SS-LIFE', '2026-11-02', '2026-11-02T14:00:00.000Z', '2026-11-02T16:00:00.000Z', 120, '{"locationText":"100 Bluebird Dr, Pensacola, FL 32503"}') `,
  ).run();
  const headers = {
    Cookie: `ss_ops=${session.token}`,
    'Content-Type': 'application/json',
    'X-CSRF-Token': actor!.csrf,
  };
  const archived = await adminRequestsPost({
    request: new Request('https://example.test/api/admin/requests', {
      method: 'POST', headers, body: JSON.stringify({ action: 'archive', requestId: 'BR-LIFE' }),
    }),
    env: { DB: db },
  } as never);
  assert.equal(archived.status, 200);
  const archivedRow = db.raw.prepare('SELECT archived_at, previous_status FROM booking_requests WHERE id = ?').get('BR-LIFE') as { archived_at: string; previous_status: string };
  assert.ok(archivedRow.archived_at);
  assert.equal(archivedRow.previous_status, 'released');
  const search = await adminRequestsGet({
    request: new Request('https://example.test/api/admin/requests?view=archived&q=Bluebird', { headers: { Cookie: `ss_ops=${session.token}` } }),
    env: { DB: db },
  } as never);
  assert.equal(search.status, 200);
  const listed = (await search.json()) as { requests: Array<Record<string, unknown>> };
  assert.equal(listed.requests.some((entry) => entry.id === 'BR-LIFE'), true);
  const reopened = await adminRequestsPost({
    request: new Request('https://example.test/api/admin/requests', {
      method: 'POST', headers, body: JSON.stringify({ action: 'reopen', requestId: 'BR-LIFE' }),
    }),
    env: { DB: db },
  } as never);
  assert.equal(reopened.status, 200);
  const reopenedRow = db.raw.prepare('SELECT status, archived_at FROM booking_requests WHERE id = ?').get('BR-LIFE') as { status: string; archived_at: string | null };
  assert.equal(reopenedRow.status, 'pending');
  assert.equal(reopenedRow.archived_at, null);
});

test('bulk reservation actions reach the real handler, preview eligibility and persist outcomes', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'bulk-owner@example.test',
    name: 'Bulk Owner',
    password: 'SyntheticOwner!2026',
  });
  const session = await createOpsSession(db, owner.id, request());
  const actor = await readOpsActor(db, request(`ss_ops=${session.token}`));
  assert.ok(actor);
  db.raw
    .prepare(
      `INSERT INTO booking_requests
       (id, hold_id, status, quote_reference, requested_date, start_at, end_at, duration_minutes, payload_json)
       VALUES (?, ?, ?, ?, '2026-11-10', ?, ?, 120, '{}')`,
    )
    .run('BR-BULK-CLOSED', 'hold-bulk-1', 'released', 'SS-BULK-1', '2026-11-10T14:00:00.000Z', '2026-11-10T16:00:00.000Z');
  db.raw
    .prepare(
      `INSERT INTO booking_requests
       (id, hold_id, status, quote_reference, requested_date, start_at, end_at, duration_minutes, payload_json)
       VALUES (?, ?, 'pending', ?, '2026-11-11', ?, ?, 120, '{}')`,
    )
    .run('BR-BULK-ACTIVE', 'hold-bulk-2', 'SS-BULK-2', '2026-11-11T14:00:00.000Z', '2026-11-11T16:00:00.000Z');
  const headers = {
    Cookie: `ss_ops=${session.token}`,
    'Content-Type': 'application/json',
    'X-CSRF-Token': actor!.csrf,
  };
  const post = (payload: Record<string, unknown>) =>
    adminRequestsPost({
      request: new Request('https://example.test/api/admin/requests', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      }),
      env: { DB: db },
    } as never);

  const previewResponse = await post({
    action: 'bulk_preview',
    operation: 'archive',
    requestIds: ['BR-BULK-CLOSED', 'BR-BULK-ACTIVE'],
  });
  assert.equal(previewResponse.status, 200, 'bulk actions no longer require a single requestId');
  const preview = (await previewResponse.json()) as {
    eligible: number;
    ineligible: number;
    results: Array<{ id: string; ok: boolean; error?: string }>;
  };
  assert.equal(preview.eligible, 1);
  assert.equal(preview.ineligible, 1);
  assert.equal(
    preview.results.find((entry) => entry.id === 'BR-BULK-ACTIVE')?.error,
    'active_request_must_close_or_cancel',
  );

  const archived = await post({
    action: 'bulk',
    operation: 'archive',
    confirm: true,
    requestIds: ['BR-BULK-CLOSED', 'BR-BULK-ACTIVE'],
  });
  assert.equal(archived.status, 200);
  const archivedBody = (await archived.json()) as {
    succeeded: number;
    failed: number;
    results: Array<{ id: string; ok: boolean; error?: string }>;
  };
  assert.equal(archivedBody.succeeded, 1);
  assert.equal(archivedBody.failed, 1, 'an active obligation is protected from archiving');
  const rows = db.raw
    .prepare("SELECT id, archived_at FROM booking_requests WHERE id IN ('BR-BULK-CLOSED','BR-BULK-ACTIVE') ORDER BY id")
    .all() as Array<{ id: string; archived_at: string | null }>;
  assert.ok(rows.find((row) => row.id === 'BR-BULK-CLOSED')?.archived_at);
  assert.equal(rows.find((row) => row.id === 'BR-BULK-ACTIVE')?.archived_at, null);
  const auditRows = db.raw
    .prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'request.bulk_archived' AND entity_id = 'BR-BULK-CLOSED'")
    .get() as { n: number };
  assert.equal(auditRows.n, 1, 'the persisted operation is audited');

  const restored = await post({
    action: 'bulk',
    operation: 'restore',
    confirm: true,
    requestIds: ['BR-BULK-CLOSED'],
  });
  assert.equal(restored.status, 200);
  const restoredRow = db.raw
    .prepare('SELECT archived_at FROM booking_requests WHERE id = ?')
    .get('BR-BULK-CLOSED') as { archived_at: string | null };
  assert.equal(restoredRow.archived_at, null);

  const protectedArchive = await post({ action: 'archive', requestId: 'BR-BULK-ACTIVE' });
  assert.equal(protectedArchive.status, 409, 'an individual archive cannot bypass an active obligation');
  const denied = await post({
    action: 'bulk',
    operation: 'deny',
    confirm: true,
    requestIds: ['BR-BULK-ACTIVE'],
  });
  assert.equal(denied.status, 200);
  const deniedRow = db.raw
    .prepare('SELECT status, closed_at FROM booking_requests WHERE id = ?')
    .get('BR-BULK-ACTIVE') as { status: string; closed_at: string | null };
  assert.equal(deniedRow.status, 'declined');
  assert.ok(deniedRow.closed_at);

  const archivedAfterDeny = await post({ action: 'archive', requestId: 'BR-BULK-ACTIVE' });
  assert.equal(archivedAfterDeny.status, 200, 'a closed record can be archived individually');
  const archivedAfterDenyRow = db.raw
    .prepare('SELECT archived_at FROM booking_requests WHERE id = ?')
    .get('BR-BULK-ACTIVE') as { archived_at: string | null };
  assert.ok(archivedAfterDenyRow.archived_at);

  db.raw
    .prepare(
      `INSERT INTO booking_requests
       (id, hold_id, status, quote_reference, requested_date, start_at, end_at, duration_minutes, payload_json)
       VALUES ('BR-BULK-TEST', 'hold-bulk-3', 'pending', 'SS-BULK-TEST', '2026-11-12', '2026-11-12T14:00:00.000Z', '2026-11-12T16:00:00.000Z', 120, '{}')`,
    )
    .run();
  const marked = await post({
    action: 'bulk',
    operation: 'mark_test',
    confirm: true,
    requestIds: ['BR-BULK-TEST'],
  });
  assert.equal(marked.status, 200);
  const testRow = db.raw
    .prepare('SELECT is_test FROM booking_requests WHERE id = ?')
    .get('BR-BULK-TEST') as { is_test: number };
  assert.equal(testRow.is_test, 1);
  const deletedTest = await post({
    action: 'bulk',
    operation: 'delete_test',
    confirm: true,
    requestIds: ['BR-BULK-TEST'],
  });
  assert.equal(deletedTest.status, 200);
  const gone = db.raw
    .prepare("SELECT COUNT(*) AS n FROM booking_requests WHERE id = 'BR-BULK-TEST'")
    .get() as { n: number };
  assert.equal(gone.n, 0, 'an eligible test record is actually deleted');
});

test('customers archive, restore and permanently delete when no history blocks it', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'delete-owner@example.test',
    name: 'Delete Owner',
    password: 'SyntheticOwner!2026',
  });
  const session = await createOpsSession(db, owner.id, request());
  const actor = await readOpsActor(db, request(`ss_ops=${session.token}`));
  assert.ok(actor);

  const clean = await createCustomer(db, actor!, {
    firstName: 'Synthetic',
    lastName: 'Delete',
    email: 'delete-clean@example.test',
    phone: '8505550100',
    addressLine1: '1 Test Lane',
    city: 'Pensacola',
    state: 'FL',
    postalCode: '32503',
  });
  await setCustomerStatus(db, actor!, String(clean.id), 'archived');
  assert.equal((db.raw.prepare('SELECT status FROM customers WHERE id = ?').get(clean.id) as { status: string }).status, 'archived');
  await setCustomerStatus(db, actor!, String(clean.id), 'active');
  await assert.rejects(
    () => deleteCustomer(db, actor!, String(clean.id), 'no'),
    (error: Error & { code?: string }) => error.code === 'delete_confirmation_required',
  );
  const outcome = await deleteCustomer(db, actor!, String(clean.id), 'DELETE');
  assert.equal(outcome.mode, 'deleted');
  assert.equal(db.raw.prepare('SELECT id FROM customers WHERE id = ?').get(clean.id), undefined);
  assert.equal((db.raw.prepare('SELECT COUNT(*) AS n FROM customer_contacts WHERE customer_id = ?').get(clean.id) as { n: number }).n, 0);
  assert.equal((db.raw.prepare('SELECT COUNT(*) AS n FROM properties WHERE customer_id = ?').get(clean.id) as { n: number }).n, 0);
  assert.equal((await deleteCustomer(db, actor!, String(clean.id), 'DELETE')).mode, 'deleted');

  const historicalCustomer = await createCustomer(db, actor!, {
    firstName: 'Historical', lastName: 'Customer', email: 'delete-history@example.test',
  });
  db.raw.prepare(
    `INSERT INTO booking_requests
     (id, hold_id, customer_id, status, quote_reference, requested_date, start_at, end_at, duration_minutes, payload_json)
     VALUES ('BR-HISTORY', 'hold-history', ?, 'released', 'SS-HISTORY', '2026-01-02', '2026-01-02T14:00:00.000Z', '2026-01-02T16:00:00.000Z', 120, '{}')`,
  ).run(historicalCustomer.id);
  const anonymized = await deleteCustomer(db, actor!, String(historicalCustomer.id), 'DELETE');
  assert.equal(anonymized.mode, 'anonymized');
  const retained = db.raw.prepare('SELECT first_name, status FROM customers WHERE id = ?').get(historicalCustomer.id) as { first_name: string; status: string };
  assert.equal(retained.first_name, 'Deleted');
  assert.equal(retained.status, 'archived');
  assert.equal((db.raw.prepare('SELECT COUNT(*) AS n FROM booking_requests WHERE id = ?').get('BR-HISTORY') as { n: number }).n, 1);

  const heldCustomer = await createCustomer(db, actor!, {
    firstName: 'Held', lastName: 'Customer', email: 'delete-held@example.test',
  });
  db.raw.prepare(
    "INSERT INTO legal_holds (id, subject_type, subject_id, reason, status) VALUES ('hold-delete-test','customer',?, 'active litigation hold','active')",
  ).run(heldCustomer.id);
  await assert.rejects(
    () => deleteCustomer(db, actor!, String(heldCustomer.id), 'DELETE'),
    (error: Error & { code?: string }) => error.code === 'legal_hold_active',
  );
  assert.ok(db.raw.prepare('SELECT id FROM customers WHERE id = ?').get(heldCustomer.id));
  db.raw.prepare("UPDATE legal_holds SET status = 'released' WHERE id = 'hold-delete-test'").run();
  assert.equal((await deleteCustomer(db, actor!, String(heldCustomer.id), 'DELETE')).mode, 'deleted');

  const protectedCustomer = await createCustomer(db, actor!, {
    firstName: 'Protected',
    lastName: 'Customer',
    email: 'delete-protected@example.test',
  });
  db.raw.prepare(
    `INSERT INTO booking_requests
     (id, hold_id, customer_id, status, quote_reference, requested_date, start_at, end_at, duration_minutes, payload_json)
     VALUES ('BR-DELETE', 'hold-delete', ?, 'pending', 'SS-PROTECT', '2026-12-01', '2026-12-01T14:00:00.000Z', '2026-12-01T16:00:00.000Z', 120, '{}')`,
  ).run(protectedCustomer.id);
  await assert.rejects(
    () => deleteCustomer(db, actor!, String(protectedCustomer.id), 'DELETE'),
    (error: Error & { code?: string }) => error.code === 'pending_booking_request',
  );
  assert.ok(db.raw.prepare('SELECT id FROM customers WHERE id = ?').get(protectedCustomer.id));
});

test('two independent solo cleaners can hold overlapping starts while a helper adds no phantom crew', async () => {
  const db = migratedDb();
  const { actor } = await ownerActor(db);
  db.raw.prepare("UPDATE team_members SET is_bookable = 0 WHERE booking_resource_id = 'hayli'").run();
  const customer = await createCustomer(db, actor, {
    firstName: 'Capacity',
    lastName: 'Customer',
    addressLine1: '400 S Baylen St',
    city: 'Pensacola',
    postalCode: '32502',
  });
  const property = db.raw.prepare('SELECT id FROM properties WHERE customer_id = ?').get(customer.id) as { id: string };
  const soloA = await createTeamMember(db, actor, { displayName: 'Solo A', isSolo: true });
  const soloB = await createTeamMember(db, actor, { displayName: 'Solo B', isSolo: true });
  const helper = await createTeamMember(db, actor, { displayName: 'Helper', isSolo: false, isLead: false });
  const start = new Date(Date.now() + 12 * 86_400_000).toISOString();
  const end = new Date(Date.parse(start) + 2 * 60 * 60 * 1000).toISOString();
  for (const suffix of ['A', 'B', 'C', 'D']) {
    db.raw.prepare(
      `INSERT INTO booking_requests (id, hold_id, branch_id, customer_id, property_id, status, quote_reference, requested_date, start_at, end_at, duration_minutes)
       VALUES (?, ?, 'branch_pensacola', ?, ?, 'pending', ?, ?, ?, ?, 120)`,
    ).run(`cap_${suffix}`, `hold_cap_${suffix}`, customer.id, property.id, `CAP-${suffix}`, start.slice(0, 10), start, end);
  }
  await confirmRequest(db, actor, 'cap_A', [soloA.id]);
  await confirmRequest(db, actor, 'cap_B', [soloB.id]);
  assert.equal((db.raw.prepare("SELECT COUNT(*) AS n FROM appointments WHERE status = 'confirmed'").get() as { n: number }).n, 2);
  await assert.rejects(() => confirmRequest(db, actor, 'cap_C', [soloA.id]), /team_conflict/);
  await assert.rejects(() => confirmRequest(db, actor, 'cap_D', [helper.id]), /crew_requires_lead/);
  await assert.rejects(() => confirmRequest(db, actor, 'cap_D'), /schedule_conflict/);
});
test('the recurring write gate fails closed and opens only when explicitly enabled', async () => {
  const db = migratedDb();
  const { owner, actor } = await ownerActor(db);
  const session = await createOpsSession(db, owner.id, request());
  const cookie = `ss_ops=${session.token}`;
  const post = (env: Record<string, unknown>) =>
    operationsPost({
      request: new Request('https://example.test/api/admin/operations', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': session.csrf,
        },
        body: JSON.stringify({ action: 'create_recurring' }),
      }),
      env,
    } as never);
  const closed = await post({ DB: db });
  assert.equal(closed.status, 503);
  assert.equal(((await closed.json()) as { error?: string }).error, 'recurring_scheduling_gated');
  const open = await post({ DB: db, RECURRING_SCHEDULING_ENABLED: 'true' });
  assert.equal(open.status, 400, 'the gate opens and reaches validation');
  assert.equal(((await open.json()) as { error?: string }).error, 'recurring_fields_required');
  assert.ok(actor);
});


test('invoice due dates follow residential immediate and commercial Net 15 policy', async () => {
  const db = migratedDb();
  const { actor } = await ownerActor(db);
  const residential = await createCustomer(db, actor, {
    firstName: 'Residential', lastName: 'Terms', email: 'residential-terms@example.test',
  });
  const commercial = await createCustomer(db, actor, {
    firstName: 'Commercial', lastName: 'Terms', email: 'commercial-terms@example.test',
  });
  const residentialInvoice = await createInvoice(db, actor, {
    customerId: residential.id,
    serviceCode: 'residential-cleaning',
    issueDate: '2026-12-01',
    lines: [{ kind: 'service', description: 'Cleaning', quantity: 1, unitAmountCents: 18000, totalCents: 18000 }],
  });
  const commercialInvoice = await createInvoice(db, actor, {
    customerId: commercial.id,
    serviceCode: 'commercial-cleaning',
    issueDate: '2026-12-01',
    lines: [{ kind: 'service', description: 'Commercial cleaning', quantity: 1, unitAmountCents: 30000, totalCents: 30000 }],
  });
  const residentialRow = db.raw.prepare('SELECT due_date FROM invoices WHERE id = ?').get(residentialInvoice.id) as { due_date: string };
  const commercialRow = db.raw.prepare('SELECT due_date FROM invoices WHERE id = ?').get(commercialInvoice.id) as { due_date: string };
  assert.equal(residentialRow.due_date, '2026-12-01');
  assert.equal(commercialRow.due_date, '2026-12-16');
});


test('a paid invoice produces exactly one idempotent customer receipt', async () => {
  const db = migratedDb();
  const { actor } = await ownerActor(db);
  const customer = await createCustomer(db, actor, {
    firstName: 'Receipt', lastName: 'Customer', email: 'receipt@example.test',
    addressLine1: '100 Receipt Street', city: 'Pensacola', postalCode: '32502',
  });
  const invoice = await createInvoice(db, actor, {
    customerId: customer.id,
    serviceCode: 'residential-cleaning',
    issueDate: '2026-11-19',
    lines: [{ kind: 'service', description: 'Residential cleaning', quantity: 1, unitAmountCents: 10000, totalCents: 10000 }],
  });
  await recordPayment(db, actor, {
    invoiceId: invoice.id, provider: 'cash', amount: 100, idempotencyKey: 'receipt-payment-1',
  });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ id: 'email_receipt_1' }), { status: 200 });
  }) as typeof fetch;
  try {
    const first = await deliverInvoiceReceipt(db, { RESEND_API_KEY: 'test' }, { invoiceId: invoice.id });
    assert.equal(first.status, 'sent');
    const duplicate = await deliverInvoiceReceipt(db, { RESEND_API_KEY: 'test' }, { invoiceId: invoice.id });
    assert.equal(duplicate.status, 'sent');
    assert.equal(calls, 1);
    const rows = db.raw.prepare('SELECT status, provider_message_id FROM payment_receipts WHERE invoice_id = ?').all(invoice.id) as Array<Record<string, unknown>>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.status, 'sent');
    assert.equal(rows[0]?.provider_message_id, 'email_receipt_1');
    const resent = await deliverInvoiceReceipt(db, { RESEND_API_KEY: 'test' }, { invoiceId: invoice.id, force: true });
    assert.equal(resent.status, 'sent');
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

import { onRequestPost as financePost } from '../functions/api/admin/finance.ts';
import { buildReceipt } from '../src/lib/payments/receipt.ts';
import { loadInvoiceReceiptData } from '../src/lib/invoicing/invoice-receipt.ts';

test('the invoice receipt is built from the persisted paid invoice and records delivery failure honestly', async () => {
  const db = migratedDb();
  const { owner, actor } = await ownerActor(db);
  const customer = await createCustomer(db, actor, {
    firstName: 'Receipt', lastName: 'Customer', email: 'receipt-phase-a@example.test',
    addressLine1: '100 Receipt Street', city: 'Pensacola', postalCode: '32502',
  });
  const invoice = await createInvoice(db, actor, {
    customerId: customer.id,
    serviceCode: 'residential-cleaning',
    issueDate: '2026-11-19',
    lines: [
      { kind: 'service', description: 'Residential cleaning', quantity: 1, unitAmountCents: 12000, totalCents: 12000 },
      { kind: 'discount', description: 'FRIENDS15', quantity: 1, unitAmountCents: 1800, totalCents: 1800 },
    ],
  });
  await recordPayment(db, actor, {
    invoiceId: invoice.id, provider: 'cash', amount: 102, idempotencyKey: 'receipt-phase-a-payment',
  });
  const loaded = await loadInvoiceReceiptData(db, invoice.id);
  assert.ok(loaded);
  assert.equal(loaded.data.receiptNumber, `${invoice.number}-R1`);
  assert.equal(loaded.data.customerEmail, 'receipt-phase-a@example.test');
  assert.equal(loaded.data.totalCents, 10200);
  assert.equal(loaded.data.paidCents, 10200);
  assert.equal(loaded.data.balanceCents, 0);
  assert.equal(loaded.data.paymentStatus, 'paid');
  assert.ok(loaded.data.lines.some((line) => line.kind === 'discount'));
  const built = buildReceipt(loaded.data);
  assert.match(built.html, /Sparkling Standard Cleaning Co\./);
  assert.match(built.html, /Standards That Sparkle\./);
  assert.match(built.html, /receipt-phase-a@example\.test/);
  assert.match(built.html, /Residential cleaning/);
  assert.match(built.html, /FRIENDS15/);
  assert.match(built.text, /Total: \$102\.00/);
  assert.match(built.text, /Total paid|Paid: \$102\.00/);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'synthetic rejection' }), { status: 422 })) as typeof fetch;
  try {
    const failed = await deliverInvoiceReceipt(db, { RESEND_API_KEY: 'test', RESEND_FROM_EMAIL: 'owner@example.test' }, {
      invoiceId: invoice.id,
      actorUserId: owner.id,
      force: true,
    });
    assert.equal(failed.status, 'failed');
    const row = db.raw.prepare('SELECT status, error_code FROM payment_receipts WHERE invoice_id = ?').get(invoice.id) as {
      status: string; error_code: string;
    };
    assert.equal(row.status, 'failed');
    assert.match(row.error_code, /provider_422|failed/);
    const auditRow = db.raw
      .prepare("SELECT action FROM admin_audit WHERE entity_id = ? AND action LIKE 'invoice.receipt_%' ORDER BY created_at DESC LIMIT 1")
      .get(invoice.id) as { action: string };
    assert.equal(auditRow.action, 'invoice.receipt_failed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('resending an invoice receipt requires finance permission and matching branch access', async () => {
  const db = migratedDb();
  const { actor } = await ownerActor(db);
  const customer = await createCustomer(db, actor, {
    firstName: 'Branch', lastName: 'Customer', email: 'branch-receipt@example.test',
    addressLine1: '200 Branch Street', city: 'Pensacola', postalCode: '32502',
  });
  const invoice = await createInvoice(db, actor, {
    customerId: customer.id,
    serviceCode: 'residential-cleaning',
    issueDate: '2026-11-19',
    lines: [{ kind: 'service', description: 'Residential cleaning', quantity: 1, unitAmountCents: 9000, totalCents: 9000 }],
  });
  await recordPayment(db, actor, {
    invoiceId: invoice.id, provider: 'cash', amount: 90, idempotencyKey: 'branch-receipt-payment',
  });
  const managerId = 'admin_manager_receipt';
  db.raw
    .prepare(
      `INSERT INTO admin_users (id, role_id, branch_id, email, password_hash, display_name, status)
       VALUES (?, 'manager', 'branch_pensacola', 'manager-receipt@example.test', 'unused', 'Synthetic Manager', 'active')`,
    )
    .run(managerId);
  const managerSession = await createOpsSession(db, managerId, request());
  const managerResponse = await financePost({
    request: new Request('https://example.test/api/admin/finance', {
      method: 'POST',
      headers: {
        Cookie: `ss_ops=${managerSession.token}`,
        'X-CSRF-Token': managerSession.csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'resend_invoice_receipt', invoiceId: invoice.id }),
    }),
    env: { DB: db } as never,
  });
  assert.equal(managerResponse.status, 403);

  const financeId = 'admin_finance_tampa';
  db.raw
    .prepare(
      `INSERT INTO admin_users (id, role_id, branch_id, email, password_hash, display_name, status)
       VALUES (?, 'finance', 'branch_tampa', 'finance-tampa@example.test', 'unused', 'Synthetic Finance', 'active')`,
    )
    .run(financeId);
  const financeSession = await createOpsSession(db, financeId, request());
  const financeResponse = await financePost({
    request: new Request('https://example.test/api/admin/finance', {
      method: 'POST',
      headers: {
        Cookie: `ss_ops=${financeSession.token}`,
        'X-CSRF-Token': financeSession.csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'resend_invoice_receipt', invoiceId: invoice.id }),
    }),
    env: { DB: db } as never,
  });
  assert.equal(financeResponse.status, 404);
  const row = db.raw.prepare('SELECT COUNT(*) AS count FROM payment_receipts WHERE invoice_id = ?').get(invoice.id) as { count: number };
  assert.equal(row.count, 0);
});

test('sending an invoice email does not require a fresh email-code step-up for an authenticated owner', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'invoice-send-no-stepup@example.test',
    name: 'Invoice Send Owner',
    password: 'SyntheticOwner!2026',
  });
  const enrollment = await startMfaEnrollment(db, owner.id, owner.email, MFA_KEY);
  await enableMfa(db, owner.id, totpCode(enrollment.secret), MFA_KEY);
  const session = await createOpsSession(db, owner.id, request());
  const actor = await readOpsActor(db, request(`ss_ops=${session.token}`));
  assert.ok(actor?.mfaEnabled);
  assert.equal(actor?.stepUpAt, null);
  const customer = await createCustomer(db, actor!, {
    firstName: 'Invoice',
    lastName: 'Recipient',
    email: 'invoice-recipient@example.test',
    addressLine1: '100 Invoice Street',
    city: 'Pensacola',
    state: 'FL',
    postalCode: '32502',
  });
  const invoice = await createInvoice(db, actor!, {
    customerId: customer.id,
    serviceCode: 'move_in_out',
    serviceLabel: 'Move-Out Cleaning',
    serviceDate: '2026-11-23',
    lines: [{ kind: 'service', description: 'Move-Out Cleaning', quantity: 1, unitAmountCents: 27500, totalCents: 27500 }],
  });
  const originalFetch = globalThis.fetch;
  let sends = 0;
  globalThis.fetch = (async () => {
    sends += 1;
    return new Response(JSON.stringify({ id: 'email_invoice_sent_1' }), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await financePost({
      request: new Request('https://example.test/api/admin/finance', {
        method: 'POST',
        headers: {
          Cookie: `ss_ops=${session.token}`,
          'X-CSRF-Token': session.csrf,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'email_invoice',
          invoiceId: invoice.id,
          idempotencyKey: 'invoice-send-no-stepup',
        }),
      }),
      env: { DB: db, RESEND_API_KEY: 'synthetic', RESEND_FROM_EMAIL: 'owner@example.test' },
    } as never);
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as { status?: string }).status, 'sent');
    assert.equal(sends, 1);
    const auditRow = db.raw
      .prepare("SELECT action FROM admin_audit WHERE entity_id = ? AND action = 'invoice.emailed' ORDER BY created_at DESC LIMIT 1")
      .get(invoice.id) as { action: string } | undefined;
    assert.equal(auditRow?.action, 'invoice.emailed');

    const noCsrf = await financePost({
      request: new Request('https://example.test/api/admin/finance', {
        method: 'POST',
        headers: { Cookie: `ss_ops=${session.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'email_invoice', invoiceId: invoice.id }),
      }),
      env: { DB: db, RESEND_API_KEY: 'synthetic', RESEND_FROM_EMAIL: 'owner@example.test' },
    } as never);
    assert.equal(noCsrf.status, 403);
    assert.equal(((await noCsrf.json()) as { error?: string }).error, 'csrf_failed');
    assert.equal(sends, 1, 'a CSRF failure never sends a second email');

    const stepUpStillRequired = await financePost({
      request: new Request('https://example.test/api/admin/finance', {
        method: 'POST',
        headers: {
          Cookie: `ss_ops=${session.token}`,
          'X-CSRF-Token': session.csrf,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'create_invoice',
          customerId: customer.id,
          lines: [{ kind: 'service', description: 'High risk test', quantity: 1, unitAmountCents: 100, totalCents: 100 }],
        }),
      }),
      env: { DB: db },
    } as never);
    assert.equal(stepUpStillRequired.status, 403);
    assert.equal(((await stepUpStillRequired.json()) as { error?: string }).error, 'mfa_step_up_required');

    db.raw
      .prepare(
        `INSERT INTO admin_users (id, role_id, email, password_hash, display_name, status)
         VALUES ('admin_no_finance', 'manager', 'no-finance@example.test', 'unused', 'Synthetic Manager', 'active')`,
      )
      .run();
    const managerSession = await createOpsSession(db, 'admin_no_finance', request());
    const managerResponse = await financePost({
      request: new Request('https://example.test/api/admin/finance', {
        method: 'POST',
        headers: {
          Cookie: `ss_ops=${managerSession.token}`,
          'X-CSRF-Token': managerSession.csrf,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'email_invoice', invoiceId: invoice.id }),
      }),
      env: { DB: db, RESEND_API_KEY: 'synthetic', RESEND_FROM_EMAIL: 'owner@example.test' },
    } as never);
    assert.equal(managerResponse.status, 403);
    assert.equal(sends, 1, 'an unauthorized manager never sends the invoice');

    db.raw.prepare('UPDATE admin_sessions SET expires_at = ? WHERE user_id = ?').run('2020-01-01T00:00:00.000Z', owner.id);
    const expiredResponse = await financePost({
      request: new Request('https://example.test/api/admin/finance', {
        method: 'POST',
        headers: {
          Cookie: `ss_ops=${session.token}`,
          'X-CSRF-Token': session.csrf,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'email_invoice', invoiceId: invoice.id }),
      }),
      env: { DB: db, RESEND_API_KEY: 'synthetic', RESEND_FROM_EMAIL: 'owner@example.test' },
    } as never);
    assert.equal(expiredResponse.status, 401);
    assert.equal(sends, 1, 'an expired session never sends the invoice');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('verified property coordinates are stored, preserved and invalidated when the address changes', async () => {
  const db = migratedDb();
  const { actor } = await ownerActor(db);
  const customer = await createCustomer(db, actor, {
    firstName: 'Coordinate', lastName: 'Customer', email: 'coords@example.test',
    addressLine1: '1000 Bayou Blvd', city: 'Pensacola', state: 'FL', postalCode: '32503',
    latitude: 30.4213, longitude: -87.2169, precision: 'exact',
  });
  const property = db.raw.prepare('SELECT id, latitude, longitude, precision FROM properties WHERE customer_id = ?').get(customer.id) as {
    id: string; latitude: number; longitude: number; precision: string;
  };
  assert.equal(property.latitude, 30.4213);
  assert.equal(property.longitude, -87.2169);
  assert.equal(property.precision, 'exact');

  await updateProperty(db, actor, property.id, {
    label: 'Service property', line1: '1000 Bayou Blvd', line2: '', city: 'Pensacola', state: 'FL',
    postalCode: '32503', propertyType: '', pets: '',
  });
  const preserved = db.raw.prepare('SELECT latitude, longitude FROM properties WHERE id = ?').get(property.id) as { latitude: number; longitude: number };
  assert.equal(preserved.latitude, 30.4213);
  assert.equal(preserved.longitude, -87.2169);

  await updateProperty(db, actor, property.id, {
    label: 'Service property', line1: '2000 New Street', line2: '', city: 'Pensacola', state: 'FL',
    postalCode: '32503', propertyType: '', pets: '',
  });
  const changed = db.raw.prepare('SELECT latitude, longitude FROM properties WHERE id = ?').get(property.id) as { latitude: number | null; longitude: number | null };
  assert.equal(changed.latitude, null);
  assert.equal(changed.longitude, null);

  await updateProperty(db, actor, property.id, {
    label: 'Service property', line1: '2000 New Street', line2: 'Apt 4', city: 'Pensacola', state: 'FL',
    postalCode: '32503', latitude: 30.43, longitude: -87.22, precision: 'street',
  });
  const updated = db.raw.prepare('SELECT latitude, longitude, precision FROM properties WHERE id = ?').get(property.id) as {
    latitude: number; longitude: number; precision: string;
  };
  assert.equal(updated.latitude, 30.43);
  assert.equal(updated.longitude, -87.22);
  assert.equal(updated.precision, 'street');
  assert.equal((db.raw.prepare('SELECT COUNT(*) AS n FROM properties WHERE customer_id = ?').get(customer.id) as { n: number }).n, 1);
});

test('lead archive, restore and disposable deletion enforce history protections', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'lead-management@example.test',
    name: 'Lead Owner',
    password: 'SyntheticOwner!2026',
  });
  const session = await createOpsSession(db, owner.id, request());
  const actor = await readOpsActor(db, request(`ss_ops=${session.token}`));
  assert.ok(actor);
  const customer = await createCustomer(db, actor!, {
    firstName: 'Linked', lastName: 'Customer', email: 'linked-lead@example.test',
    addressLine1: '100 Lead Street', city: 'Pensacola', state: 'FL', postalCode: '32502',
  });
  db.raw.prepare(
    `INSERT INTO leads (id, branch_id, customer_id, request_type, status, source, quote_reference, payload_json)
     VALUES ('lead_linked', 'branch_pensacola', ?, 'reservation_request', 'new', 'website', 'SS-LINKED', '{"service_type":"deep"}')`,
  ).run(customer.id);
  db.raw.prepare(
    `INSERT INTO leads (id, branch_id, request_type, status, source, quote_reference, payload_json)
     VALUES ('lead_disposable', 'branch_pensacola', 'general_inquiry', 'lost', 'phone', '', '{"note":"synthetic"}')`,
  ).run();
  db.raw.prepare(
    `INSERT INTO leads (id, branch_id, request_type, status, source, quote_reference, payload_json)
     VALUES ('lead_archived', 'branch_pensacola', 'general_inquiry', 'archived', 'phone', '', '{}')`,
  ).run();
  const headers = {
    Cookie: `ss_ops=${session.token}`,
    'Content-Type': 'application/json',
    'X-CSRF-Token': actor!.csrf,
  };
  const post = (payload: Record<string, unknown>) =>
    adminLeadsPost({
      request: new Request('https://example.test/api/admin/leads', {
        method: 'POST', headers, body: JSON.stringify(payload),
      }),
      env: { DB: db },
    } as never);
  const detail = await adminLeadsGet({
    request: new Request('https://example.test/api/admin/leads?id=lead_linked', {
      headers: { Cookie: `ss_ops=${session.token}` },
    }),
    env: { DB: db },
  } as never);
  assert.equal(detail.status, 200);
  const detailBody = (await detail.json()) as { lead: Record<string, unknown> };
  assert.equal((detailBody.lead.payload as Record<string, unknown>).service_type, 'deep');

  assert.equal((await post({ action: 'archive', leadId: 'lead_linked' })).status, 200);
  assert.equal((db.raw.prepare('SELECT status FROM leads WHERE id = ?').get('lead_linked') as { status: string }).status, 'archived');
  assert.equal((await post({ action: 'restore', leadId: 'lead_archived' })).status, 200);
  assert.equal((db.raw.prepare('SELECT status FROM leads WHERE id = ?').get('lead_archived') as { status: string }).status, 'new');
  assert.equal((await post({ action: 'delete', leadId: 'lead_linked' })).status, 409);
  assert.equal((await post({ action: 'delete', leadId: 'lead_disposable' })).status, 200);
  assert.equal((db.raw.prepare("SELECT COUNT(*) AS n FROM leads WHERE id = 'lead_disposable'").get() as { n: number }).n, 0);

  const bulk = await post({
    action: 'bulk', operation: 'archive', confirm: true, leadIds: ['lead_linked', 'lead_archived'],
  });
  assert.equal(bulk.status, 200);
  const bulkBody = (await bulk.json()) as { succeeded: number; failed: number };
  assert.equal(bulkBody.succeeded, 2);
  assert.equal(bulkBody.failed, 0);
});
