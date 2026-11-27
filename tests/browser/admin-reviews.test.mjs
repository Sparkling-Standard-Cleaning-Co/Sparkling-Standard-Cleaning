// Google Reviews admin surface: searchable completed cleanings, invitation
// status, preview and no horizontal overflow on a phone-sized viewport.
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
  await page.route('**/api/admin/overview*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, counts: {}, alerts: [], recentLeads: [] }) }),
  );
  await page.route('**/api/admin/reviews?**', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('view') === 'eligible') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          appointments: [{
            id: 'appt_review_1', start_at: '2026-11-23T18:00:00.000Z', status: 'completed',
            first_name: 'Google', last_name: 'Customer', line1: '100 Review Street', city: 'Pensacola',
            customer_email: 'customer@example.test',
            branch_id: 'branch_pensacola', branch_name: 'Pensacola', service_code: 'standard',
            input_snapshot_json: JSON.stringify({ service_label: 'Residential Cleaning' }),
            review_url: 'https://g.page/r/CXAcv1Pp7OI2ECE/review', review_requests_enabled: 0,
            latest_status: null, latest_sent_at: null,
          }],
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        requests: [{
          id: 'rev_1', branch_id: 'branch_pensacola', customer_id: 'cust_1', status: 'queued',
          recipient: 'customer@example.test', scheduled_at: '2026-11-24T18:00:00.000Z',
          suppressed_reason: '', error_detail: '', first_name: 'Review', last_name: 'Customer',
          branch_name: 'Pensacola', appointment_start: '2026-11-23T18:00:00.000Z',
        }],
      }),
    });
  });
  await page.goto(BASE + '/admin/', { waitUntil: 'networkidle' });
  await page.locator('[data-admin-menu-toggle]').click();
  await page.locator('[data-admin-nav="reviews"]').click();
  await page.locator('[data-admin-view="reviews"]').waitFor({ state: 'visible' });
  await page.getByText('Google review requests').waitFor();
  await page.locator('[data-admin-review-list]').getByText('Review Customer').waitFor();
  await page.locator('[data-review-eligible-list]').getByText('Google Customer').waitFor();
  assert.equal(await page.locator('input[name="appointmentId"]').count(), 0, 'no manual appointment ID entry');
  await page.getByRole('button', { name: 'Send Review Invitation' }).waitFor();
  assert.match(await page.locator('[data-review-eligible-list]').textContent() ?? '', /Automation is off/);
  await page.getByRole('button', { name: 'Preview' }).waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `horizontal overflow: ${overflow}px`);
  await context.close();
});
