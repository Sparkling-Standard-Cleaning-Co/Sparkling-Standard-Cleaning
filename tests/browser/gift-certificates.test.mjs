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

test('the gift page sells a certificate through secure checkout', async () => {
  const { context, page } = await open();
  try {
    let checkoutBody = null;
    await page.route('**/api/gift-checkout', async (route) => {
      checkoutBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          url: BASE + '/gift-certificates/success/?session_id=cs_test_gift',
        }),
      });
    });
    await page.route('**/api/lead', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false}' });
    });

    await page.goto(BASE + '/gift-certificates/', { waitUntil: 'load' });
    assert.match((await page.locator('h1').textContent()) ?? '', /beautifully kept home/i);
    assert.match((await page.textContent('body')) ?? '', /value toward Sparkling Standard cleaning services/i);
    assert.match((await page.textContent('body')) ?? '', /SSGC-SAMP-LE42/, 'sample certificate code shown');
    assert.equal(await page.locator('[data-gift-purchase]').count(), 1, 'purchase mode is live');
    assert.equal(await page.locator('#gift-denomination').inputValue(), '50');

    await page.selectOption('#gift-denomination', '100');
    await page.fill('#gift-purchaser-name', 'Synthetic Purchaser');
    await page.fill('#gift-purchaser-email', 'purchaser@example.com');
    await page.fill('#gift-recipient-name', 'Synthetic Recipient');
    await page.fill('#gift-recipient-email', 'recipient@example.com');
    await page.selectOption('#gift-delivery-method', 'recipient_email');
    await page.fill('#gift-message', 'Enjoy a beautifully kept home!');
    await page.check('#gift-terms');
    await page.click('button[type="submit"]');
    await page.waitForURL(/gift-certificates\/success/);

    assert.ok(checkoutBody, 'the checkout endpoint received the purchase');
    assert.equal(checkoutBody.purchaserName, 'Synthetic Purchaser');
    assert.equal(checkoutBody.purchaserEmail, 'purchaser@example.com');
    assert.equal(checkoutBody.recipientName, 'Synthetic Recipient');
    assert.equal(checkoutBody.recipientEmail, 'recipient@example.com');
    assert.equal(checkoutBody.denominationUsd, 100);
    assert.equal(checkoutBody.amountUsd, undefined);
    assert.equal(checkoutBody.message, 'Enjoy a beautifully kept home!');
    assert.equal(checkoutBody.termsAccepted, true);
  } finally {
    await context.close();
  }
});

test('a custom gift amount and valid-from date are sent to checkout', async () => {
  const { context, page } = await open(390, 844);
  try {
    let checkoutBody = null;
    await page.route('**/api/gift-checkout', async (route) => {
      checkoutBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          url: BASE + '/gift-certificates/success/?session_id=cs_test_custom',
        }),
      });
    });
    await page.goto(BASE + '/gift-certificates/', { waitUntil: 'load' });
    await page.selectOption('#gift-denomination', 'custom');
    await page.locator('#gift-custom-value').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#gift-custom-value').isVisible(), true);
    await page.fill('#gift-custom-value', '75');
    await page.fill('#gift-valid-from', '2027-01-15');
    await page.fill('#gift-purchaser-name', 'Synthetic Purchaser');
    await page.fill('#gift-purchaser-email', 'purchaser@example.com');
    await page.fill('#gift-recipient-name', 'Synthetic Recipient');
    await page.check('#gift-terms');
    await page.click('button[type="submit"]');
    await page.waitForURL(/gift-certificates\/success/);
    assert.ok(checkoutBody);
    assert.equal(checkoutBody.denominationUsd, undefined);
    assert.equal(checkoutBody.amountUsd, 75);
    assert.equal(checkoutBody.validFromDate, '2027-01-15');
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
    await page.locator('[data-gift-auth-login]').waitFor({ state: 'visible' });
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
