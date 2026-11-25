import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4604;
const BASE = `http://localhost:${PORT}`;
let server;
let browser;

const customers = [
  { id: 'cust_a', first_name: 'Alice', last_name: 'Alpha', email: 'alice@example.test', phone: '850-111-1111', status: 'active' },
  { id: 'cust_b', first_name: 'Bob', last_name: 'Beta', email: 'bob@example.test', phone: '850-222-2222', status: 'active' },
  { id: 'cust_c', first_name: 'Cara', last_name: 'Gamma', email: '', phone: '850-333-3333', status: 'active' },
];
const contexts = {
  cust_a: {
    customer: { ...customers[0], primary_branch_id: 'branch_pensacola' },
    properties: [
      { id: 'prop_a1', label: 'Alpha Home', line1: '1 Alpha Way', city: 'Pensacola', state: 'FL', postal_code: '32501', latitude: 30.41, longitude: -87.21, property_type: 'house', square_feet: 1200, bedrooms: 2, full_baths: 1, half_baths: 1, beds: 2, pets: 'one', is_primary: 1 },
      { id: 'prop_a2', label: 'Alpha Rental', line1: '2 Alpha Way', city: 'Pensacola', state: 'FL', postal_code: '32501', property_type: 'condo', square_feet: 800, bedrooms: 1, full_baths: 1, half_baths: 0, beds: 1, pets: 'none', is_primary: 0 },
    ],
  },
  cust_b: {
    customer: { ...customers[1], primary_branch_id: 'branch_pensacola' },
    properties: [
      { id: 'prop_b1', label: 'Beta Home', line1: '10 Beta Blvd', city: 'Milton', state: 'FL', postal_code: '32570', latitude: 30.62, longitude: -87.04, property_type: 'house', square_feet: 2400, bedrooms: 4, full_baths: 3, half_baths: 0, beds: 4, pets: 'multiple_shedding', is_primary: 1 },
    ],
  },
  cust_c: {
    customer: { ...customers[2], primary_branch_id: 'branch_pensacola' },
    properties: [],
  },
};

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

test('Quick Estimate switches customers atomically and ignores stale responses', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const quotes = [];
  const nativeDialogs = [];
  page.on('dialog', (dialog) => {
    nativeDialogs.push(dialog.type());
    void dialog.dismiss();
  });
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
      body: JSON.stringify({ ok: true, counts: {}, alerts: [], alertHistory: [], recentLeads: [] }),
    }),
  );
  await page.route('**/api/admin/customers**', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('credentialTest')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, customers, total: customers.length, limit: 25, offset: 0 }),
    });
  });
  await page.route('**/api/admin/bookings?view=context**', async (route) => {
    const customerId = new URL(route.request().url()).searchParams.get('customerId') ?? '';
    if (customerId === 'cust_b') await delay(220);
    const data = contexts[customerId];
    if (!data) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'customer_not_found' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...data }) });
  });
  await page.route('**/api/admin/quick-estimates**', (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, estimates: [] }) });
    }
    quotes.push(request.postDataJSON());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        quote: {
          status: 'priced', totalCents: 18000, range: null, laborHours: 3, durationMinutes: 180,
          cleaningSubtotalCents: 18000, extrasSubtotalCents: 0, travelAdjustmentCents: 0,
          discountAmountCents: 0, discountLabel: null, ongoingPerVisitCents: null, ongoingFrequency: null,
          pricingVersion: 'test', serviceCode: 'standard', message: null, entitlement: null,
        },
      }),
    });
  });
  const field = (name) => page.locator(`[data-quick-form] [name="${name}"]`);
  const selectedOption = (name) => field(name).locator('option:checked');
  const customerContext = (id) => contexts[id];
  try {
    await page.goto(BASE + '/admin/', { waitUntil: 'load' });
    await page.locator('[data-admin-nav="quick-estimate"]').click();
    await field('customerId').locator('option[value="cust_a"]').waitFor({ state: 'attached' });

    await field('customerId').selectOption('cust_a');
    await page.waitForFunction(() => document.querySelector('[data-quick-form] [name="customerEmail"]')?.value === 'alice@example.test');
    assert.equal(await field('customerName').inputValue(), 'Alice Alpha');
    assert.equal(await field('customerPhone').inputValue(), '850-111-1111');
    assert.equal(await field('addressLine1').inputValue(), '1 Alpha Way');
    assert.equal(await field('squareFeet').inputValue(), '1200');
    assert.equal(await field('bedrooms').inputValue(), '2');
    assert.equal(await field('pets').inputValue(), 'one');
    assert.equal(await field('propertyId').inputValue(), 'prop_a1');
    assert.equal(await selectedOption('propertyId').textContent().then((text) => text.includes('alpha') || text.includes('Alpha')), true);

    await field('customerId').selectOption('cust_b');
    await page.waitForFunction(() => document.querySelector('[data-quick-form] [name="customerEmail"]')?.value === 'bob@example.test');
    assert.equal(await field('customerName').inputValue(), 'Bob Beta');
    assert.equal(await field('customerPhone').inputValue(), '850-222-2222');
    assert.equal(await field('addressLine1').inputValue(), '10 Beta Blvd');
    assert.equal(await field('city').inputValue(), 'Milton');
    assert.equal(await field('squareFeet').inputValue(), '2400');
    assert.equal(await field('propertyId').inputValue(), 'prop_b1');

    await field('customerId').selectOption('cust_a');
    await page.waitForFunction(() => document.querySelector('[data-quick-form] [name="customerEmail"]')?.value === 'alice@example.test');
    await field('customerId').selectOption('cust_b');
    await field('customerId').selectOption('cust_c');
    await page.waitForFunction(() => document.querySelector('[data-quick-customer-note]')?.textContent?.includes('no saved active property'));
    await delay(400);
    assert.equal(await field('customerName').inputValue(), 'Cara Gamma');
    assert.equal(await field('customerEmail').inputValue(), '');
    assert.equal(await field('customerPhone').inputValue(), '850-333-3333');
    assert.equal(await field('addressLine1').inputValue(), '');
    assert.equal(await field('propertyId').inputValue(), '');
    assert.match(await page.textContent('[data-quick-customer-note]') ?? '', /no saved active property/i);

    await field('customerId').selectOption('cust_a');
    await page.waitForFunction(() => document.querySelector('[data-quick-form] [name="customerEmail"]')?.value === 'alice@example.test');
    await delay(300);
    assert.equal(await field('customerName').inputValue(), 'Alice Alpha');
    assert.equal(await field('addressLine1').inputValue(), '1 Alpha Way');
    assert.equal(await field('propertyId').inputValue(), 'prop_a1');
    assert.ok(!(await field('customerName').inputValue()).includes('Bob'));
    assert.ok(!(await field('addressLine1').inputValue()).includes('Beta'));

    await page.locator('[data-quick-action="calculate"]').click();
    await page.waitForFunction(() => document.querySelector('[data-quick-result]')?.textContent?.includes('$180.00'));
    const payload = quotes.at(-1);
    assert.equal(payload.customerId, 'cust_a');
    assert.equal(payload.propertyId, 'prop_a1');
    assert.equal(payload.customerName, 'Alice Alpha');
    assert.equal(payload.customerEmail, 'alice@example.test');
    assert.equal(payload.addressLine1, '1 Alpha Way');
    assert.equal(payload.squareFeet, '1200');
    assert.equal(payload.bedrooms, '2');
    assert.equal(payload.pets, 'one');
    assert.equal(nativeDialogs.length, 0);
    assert.equal(customerContext('cust_a').properties[0].line1, '1 Alpha Way');
  } finally {
    await context.close();
  }
});
