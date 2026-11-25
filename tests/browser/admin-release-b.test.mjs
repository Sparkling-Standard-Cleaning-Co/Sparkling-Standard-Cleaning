import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4603;
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

test('Release B: photos are listed, protected and deletable; legal holds use real records', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const posts = [];
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
  await page.route('**/api/admin/overview*', (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, counts: {}, alerts: [], alertHistory: [], recentLeads: [] }),
    });
  });
  await page.route('**/api/admin/storage?**', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('view') === 'photos') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          configured: true,
          total: 2,
          protectedCount: 1,
          truncated: false,
          photos: [
            {
              key: 'leads/2026/11/quote-test-1/bathroom-0123456789abcdef0123456789abcdef.jpg',
              ref: 'quote-test-1',
              category: 'bathroom',
              uploadedAt: '2026-10-01T12:00:00.000Z',
              bytes: 1048576,
              customer: 'Elise Customer',
              property: 'Home',
              protected: false,
            },
            {
              key: 'leads/2026/11/quote-test-2/kitchen-0123456789abcdef0123456789abcdef.jpg',
              ref: 'quote-test-2',
              category: 'kitchen',
              uploadedAt: '2026-10-02T12:00:00.000Z',
              bytes: 1048576,
              customer: 'ProTec Customer',
              property: 'Office',
              protected: true,
            },
          ],
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        branch: 'all',
        database: { bytes: 3620864, counts: { customers: 11, appointments: 13, invoices: 1, documents: 27 } },
        backup: { recentRuns: [], openIncidents: [{ incident_key: 'backup_stale', status: 'open', summary: 'Backup failure or missed backup', opened_at: '2026-11-21T21:23:47.505Z' }] },
        retention: {
          policies: [],
          holds: [{ id: 'hold_1', subject_type: 'customer', subject_id: 'customer_1', reason: 'Legal review', status: 'active', created_at: '2026-11-22T12:00:00.000Z' }],
        },
        settings: [],
        holdOptions: [
          { type: 'customer', id: 'customer_1', label: 'Elise Customer' },
          { type: 'property', id: 'property_1', label: 'Elise Customer â€” Home' },
          { type: 'booking', id: 'appointment_1', label: 'Elise Customer â€” SS-20261124-ABC123' },
        ],
      }),
    });
  });
  await page.route('**/api/admin/storage', (route) => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON());
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, deleted: 1, eligible: 1, protectedEligible: 1, dryRun: false }) });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        branch: 'all',
        database: { bytes: 3620864, counts: { customers: 11, appointments: 13, invoices: 1, documents: 27 } },
        backup: { recentRuns: [], openIncidents: [{ incident_key: 'backup_stale', status: 'open', summary: 'Backup failure or missed backup', opened_at: '2026-11-21T21:23:47.505Z' }] },
        retention: {
          policies: [],
          holds: [{ id: 'hold_1', subject_type: 'customer', subject_id: 'customer_1', reason: 'Legal review', status: 'active', created_at: '2026-11-22T12:00:00.000Z' }],
        },
        settings: [],
        holdOptions: [
          { type: 'customer', id: 'customer_1', label: 'Elise Customer' },
          { type: 'property', id: 'property_1', label: 'Elise Customer - Home' },
          { type: 'booking', id: 'appointment_1', label: 'Elise Customer - SS-20261124-ABC123' },
        ],
      }),
    });
  });
  try {
    await page.goto(BASE + '/admin/', { waitUntil: 'load' });
    await page.locator('[data-admin-nav="storage"]').click();
    await page.locator('[data-admin-photo-list]').getByText('Elise Customer').waitFor({ state: 'visible' });
    await page.locator('[data-admin-photo-list]').getByText('Protected by legal hold').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-admin-action="photo-delete"]').count(), 1, 'only the unprotected photo can be deleted');

    await page.locator('[data-admin-action="photo-delete"]').click();
    await page.locator('[data-admin-dialog][open]').waitFor({ state: 'visible' });
    const deletionResponse = page.waitForResponse((response) => response.url().endsWith('/api/admin/storage') && response.request().method() === 'POST', { timeout: 60000 });
    await page.locator('[data-admin-dialog-confirm]').click();
    await deletionResponse;
    assert.ok(posts.some((post) => post.action === 'photo_delete' && post.key.includes('quote-test-1')));

    const holdSelect = page.locator('[data-admin-hold-options]');
    assert.ok(await holdSelect.locator('option').count() >= 4, 'customer, property and booking choices are available');
    await holdSelect.selectOption('customer|customer_1');
    await page.locator('[data-legal-hold] textarea[name="reason"]').fill('Legal review requested by owner');
    const holdResponse = page.waitForResponse((response) => response.url().endsWith('/api/admin/storage') && response.request().method() === 'POST', { timeout: 60000 });
    await page.locator('[data-legal-hold] button[type="submit"]').click();
    await holdResponse;
    await page.waitForFunction(() => document.querySelector('[data-admin-retention-status]')?.textContent?.includes('Legal hold'), undefined, { timeout: 60000 });
    assert.ok(posts.some((post) => post.action === 'create_legal_hold' && post.subjectType === 'customer' && post.subjectId === 'customer_1'));

    await page.locator('[data-admin-action="storage-cleanup-run"]').click();
    await page.locator('[data-admin-dialog][open]').waitFor({ state: 'visible' });
    const cleanupResponse = page.waitForResponse((response) => response.url().endsWith('/api/admin/storage') && response.request().method() === 'POST', { timeout: 60000 });
    await page.locator('[data-admin-dialog-confirm]').click();
    await cleanupResponse;
    await page.waitForTimeout(250);
    assert.ok(posts.some((post) => post.action === 'photo_cleanup' && post.dryRun === false));
    assert.equal(nativeDialogs.length, 0, 'no native browser prompts are used');
    await page.setViewportSize({ width: 390, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `storage workspace has no horizontal overflow at phone width (${overflow}px)`);
    await page.locator('[data-admin-photo-list]').waitFor({ state: 'visible' });
  } finally {
    await context.close();
  }
});
