// Browser tests — gift-certificate page (request mode while sales are
// disabled), redemption page and checkout-return page.
// Run with: npm run test:browser on :4415.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4415;
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

async function open(width = 1280, height = 900) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  return { context, page };
}

test('the gift page explains the offering and takes a request without charging', async () => {
  const { context, page } = await open();
  try {
    const requests = { lead: [], checkout: [] };
    await page.route('**/api/lead', async (route) => {
      requests.lead.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await page.route('**/api/gift-checkout', async (route) => {
      requests.checkout.push(route.request().postData());
      await route.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false}' });
    });

    await page.goto(BASE + '/gift-certificates/', { waitUntil: 'load' });
    assert.match((await page.locator('h1').textContent()) ?? '', /beautifully kept home/i);
    assert.match((await page.textContent('body')) ?? '', /value toward Sparkling Standard cleaning services/i);
    assert.match((await page.textContent('body')) ?? '', /SSGC-SAMP-LE42/, 'sample certificate code shown');
    assert.equal(await page.locator('[data-gift-purchase]').count(), 0, 'purchase mode is off until approved');
    assert.match((await page.textContent('body')) ?? '', /No payment is taken/i);

    await delay(2800); // clear the shared form's time-on-form guard
    await page.fill('#gift-purchaser-name', 'Synthetic Purchaser');
    await page.fill('#gift-purchaser-email', 'purchaser@example.com');
    await page.fill('#gift-recipient-name', 'Synthetic Recipient');
    await page.fill('#gift-recipient-email', 'recipient@example.com');
    await page.fill('#gift-value', '100');
    await page.fill('#gift-message', 'Enjoy a beautifully kept home!');
    await page.check('#gift-terms');
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-form-status][data-state="success"]', { timeout: 15000 });

    assert.equal(requests.checkout.length, 0, 'no checkout attempt while sales are disabled');
    assert.equal(requests.lead.length, 1, 'the request goes through the existing lead relay');
    const fields = requests.lead[0].fields;
    assert.equal(fields.name, 'Synthetic Purchaser');
    assert.equal(fields.email, 'purchaser@example.com');
    assert.equal(fields.recipient_name, 'Synthetic Recipient');
    assert.equal(fields.recipient_email, 'recipient@example.com');
    assert.equal(fields.gift_value, '100');
    assert.equal(fields.gift_message, 'Enjoy a beautifully kept home!');
    assert.equal(fields.extra_ref, undefined, 'the honeypot never travels');

    const success = (await page.locator('[data-form-status]').textContent()) ?? '';
    assert.match(success, /No payment has been taken/i);
  } finally {
    await context.close();
  }
});

test('a filled trap field blocks the gift request without sending', async () => {
  const { context, page } = await open(390, 844);
  try {
    const requests = [];
    await page.route('**/api/lead', async (route) => {
      requests.push(route.request().postData());
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await page.goto(BASE + '/gift-certificates/', { waitUntil: 'load' });
    await delay(2800);
    await page.fill('#gift-purchaser-name', 'Synthetic Purchaser');
    await page.fill('#gift-purchaser-email', 'purchaser@example.com');
    await page.fill('#gift-recipient-name', 'Synthetic Recipient');
    await page.fill('#gift-value', '100');
    await page.check('#gift-terms');
    await page.evaluate(() => {
      const trap = document.querySelector('input[name="extra_ref"]');
      if (trap) trap.value = 'bot';
    });
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-form-status][data-state="error"]', { timeout: 15000 });
    assert.equal(requests.length, 0, 'trapped requests are never sent');
    assert.match((await page.locator('[data-form-status]').textContent()) ?? '', /could not be verified/i);
  } finally {
    await context.close();
  }
});

test('the redeem page echoes a valid code, verifies its balance and refuses nonsense', async () => {
  const { context, page } = await open(390, 844);
  try {
    await page.route('**/api/gift-balance**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          code: 'SSGC-ABCD-2345',
          status: 'active',
          valueCents: 10000,
          redeemedCents: 2500,
          remainingCents: 7500,
        }),
      }),
    );
    const calls = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/')) calls.push(request.url());
    });
    await page.goto(BASE + '/gift-certificates/redeem/?ref=SSGC-ABCD-2345', { waitUntil: 'load' });
    assert.equal((await page.locator('[data-gift-ref]').textContent())?.trim(), 'SSGC-ABCD-2345');
    await page.waitForFunction(() => /Remaining balance: \$75\.00/.test(document.querySelector('[data-gift-balance]')?.textContent ?? ''));
    assert.match((await page.textContent('body')) ?? '', /never ask for payment-card details/i);
    assert.equal(calls.filter((url) => url.includes('/api/gift-balance')).length, 1);

    await page.goto(BASE + '/gift-certificates/redeem/?ref=%3Cscript%3E', { waitUntil: 'load' });
    assert.match((await page.locator('[data-gift-ref]').textContent()) ?? '', /No certificate code found/i);
    assert.equal(calls.filter((url) => url.includes('/api/gift-balance')).length, 1, 'malformed code makes no lookup');
  } finally {
    await context.close();
  }
});

test('the checkout-return page is noindex and never claims issuance', async () => {
  const { context, page } = await open();
  try {
    await page.goto(BASE + '/gift-certificates/success/?session_id=cs_test_123', { waitUntil: 'load' });
    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    assert.match(robots ?? '', /noindex/);
    assert.match((await page.textContent('body')) ?? '', /does not issue a certificate by itself/i);
  } finally {
    await context.close();
  }
});

test('the owner gift register requires a session password and exposes data only after login', async () => {
  const { context, page } = await open();
  try {
    let refundBody = null;
    let certificate = {
      code: 'SSGC-ABCD-2345',
      status: 'active',
      valueCents: 10000,
      redeemedCents: 0,
      remainingCents: 10000,
      recipientName: 'Synthetic Recipient',
      recipientEmail: 'recipient@example.com',
      purchaserName: 'Synthetic Purchaser',
      purchaserEmail: 'purchaser@example.com',
      issuedAt: '2026-10-28T12:00:00.000Z',
      history: [],
      adjustments: [],
    };
    await page.route('**/api/gift-auth**', async (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            session: {
              csrf: 'csrf-test-token',
              admin: { recoveryEmail: 'recovery@example.com', recoveryEmailVerified: true },
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, configured: true, authenticated: false, phoneRecovery: { available: false } }),
      });
    });
    await page.route('**/api/gift-admin**', async (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        refundBody = request.postDataJSON();
        certificate = {
          ...certificate,
          status: 'refunded',
          remainingCents: 0,
          adjustments: [
            {
              at: '2026-10-28T13:00:00.000Z',
              kind: 'refund',
              amountCents: 10000,
              note: 'Owner-approved refund',
              reference: 'REF-1',
              stripeRefundId: 're_test_1',
            },
          ],
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, refundId: 're_test_1', certificate }),
        });
        return;
      }
      if (request.url().includes('summary=1')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            summary: {
              issuedCount: 1,
              activeCount: 1,
              totalOriginalCents: 10000,
              totalRedeemedCents: 0,
              totalOutstandingCents: 10000,
              totalRefundedCents: 0,
              totalVoidedCents: 0,
              pendingDeliveries: 0,
              failedDeliveries: 0,
            },
          }),
        });
        return;
      }
      if (request.url().includes('list=1')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            page: 1,
            pageSize: 20,
            total: 1,
            totalPages: 1,
            items: [{ ...certificate, deliveryStatus: 'sent', deliveryDate: '', lastRedemptionAt: '' }],
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, certificate }),
      });
    });

    await page.goto(BASE + '/gift-admin/', { waitUntil: 'load' });
    assert.match((await page.locator('meta[name="robots"]').getAttribute('content')) ?? '', /noindex/);
    assert.equal(await page.locator('#gift-admin-token').count(), 0, 'the legacy token field is gone');
    assert.equal(await page.locator('[data-gift-auth-login]').isVisible(), true);
    assert.doesNotMatch((await page.textContent('body')) ?? '', /SSGC-ABCD-2345/);

    await page.fill('#gift-login-password', 'Synthetic-Admin-Password-1!');
    await page.click('[data-gift-login-form] button[type="submit"]');
    await page.waitForSelector('[data-gift-dashboard]:not([hidden])');
    await page.waitForSelector('[data-gift-rows] tr');
    assert.match((await page.textContent('body')) ?? '', /Synthetic Recipient/);

    await page.click('[data-gift-rows] button');
    await page.waitForSelector('[data-gift-detail]:not([hidden])');
    await page.waitForSelector('[data-gift-actions]:not([hidden])');
    await page.fill('#gift-action-password', 'Synthetic-Admin-Password-1!');
    await page.fill('#gift-action-note', 'Owner-approved refund');
    await page.fill('#gift-action-reference', 'REF-1');
    page.on('dialog', (dialog) => void dialog.accept());
    await page.click('[data-gift-refund]');
    await page.waitForFunction(() => /Refund completed in Stripe/.test(document.querySelector('[data-gift-action-status]')?.textContent ?? ''));
    assert.equal(refundBody?.action, 'refund');
    assert.equal(refundBody?.password, 'Synthetic-Admin-Password-1!');
    assert.equal(refundBody?.code, 'SSGC-ABCD-2345');
    assert.equal(refundBody?.note, 'Owner-approved refund');
    assert.equal(refundBody?.reference, 'REF-1');
    await page.waitForFunction(() => document.querySelector('[data-gift-actions]')?.hasAttribute('hidden'));
  } finally {
    await context.close();
  }
});
