// Customer File and Job File: connected customer context, payments,
// communications, activity timeline, change orders and job finance.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4608;
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
    } catch {
      // not ready
    }
    await delay(500);
  }
  throw new Error('preview server did not become ready');
});

after(async () => {
  await browser?.close();
  server?.kill();
});

test('the customer file and job file render connected activity, payments and change orders', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const customer = {
    id: 'cust_file',
    first_name: 'File',
    last_name: 'Customer',
    company_name: '',
    status: 'active',
    source: 'website',
    primary_branch_id: 'branch_pensacola',
    branch_name: 'Pensacola',
  };

  await page.route('**/api/admin/auth*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        configured: true,
        setupRequired: false,
        authenticated: true,
        actor: { id: 'admin_owner', name: 'Owner', role: 'owner', branchId: null, permissions: ['*'], mfaEnabled: false },
        csrf: 'csrf-test',
      }),
    }),
  );
  await page.route('**/api/admin/overview*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, counts: {}, alerts: [], recentLeads: [] }) }),
  );
  await page.route('**/api/admin/entitlements?**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, entitlements: [], history: [] }) }),
  );
  await page.route('**/api/admin/customers?**', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('id')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          customer,
          contacts: [{ id: 'c1', kind: 'email', value: 'file@example.test', is_primary: 1 }],
          properties: [{ id: 'prop_file', label: 'Home', line1: '9 File Way', city: 'Pensacola', state: 'FL', postal_code: '32502', is_primary: 1, status: 'active' }],
          notes: [],
          leads: [],
          estimates: [],
          appointments: [{ id: 'appt_file', reference: 'HC-FILE-001', status: 'completed', start_at: '2026-11-22T18:00:00.000Z', property_id: 'prop_file' }],
          recurringPlans: [],
          invoices: [{ id: 'inv_file', number: 'INV-FILE-001', status: 'paid', total_cents: 27500, balance_cents: 0, due_date: '2026-11-22', appointment_id: 'appt_file', invoice_role: 'primary', created_at: '2026-11-22T20:10:00.000Z' }],
          paymentAuthorizations: [],
          signingRequests: [],
          gifts: [],
          quickEstimates: [],
          reviewState: { status: 'reviewed', invitation_count: 1, last_invited_at: '2026-11-23T20:00:00.000Z' },
          payments: [{ id: 'pay_file', invoice_id: 'inv_file', appointment_id: 'appt_file', provider: 'stripe', status: 'succeeded', amount_cents: 30000, tip_cents: 2500, received_at: '2026-11-22T20:20:00.000Z', created_at: '2026-11-22T20:20:00.000Z' }],
          communications: [{ id: 'comm_file', channel: 'email', direction: 'outbound', status: 'delivered', subject: 'Your cleaning receipt', created_at: '2026-11-22T20:25:00.000Z' }],
          jobMedia: [{ id: 'media_file', appointment_id: 'appt_file', kind: 'after', created_at: '2026-11-22T20:30:00.000Z' }],
          tipAllocations: [],
          timeline: [
            { at: '2026-11-22T20:30:00.000Z', kind: 'photo', title: 'Photo added', detail: 'After', entityType: 'job_media', entityId: 'media_file', appointmentId: 'appt_file' },
            { at: '2026-11-22T20:20:00.000Z', kind: 'payment', title: 'Payment Succeeded', detail: '$300.00 including $25.00 gratuity via Stripe', entityType: 'payment', entityId: 'pay_file', invoiceId: 'inv_file', appointmentId: 'appt_file' },
            { at: '2026-11-22T20:10:00.000Z', kind: 'invoice', title: 'Invoice INV-FILE-001', detail: '$275.00 · Paid', entityType: 'invoice', entityId: 'inv_file', invoiceId: 'inv_file', appointmentId: 'appt_file' },
          ],
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, customers: [customer], total: 1, limit: 25, offset: 0 }),
    });
  });
  await page.route('**/api/admin/bookings?view=job**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        job: {
          id: 'appt_file', reference: 'HC-FILE-001', status: 'completed', source: 'website',
          start_at: '2026-11-22T18:00:00.000Z', end_at: '2026-11-22T20:00:00.000Z',
          branch_id: 'branch_pensacola', customer_id: 'cust_file', property_id: 'prop_file',
          first_name: 'File', last_name: 'Customer', company_name: '',
          property_label: 'Home', line1: '9 File Way', city: 'Pensacola', state: 'FL', postal_code: '32502',
          service_name: 'Deep Cleaning', service_code: 'deep', total_cents: 27500, assigned_names: 'Hayli',
        },
        invoice: { id: 'inv_file', number: 'INV-FILE-001', status: 'paid', totalCents: 27500, balanceCents: 0 },
        documents: [],
        invoices: [{ id: 'inv_file', number: 'INV-FILE-001', status: 'paid', invoice_role: 'primary', total_cents: 27500, balance_cents: 0, created_at: '2026-11-22T20:10:00.000Z' }],
        payments: [{ id: 'pay_file', provider: 'stripe', status: 'succeeded', amount_cents: 30000, tip_cents: 2500, received_at: '2026-11-22T20:20:00.000Z' }],
        photos: [{ id: 'media_file', kind: 'after', created_at: '2026-11-22T20:30:00.000Z' }],
        communications: [{ id: 'comm_file', channel: 'email', direction: 'outbound', status: 'delivered', subject: 'Your cleaning receipt', created_at: '2026-11-22T20:25:00.000Z' }],
        crew: [{ id: 'team_hayli', display_name: 'Hayli' }],
        changeOrders: [{
          id: 'change_file', reference: 'CO-20261124-AA1111', effective_status: 'signed',
          adjustment_cents: 5000, revised_price_cents: 32500, signing_request_id: 'sign_change',
          supplemental_invoice_id: null,
        }],
        timeline: [
          { at: '2026-11-24T12:00:00.000Z', kind: 'change_order', title: 'Change order CO-20261124-AA1111', detail: '$50.00 · Signed' },
          { at: '2026-11-22T20:20:00.000Z', kind: 'payment', title: 'Payment Succeeded', detail: '$300.00 including $25.00 gratuity via Stripe' },
        ],
      }),
    }),
  );

  try {
    await page.goto(BASE + '/admin/', { waitUntil: 'load' });
    await page.locator('[data-admin-nav="customers"]').click();
    await page.locator('[data-admin-customers]').getByText('File Customer').first().waitFor();
    await page.locator('[data-admin-customers] button[data-admin-action="customer-open"]').first().click();
    const detail = page.locator('[data-admin-customer-detail]');
    await detail.getByText('Activity timeline').waitFor();
    const detailText = (await detail.textContent()) ?? '';
    assert.match(detailText, /HC-FILE-001/);
    assert.match(detailText, /\$300\.00/);
    assert.match(detailText, /\$25\.00 gratuity/);
    assert.match(detailText, /Your cleaning receipt/);
    assert.match(detailText, /Payment Succeeded/);
    assert.match(detailText, /Photo added/);

    await detail.getByRole('button', { name: 'Open Job File' }).first().click();
    const dialog = page.locator('.admin-calendar-dialog-card');
    await dialog.getByText('Change orders').waitFor();
    const jobText = (await dialog.textContent()) ?? '';
    assert.match(jobText, /HC-FILE-001/);
    assert.match(jobText, /CO-20261124-AA1111/);
    assert.match(jobText, /Signed/);
    assert.match(jobText, /Create supplemental invoice/);
    assert.match(jobText, /Finance/);
    assert.match(jobText, /Deep Cleaning/);
    assert.match(jobText, /Hayli/);
    assert.match(jobText, /Create change order/);
    assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
  } finally {
    await context.close();
  }
});
