// Regression: the final estimate must never advertise Pay Now while hiding the
// button. A preliminary travel quote must offer address verification, then
// expose secure checkout once the server-verifiable route exists.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4503;
const BASE = `http://localhost:${PORT}`;
const BOOKING_DATE = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

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

async function open(width, height, { geocode = 'exact', travel = 'verified' } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('pcc-consent-v1', JSON.stringify({ analytics: false, ads: false, v: 1 }));
    localStorage.setItem('pcc-promo-state', JSON.stringify({ state: 'dismissed', at: new Date().toISOString() }));
    sessionStorage.setItem('pcc-promo-shown-session', '1');
  });
  await page.route('**/api/estimate-checkout', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, enabled: true, mode: 'live' }),
      });
      return;
    }
    await route.fulfill({ status: 502, contentType: 'application/json', body: '{"ok":false,"error":"stripe_unavailable"}' });
  });
  await page.route('**/api/geocode', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.action === 'suggest') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"suggestions":[]}' });
      return;
    }
    const result =
      geocode === 'approximate'
        ? {
            label: 'Molino area (ZIP 32577)',
            lat: 30.72,
            lng: -87.31,
            zip: '32577',
            city: 'Molino',
            state: 'FL',
            source: 'census',
            precise: false,
            approximate: true,
          }
        : {
            label: '100 S Baylen St, Pensacola, FL 32502',
            lat: 30.4111,
            lng: -87.2164,
            zip: '32502',
            city: 'Pensacola',
            state: 'FL',
            source: 'mapmap',
            precise: true,
          };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, result }),
    });
  });
  await page.route('**/api/travel', (route) =>
    travel === 'unavailable'
      ? route.fulfill({ status: 502, contentType: 'application/json', body: '{"ok":false}' })
      : route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            oneWayMiles: 15,
            durationMinutes: 30,
            gasPrice: 3.1,
            gasPriceSource: 'configured_reference',
            provider: 'mapmap',
            method: 'route',
            verified: true,
            zone: 'core',
          }),
        }),
  );
  await page.route('**tiles.openfreemap.org/**', (route) => route.abort());
  await page.goto(BASE + '/estimate/residential/', { waitUntil: 'load' });
  await page.addStyleTag({ content: '.mobile-action-bar,.consent-banner,.promo-popup{display:none!important}' });
  return { context, page };
}

async function confirmMapIfShown(page) {
  const map = page.locator('[data-address-map]');
  if (!(await map.isVisible())) {
    const resolve = page.locator('[data-address-resolve]');
    if (await resolve.isVisible().catch(() => false)) await resolve.click();
    await map.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  }
  if (await map.isVisible()) {
    await page.locator('[data-address-confirm]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-address-finder]')?.getAttribute('data-state') === 'confirmed',
    );
  }
}
async function reachFinal(page) {
  await page.fill('#est-date', BOOKING_DATE);
  await page.waitForSelector('[data-calendar-period]', { state: 'visible' });
  await page.click('[data-period="first"]');
  await page.locator('[data-address-card]').waitFor({ state: 'visible' });
  await page.fill('#est-address', '100 S Baylen St');
  await page.fill('#est-address-city', 'Pensacola');
  await page.fill('#est-zip', '32502');
  await confirmMapIfShown(page);
  await page.click('[data-next]');
  await page.waitForFunction(
    () => document.querySelector('.wizard__step[data-step="2"]')?.getAttribute('data-active') === 'true',
  );
  await page.click('label.option:has(input[name="serviceType"][value="standard"])');
  await page.selectOption('#est-property', 'house');
  await page.fill('#est-sqft', '1600');
  await page.fill('#est-bedrooms', '3');
  await page.fill('#est-full-baths', '2');
  await page.fill('#est-half-baths', '0');
  await page.click('[data-next]');
  await page.selectOption('#est-frequency', 'one_time');
  await page.locator('[data-dirt-guide] summary').click(); await page.locator('[data-dirt-level="2"]').click();
  await page.selectOption('#est-last-clean', 'within_month');
  await page.selectOption('#est-pets', 'none');
  await page.click('[data-next]'); // your details
  await page.fill('#est-name', 'Pay Now test (please ignore)');
  await page.fill('#est-phone', '8500000000');
  await page.fill('#est-email', 'owner@sparkling-standard.com');
  await page.click('[data-next]'); // extras & payment
  await page.waitForSelector('[data-reservation-summary]', { state: 'visible' });
}
for (const [label, width, height] of [
  ['desktop', 1440, 1000],
  ['mobile', 390, 844],
]) {
  test(`an exact address reaches the final step with Pay Now available (${label})`, async () => {
    const { context, page } = await open(width, height);
    try {
      await reachFinal(page);
      assert.equal(await page.locator('[data-pay-now]').isVisible(), true, 'Pay Now is visible for the verified exact address');
      assert.equal(await page.locator('[data-gift-code]').isVisible(), true, 'gift code is available with online payment');
      assert.equal(await page.locator('[data-verify-address]').count(), 0, 'no separate address verification control');
      const note = (await page.locator('[data-payment-note]').innerText()).replace(/\s+/g, ' ');
      assert.match(note, /Pay now to reserve this cleaning/i);
      assert.match(
        (await page.locator('[data-submit]').innerText()).replace(/\s+/g, ' '),
        /Reserve This Cleaning/,
      );
    } finally {
      await context.close();
    }
  });
}
test('an approximate address is reservation-only and never becomes payable', async () => {
  const { context, page } = await open(1440, 1000, { geocode: 'approximate' });
  try {
    await reachFinal(page);
    assert.equal(await page.locator('[data-pay-now]').isVisible(), false, 'approximate addresses cannot pay online');
    assert.equal(await page.locator('[data-gift-code]').isVisible(), false, 'gift code is hidden when payment is unavailable');
    assert.equal(await page.locator('[data-verify-address]').count(), 0, 'no verification loop exists');
    const note = (await page.locator('[data-payment-note]').innerText()).replace(/\s+/g, ' ');
    assert.match(note, /couldn't verify this address|secure payment link|confirm/i);
    assert.match(
      (await page.locator('[data-submit]').innerText()).replace(/\s+/g, ' '),
      /Reserve This Cleaning/,
    );
  } finally {
    await context.close();
  }
});

test('an exact address with unavailable travel stays reservation-only', async () => {
  const { context, page } = await open(1440, 1000, { travel: 'unavailable' });
  try {
    await reachFinal(page);
    assert.equal(await page.locator('[data-pay-now]').isVisible(), false, 'unverified travel cannot pay online');
    assert.equal(await page.locator('[data-gift-code]').isVisible(), false, 'gift code is hidden when payment is unavailable');
    assert.equal(await page.locator('[data-verify-address]').count(), 0, 'no verification control');
    const note = (await page.locator('[data-payment-note]').innerText()).replace(/\s+/g, ' ');
    assert.match(note, /Your cleaning request is ready|couldn't verify|confirm/i);
    assert.match(
      (await page.locator('[data-submit]').innerText()).replace(/\s+/g, ' '),
      /Reserve This Cleaning/,
    );
  } finally {
    await context.close();
  }
});