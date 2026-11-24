import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4600;
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

test('a completed historical calendar job opens its detail and creates/opens one linked invoice', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  let invoiceCreated = false;
  let invoicePosts = 0;
  const appointment = {
    id: 'appt_hc_1',
    booking_request_id: null,
    status: 'completed',
    source: 'admin_completed',
    start_at: '2026-11-23T18:00:00.000Z',
    end_at: '2026-11-23T20:00:00.000Z',
    duration_minutes: 120,
    reference: 'HC-20261123-0F3495',
    customer_id: 'cust_francesca',
    first_name: 'Francesca',
    last_name: 'Customer',
    line1: '100 Bellview Street',
    city: 'Bellview',
    assigned_names: 'Hayli',
    branch_id: 'branch_pensacola',
    crew_size: 1,
    request_payload: JSON.stringify({ service_type: 'move_out' }),
  };
  const job = {
    id: appointment.id,
    status: 'completed',
    source: 'admin_completed',
    reference: appointment.reference,
    start_at: appointment.start_at,
    end_at: appointment.end_at,
    timezone: 'America/Chicago',
    customer_id: 'cust_francesca',
    property_id: 'prop_francesca',
    first_name: 'Francesca',
    last_name: 'Customer',
    property_label: 'Home',
    line1: '100 Bellview Street',
    city: 'Bellview',
    state: 'FL',
    postal_code: '32526',
    total_cents: 27500,
    service_code: 'move_in_out',
    service_name: 'Move-Out Cleaning',
    assigned_names: 'Hayli',
  };
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
  await page.route('**/api/admin/overview*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, counts: {}, alerts: [], recentLeads: [] }) }),
  );
  await page.route('**/api/admin/requests?**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, requests: [], appointments: [appointment], reservationLeads: [] }) }),
  );
  await page.route('**/api/admin/bookings?view=job**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        job,
        invoice: invoiceCreated
          ? { id: 'inv_francesca', number: 'INV-FRANCESCA', status: 'open', totalCents: 27500, balanceCents: 27500 }
          : null,
        documents: [{ id: 'sign_1', packet_name: 'Move-Out Packet', status: 'signed', executed_at: '2026-11-23T12:00:00.000Z' }],
      }),
    }),
  );
  await page.route('**/api/admin/bookings', async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === 'invoice_job') {
      invoicePosts += 1;
      invoiceCreated = true;
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, invoice: { id: 'inv_francesca', number: 'INV-FRANCESCA', totalCents: 27500 } }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.route('**/api/admin/finance?**', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true, invoices: [], total: 0, limit: 25, offset: 0,
        summary: { invoices: { total: 0 }, payments: { total: 0 }, outstanding: { total: 0 }, gifts: { balance: 0 } },
        services: [],
      }),
    }),
  );
  await page.route('**/api/admin/finance?id=**', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        invoice: {
          id: 'inv_francesca', number: 'INV-FRANCESCA', status: 'open', total_cents: 27500,
          amount_paid_cents: 0, balance_cents: 27500, due_date: '2026-11-23',
          service_name: 'Move-Out Cleaning', service_date: '2026-11-23', service_code: 'move_in_out',
          customer_id: 'cust_francesca', customer_email: 'f@example.test', first_name: 'Francesca', last_name: 'Customer',
        },
        lines: [{ description: 'Move-Out Cleaning', total_cents: 27500 }],
        payments: [], refunds: [], credits: [], receipts: [], tips: { payments: [], allocations: [], summary: {} },
      }),
    }),
  );
  try {
    await page.goto(BASE + '/admin/', { waitUntil: 'load' });
    await page.locator('[data-admin-nav="calendar"]').click();
    await page.locator('.admin-week-grid').waitFor({ state: 'visible' });
    await page.locator('[data-week-appointment="appt_hc_1"] [data-admin-appointment-action="open"]').click();
    await page.locator('[data-admin-calendar-dialog] .admin-calendar-dialog-card').waitFor({ state: 'visible' });
    assert.match((await page.textContent('[data-admin-calendar-dialog]')) ?? '', /Move-Out Cleaning/);
    assert.match((await page.textContent('[data-admin-calendar-dialog]')) ?? '', /Move-Out Packet/);
    await page.locator('[data-calendar-close]').first().click();

    await page.locator('[data-week-appointment="appt_hc_1"] [data-admin-appointment-action="invoice"]').click();
    const confirmation = page.locator('[data-admin-dialog][open]');
    await confirmation.waitFor({ state: 'visible' });
    assert.match((await page.locator('[data-admin-dialog-body]').textContent()) ?? '', /\$275\.00/);
    await page.locator('[data-admin-dialog-confirm]').click();
    await page.waitForFunction(() => document.querySelector('[data-admin-invoice-detail]')?.textContent?.includes('INV-FRANCESCA'));
    assert.equal(invoicePosts, 1);

    await page.locator('[data-admin-nav="calendar"]').click();
    await page.locator('.admin-week-grid').waitFor({ state: 'visible' });
    await page.locator('[data-week-appointment="appt_hc_1"] [data-admin-appointment-action="invoice"]').click();
    await page.waitForFunction(() => document.querySelector('[data-admin-invoice-detail]')?.textContent?.includes('INV-FRANCESCA'));
    assert.equal(invoicePosts, 1, 'clicking Invoice again opens the existing invoice without creating a duplicate');
  } finally {
    await context.close();
  }
});
