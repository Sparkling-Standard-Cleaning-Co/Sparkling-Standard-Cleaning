import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4601;
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

const invoice = {
  id: 'inv_francesca',
  number: 'INV-20261124-FRANCESCA',
  status: 'open',
  total_cents: 27500,
  amount_paid_cents: 0,
  balance_cents: 27500,
  due_date: '2026-11-24',
  service_code: 'move_in_out',
  service_name: 'Move-Out Cleaning',
  service_date: '2026-11-23',
  customer_id: 'cust_francesca',
  customer_email: 'francesca@example.test',
  first_name: 'Francesca',
  last_name: 'Customer',
  payment_url: null,
};

test('invoice sending uses a branded confirmation, not an email-code prompt, and sends once', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const sends = [];
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
        actor: { id: 'admin_owner', name: 'Owner', role: 'owner', branchId: null, permissions: ['*'], mfaEnabled: true },
        csrf: 'csrf-test',
      }),
    }),
  );
  await page.route('**/api/admin/overview*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, counts: {}, alerts: [], recentLeads: [] }) }),
  );
  await page.route('**/api/admin/customers?**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, customers: [] }) }),
  );
  await page.route('**/api/admin/finance?**', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        invoices: [{
          id: invoice.id, number: invoice.number, status: invoice.status,
          total_cents: invoice.total_cents, balance_cents: invoice.balance_cents,
          due_date: invoice.due_date, first_name: invoice.first_name, last_name: invoice.last_name,
        }],
        total: 1, limit: 25, offset: 0,
        summary: { invoices: { total: 27500 }, payments: { total: 0 }, outstanding: { total: 27500 }, gifts: { balance: 0 } },
        services: [],
      }),
    }),
  );
  await page.route('**/api/admin/finance?id=**', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true, invoice,
        lines: [{ description: 'Move-Out Cleaning', total_cents: 27500 }],
        payments: [], refunds: [], credits: [], receipts: [],
        tips: { payments: [], allocations: [], summary: {} },
      }),
    }),
  );
  await page.route('**/api/admin/finance', async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === 'email_invoice') sends.push(body);
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, status: 'sent' }),
    });
  });
  try {
    await page.goto(BASE + '/admin/', { waitUntil: 'load' });
    await page.getByRole('button', { name: 'Invoices & Payments' }).click();
    await page.locator('[data-admin-invoices]').getByText(invoice.number).waitFor({ state: 'visible' });
    await page.locator('[data-admin-invoices] [data-admin-action="invoice-open"]').click();
    await page.locator('[data-admin-invoice-detail]').getByText(invoice.number).waitFor({ state: 'visible' });

    await page.locator('[data-admin-action="invoice-email-link"]').click();
    const dialog = page.locator('[data-admin-dialog][open]');
    await dialog.waitFor({ state: 'visible' });
    const detail = (await page.locator('[data-admin-dialog-body]').textContent()) ?? '';
    assert.match(detail, /Francesca Customer/);
    assert.match(detail, /francesca@example\.test/);
    assert.match(detail, /INV-20261124-FRANCESCA/);
    assert.match(detail, /\$275\.00/);
    assert.match(detail, /Included in this email/);
    assert.match(detail, /optional gratuity defaulting to \$0\.00/);
    assert.equal(nativeDialogs.length, 0, 'no browser prompt/email-code challenge is shown');
    await page.locator('[data-admin-dialog-cancel]').click();
    assert.equal(sends.length, 0, 'Cancel never sends');

    await page.locator('[data-admin-action="invoice-email-link"]').click();
    await page.locator('[data-admin-dialog][open]').waitFor({ state: 'visible' });
    await page.locator('[data-admin-dialog-confirm]').click();
    await page.waitForFunction(() => document.querySelector('[data-admin-success]')?.textContent?.includes('secure payment link'));
    assert.equal(sends.length, 1);
    assert.equal(sends[0].includePaymentLink, true);
    assert.equal(nativeDialogs.length, 0);

    await page.locator('[data-admin-action="invoice-email"]').click();
    await page.locator('[data-admin-dialog][open]').waitFor({ state: 'visible' });
    assert.match((await page.locator('[data-admin-dialog-body]').textContent()) ?? '', /Not included — PDF only/);
    await page.locator('[data-admin-dialog-confirm]').click();
    await page.waitForFunction(() => document.querySelector('[data-admin-success]')?.textContent?.includes('PDF attached'));
    assert.equal(sends.length, 2);
    assert.equal(sends[1].includePaymentLink, false);
    assert.equal(nativeDialogs.length, 0);
  } finally {
    await context.close();
  }
});
