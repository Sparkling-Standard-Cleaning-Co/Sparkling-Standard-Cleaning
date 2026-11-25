import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import type { AdminActor } from '../src/lib/admin/operations.ts';
import {
  defaultCommunicationSettings,
  deliveryHealth,
  extractTemplateVariables,
  listCommunicationVersions,
  notificationRecipients,
  previewTemplate,
  readCommunicationSettings,
  recordNotificationDelivery,
  saveCommunicationSettings,
  sendOperationalNotification,
  sendTestNotification,
  validateCommunicationSettings,
} from '../src/lib/admin/communications.ts';
import { createCustomerBillingPortalSession } from '../src/lib/admin/stripe-billing.ts';
import {
  backupMonitorTick,
  evaluateBackupHealth,
  recordBackupRun,
} from '../src/lib/admin/backup-monitor.ts';
import { countCustomers, countLeads, customerPageBounds, listCustomers, listLeads } from '../src/lib/admin/crm.ts';
import { countInvoices, invoicePageBounds, listInvoices } from '../src/lib/admin/billing.ts';

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
  for (const file of [
    '0001_operational_foundation.sql',
    '0002_admin_security_and_seeds.sql',
    '0005_admin_accounts_and_operations.sql',
    '0008_invoice_payment_links.sql',
    '0044_communications.sql',
  ]) {
    db.raw.exec(fs.readFileSync(path.join('migrations', file), 'utf8'));
  }
  db.raw.prepare(
    "INSERT INTO admin_users (id, role_id, email, password_hash, display_name, status) VALUES ('admin_owner', 'owner', 'owner@sparkling-standard.com', 'synthetic', 'Owner', 'active')",
  ).run();
  return db;
}

function actor(overrides: Partial<AdminActor> = {}): AdminActor {
  return {
    id: 'admin_owner',
    email: 'owner@sparkling-standard.com',
    name: 'Owner',
    role: 'owner',
    branchId: null,
    csrf: 'synthetic-csrf',
    permissions: ['settings.write'],
    mfaEnabled: true,
    ...overrides,
  };
}

test('approved defaults route each event to its department and keep critical alerts fixed', () => {
  const settings = defaultCommunicationSettings();
  assert.deepEqual(settings.routing.booking_confirmation, ['bookings']);
  assert.deepEqual(settings.routing.booking_request, ['bookings', 'owner']);
  assert.deepEqual(settings.routing.booking_paid, ['bookings', 'billing']);
  assert.deepEqual(settings.routing.invoice_delivery, ['billing']);
  assert.deepEqual(settings.routing.contact_inquiry, ['customerService', 'owner']);
  assert.deepEqual(settings.routing.careers_application, ['hiring']);
  assert.deepEqual(settings.routing.document_signing_request, ['bookings', 'admin']);
  assert.deepEqual(settings.routing.document_executed, ['admin', 'owner']);
  assert.deepEqual(settings.routing.security_alert, ['admin', 'owner']);
  assert.deepEqual(settings.routing.backup_failure, ['admin', 'owner']);
  assert.equal(settings.replyTo.invoices, 'billing');
  assert.equal(settings.replyTo.bookingConfirmations, 'bookings');
});

test('settings saved before a new event existed stay valid and use the new default route', () => {
  const settings = defaultCommunicationSettings();
  const legacy = structuredClone(settings) as unknown as Record<string, unknown>;
  const routing = legacy.routing as Record<string, unknown>;
  delete routing.document_executed;
  delete routing.booking_paid;
  const validation = validateCommunicationSettings(legacy);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.settings.routing.document_executed, ['admin', 'owner']);
  assert.deepEqual(validation.settings.routing.booking_paid, ['bookings', 'billing']);
});

test('operational notifications resolve department inboxes, send once per inbox and record each outcome', async () => {
  const db = migratedDb();
  const originalFetch = globalThis.fetch;
  const sent: Array<Record<string, unknown>> = [];
  const headers: Array<Record<string, string>> = [];
  globalThis.fetch = (async (_input, init) => {
    sent.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    headers.push((init?.headers ?? {}) as Record<string, string>);
    return new Response(JSON.stringify({ id: `email_${sent.length}` }), { status: 200 });
  }) as typeof fetch;
  try {
    const booking = await sendOperationalNotification(db, { RESEND_API_KEY: 're_synthetic' }, {
      eventKey: 'booking_request',
      subject: 'New booking request',
      text: 'Customer requested a cleaning appointment.',
      idempotencyKey: 'lead-request-1',
      relatedType: 'lead',
      relatedId: 'lead_1',
    });
    assert.deepEqual(booking.recipients, ['booking@sparkling-standard.com', 'owner@sparkling-standard.com']);
    assert.deepEqual(booking.departments, ['bookings', 'owner']);
    assert.equal(booking.sent, 2);

    const contact = await sendOperationalNotification(db, { RESEND_API_KEY: 're_synthetic' }, {
      eventKey: 'contact_inquiry',
      subject: 'Website message',
      text: 'A customer asked a question.',
      idempotencyKey: 'lead-contact-1',
    });
    assert.deepEqual(contact.recipients, ['customer-service@sparkling-standard.com', 'owner@sparkling-standard.com']);

    const critical = await sendOperationalNotification(db, { RESEND_API_KEY: 're_synthetic' }, {
      eventKey: 'security_alert',
      subject: 'Security alert',
      text: 'Synthetic test only.',
      idempotencyKey: 'security-1',
    });
    assert.deepEqual(critical.recipients, [
      'admin@sparkling-standard.com',
      'owner@sparkling-standard.com',
    ]);

    assert.equal(new Set(headers.map((header) => header['Idempotency-Key'])).size, 6);
    const rows = db.raw
      .prepare("SELECT event_key, department, recipient, status FROM notification_delivery_events ORDER BY created_at")
      .all() as Array<{ event_key: string; department: string; recipient: string; status: string }>;
    assert.equal(rows.length, 6);
    assert.ok(rows.some((row) => row.event_key === 'booking_request' && row.department === 'bookings' && row.status === 'sent'));
    assert.ok(rows.some((row) => row.event_key === 'contact_inquiry' && row.department === 'customerService'));
    assert.ok(rows.some((row) => row.event_key === 'security_alert' && row.department === 'owner'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a disabled operational inbox is skipped while explicitly routed departments still receive', () => {
  const settings = defaultCommunicationSettings();
  settings.departments.bookings.enabled = false;
  assert.deepEqual(
    notificationRecipients(settings, 'booking_request').map((entry) => entry.department),
    ['owner'],
  );
  assert.deepEqual(notificationRecipients(settings, 'contact_inquiry').map((entry) => entry.department), [
    'customerService',
    'owner',
  ]);
});

test('validation rejects department address changes, owner reply-to and critical rerouting', () => {
  const settings = defaultCommunicationSettings();
  const tampered = structuredClone(settings);
  tampered.departments.billing.address = 'attacker@example.test';
  tampered.replyTo.contact = 'owner';
  tampered.routing.security_alert = ['admin'];
  const invalid = validateCommunicationSettings(tampered);
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((error) => error.includes('departments.billing')));
  assert.ok(invalid.errors.some((error) => error.includes('replyTo.contact')));
  assert.ok(invalid.errors.some((error) => error.includes('routing.security_alert')));
});

test('validation rejects unsupported template variables and accepts approved ones', () => {
  const settings = defaultCommunicationSettings();
  const tampered = structuredClone(settings);
  tampered.templates.booking_confirmation.body = 'Hello {{customer_name}} {{secret_token}}';
  const invalid = validateCommunicationSettings(tampered);
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((error) => error.includes('secret_token')));

  const valid = structuredClone(settings);
  valid.templates.booking_confirmation.body = 'Hello {{customer_name}}, reference {{reference}}.';
  assert.equal(validateCommunicationSettings(valid).ok, true);
});

test('template previews render only sample values and list supported variables', () => {
  const settings = defaultCommunicationSettings();
  const preview = previewTemplate(settings, 'booking_confirmation');
  assert.match(preview.subject, /SS-EXAMPLE-1001/);
  assert.match(preview.body, /Jordan Example/);
  assert.ok(preview.variables.includes('service_date'));
  assert.deepEqual(extractTemplateVariables('{{a}} {{ b }} {{a}}'), ['a', 'b']);
});

test('saving settings creates an immutable version and read returns the saved configuration', async () => {
  const db = migratedDb();
  const owner = actor();
  const settings = defaultCommunicationSettings();
  settings.routing.contact_inquiry = ['customerService'];
  settings.templates.booking_confirmation.subject = 'Confirmed: {{reference}}';
  settings.alerts.escalationMinutes = 45;

  const first = await saveCommunicationSettings(db, owner, settings, 'Initial owner configuration');
  assert.equal(first.version, 1);

  const updated = structuredClone(settings);
  updated.alerts.failureThreshold = 5;
  const second = await saveCommunicationSettings(db, owner, updated, 'Raise threshold');
  assert.equal(second.version, 2);

  const state = await readCommunicationSettings(db);
  assert.equal(state.source, 'stored');
  assert.equal(state.valid, true);
  assert.equal(state.settings.alerts.escalationMinutes, 45);
  assert.equal(state.settings.alerts.failureThreshold, 5);

  const versions = await listCommunicationVersions(db, 10);
  assert.equal(versions.length, 2);
  assert.equal(Number(versions[0]?.version), 2);

  const auditRows = db.raw
    .prepare("SELECT action FROM admin_audit WHERE action = 'communications.settings_saved'")
    .all() as Array<{ action: string }>;
  assert.equal(auditRows.length, 2);
});

test('a non-owner cannot change routing and an invalid stored value falls back to defaults', async () => {
  const db = migratedDb();
  await assert.rejects(
    () => saveCommunicationSettings(db, actor({ role: 'manager' }), defaultCommunicationSettings(), 'attempt'),
    /owner_required/,
  );
  db.raw.prepare(
    "INSERT INTO admin_settings (key, value_json, updated_by_admin_user_id, updated_at) VALUES ('communications.config', '{bad json', 'admin_owner', CURRENT_TIMESTAMP)",
  ).run();
  const state = await readCommunicationSettings(db);
  assert.equal(state.valid, false);
  assert.equal(state.source, 'stored');
  assert.deepEqual(state.settings.routing.booking_confirmation, ['bookings']);
});

test('owner test delivery records provider acceptance honestly and never claims inbox delivery', async () => {
  const db = migratedDb();
  const originalFetch = globalThis.fetch;
  const sent: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input, init) => {
    sent.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return new Response(JSON.stringify({ id: 'email_test_1' }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await sendTestNotification(db, actor(), {
      RESEND_API_KEY: 're_synthetic',
      RESEND_FROM_EMAIL: 'notifications@example.test',
    }, 'admin');
    assert.equal(result.status, 'sent');
    assert.equal(result.recipient, 'admin@sparkling-standard.com');
    assert.equal(sent.length, 1);
    assert.match(String(sent[0]?.subject), /\[TEST\]/);
    assert.match(String(sent[0]?.text), /No customer data/);

    const health = await deliveryHealth(db);
    assert.equal(health.summary && (health.summary as Record<string, number>).sent, 1);
    assert.match(String(health.note), /Inbox delivery/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('test delivery is suppressed honestly when Resend is not configured', async () => {
  const db = migratedDb();
  const result = await sendTestNotification(db, actor(), {}, 'owner');
  assert.equal(result.status, 'not_configured');
  const row = db.raw
    .prepare("SELECT status, error_code FROM notification_delivery_events WHERE event_key = 'communications_test'")
    .get() as { status: string; error_code: string };
  assert.equal(row.status, 'suppressed');
  assert.equal(row.error_code, 'resend_not_configured');
});

test('delivery health separates application failures from delivery proof', async () => {
  const db = migratedDb();
  await recordNotificationDelivery(db, {
    eventKey: 'booking_confirmation',
    department: 'bookings',
    recipient: 'booking@sparkling-standard.com',
    status: 'failed',
    errorCode: 'http_422',
  });
  const health = await deliveryHealth(db);
  assert.equal(health.summary && (health.summary as Record<string, number>).failed, 1);
  assert.ok(Array.isArray(health.recent));
});

test('pagination bounds are capped, stable and sort-whitelisted', () => {
  assert.deepEqual(customerPageBounds({}), { limit: 25, offset: 0, sort: 'created_at' });
  assert.equal(customerPageBounds({ limit: 500 }).limit, 200);
  assert.equal(customerPageBounds({ offset: -4 }).offset, 0);
  assert.equal(customerPageBounds({ sort: 'injected; DROP TABLE customers' }).sort, 'created_at');
  assert.equal(customerPageBounds({ sort: 'name' }).sort, 'name');
  assert.equal(invoicePageBounds({ limit: 50 }).limit, 50);
  assert.equal(invoicePageBounds({ sort: 'balance' }).sort, 'balance');
});

test('server pagination returns accurate totals, stable ordering and independent pages', async () => {
  const db = migratedDb();
  const upsert = db.raw.prepare(
    "INSERT INTO customers (id, first_name, last_name, status, primary_branch_id) VALUES (?, ?, ?, 'active', 'branch_pensacola')",
  );
  upsert.run('cust_a', 'Avery', 'Zulu');
  upsert.run('cust_b', 'Blake', 'Alpha');
  upsert.run('cust_c', 'Casey', 'Mike');
  const first = await listCustomers(db, actor(), { limit: 1, offset: 0, sort: 'name' });
  const second = await listCustomers(db, actor(), { limit: 1, offset: 1, sort: 'name' });
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(first[0]?.last_name, 'Alpha');
  assert.equal(second[0]?.last_name, 'Mike');
  assert.equal(await countCustomers(db, actor(), {}), 3);

  const lead = db.raw.prepare(
    "INSERT INTO leads (id, branch_id, request_type, status, quote_reference, delivery_status, created_at) VALUES (?, 'branch_pensacola', 'residential', ?, ?, 'sent', ?)",
  );
  lead.run('lead_1', 'new', 'Q-1', '2026-11-01T00:00:00.000Z');
  lead.run('lead_2', 'contacted', 'Q-2', '2026-11-02T00:00:00.000Z');
  lead.run('lead_3', 'new', 'Q-3', '2026-11-03T00:00:00.000Z');
  assert.equal(await countLeads(db, actor(), {}), 3);
  assert.equal(await countLeads(db, actor(), { status: 'new' }), 2);
  assert.equal((await listLeads(db, actor(), { limit: 1, offset: 1 }))[0]?.id, 'lead_2');
  assert.equal((await listLeads(db, actor(), { status: 'new', limit: 1, offset: 1 }))[0]?.id, 'lead_1');

  const invoice = db.raw.prepare(
    "INSERT INTO invoices (id, branch_id, customer_id, number, status, issue_date, due_date, total_cents, balance_cents) VALUES (?, 'branch_pensacola', 'cust_a', ?, ?, '2026-11-01', '2026-11-15', ?, ?)",
  );
  invoice.run('inv_1', 'INV-1', 'paid', 10000, 0);
  invoice.run('inv_2', 'INV-2', 'open', 20000, 15000);
  invoice.run('inv_3', 'INV-3', 'open', 30000, 25000);
  assert.equal(await countInvoices(db, actor(), {}), 3);
  assert.equal(await countInvoices(db, actor(), { status: 'open' }), 2);
  const byBalance = await listInvoices(db, actor(), { sort: 'balance', limit: 2, offset: 0 });
  assert.equal(byBalance[0]?.id, 'inv_3');
  assert.equal(byBalance[1]?.id, 'inv_2');
});

test('backup health reports missing, stale, failed and healthy states with escalation timing', () => {
  const now = new Date('2026-11-20T12:00:00.000Z');
  assert.equal(evaluateBackupHealth({ lastSuccessAt: null, now }).status, 'missing');
  assert.equal(
    evaluateBackupHealth({ lastSuccessAt: '2026-11-20T00:00:00.000Z', now }).status,
    'healthy',
  );
  assert.equal(
    evaluateBackupHealth({ lastSuccessAt: '2026-11-18T00:00:00.000Z', now }).status,
    'stale',
  );
  assert.equal(
    evaluateBackupHealth({ lastSuccessAt: '2026-11-20T11:00:00.000Z', lastRunStatus: 'failure', now }).status,
    'failed',
  );
  const escalating = evaluateBackupHealth({
    lastSuccessAt: '2026-11-18T00:00:00.000Z',
    now,
    escalationMinutes: 30,
    incidentOpenedAt: '2026-11-20T11:00:00.000Z',
  });
  assert.equal(escalating.shouldEscalate, true);
  assert.equal(
    evaluateBackupHealth({
      lastSuccessAt: '2026-11-18T00:00:00.000Z',
      now,
      incidentOpenedAt: '2026-11-20T11:45:00.000Z',
    }).shouldEscalate,
    false,
  );
});

test('a failed backup opens one critical incident, alerts both departments and escalates the owner', async () => {
  const db = migratedDb();
  const originalFetch = globalThis.fetch;
  const recipients: string[] = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { to?: string[] };
    recipients.push(...(body.to ?? []));
    return new Response(JSON.stringify({ id: `email_${recipients.length}` }), { status: 200 });
  }) as typeof fetch;
  try {
    const run = await recordBackupRun(db, { runKey: 'github-backup-100', status: 'failure', summary: 'export failed' });
    assert.equal(run.recorded, true);

    const first = await backupMonitorTick(db, { RESEND_API_KEY: 're_synthetic' });
    assert.equal(first.status, 'failed');
    assert.equal(first.action, 'alerted_admin_and_owner');
    assert.deepEqual(recipients.sort(), ['admin@sparkling-standard.com', 'owner@sparkling-standard.com']);
    const incident = db.raw
      .prepare("SELECT id, status, escalation_sent_at FROM operations_incidents WHERE incident_key = 'backup_stale'")
      .get() as { id: string; status: string; escalation_sent_at: string | null };
    assert.equal(incident.status, 'open');
    assert.equal(incident.escalation_sent_at, null);

    const duplicate = await backupMonitorTick(db, { RESEND_API_KEY: 're_synthetic' });
    assert.equal(duplicate.action, 'none');
    assert.equal(recipients.length, 2);

    const later = await backupMonitorTick(
      db,
      { RESEND_API_KEY: 're_synthetic' },
      new Date(Date.now() + 31 * 60_000),
    );
    assert.equal(later.action, 'escalated_owner');
    assert.deepEqual(recipients.slice(2), ['owner@sparkling-standard.com']);
    const escalated = db.raw
      .prepare("SELECT escalation_sent_at FROM operations_incidents WHERE incident_key = 'backup_stale'")
      .get() as { escalation_sent_at: string };
    assert.ok(escalated.escalation_sent_at);

    await recordBackupRun(db, { runKey: 'github-backup-101', status: 'success', summary: 'ok' });
    const recovered = await backupMonitorTick(db, { RESEND_API_KEY: 're_synthetic' });
    assert.equal(recovered.status, 'healthy');
    assert.equal(recovered.action, 'resolved_recovery');
    const resolved = db.raw
      .prepare("SELECT status FROM operations_incidents WHERE incident_key = 'backup_stale'")
      .get() as { status: string };
    assert.equal(resolved.status, 'resolved');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a new backup failure reopens a previously resolved incident', async () => {
  const db = migratedDb();
  db.raw
    .prepare(
      `INSERT INTO operations_incidents
       (id, incident_key, kind, severity, status, summary, detail, opened_at, resolved_at, updated_at)
       VALUES ('incident_old', 'backup_stale', 'backup', 'critical', 'resolved',
               'Old incident', 'Old detail', '2026-11-20T00:00:00.000Z',
               '2026-11-21T00:00:00.000Z', '2026-11-21T00:00:00.000Z')`,
    )
    .run();
  await recordBackupRun(db, { runKey: 'github-backup-300', status: 'success', summary: 'old success' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  await recordBackupRun(db, { runKey: 'github-backup-301', status: 'failure', summary: 'new failure' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ id: 'email_reopen' }), { status: 200 })) as typeof fetch;
  try {
    const result = await backupMonitorTick(db, { RESEND_API_KEY: 're_synthetic' });
    assert.equal(result.status, 'failed');
    assert.equal(result.action, 'alerted_admin_and_owner');
    const incident = db.raw
      .prepare(
        "SELECT id, status, opened_at, resolved_at, escalation_sent_at FROM operations_incidents WHERE incident_key = 'backup_stale'",
      )
      .get() as {
      id: string;
      status: string;
      opened_at: string;
      resolved_at: string | null;
      escalation_sent_at: string | null;
    };
    assert.equal(incident.status, 'open');
    assert.equal(incident.id, 'incident_old', 'the single incident record is reused');
    assert.ok(incident.opened_at > '2026-11-20T00:00:00.000Z');
    assert.equal(incident.resolved_at, null);
    assert.equal(incident.escalation_sent_at, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('backup alerts fail closed and record suppression when Resend is absent', async () => {
  const db = migratedDb();
  await recordBackupRun(db, { runKey: 'github-backup-200', status: 'failure', summary: 'no provider' });
  const result = await backupMonitorTick(db, {});
  assert.equal(result.status, 'failed');
  assert.equal(result.action, 'none');
  const rows = db.raw
    .prepare("SELECT status, error_code FROM notification_delivery_events WHERE event_key = 'backup_failure'")
    .all() as Array<{ status: string; error_code: string }>;
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.status === 'suppressed' && row.error_code === 'resend_not_configured'));
});

test('the Stripe billing portal is owner/finance initiated, branch-scoped and never charges', async () => {
  const db = migratedDb();
  db.raw.prepare(
    "INSERT INTO customers (id, first_name, last_name, status, primary_branch_id, stripe_customer_id) VALUES ('cust_portal', 'Portal', 'Customer', 'active', 'branch_pensacola', 'cus_synthetic')",
  ).run();
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ id: 'bps_synthetic', url: 'https://billing.stripe.test/session' }), { status: 200 });
  }) as typeof fetch;
  try {
    const session = await createCustomerBillingPortalSession(db, actor(), 'cust_portal', {
      STRIPE_SECRET_KEY: 'sk_test_synthetic',
      ADMIN_STRIPE_PORTAL_ENABLED: 'true',
      PUBLIC_SITE_URL: 'https://example.test',
    });
    assert.equal(session.sessionId, 'bps_synthetic');
    assert.ok(calls.some((call) => call.includes('/billing_portal/sessions')));
    assert.equal(calls.some((call) => call.includes('/charges') || call.includes('/payment_intents')), false);

    await assert.rejects(
      () => createCustomerBillingPortalSession(db, actor(), 'cust_portal', { STRIPE_SECRET_KEY: 'sk_test_synthetic' }),
      /stripe_billing_portal_disabled/,
    );
    await assert.rejects(
      () => createCustomerBillingPortalSession(db, actor({ role: 'manager', branchId: 'branch_tampa' }), 'cust_portal', {
        STRIPE_SECRET_KEY: 'sk_test_synthetic',
        ADMIN_STRIPE_PORTAL_ENABLED: 'true',
      }),
      /forbidden/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
