import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4598;
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

test('the admin invoice form uses the canonical service catalog and records a completed service date', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  let posted = null;
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
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, counts: {}, alerts: [], recentLeads: [] }),
    }),
  );
  await page.route('**/api/admin/customers?**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        customers: [{ id: 'cust_francesca', first_name: 'Francesca', last_name: 'Customer', email: 'f@example.test' }],
        total: 1,
        limit: 25,
        offset: 0,
      }),
    }),
  );
  await page.route('**/api/admin/finance?**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        invoices: [],
        total: 0,
        limit: 25,
        offset: 0,
        summary: { invoices: { total: 0 }, payments: { total: 0 }, outstanding: { total: 0 }, gifts: { balance: 0 } },
        services: [
          { code: 'standard', name: 'Residential Cleaning', category: 'residential', taxable: 1 },
          { code: 'deep', name: 'Deep Cleaning', category: 'residential', taxable: 1 },
          { code: 'move_in_out', name: 'Move-in and Move-out Cleaning', category: 'residential', taxable: 1 },
          { code: 'commercial-cleaning', name: 'Commercial Cleaning', category: 'commercial', taxable: 1 },
        ],
      }),
    }),
  );
  await page.route('**/api/admin/finance', async (route) => {
    posted = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, id: 'inv_1', number: 'INV-1', totalCents: 27500 }),
    });
  });
  try {
    await page.goto(BASE + '/admin/', { waitUntil: 'load' });
    await page.getByRole('button', { name: 'Invoices & Payments' }).click();
    await page.waitForFunction(() => {
      const select = document.querySelector('[data-admin-invoice-services]');
      return select instanceof HTMLSelectElement && select.options.length > 3;
    });
    const labels = await page.locator('[data-admin-invoice-services] option').allTextContents();
    assert.ok(labels.includes('Move-Out Cleaning'));
    assert.ok(labels.includes('Move-In Cleaning'));
    assert.ok(labels.includes('Residential Cleaning'));
    assert.ok(labels.includes('Deep Cleaning'));
    await page.selectOption('[data-admin-invoice-create] select[name="customerId"]', 'cust_francesca');
    await page.selectOption('[data-admin-invoice-services]', { label: 'Move-Out Cleaning' });
    await page.fill('[data-admin-invoice-create] input[name="serviceDate"]', '2026-11-23');
    await page.fill('[data-admin-invoice-create] input[name="amount"]', '275');
    const responsePromise = page.waitForResponse(
      (response) => response.url().endsWith('/api/admin/finance') && response.request().method() === 'POST',
    );
    await page.locator('[data-admin-invoice-create] button[type="submit"]').click();
    await responsePromise;
    assert.ok(posted);
    assert.equal(posted.action, 'create_invoice');
    assert.equal(posted.serviceCode, 'move_in_out');
    assert.equal(posted.serviceLabel, 'Move-Out Cleaning');
    assert.equal(posted.serviceDate, '2026-11-23');
    assert.equal(posted.lines[0].description, 'Move-Out Cleaning');
    assert.equal(posted.lines[0].totalCents, 27500);
  } finally {
    await context.close();
  }
});
