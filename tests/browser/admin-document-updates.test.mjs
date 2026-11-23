// Admin Document Updates: owner review of a revision and prefill of the
// existing composer from the re-signing queue. APIs are mocked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4557;
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
      // not ready yet
    }
    await delay(500);
  }
  throw new Error('preview server did not become ready');
});

after(async () => {
  await browser?.close();
  server?.kill();
});

test('the owner can review a revision and prefill the existing composer', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  let acknowledged = null;
  const updates = [
    {
      templateId: 'doc_revision_1',
      title: 'Residential Deep Cleaning Agreement',
      newVersion: '1.1',
      previousVersion: '1.0',
      status: 'owner_review_required',
      review: { acknowledgedAt: null, acknowledgedByAdminUserId: null, materialChange: null, note: '' },
      affectedPackets: [
        { id: 'bundle_customer_deep', code: 'customer.deep', name: 'Residential Deep / One-Time Packet', status: 'active', required: true, perBooking: true },
      ],
      affectedCustomers: [
        {
          customerId: 'cust_1',
          name: 'Test Customer',
          lastSignedAt: '2026-11-20T10:00:00.000Z',
          newVersionSignedAt: null,
          needsResigning: true,
          nextAppointmentAt: '2027-01-04T14:00:00.000Z',
        },
      ],
      counts: { packets: 1, customers: 1, needingResigning: 1, upcomingAppointments: 1 },
    },
  ];

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
      body: JSON.stringify({ ok: true, counts: {}, recentLeads: [] }),
    });
  });
  await page.route('**/api/admin/documents?**', async (route) => {
    const url = new URL(route.request().url());
    const view = url.searchParams.get('view');
    let body = { ok: true };
    if (view === 'templates') body.templates = [];
    else if (view === 'bundles') {
      body.bundles = [
        { id: 'bundle_customer_deep', code: 'customer.deep', name: 'Residential Deep / One-Time Packet', purpose: 'customer', packet_type: 'deep', document_count: 9, status: 'active' },
      ];
    } else if (view === 'requests') body.requests = [];
    else if (view === 'reminder-settings') body.settings = { enabled: false, firstHours: 24, secondHours: 72 };
    else if (view === 'updates') body.updates = updates;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/api/admin/documents', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }
    acknowledged = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, updates }) });
  });

  try {
    await page.goto(BASE + '/admin/', { waitUntil: 'load' });
    await page.locator('[data-admin-nav="documents"]').click();
    await page.locator('[data-document-tab="updates"]').first().click();
    const updatesCard = page.locator('[data-admin-document-updates]');
    await updatesCard.getByText('Residential Deep Cleaning Agreement').waitFor({ state: 'visible' });
    assert.match((await updatesCard.textContent()) ?? '', /Owner review required/);
    assert.match((await updatesCard.textContent()) ?? '', /1 still need the new version/);

    await updatesCard.getByText(/Re-signing queue/).click();
    await updatesCard.getByRole('button', { name: /Use in composer/i }).click();
    assert.equal(await page.locator('[data-document-send] input[name="customerId"]').inputValue(), 'cust_1');
    assert.equal(await page.locator('[data-document-send] select[name="bundleId"]').inputValue(), 'bundle_customer_deep');

    await updatesCard.getByRole('button', { name: /Acknowledge material change/i }).click();
    await page.waitForFunction(() => document.querySelector('[data-document-template-result]')?.textContent?.includes('material change'));
    assert.deepEqual(acknowledged, {
      action: 'acknowledge_update',
      templateId: 'doc_revision_1',
      materialChange: true,
    });
  } finally {
    await context.close();
  }
});
