import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4579;
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

test('the commercial workspace builds a structured multi-location proposal and saves server payload', async () => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
  const page = await context.newPage();
  const posts = [];
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
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"counts":{},"recentLeads":[]}' }),
  );
  await page.route('**/api/admin/commercial**', async (route) => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"id":"prop_new"}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        customers: [
          { id: 'cust_acme', company_name: 'Acme Facilities', first_name: 'Acme', last_name: 'Manager', primary_branch_id: 'branch_pensacola' },
        ],
        properties: [
          { id: 'prop_hq', customer_id: 'cust_acme', label: 'HQ', line1: '1 Office Way', city: 'Pensacola', state: 'FL', access_notes: 'Badge at front desk' },
          { id: 'prop_wh', customer_id: 'cust_acme', label: 'Warehouse', line1: '2 Depot Rd', city: 'Pensacola', state: 'FL' },
        ],
        proposals: [],
        contracts: [],
      }),
    });
  });
  page.on('dialog', (dialog) => dialog.accept());

  try {
    await page.goto(BASE + '/admin/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Commercial Accounts' }).click();
    await page.waitForSelector('[data-admin-view="commercial"]:not([hidden])');
    assert.match((await page.textContent('[data-commercial-workspace]')) ?? '', /No commercial proposals yet/);
    await page.click('[data-commercial-action="new"]');
    await page.waitForSelector('[data-commercial-editor] [data-commercial-field="title"]');
    await page.fill('[data-commercial-field="title"]', 'Multi-site janitorial');
    await page.selectOption('[data-commercial-field="customerId"]', 'cust_acme');
    await page.click('[data-commercial-action="add-location"]');
    await page.waitForSelector('[data-commercial-location]');
    await page.fill('[data-location-field="name"]', 'HQ');
    await page.fill('[data-location-field="address"]', '1 Office Way');
    await page.selectOption('[data-location-field="propertyId"]', 'prop_hq');
    await page.click('[data-commercial-action="add-area"]');
    await page.fill('[data-area-field="name"]', 'Offices');
    await page.click('[data-commercial-action="add-task"]');
    const task = page.locator('[data-commercial-task]').first();
    await task.locator('[data-task-field="name"]').fill('Vacuum and dust');
    await task.locator('[data-task-field="frequency"]').fill('3x weekly');
    await task.locator('[data-task-field="monthly"]').fill('1200.00');
    const responsePromise = page.waitForResponse((response) => response.url().includes('/api/admin/commercial') && response.request().method() === 'POST');
    await page.click('[data-commercial-action="save"]');
    await responsePromise;
    const created = posts.find((body) => body.action === 'create_proposal');
    assert.ok(created, 'create_proposal was submitted');
    assert.equal(created.title, 'Multi-site janitorial');
    assert.equal(created.customerId, 'cust_acme');
    assert.equal(created.scope.locations.length, 1);
    assert.equal(created.scope.locations[0].propertyId, 'prop_hq');
    assert.equal(created.scope.locations[0].areas[0].tasks[0].name, 'Vacuum and dust');
    assert.equal(created.scope.locations[0].areas[0].tasks[0].monthlyCents, 120000);
  } finally {
    await context.close();
  }
});
