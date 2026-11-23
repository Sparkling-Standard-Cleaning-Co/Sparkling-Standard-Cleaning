// Google Reviews admin surface: branch/status filters, queue form and no
// horizontal overflow on a phone-sized viewport.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4595;
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

test('Google Reviews is usable at phone width and shows the owner controls', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const page = await context.newPage();
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
  await page.route('**/api/admin/reviews*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        requests: [
          {
            id: 'rev_1',
            branch_id: 'branch_pensacola',
            customer_id: 'cust_1',
            status: 'queued',
            recipient: 'customer@example.test',
            scheduled_at: '2026-11-24T18:00:00.000Z',
            suppressed_reason: '',
            error_detail: '',
          },
        ],
      }),
    }),
  );
  await page.goto(BASE + '/admin/', { waitUntil: 'networkidle' });
  await page.locator('[data-admin-nav="reviews"]').click();
  await page.locator('[data-admin-view="reviews"]').waitFor({ state: 'visible' });
  await page.getByText('Google review requests').waitFor();
  await page.getByText('customer@example.test').waitFor();
  await page.getByRole('button', { name: 'Queue review request' }).waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `horizontal overflow: ${overflow}px`);
  await context.close();
});
