// Admin customer property profiles: real built page, mocked API.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4422;
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
      const response = await fetch(BASE + '/', { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        browser = await chromium.launch();
        return;
      }
    } catch {
      // not ready yet
    }
    await delay(500);
  }
  throw new Error('preview server did not become ready on ' + BASE);
});

after(async () => {
  await browser?.close();
  server?.kill();
});

function property(overrides = {}) {
  return {
    id: 'prop_home',
    customer_id: 'cust_1',
    label: 'Home',
    line1: '100 S Baylen St',
    line2: '',
    city: 'Pensacola',
    state: 'FL',
    postal_code: '32502',
    property_type: 'house',
    square_feet: 1800,
    bedrooms: 3,
    full_baths: 2,
    half_baths: 1,
    stories: 1,
    beds: null,
    pets: 'none',
    access_notes: 'Side gate code 1102.',
    parking_notes: 'Driveway only.',
    internal_notes: 'Friendly dog in the back yard.',
    is_primary: 1,
    status: 'active',
    ...overrides,
  };
}

function customerDetail(properties) {
  return {
    ok: true,
    customer: {
      id: 'cust_1',
      first_name: 'Synthetic',
      last_name: 'Customer',
      company_name: '',
      status: 'active',
      source: 'admin',
      branch_name: 'Pensacola',
      primary_branch_id: 'branch_pensacola',
    },
    contacts: [{ kind: 'email', value: 'customer@example.test' }],
    properties,
    notes: [],
    leads: [],
    estimates: [],
    appointments: [],
    recurringPlans: [],
    invoices: [],
    paymentAuthorizations: [],
  };
}

test('the owner can view, edit and add complete property profiles', async () => {
  const properties = [property()];
  const posted = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  try {
    await page.route('**/api/admin/**', (route) => route.fulfill({ json: { ok: true } }));
    await page.route('**/api/admin/auth', (route) =>
      route.fulfill({
        json: {
          ok: true,
          configured: true,
          setupRequired: false,
          authenticated: true,
          actor: {
            id: 'admin_test_owner',
            email: 'owner@example.test',
            name: 'Hayli',
            role: 'owner',
            branchId: 'branch_pensacola',
            permissions: ['customer.read', 'customer.write', 'settings.write'],
            mfaEnabled: false,
          },
          csrf: 'test-csrf',
        },
      }),
    );
    await page.route('**/api/admin/overview', (route) =>
      route.fulfill({
        json: {
          ok: true,
          counts: { customers: 1, leads: 0, requests: 0, upcomingAppointments: 0, activeGifts: 0, failedLeadDeliveries: 0 },
          today: new Date().toISOString().slice(0, 10),
          recentLeads: [],
        },
      }),
    );
    await page.route('**/api/admin/documents?**', (route) => route.fulfill({ json: { ok: true, requests: [] } }));
    await page.route('**/api/admin/customers*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'GET') {
        const id = url.searchParams.get('id');
        if (id) return route.fulfill({ json: customerDetail(properties) });
        return route.fulfill({
          json: {
            ok: true,
            customers: [
              {
                id: 'cust_1',
                first_name: 'Synthetic',
                last_name: 'Customer',
                company_name: '',
                email: 'customer@example.test',
                phone: '8505550111',
                property_count: properties.length,
                branch_name: 'Pensacola',
              },
            ],
          },
        });
      }
      const body = request.postDataJSON();
      posted.push(body);
      if (body.action === 'update_property') {
        const index = properties.findIndex((item) => item.id === body.propertyId);
        if (index >= 0) properties[index] = { ...properties[index], ...body, square_feet: Number(body.squareFeet) };
        return route.fulfill({ json: { ok: true } });
      }
      if (body.action === 'add_property') {
        properties.push(
          property({
            id: 'prop_new',
            label: body.label,
            line1: body.line1,
            property_type: body.propertyType,
            square_feet: Number(body.squareFeet),
            pets: body.pets,
            is_primary: 0,
          }),
        );
        return route.fulfill({ json: { ok: true, id: 'prop_new' } });
      }
      return route.fulfill({ json: { ok: true, id: 'cust_1' } });
    });

    await page.goto(BASE + '/admin/', { waitUntil: 'load' });
    await page.locator('[data-admin-app]').waitFor({ state: 'visible' });
    await page.locator('[data-admin-nav="customers"]').click();
    await page.locator('[data-admin-action="customer-open"]').first().click();
    await page.locator('text=Home').first().waitFor({ state: 'visible' });

    const detailText = await page.locator('[data-admin-customer-detail]').innerText();
    assert.match(detailText, /1,800 sq ft|1800 sq ft/);
    assert.match(detailText, /3 bedrooms/);
    assert.match(detailText, /2 full baths/);
    assert.match(detailText, /No pets/);
    assert.match(detailText, /Access: Side gate code 1102/);
    assert.match(detailText, /Parking: Driveway only/);
    assert.match(detailText, /Friendly dog/);

    await page.locator('details.admin-detail-toggle').filter({ hasText: 'Edit property' }).first().locator('summary').click();
    const editForm = page.locator('form[data-form="property-update"]').first();
    await editForm.locator('input[name="squareFeet"]').fill('1950');
    await editForm.locator('select[name="pets"]').selectOption('one');
    const updateResponse = page.waitForResponse(
      (response) => response.url().includes('/api/admin/customers') && response.request().method() === 'POST',
    );
    await editForm.locator('button[type="submit"]').click();
    await updateResponse;
    const update = posted.find((body) => body.action === 'update_property');
    assert.ok(update);
    assert.equal(update.propertyId, 'prop_home');
    assert.equal(update.squareFeet, '1950');
    assert.equal(update.pets, 'one');

    await page.locator('details.admin-detail-toggle').filter({ hasText: 'Add a property' }).first().locator('summary').click();
    const addForm = page.locator('form[data-form="property-add"]').first();
    await addForm.locator('input[name="label"]').fill('Rental condo');
    await addForm.locator('input[name="line1"]').fill('200 S Palafox St');
    await addForm.locator('input[name="city"]').fill('Pensacola');
    await addForm.locator('select[name="propertyType"]').selectOption('condo');
    await addForm.locator('input[name="squareFeet"]').fill('1100');
    await addForm.locator('select[name="pets"]').selectOption('none');
    const addResponse = page.waitForResponse(
      (response) => response.url().includes('/api/admin/customers') && response.request().method() === 'POST',
    );
    await addForm.locator('button[type="submit"]').click();
    await addResponse;
    const added = posted.find((body) => body.action === 'add_property');
    assert.ok(added);
    assert.equal(added.label, 'Rental condo');
    assert.equal(added.propertyType, 'condo');
    assert.equal(added.squareFeet, '1100');
    assert.equal(added.pets, 'none');
  } finally {
    await context.close();
  }
});

test('the property editor remains usable at phone width without horizontal overflow', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const page = await context.newPage();
  try {
    await page.route('**/api/admin/**', (route) => route.fulfill({ json: { ok: true } }));
    await page.route('**/api/admin/auth', (route) =>
      route.fulfill({
        json: {
          ok: true,
          configured: true,
          setupRequired: false,
          authenticated: true,
          actor: {
            id: 'admin_test_owner',
            email: 'owner@example.test',
            name: 'Hayli',
            role: 'owner',
            branchId: 'branch_pensacola',
            permissions: ['customer.read', 'customer.write'],
            mfaEnabled: false,
          },
          csrf: 'test-csrf',
        },
      }),
    );
    await page.route('**/api/admin/overview', (route) =>
      route.fulfill({
        json: { ok: true, counts: {}, today: new Date().toISOString().slice(0, 10), recentLeads: [] },
      }),
    );
    await page.route('**/api/admin/documents?**', (route) => route.fulfill({ json: { ok: true, requests: [] } }));
    await page.route('**/api/admin/customers*', (route) => {
      const url = new URL(route.request().url());
      return route.fulfill({
        json: url.searchParams.get('id')
          ? customerDetail([property()])
          : { ok: true, customers: [{ id: 'cust_1', first_name: 'Synthetic', last_name: 'Customer', property_count: 1 }] },
      });
    });

    await page.goto(BASE + '/admin/', { waitUntil: 'load' });
    await page.locator('[data-admin-app]').waitFor({ state: 'visible' });
    await page.locator('[data-admin-nav="customers"]').click();
    await page.locator('[data-admin-action="customer-open"]').first().click();
    await page.locator('form[data-form="property-add"]').waitFor({ state: 'attached' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `horizontal overflow ${overflow}px`);
  } finally {
    await context.close();
  }
});
