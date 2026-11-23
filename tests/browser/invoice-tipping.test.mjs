import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4596;
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

function invoiceView(overrides = {}) {
  return {
    invoiceId: 'inv_tip_page',
    invoiceNumber: 'INV-2026-0100',
    customerName: 'Francesca Customer',
    serviceBalanceCents: 27500,
    serviceTotalCents: 27500,
    amountPaidCents: 0,
    tipOnly: false,
    status: 'open',
    lines: [{ description: 'Move-Out Cleaning', quantity: 1, total_cents: 27500 }],
    suggestionsCents: [1000, 1500, 2500],
    defaultTipCents: 0,
    minimumTipCents: 0,
    maximumTipCents: 100000,
    ...overrides,
  };
}

async function openPage(view) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.route('**/api/invoice-pay?**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, mode: view.tipOnly ? 'tip' : 'invoice', invoice: view }),
    }),
  );
  await page.goto(`${BASE}/invoice-pay/?token=synthetic-token`, { waitUntil: 'load' });
  await page.locator('[data-pay-content]').waitFor({ state: 'visible' });
  return { context, page };
}

test('the customer payment page defaults to no tip and shows the exact service total', async () => {
  const { context, page } = await openPage(invoiceView());
  try {
    assert.match((await page.textContent('[data-pay-service]')) ?? '', /\$275\.00/);
    assert.match((await page.textContent('[data-pay-tip-line]')) ?? '', /\$0\.00/);
    assert.match((await page.textContent('[data-pay-total]')) ?? '', /\$275\.00/);
    assert.equal(await page.locator('input[name="tip"][value="0"]').isChecked(), true, 'No tip is the initial selection');
    assert.equal(await page.locator('input[name="tip"][value="2500"]').isChecked(), false);
    assert.match((await page.textContent('[data-pay-submit]')) ?? '', /\$275\.00/);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(overflow <= 1, `mobile payment page has no horizontal overflow (got ${overflow})`);
  } finally {
    await context.close();
  }
});

test('suggested, custom and zero tips update the final total and submit only the chosen cents', async () => {
  const { context, page } = await openPage(invoiceView());
  try {
    let posted = null;
    await page.route('**/api/invoice-pay', async (route) => {
      posted = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, url: '/invoice-payment/?status=success', totalCents: 30000 }),
      });
    });
    await page.locator('input[name="tip"][value="1500"]').check();
    assert.match((await page.textContent('[data-pay-tip-line]')) ?? '', /\$15\.00/);
    assert.match((await page.textContent('[data-pay-total]')) ?? '', /\$290\.00/);
    await page.locator('input[name="tip"][value="custom"]').check();
    await page.locator('[data-pay-custom-input]').fill('12.34');
    assert.match((await page.textContent('[data-pay-tip-line]')) ?? '', /\$12\.34/);
    assert.match((await page.textContent('[data-pay-total]')) ?? '', /\$287\.34/);
    await page.locator('input[name="tip"][value="0"]').check();
    assert.match((await page.textContent('[data-pay-total]')) ?? '', /\$275\.00/);
    await page.locator('input[name="tip"][value="2500"]').check();
    assert.match((await page.textContent('[data-pay-total]')) ?? '', /\$300\.00/);
    await page.locator('[data-pay-submit]').click();
    await page.waitForURL('**/invoice-payment/**');
    assert.equal(posted.tipCents, 2500);
  } finally {
    await context.close();
  }
});

test('a fully prepaid service offers a tip-only page with no service charge', async () => {
  const { context, page } = await openPage(
    invoiceView({ serviceBalanceCents: 0, amountPaidCents: 27500, tipOnly: true, status: 'paid' }),
  );
  try {
    assert.match((await page.textContent('[data-pay-service]')) ?? '', /Already paid/);
    assert.match((await page.textContent('[data-pay-total]')) ?? '', /\$0\.00/);
    assert.equal(await page.locator('[data-pay-submit]').isHidden(), true, 'zero-tip tip-only page needs no payment');
    assert.equal(await page.locator('[data-pay-close]').isVisible(), true, 'customer can close without tipping');
    await page.locator('input[name="tip"][value="2500"]').check();
    assert.match((await page.textContent('[data-pay-total]')) ?? '', /\$25\.00/);
    assert.equal(await page.locator('[data-pay-submit]').isVisible(), true);
    assert.match((await page.textContent('[data-pay-submit]')) ?? '', /\$25\.00/);
  } finally {
    await context.close();
  }
});
