// Admin operations redesign: actionable alerts, seven-day calendar, bulk
// reservation actions, and active/archived/deleted customer views.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4593;
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

test('alerts, calendar, bulk requests and customer views are actionable', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const customerQueries = [];
  let bulkBody = null;
  page.on('dialog', (dialog) => dialog.accept());

  await page.route('**/api/admin/auth*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        configured: true,
        setupRequired: false,
        authenticated: true,
        actor: { id: 'admin_owner', name: 'Owner', role: 'owner', branchId: null, permissions: ['*'], mfaEnabled: true },
        csrf: 'csrf-test',
      }),
    }),
  );
  await page.route('**/api/admin/overview*', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        counts: { requests: 14, unsignedAgreements: 2, outstandingInvoices: 1, failedWorkerRuns: 11, failedCheckouts: 11 },
        alerts: [
          {
            key: 'checkout.sessions',
            kind: 'checkout_failure',
            severity: 'medium',
            status: 'new',
            title: 'Checkout sessions needing review',
            message: '11 checkout sessions failed or are stale.',
            explanation: 'This mixes abandoned checkouts with real setup or provider failures.',
            rootCause: '8 abandoned checkout; 3 checkout setup failure',
            recommendation: 'Investigate failed setup/provider sessions; leave ordinary abandoned sessions as history.',
            count: 11,
            firstSeen: '2026-11-20T15:56:32.000Z',
            lastSeen: '2026-11-22T23:22:08.000Z',
            view: 'calendar',
            filter: 'checkout',
            records: [{ label: 'SS-20261122-93QFAS', detail: 'Abandoned checkout · Nov 22, 2026' }],
          },
          {
            key: 'recurring.worker_failures',
            kind: 'recurring_worker',
            severity: 'high',
            status: 'new',
            title: 'Recurring worker failures',
            message: '11 recurring worker runs failed.',
            explanation: 'Daily recurring synchronization runs.',
            rootCause: '3 run(s): Google Calendar authentication failed.',
            recommendation: 'Reauthorize Google Calendar and retry safe syncs.',
            count: 11,
            firstSeen: '2026-11-10T09:00:07.000Z',
            lastSeen: '2026-11-20T09:00:07.000Z',
            view: 'recurring',
            records: [],
          },
        ],
        alertHistory: [],
        recentLeads: [],
      }),
    });
  });
  await page.route('**/api/admin/requests?**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        requests: [
          {
            id: 'req_pending',
            quote_reference: 'SS-20261123-TEST',
            start_at: '2026-11-25T14:00:00.000Z',
            created_at: '2026-11-23T06:21:19.000Z',
            status: 'pending',
            payment_status: 'unpaid',
            first_name: 'Test',
            last_name: 'Customer',
            line1: '100 Example Street',
            city: 'Pensacola',
            payload_json: JSON.stringify({ service_type: 'standard' }),
            is_test: 0,
          },
        ],
        appointments: [
          {
            id: 'appt_confirmed',
            booking_request_id: 'req_confirmed',
            status: 'confirmed',
            start_at: '2026-11-24T14:30:00.000Z',
            end_at: '2026-11-24T18:30:00.000Z',
            reference: 'SS-20261124-CONF',
            customer_id: 'cust_1',
            first_name: 'Christina',
            last_name: 'Sherwin',
            line1: '100 Example Street',
            city: 'Pensacola',
            assigned_names: 'Hayli',
            branch_id: 'branch_pensacola',
            request_payload: JSON.stringify({ service_type: 'recurring-residential' }),
          },
          {
            id: 'appt_cancelled',
            booking_request_id: 'req_cancelled',
            status: 'cancelled',
            start_at: '2026-11-24T15:00:00.000Z',
            end_at: '2026-11-24T17:00:00.000Z',
            reference: 'RECURRING-rec_123',
            customer_id: 'cust_2',
            first_name: 'Canceled',
            last_name: 'Customer',
            line1: '200 Example Street',
            city: 'Pensacola',
            assigned_names: 'Hayli',
            branch_id: 'branch_pensacola',
            request_payload: JSON.stringify({ service_type: 'standard' }),
          },
        ],
      }),
    }),
  );
  await page.route('**/api/admin/requests', async (route) => {
    const posted = route.request().postDataJSON();
    if (posted?.action === 'bulk_preview') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          operation: posted.operation,
          total: 1,
          eligible: 1,
          ineligible: 0,
          results: [{ id: 'req_pending', ok: true }],
        }),
      });
      return;
    }
    bulkBody = posted;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, succeeded: 1, failed: 0, results: [{ id: 'req_pending', ok: true }] }),
    });
  });
  await page.route('**/api/admin/customers?**', (route) => {
    const url = new URL(route.request().url());
    const status = url.searchParams.get('status');
    customerQueries.push(status);
    const deleted = status === 'deleted';
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        customers: deleted
          ? []
          : [
              {
                id: 'cust_1',
                first_name: 'Christina',
                last_name: 'Sherwin',
                company_name: '',
                status: 'active',
                email: 'customer@example.test',
                phone: '8505550123',
                property_count: 1,
                branch_name: 'Pensacola',
              },
            ],
        total: deleted ? 0 : 1,
        limit: 25,
        offset: 0,
      }),
    });
  });

  try {
    await page.goto(BASE + '/admin/', { waitUntil: 'load' });
    const alerts = page.locator('[data-admin-alerts]');
    await alerts.getByText('Checkout sessions needing review').waitFor({ state: 'visible' });
    assert.match(await alerts.textContent(), /Abandoned checkout/);
    assert.match(await alerts.textContent(), /Investigate failed setup/);
    await alerts.locator('details').first().locator('summary').click();
    assert.ok(await alerts.getByRole('button', { name: 'Resolve' }).first().isVisible());

    await page.locator('[data-admin-nav="calendar"]').click();
    await page.locator('.admin-week-grid').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.admin-week-day').count(), 7);
    await page.getByText('Christina Sherwin').first().waitFor({ state: 'visible' });
    assert.equal(await page.getByText('Canceled Customer').count(), 0, 'canceled appointments are hidden by default');
    await page.locator('[data-admin-week-status]').selectOption('cancelled');
    await page.getByText('Canceled Customer').first().waitFor({ state: 'visible' });
    assert.doesNotMatch(await page.locator('.admin-appointment-card').first().textContent(), /rec_123/);

    await page.locator('[data-admin-request-select]').check();
    await page.locator('[data-admin-request-bulk]').waitFor({ state: 'visible' });
    assert.match(await page.locator('[data-admin-request-bulk-count]').textContent(), /1 selected/);
    await page.locator('[data-admin-request-bulk] [data-operation="archive"]').click();
    const bulkDialog = page.locator('[data-admin-dialog][open]');
    await bulkDialog.waitFor({ state: 'visible' });
    assert.match(await page.locator('[data-admin-dialog-body]').textContent(), /1 eligible/);
    await page.locator('[data-admin-dialog-confirm]').click();
    await page.waitForFunction(() => document.querySelector('[data-admin-success]')?.textContent?.includes('1 request'));
    assert.equal(bulkBody.action, 'bulk');
    assert.equal(bulkBody.operation, 'archive');
    assert.deepEqual(bulkBody.requestIds, ['req_pending']);
    assert.equal(bulkBody.confirm, true);

    await page.locator('[data-admin-nav="customers"]').click();
    await page.locator('[data-admin-customers]').getByText('Christina Sherwin').waitFor({ state: 'visible' });
    assert.ok(customerQueries.includes('active'));
    await page.locator('[data-admin-customer-search] select[name="status"]').selectOption('deleted');
    await page.locator('[data-admin-customer-search] button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('[data-admin-customers]')?.textContent?.includes('No deleted or anonymized'));
    assert.ok(customerQueries.includes('deleted'));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-admin-menu-toggle]').click();
    await page.locator('[data-admin-nav="calendar"]').click();
    await page.locator('.admin-week-mobile-days').waitFor({ state: 'visible' });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(overflow <= 1, `admin calendar has no page-level horizontal overflow at 390px (got ${overflow})`);
    await page.locator('[data-admin-menu-toggle]').click();
    await page.locator('[data-admin-nav="overview"]').click();
    await page.locator('[data-admin-alerts]').waitFor({ state: 'visible' });
    const overviewOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(overviewOverflow <= 1, `admin overview has no page-level horizontal overflow at 390px (got ${overviewOverflow})`);
  } finally {
    await context.close();
  }
});
