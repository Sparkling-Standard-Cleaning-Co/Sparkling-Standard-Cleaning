// Admin address autocomplete UI. Google is intentionally unavailable here so
// the test exercises the graceful address-lookup fallback; Google Places itself
// is covered by the authenticated server tests.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4439;
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

async function openAdmin() {
  const context = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  const page = await context.newPage();
  await page.route('**/api/admin/auth*', async (route) => {
    await route.fulfill({
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
    });
  });
  await page.route('**/api/admin/overview*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, counts: {}, recentLeads: [], alerts: [] }) });
  });
  await page.route('**/api/admin/promotions*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, promotions: [] }) });
  });
  await page.route('**/api/admin/customers**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        customers: [{ id: 'cust_1', first_name: 'Saved', last_name: 'Customer', email: 'saved@example.test', status: 'active' }],
      }),
    });
  });
  await page.route('**/api/admin/bookings?view=context**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        properties: [{
          id: 'prop_1',
          label: 'Home',
          line1: '500 Property Way',
          line2: 'Unit B',
          city: 'Pensacola',
          state: 'FL',
          postal_code: '32503',
          latitude: 30.5,
          longitude: -87.3,
          precision: 'exact',
        }],
      }),
    });
  });
  await page.route('**/api/admin/quick-estimates**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, estimates: [] }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.route('**/api/maps-browser-config', async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'maps_not_configured' }) });
  });
  await page.route('**/api/geocode', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.action === 'suggest') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          suggestions: [
            { id: 'lookup_1', label: '1000 Bayou Blvd, Pensacola, FL 32503', kind: 'address' },
            { id: 'lookup_2', label: '1000 Bayou Drive, Pensacola, FL 32503', kind: 'address' },
          ],
        }),
      });
      return;
    }
    if (body.action === 'resolve-id') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          result: {
            label: '1000 Bayou Blvd, Pensacola, FL 32503',
            lat: 30.4213,
            lng: -87.2169,
            city: 'Pensacola',
            state: 'FL',
            zip: '32503',
            precise: true,
          },
        }),
      });
      return;
    }
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
  });
  await page.goto(BASE + '/admin/', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-admin-app]:not([hidden])');
  await page.click('[data-admin-nav="quick-estimate"]');
  await page.waitForSelector('[data-admin-view="quick-estimate"]:not([hidden])');
  return { page, context };
}

test('the admin address field offers predictions, keyboard selection and autofill without losing the unit', async () => {
  const { page, context } = await openAdmin();
  await page.fill('[data-quick-form] input[name="addressUnit"]', 'Apt 4');
  await page.fill('[data-quick-form] input[name="addressLine1"]', '1000 Bay');
  await page.waitForSelector('.admin-address-menu__option');
  const options = await page.locator('.admin-address-menu__option').count();
  assert.equal(options, 2);
  const menuText = await page.textContent('.admin-address-menu:not([hidden])');
  assert.match(menuText ?? '', /Address lookup/);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const input = document.querySelector('[data-quick-form] input[name="addressLine1"]');
    return input && input.value === '1000 Bayou Blvd';
  });
  assert.equal(await page.inputValue('[data-quick-form] input[name="addressUnit"]'), 'Apt 4');
  assert.equal(await page.inputValue('[data-quick-form] input[name="city"]'), 'Pensacola');
  assert.equal(await page.inputValue('[data-quick-form] select[name="state"]'), 'FL');
  assert.equal(await page.inputValue('[data-quick-form] input[name="postalCode"]'), '32503');
  assert.equal(await page.inputValue('[data-quick-form] input[name="latitude"]'), '30.4213');
  assert.equal(await page.inputValue('[data-quick-form] input[name="longitude"]'), '-87.2169');
  assert.match((await page.textContent('[data-quick-form] [data-admin-address-status]')) ?? '', /verified with the address lookup service/i);

  await page.fill('[data-quick-form] input[name="addressLine1"]', '1000 Bayou Blvdx');
  await page.waitForFunction(() => {
    const input = document.querySelector('[data-quick-form] input[name="latitude"]');
    return input && input.value === '';
  });
  assert.match((await page.textContent('[data-quick-form] [data-admin-address-status]')) ?? '', /Address changed/i);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.fill('[data-quick-form] input[name="addressLine1"]', '1000 Bay');
  await page.waitForSelector('.admin-address-menu__option');
  const menu = await page.locator('.admin-address-menu:not([hidden])').last().boundingBox();
  assert.ok(menu);
  assert.ok(menu.x >= 0 && menu.x + menu.width <= 390, `menu stays inside the phone viewport: ${JSON.stringify(menu)}`);
  await context.close();
});

test('selecting a saved customer property fills the verified coordinates and does not keep a stale Google selection', async () => {
  const { page, context } = await openAdmin();
  await page.selectOption('[data-quick-form] select[name="customerId"]', 'cust_1');
  await page.waitForFunction(() => {
    const select = document.querySelector('[data-quick-form] select[name="propertyId"]');
    return select && select.options.length > 1;
  });
  await page.selectOption('[data-quick-form] select[name="propertyId"]', 'prop_1');
  assert.equal(await page.inputValue('[data-quick-form] input[name="addressLine1"]'), '500 Property Way');
  assert.equal(await page.inputValue('[data-quick-form] input[name="addressUnit"]'), 'Unit B');
  assert.equal(await page.inputValue('[data-quick-form] input[name="city"]'), 'Pensacola');
  assert.equal(await page.inputValue('[data-quick-form] input[name="postalCode"]'), '32503');
  assert.equal(await page.inputValue('[data-quick-form] input[name="latitude"]'), '30.5');
  assert.equal(await page.inputValue('[data-quick-form] input[name="longitude"]'), '-87.3');
  assert.match((await page.textContent('[data-quick-form] [data-admin-address-status]')) ?? '', /Saved coordinates on file/i);
  await context.close();
});
