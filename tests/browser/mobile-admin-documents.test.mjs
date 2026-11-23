// Mobile QA for the admin document center: readable tabs, no page overflow,
// searchable recipient flow, request log, packet readiness and library tables.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4561;
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

async function openAdmin(width, height = 844) {
  const context = await browser.newContext({ viewport: { width, height } });
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
        actor: {
          id: 'admin_owner',
          name: 'Owner',
          role: 'owner',
          branchId: null,
          permissions: ['*'],
          mfaEnabled: false,
        },
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
    if (view === 'templates') {
      body.templates = [
        {
          id: 'doc_1',
          title: 'Residential Deep Cleaning Agreement',
          category: 'residential',
          version: '2026-11-22',
          status: 'approved',
          legal_review_status: 'owner_approved',
          signer_party: 'customer',
        },
      ];
    } else if (view === 'bundles') {
      body.bundles = [
        {
          id: 'bundle_1',
          code: 'customer.deep',
          name: 'Residential Deep Cleaning Packet',
          purpose: 'customer',
          packet_type: 'deep',
          document_count: 3,
          approved_document_count: 3,
          required_document_count: 2,
          status: 'active',
          is_system: 0,
        },
      ];
    } else if (view === 'requests') {
      body.requests = [
        {
          id: 'signreq_1',
          bundle_code: 'customer.deep',
          packet_name: 'Residential Deep Cleaning Packet',
          status: 'pending',
          signed_count: 0,
          awaiting_verification: 0,
          first_name: 'Jordan',
          last_name: 'Customer',
          signer_email: 'jordan@example.test',
          booking_reference: 'SS-20261201-QA',
          created_at: '2026-11-22T12:00:00.000Z',
          subject_type: 'customer',
        },
      ];
    } else if (view === 'reminder-settings') {
      body.settings = { enabled: false, firstHours: 24, secondHours: 72 };
    } else if (view === 'updates') {
      body.updates = [];
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(BASE + '/admin/', { waitUntil: 'load' });
  await page.locator('[data-admin-nav="documents"]').click();
  await page.waitForSelector('[data-admin-view="documents"]:not([hidden])');
  return { context, page };
}

async function overflow(page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

for (const width of [320, 390, 430]) {
  test(`admin document center is usable at ${width}px`, async () => {
    const { context, page } = await openAdmin(width);
    try {
      assert.ok((await overflow(page)) <= 1, `overview has no page overflow at ${width}px`);

      await page.locator('[data-document-tab="send"]').first().click();
      await page.getByPlaceholder(/Start typing a customer name/i).waitFor({ state: 'visible' });
      assert.equal(await page.locator('[data-document-send] input[name="customerId"]').isVisible(), false);
      assert.ok((await overflow(page)) <= 1, `send view has no page overflow at ${width}px`);

      await page.locator('[data-document-tab="requests"]').first().click();
      await page.locator('[data-document-request-search]').waitFor({ state: 'visible' });
      assert.match(await page.textContent('[data-admin-documents-requests]') ?? '', /Residential Deep Cleaning Packet/);
      assert.match(await page.textContent('[data-admin-documents-requests]') ?? '', /Jordan Customer/);
      assert.ok((await overflow(page)) <= 1, `requests view has no page overflow at ${width}px`);

      await page.locator('[data-document-tab="library"]').first().click();
      assert.match(await page.textContent('[data-admin-documents-templates]') ?? '', /Residential Deep Cleaning Agreement/);
      assert.ok((await overflow(page)) <= 1, `library view has no page overflow at ${width}px`);

      await page.locator('[data-document-tab="packets"]').first().click();
      assert.match(await page.textContent('[data-admin-documents-bundles]') ?? '', /3 approved/);
      assert.ok((await overflow(page)) <= 1, `packets view has no page overflow at ${width}px`);

      await page.locator('[data-document-tab="settings"]').first().click();
      await page.locator('[data-document-reminders]').waitFor({ state: 'visible' });
      assert.ok((await overflow(page)) <= 1, `settings view has no page overflow at ${width}px`);
    } finally {
      await context.close();
    }
  });
}
