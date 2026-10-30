// Admin operations UI: the timekeeping board and gift-certificate detail view.
// APIs are mocked; no real account, employee or gift record is touched.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4432;
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
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
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
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, counts: { customers: 0, leads: 0, requests: 0, upcomingAppointments: 0, activeGifts: 0, failedLeadDeliveries: 0 }, recentLeads: [] }),
    });
  });
  await page.route('**/api/admin/timekeeping*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        weekStart: '2026-10-26',
        weekEnd: '2026-11-01',
        employees: [
          {
            id: 'tm_1',
            display_name: 'Test Cleaner',
            status: 'active',
            admin_user_id: 'admin_cleaner',
            default_rate_type: 'regular',
            pay_rate_regular_cents: 1800,
            intervals: [
              { id: 'tint_1', employee_name: 'Test Cleaner', kind: 'work', rate_type: 'regular', paid: 1, started_at: '2026-10-30T13:00:00.000Z', ended_at: '2026-10-30T21:00:00.000Z', status: 'closed' },
            ],
            totals: { workMinutes: 480, breakMinutes: 0, mealMinutes: 0, paidMinutes: 480, grossCents: 14400, overtimeMinutes: 0, workLabel: '8h 00m', breakLabel: '0h 00m', mealLabel: '0h 00m', overtimeLabel: '0h 00m', grossLabel: '$144.00' },
            openInterval: null,
            missingClockOut: false,
          },
        ],
        events: [],
        corrections: [],
      }),
    });
  });
  await page.route('**/api/admin/gifts*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        configured: true,
        summary: { issuedCount: 1, activeCount: 1, partialCount: 1, futureCount: 0, outstandingCents: 6000, redeemedCents: 9000, refundedCount: 0, voidedCount: 0 },
        records: [
          {
            code: 'SSGC-AAAA-BBBB',
            status: 'active',
            activationState: 'active',
            active: true,
            valueCents: 15000,
            redeemedCents: 9000,
            remainingCents: 6000,
            purchaserName: 'Test Buyer',
            purchaserEmail: 'buyer@example.test',
            recipientName: 'Test Recipient',
            recipientEmail: 'recipient@example.test',
            message: 'Enjoy!',
            validFromDate: '2026-10-30',
            issuedAt: '2026-10-30T12:00:00.000Z',
            stripeSessionId: 'cs_test_123',
            history: [{ at: '2026-10-30T18:00:00.000Z', amountCents: 9000, reference: 'invoice:test', note: 'Applied to invoice' }],
            adjustments: [],
          },
        ],
      }),
    });
  });
  const requestPosts = [];
  await page.route('**/api/admin/requests*', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET' && url.searchParams.get('id')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          request: {
            id: 'BR-LEGACY-1',
            customer_id: null,
            property_id: null,
            status: 'pending',
            quote_reference: 'SS-LEGACY-ONE',
            start_at: '2026-10-30T13:45:00.000Z',
            end_at: '2026-10-30T21:03:00.000Z',
            duration_minutes: 438,
            payload_json: JSON.stringify({ locationText: '6360 Haupert Ln, Molino, FL 32577' }),
          },
          payload: { locationText: '6360 Haupert Ln, Molino, FL 32577' },
          contacts: [],
          properties: [],
          notifications: [],
          audit: [],
          possibleDuplicates: [{ id: 'BR-LEGACY-2', quote_reference: 'SS-LEGACY-TWO', start_at: '2026-10-30T14:00:00.000Z' }],
          email: '',
        }),
      });
      return;
    }
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          requests: [{
            id: 'BR-LEGACY-1', customer_id: null, status: 'pending', quote_reference: 'SS-LEGACY-ONE',
            start_at: '2026-10-30T13:45:00.000Z', end_at: '2026-10-30T21:03:00.000Z',
            payload_json: JSON.stringify({ locationText: '6360 Haupert Ln, Molino, FL 32577' }),
          }],
          appointments: [],
          reservationLeads: [],
        }),
      });
      return;
    }
    requestPosts.push(JSON.parse(route.request().postData() ?? '{}'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.route('**/api/admin/customers*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, customers: [], properties: [] }) });
  });
  await page.goto(BASE + '/admin/', { waitUntil: 'load' });
  await page.locator('[data-admin-app]').waitFor({ state: 'visible' });
  return { context, page, requestPosts };
}

test('the owner can open the timekeeping board and see hours and corrections', async () => {
  const { context, page } = await openAdmin();
  try {
    await page.locator('[data-admin-nav="timekeeping"]').click();
    await page.locator('[data-admin-view="timekeeping"]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-admin-view-title]').innerText(), 'Timekeeping');
    const text = await page.locator('[data-admin-view="timekeeping"]').innerText();
    assert.match(text, /Test Cleaner/);
    assert.match(text, /8h 00m/);
    assert.match(text, /\$144\.00/);
    assert.equal(await page.locator('[data-time-week]').inputValue(), '2026-10-26');
  } finally {
    await context.close();
  }
});

test('gift certificates expose purchaser, recipient, balance and redemption history', async () => {
  const { context, page } = await openAdmin();
  try {
    await page.locator('[data-admin-nav="gift"]').click();
    await page.locator('[data-admin-view="gift"]').waitFor({ state: 'visible' });
    await page.locator('[data-gift-action="details"]').click();
    const detail = page.locator('[data-admin-gift-detail]');
    await detail.waitFor({ state: 'visible' });
    const text = await detail.innerText();
    assert.match(text, /SSGC-AAAA-BBBB/);
    assert.match(text, /Test Buyer/);
    assert.match(text, /Test Recipient/);
    assert.match(text, /\$60\.00/);
    assert.match(text, /Applied to invoice/);
    assert.match(text, /cs_test_123/);
  } finally {
    await context.close();
  }
});


test('a legacy request can be opened, reviewed and confirmed from the admin', async () => {
  const { context, page, requestPosts } = await openAdmin();
  try {
    await page.locator('[data-admin-nav="calendar"]').click();
    await page.locator('[data-admin-action="request-open"]').click();
    const detail = page.locator('[data-admin-request-detail]');
    await detail.waitFor({ state: 'visible' });
    const text = await detail.innerText();
    assert.match(text, /SS-LEGACY-ONE/);
    assert.match(text, /6360 Haupert Ln/);
    assert.match(text, /Possible duplicate requests/);
    assert.match(text, /Link this request to a customer/);
    assert.match(text, /Accept \/ Confirm Booking/);
    assert.match(text, /No identity is guessed from the address/i);
    await detail.getByRole('button', { name: 'Accept / Confirm Booking' }).click();
    await page.waitForTimeout(400);
    assert.equal(requestPosts.some((post) => post.action === 'confirm'), true);
    assert.equal(await page.locator('[data-admin-app-error]').innerText(), '');
  } finally {
    await context.close();
  }
});
