import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4602;
const BASE = `http://localhost:${PORT}`;
let server;
let browser;

before(async () => {
  server = spawn(process.execPath, ['node_modules/astro/astro.js', 'preview', '--port', String(PORT)], {
    stdio: 'ignore',
    windowsHide: true,
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(BASE + '/', { signal: AbortSignal.timeout(1500) })).ok) {
        browser = await chromium.launch();
        return;
      }
    } catch {}
    await delay(500);
  }
  throw new Error('preview server did not become ready');
});

after(async () => {
  await browser?.close();
  server?.kill();
});

test('Release A: alert navigation, review job selection and lead management work', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const posts = [];
  const nativeDialogs = [];
  page.on('dialog', (dialog) => {
    nativeDialogs.push(dialog.type());
    void dialog.dismiss();
  });
  await page.route('**/api/admin/auth*', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true, configured: true, setupRequired: false, authenticated: true,
        actor: { id: 'admin_owner', name: 'Owner', role: 'owner', branchId: null, permissions: ['*'], mfaEnabled: false },
        csrf: 'csrf-test',
      }),
    }),
  );
  await page.route('**/api/admin/overview*', (route) => {
    if (route.request().method() === 'POST') {
      posts.push({ route: 'overview', ...route.request().postDataJSON() });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        counts: { requests: 1, unsignedAgreements: 1, outstandingInvoices: 1 },
        alerts: [
          {
            key: 'documents.unsigned', kind: 'unsigned_agreements', severity: 'medium', status: 'new',
            title: 'Agreement packets awaiting signature', message: '1 packet is waiting.', explanation: 'Unsigned.', rootCause: 'Link not completed.', recommendation: 'Open the signing request.',
            count: 1, view: 'documents', records: [{ id: 'sign_1', label: 'Move-Out Packet', detail: 'customer@example.test · pending' }],
          },
          {
            key: 'finance.outstanding_invoices', kind: 'outstanding_invoices', severity: 'medium', status: 'new',
            title: 'Outstanding invoice balances', message: '1 invoice is open.', explanation: 'Balance due.', rootCause: 'Unpaid.', recommendation: 'Open Finance.',
            count: 1, view: 'finance', records: [{ id: 'invoice_1', label: 'INV-1', detail: 'Balance $275.00' }],
          },
        ],
        alertHistory: [], recentLeads: [],
      }),
    });
  });
  await page.route('**/api/admin/documents?**', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('view') === 'request') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          request: {
            request: { id: 'sign_1', packet_name: 'Move-Out Packet', status: 'pending', bundle_code: 'customer.deep', created_at: '2026-11-23T12:00:00.000Z', pricing_snapshot_json: '{}' },
            signatures: [],
          },
          ownerEmail: null,
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, templates: [], bundles: [], requests: [], settings: { enabled: false } }) });
  });
  await page.route('**/api/admin/finance?**', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('id') === 'invoice_1') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          invoice: { id: 'invoice_1', number: 'INV-1', status: 'open', total_cents: 27500, amount_paid_cents: 0, balance_cents: 27500, due_date: '2026-11-24', service_name: 'Move-Out Cleaning', first_name: 'Francesca', last_name: 'Customer', customer_email: 'customer@example.test' },
          lines: [{ description: 'Move-Out Cleaning', total_cents: 27500 }], payments: [], refunds: [], credits: [], receipts: [], tips: { payments: [], allocations: [], summary: {} },
        }),
      });
    }
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, invoices: [{ id: 'invoice_1', number: 'INV-1', total_cents: 27500, balance_cents: 27500, due_date: '2026-11-24', first_name: 'Francesca', last_name: 'Customer', status: 'open' }], total: 1, limit: 25, offset: 0, summary: {}, services: [] }),
    });
  });
  await page.route('**/api/admin/leads?**', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('id')) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, lead: { id: 'lead_1', request_type: 'general_inquiry', status: 'new', delivery_status: 'sent', created_at: '2026-11-23T12:00:00.000Z', payload: { service_type: 'deep', note: 'Synthetic lead' } }, audit: [] }),
      });
    }
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        leads: [
          { id: 'lead_1', request_type: 'general_inquiry', status: 'new', delivery_status: 'sent', quote_reference: 'INQ-1', created_at: '2026-11-23T12:00:00.000Z', first_name: 'Lead', last_name: 'Customer', payload_json: '{}' },
          { id: 'lead_2', request_type: 'general_inquiry', status: 'archived', delivery_status: 'sent', quote_reference: 'INQ-2', created_at: '2026-11-22T12:00:00.000Z', first_name: 'Archived', last_name: 'Lead', payload_json: '{}' },
        ],
        total: 2, limit: 25, offset: 0,
      }),
    });
  });
  await page.route('**/api/admin/leads', (route) => {
    posts.push({ route: 'leads', ...route.request().postDataJSON() });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, succeeded: 1, failed: 0, results: [{ id: 'lead_1', ok: true }] }) });
  });
  await page.route('**/api/admin/reviews?**', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('view') === 'eligible') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          appointments: [{
            id: 'appt_review_1', start_at: '2026-11-23T18:00:00.000Z', status: 'completed', branch_id: 'branch_pensacola',
            first_name: 'Francesca', last_name: 'Customer', line1: '100 Bellview Street', city: 'Bellview',
            service_code: 'move_in_out', input_snapshot_json: '{"service_label":"Move-Out Cleaning"}',
            branch_name: 'Pensacola', review_url: 'https://g.page/r/CXAcv1Pp7OI2ECE/review', review_requests_enabled: 1,
            latest_status: null, latest_sent_at: null,
          }],
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, requests: [] }) });
  });
  await page.route('**/api/admin/reviews', (route) => {
    posts.push({ route: 'reviews', ...route.request().postDataJSON() });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, queued: true }) });
  });
  try {
    await page.goto(BASE + '/admin/', { waitUntil: 'load' });
    const docsAlert = page.locator('.admin-alert').filter({ hasText: 'Agreement packets awaiting signature' });
    await docsAlert.locator('summary').click();
    await docsAlert.getByRole('button', { name: 'Open', exact: true }).click();
    await page.locator('[data-document-request-detail]').getByText('Move-Out Packet').waitFor({ state: 'visible' });

    await page.locator('[data-admin-nav="overview"]').click();
    const invoiceAlert = page.locator('.admin-alert').filter({ hasText: 'Outstanding invoice balances' });
    await invoiceAlert.locator('summary').click();
    await invoiceAlert.getByRole('button', { name: 'Open', exact: true }).click();
    await page.locator('[data-admin-invoice-detail]').getByText('INV-1').waitFor({ state: 'visible' });

    await page.locator('[data-admin-nav="leads"]').click();
    await page.locator('[data-admin-leads]').getByText('INQ-1').waitFor({ state: 'visible' });
    await page.locator('[data-lead-select]').first().check();
    await page.locator('[data-admin-lead-bulk]').waitFor({ state: 'visible' });
    await page.locator('[data-admin-lead-bulk] [data-operation="archive"]').click();
    await page.locator('[data-admin-dialog][open]').waitFor({ state: 'visible' });
    await page.locator('[data-admin-dialog-confirm]').click();
    await page.waitForFunction(() => document.querySelector('[data-admin-success]')?.textContent?.includes('updated'));
    assert.ok(posts.some((post) => post.route === 'leads' && post.action === 'bulk' && post.operation === 'archive'));
    await page.locator('[data-admin-action="lead-open"]').first().click();
    await page.locator('[data-admin-lead-detail]').getByText('Synthetic lead').waitFor({ state: 'visible' });

    await page.locator('[data-admin-nav="reviews"]').click();
    assert.equal(await page.locator('input[name="appointmentId"]').count(), 0, 'no manual appointment ID entry remains');
    await page.locator('[data-review-eligible-list]').getByText('Francesca Customer').waitFor({ state: 'visible' });
    await page.locator('[data-review-queue-id="appt_review_1"]').click();
    await page.locator('[data-admin-dialog][open]').waitFor({ state: 'visible' });
    await page.locator('[data-admin-dialog-confirm]').click();
    await page.waitForFunction(() => document.querySelector('[data-review-status-message]')?.textContent?.includes('queued'));
    assert.ok(posts.some((post) => post.route === 'reviews' && post.action === 'queue' && post.appointmentId === 'appt_review_1'));
    assert.equal(nativeDialogs.length, 0, 'no native browser prompts are used for these operations');
  } finally {
    await context.close();
  }
});
