// Admin Quick Estimate and document packet UI. APIs are mocked; no real
// customer, booking, document or payment record is created.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4437;
const BASE = `http://localhost:${PORT}`;

let server;
let browser;

const quote = {
  status: 'priced',
  totalCents: 18500,
  range: null,
  laborHours: 3.5,
  durationMinutes: 210,
  cleaningSubtotalCents: 18500,
  extrasSubtotalCents: 0,
  travelAdjustmentCents: 0,
  discountAmountCents: 1500,
  discountLabel: 'FRIENDS15',
  ongoingPerVisitCents: null,
  ongoingFrequency: null,
  pricingVersion: '2026.11.19-test',
  serviceCode: 'standard',
  message: null,
  entitlement: { code: 'FRIENDS15', percent: 15, discountCents: 1500, label: 'FRIENDS15' },
  travel: { oneWayMiles: 12.5, verified: true },
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

async function openAdmin() {
  const context = await browser.newContext({ viewport: { width: 1360, height: 1100 } });
  const page = await context.newPage();
  const actions = [];
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
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, counts: {}, recentLeads: [], alerts: [] }),
    });
  });
  await page.route('**/api/admin/promotions*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        promotions: [{ id: 'promo_1', code: 'THANKS75', name: 'Thanksgiving Special', status: 'active', displayStatus: 'active', editable: true }],
      }),
    });
  });
  await page.route('**/api/admin/customers**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        customers: [{ id: 'cust_1', first_name: 'Synthetic', last_name: 'Customer', email: 'quick@example.test', status: 'active' }],
      }),
    });
  });
  await page.route('**/api/admin/bookings?view=context**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        properties: [{ id: 'prop_1', label: 'Home', line1: '1 Test Way', city: 'Pensacola', state: 'FL', postal_code: '32502' }],
      }),
    });
  });
  await page.route('**/api/admin/quick-estimates**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          estimates: [{
            id: 'qe_1',
            status: 'saved',
            engine: 'residential',
            total_cents: 18500,
            customer_name: 'Synthetic Customer',
            customer_email: 'quick@example.test',
            address_text: '1 Test Way, Pensacola, FL 32502',
            updated_at: '2026-11-19T12:00:00.000Z',
          }],
        }),
      });
      return;
    }
    const body = JSON.parse(request.postData() ?? '{}');
    actions.push(body);
    if (body.action === 'calculate') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, quote }) });
      return;
    }
    if (body.action === 'save') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, id: 'qe_1', status: 'saved', quote }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.route('**/api/admin/documents**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const view = url.searchParams.get('view');
    if (request.method() === 'GET' && view === 'templates') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          templates: [{
            id: 'doc_1',
            title: 'Residential One-Time Agreement',
            category: 'residential',
            version: '2026-11-19.v1',
            status: 'draft',
            legal_review_status: 'owner_review_required',
            family_key: 'residential-one-time',
          }],
        }),
      });
      return;
    }
    if (request.method() === 'GET' && view === 'template') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          template: {
            id: 'doc_1',
            title: 'Residential One-Time Agreement',
            category: 'residential',
            version: '2026-11-19.v1',
            status: 'draft',
            signer_party: 'customer',
            family_key: 'residential-one-time',
            legal_review_status: 'owner_review_required',
            content_text: 'Customer {{customer.first_name}} at {{property.address}}.',
            requires_verification: 0,
            requires_countersignature: 0,
          },
        }),
      });
      return;
    }
    if (request.method() === 'GET' && view === 'bundles') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          bundles: [{
            id: 'bundle_1',
            code: 'packet.residential_one_time',
            name: 'Residential One-Time Packet',
            subject_type: 'customer',
            purpose: 'customer',
            packet_type: 'residential_one_time',
            document_count: 1,
            status: 'active',
          }],
        }),
      });
      return;
    }
    if (request.method() === 'GET' && view === 'requests') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, requests: [] }) });
      return;
    }
    if (request.method() === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}');
      actions.push(body);
      if (body.action === 'preview_packet') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            preview: {
              bundleName: 'Residential One-Time Packet',
              bundleCode: 'packet.residential_one_time',
              bundleVersion: 1,
              totalDocuments: 1,
              requiredDocuments: 1,
              instructions: 'Review every document.',
              missingVariables: ['customer.first_name'],
              requirements: [{ title: 'Residential One-Time Agreement', version: '1.0', stage: 'before_confirmation', required: 1, contentText: 'Customer {{customer.first_name}}.', missingVariables: ['customer.first_name'] }],
            },
          }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.goto(BASE + '/admin/', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-admin-app]:not([hidden])');
  return { page, actions };
}

test('Quick Estimate calculates, saves and lists a server-priced estimate', async () => {
  const { page, actions } = await openAdmin();
  await page.click('[data-admin-nav="quick-estimate"]');
  await page.waitForSelector('[data-admin-view="quick-estimate"]:not([hidden])');
  await page.fill('[data-quick-form] input[name="postalCode"]', '32502');
  await page.fill('[data-quick-form] input[name="squareFeet"]', '1800');
  await page.fill('[data-quick-form] input[name="bedrooms"]', '3');
  await page.fill('[data-quick-form] input[name="fullBaths"]', '2');
  await page.click('[data-quick-action="calculate"]');
  await page.waitForSelector('[data-quick-result] h3');
  const quoteText = await page.textContent('[data-quick-result]');
  assert.match(quoteText ?? '', /\$185\.00/);
  assert.match(quoteText ?? '', /Pricing version 2026\.11\.19-test/);
  assert.match(quoteText ?? '', /FRIENDS15/);
  await page.click('[data-quick-action="save"]');
  await page.waitForSelector('[data-quick-result] .admin-status-message');
  const listText = await page.textContent('[data-quick-list]');
  assert.match(listText ?? '', /Synthetic Customer/);
  assert.match(listText ?? '', /\$185\.00/);
  assert.ok(actions.some((entry) => entry.action === 'calculate'));
  assert.ok(actions.some((entry) => entry.action === 'save' && entry.postalCode === '32502'));
  await page.context().close();
});

test('the document packet builder opens a draft, previews unresolved variables and lists packet actions', async () => {
  const { page, actions } = await openAdmin();
  await page.click('[data-admin-nav="documents"]');
  await page.waitForSelector('[data-admin-view="documents"]:not([hidden])');
  await page.locator('[data-document-tab="library"]').first().click();
  await page.waitForSelector('[data-admin-documents-templates] button[data-admin-action="document-edit"]');
  assert.match((await page.textContent('[data-admin-documents-templates]')) ?? '', /Residential One-Time Agreement/);
  await page.locator('[data-document-tab="packets"]').first().click();
  assert.match((await page.textContent('[data-admin-documents-bundles]')) ?? '', /Residential One-Time Packet/);
  await page.locator('[data-document-tab="library"]').first().click();
  await page.click('[data-admin-documents-templates] button[data-admin-action="document-edit"]');
  await page.waitForSelector('[data-document-editor]:not([hidden])');
  assert.match(await page.locator('[data-document-editor-canvas]').innerHTML(), /customer\.first_name/);
  assert.match(await page.textContent('[data-document-editor-version-display]') ?? '', /Version 1\.0/);
  assert.doesNotMatch(await page.textContent('[data-document-editor-version-display]') ?? '', /2026-11-19/);

  await page.locator('[data-document-tab="send"]').first().click();
  await page.evaluate(() => {
    const input = document.querySelector('[data-document-send] input[name="customerId"]');
    if (input) input.value = 'cust_1';
  });
  await page.selectOption('[data-document-send] select[name="bundleId"]', 'bundle_1');
  await page.fill('[data-document-send] textarea[name="serviceScope"]', 'Approved deep-cleaning scope.');
  await page.fill('[data-document-send] input[name="priceSummary"]', '$260.00');
  await page.selectOption('[data-document-send] select[name="frequency"]', 'weekly');
  await page.click('[data-document-preview]');
  await page.waitForSelector('[data-document-preview-result] .admin-card');
  const previewText = await page.textContent('[data-document-preview-result]');
  assert.match(previewText ?? '', /Residential One-Time Packet/);
  assert.match(previewText ?? '', /Unresolved variables block sending/);
  assert.match(previewText ?? '', /live preview/);
  const frameText = await page.frameLocator('[data-document-preview-frame]').locator('body').innerText();
  assert.match(frameText, /Residential One-Time Agreement/);
  assert.match(frameText, /Unresolved variables/);
  assert.match(frameText, /customer\.first_name/);
  assert.ok(await page.isVisible('[data-document-save-draft]'));
  assert.ok(await page.isVisible('[data-document-preview-zoom]'));
  const previewAction = actions.find((entry) => entry.action === 'preview_packet');
  assert.equal(previewAction.variables['service.scope'], 'Approved deep-cleaning scope.');
  assert.equal(previewAction.variables['price.summary'], '$260.00');
  await page.context().close();
});
