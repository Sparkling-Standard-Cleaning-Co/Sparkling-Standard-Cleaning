import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4576;
const BASE = 'http://localhost:' + PORT;
let server; let browser;
before(async () => {
  server = spawn(process.execPath, ['node_modules/astro/astro.js', 'preview', '--port', String(PORT)], { stdio: 'ignore', windowsHide: true });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(BASE + '/')).ok) { browser = await chromium.launch(); return; } } catch {}
    await delay(500);
  }
  throw new Error('preview server did not become ready');
});
after(async () => { await browser?.close(); server?.kill(); });

const settings = {
  schemaVersion: 1,
  departments: {
    bookings: { address: 'bookings@sparkling-standard.com', enabled: true },
    customerService: { address: 'customer-service@sparkling-standard.com', enabled: true },
    billing: { address: 'billing@sparkling-standard.com', enabled: true },
    hiring: { address: 'hiring@sparkling-standard.com', enabled: true },
    admin: { address: 'admin@sparkling-standard.com', enabled: true },
    owner: { address: 'owner@sparkling-standard.com', enabled: true },
  },
  routing: {
    booking_request: ['bookings'], booking_confirmation: ['bookings'], booking_reminder: ['bookings'],
    invoice_delivery: ['billing'], payment_receipt: ['billing'], contact_inquiry: ['customerService'],
    careers_application: ['hiring'], hiring_notification: ['hiring'],
    security_alert: ['admin', 'owner'], backup_failure: ['admin', 'owner'],
    owner_escalation: ['admin', 'owner'], weekly_health_digest: ['admin', 'owner'],
  },
  replyTo: { bookingConfirmations: 'bookings', invoices: 'billing', receipts: 'billing', careers: 'hiring', contact: 'customerService' },
  templates: {
    booking_confirmation: { subject: 'Confirmed {{reference}}', body: 'Hello {{customer_name}}', enabled: true },
    invoice_delivery: { subject: 'Invoice {{invoice_number}}', body: 'Balance {{balance}}', enabled: true },
    payment_receipt: { subject: 'Receipt {{invoice_number}}', body: 'Paid {{amount_paid}}', enabled: true },
    careers_acknowledgment: { subject: 'Application {{reference}}', body: 'Hello {{applicant_name}}', enabled: true },
    hiring_notification: { subject: 'Application {{reference}}', body: 'Role {{desired_role}}', enabled: true },
    security_alert: { subject: 'Security', body: '{{event_detail}}', enabled: true },
    backup_alert: { subject: 'Backup', body: '{{event_detail}}', enabled: true },
    weekly_digest: { subject: 'Digest {{period}}', body: '{{summary}}', enabled: true },
  },
  alerts: { escalationMinutes: 30, failureThreshold: 3 },
};

const metadata = {
  departments: [
    { key: 'bookings', label: 'Bookings' }, { key: 'customerService', label: 'Customer Service' },
    { key: 'billing', label: 'Billing' }, { key: 'hiring', label: 'Hiring' },
    { key: 'admin', label: 'Admin' }, { key: 'owner', label: 'Owner' },
  ],
  events: [
    { key: 'booking_confirmation', label: 'Booking confirmation', critical: false, defaults: ['bookings'], description: 'Booking updates.' },
    { key: 'security_alert', label: 'Critical security alert', critical: true, defaults: ['admin', 'owner'], description: 'Critical events.' },
  ],
  replyTo: [{ key: 'bookingConfirmations', label: 'Booking confirmations' }, { key: 'invoices', label: 'Invoice email' }],
  templates: [{ key: 'booking_confirmation' }, { key: 'security_alert' }],
};

test('the owner communications center renders routing, previews templates and never exposes owner as reply-to', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const posts = [];
  await page.route('**/api/admin/auth*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, configured: true, setupRequired: false, authenticated: true, actor: { id: 'admin_owner', name: 'Owner', role: 'owner', branchId: null, permissions: ['*'], mfaEnabled: false }, csrf: 'csrf-test' }) });
  });
  await page.route('**/api/admin/overview*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, counts: {}, recentLeads: [] }) });
  });
  await page.route('**/api/admin/communications**', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      posts.push(body);
      if (body.action === 'preview') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, preview: { subject: 'Confirmed SS-EXAMPLE-1001', body: 'Hello Jordan Example', variables: ['customer_name', 'reference'] } }) });
        return;
      }
      if (body.action === 'send_test') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'sent', recipient: 'bookings@sparkling-standard.com', eventId: 'notif_test' }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, version: 2 }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, source: 'stored', valid: true, settings, metadata,
      versions: [{ version: 1, created_at: '2026-11-20T12:00:00.000Z', created_by: 'Owner', change_note: 'Initial' }],
      health: {
        summary: { sent: 3 },
        recent: [{ event_key: 'communications_test', department: 'bookings', recipient: 'bookings@sparkling-standard.com', status: 'sent', provider: 'resend', error_code: '', attempts: 1, created_at: '2026-11-22T12:00:00.000Z' }],
        leadFailures: [],
        bookingFailures: [],
        receiptFailures: [],
        note: 'Inbox confirmation required.',
      },
      provider: { provider: 'resend', resendConfigured: true, senderConfigured: true, replyToConfigured: true, note: 'Provider acceptance is not inbox proof.' },
    }) });
  });
  page.on('dialog', (dialog) => dialog.accept());
  try {
    await page.goto(BASE + '/admin/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Communications & Notifications' }).click();
    await page.waitForSelector('[data-admin-view="communications"]:not([hidden])');
    assert.equal(await page.locator('[data-communication-route]').count(), 12);
    assert.equal(await page.locator('[data-communication-route][disabled]').count(), 6);
    assert.match(await page.textContent('[data-admin-communications-provider]') ?? '', /Resend API key configured/);
    assert.match(await page.textContent('[data-communications-versions]') ?? '', /Initial/);
    const replyToOptions = await page.locator('[data-communication-reply-to="contact"] option').evaluateAll((options) => options.map((option) => option.value));
    assert.equal(replyToOptions.includes('owner'), false);
    await page.selectOption('[data-communications-template-select]', 'booking_confirmation');
    await page.click('[data-admin-action="communications-preview"]');
    await page.waitForSelector('[data-communications-preview] .admin-record');
    assert.match(await page.textContent('[data-communications-preview]') ?? '', /Hello Jordan Example/);
    assert.ok(posts.some((body) => body.action === 'preview' && body.templateKey === 'booking_confirmation'));
    assert.match(await page.textContent('[data-admin-communications-health]') ?? '', /communications_test|Bookings|sent/i);

    await page.locator('[data-communication-route="booking_confirmation"][value="owner"]').check();
    await page.fill('[data-communications-note]', 'Owner oversight for booking confirmations');
    await page.locator('[data-communications-form] button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('[data-communications-form-status]')?.textContent?.includes('Saved'));
    const saved = posts.find((body) => body.action === 'save');
    assert.ok(saved);
    assert.ok(saved.settings.routing.booking_confirmation.includes('owner'));
    assert.equal(saved.note, 'Owner oversight for booking confirmations');

    await page.selectOption('[data-communications-test-department]', 'bookings');
    await page.click('[data-admin-action="communications-test"]');
    await page.waitForFunction(() => document.querySelector('[data-communications-test-status]')?.textContent?.includes('Provider accepted'));
    assert.ok(posts.some((body) => body.action === 'send_test' && body.department === 'bookings'));
  } finally { await context.close(); }
});
