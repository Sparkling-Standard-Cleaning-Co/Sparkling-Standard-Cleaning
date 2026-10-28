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
  await page.click('[data-address-manual-summary]');
  return { context, page };
}

async function reachFinalWithUnconfirmedAddress(page) {
  await page.click('label.option:has(input[name="serviceType"][value="standard"])');
  await page.fill('#est-address', '100 S Baylen St');
  await page.fill('#est-address-city', 'Pensacola');
  await page.selectOption('#est-address-state', 'FL');
  await page.fill('#est-zip', '32502');
  await page.click('[data-next]');
  await page.selectOption('#est-property', 'house');
  await page.fill('#est-sqft', '1600');
  await page.fill('#est-bedrooms', '3');
  await page.fill('#est-full-baths', '2');
  await page.fill('#est-half-baths', '0');
  await page.click('[data-next]');
  await page.selectOption('#est-frequency', 'one_time');
  await page.click('label.option:has(input[name="condition"][value="maintained"])');
  await page.selectOption('#est-last-clean', 'within_month');
  await page.selectOption('#est-pets', 'none');
  await page.click('[data-next]');
  await page.click('[data-next]');
  await page.fill('#est-date', BOOKING_DATE);
  await page.selectOption('#est-arrival', 'morning');
  await page.click('[data-next]');
  await page.waitForSelector('[data-reservation-summary]', { state: 'visible' });
}

for (const [label, width, height] of [
  ['desktop', 1440, 1000],
  ['mobile', 390, 844],
]) {
  test(`preliminary address hides Pay Now, offers verification, then reveals it (${label})`, async () => {
    const { context, page } = await open(width, height);
    try {
      await reachFinalWithUnconfirmedAddress(page);
      assert.equal(await page.locator('[data-pay-now]').isVisible(), false, 'no hidden promise: Pay Now is hidden');
      assert.equal(await page.locator('[data-verify-address]').isVisible(), true, 'verification path is visible');
      const note = (await page.locator('[data-payment-note]').innerText()).replace(/\s+/g, ' ');
      assert.match(note, /Verify your service address/i);
      assert.doesNotMatch(note, /Pay securely now/i);
      assert.match(
        (await page.locator('[data-submit]').innerText()).replace(/\s+/g, ' '),
        /Reserve This Cleaning/,
      );

      await page.click('[data-verify-address]');
      assert.equal(
        await page.evaluate(() => document.querySelector('.wizard__step[data-step="1"]')?.getAttribute('data-active')),
        'true',
        'verification returns to the address step',
      );
      await page.waitForSelector('[data-address-confirm]', { state: 'visible' });
      await page.click('[data-address-confirm]');
      await page.waitForFunction(
        () => document.querySelector('.wizard__step[data-step="6"]')?.getAttribute('data-active') === 'true',
        null,
        { timeout: 15_000 },
      );
      await page.waitForFunction(() => document.querySelector('[data-estimate-reveal]')?.hidden === true);
      assert.equal(await page.locator('[data-pay-now]').isVisible(), true, 'Pay Now becomes visible');
      assert.equal(await page.locator('[data-verify-address]').isVisible(), false);
      const readyNote = (await page.locator('[data-payment-note]').innerText()).replace(/\s+/g, ' ');
      assert.match(readyNote, /Your estimate is ready/i);
      assert.match(readyNote, /Pay securely now/i);
      assert.match(
        (await page.locator('[data-submit]').innerText()).replace(/\s+/g, ' '),
        /Reserve This Cleaning \(Pay Later\)/,
      );
    } finally {
      await context.close();
    }
  });
}

test('an approximate map match returns to the final step for manual review instead of looping', async () => {
  const { context, page } = await open(1440, 1000, { geocode: 'approximate' });
  try {
    await reachFinalWithUnconfirmedAddress(page);
    await page.click('[data-verify-address]');
    await page.waitForSelector('[data-address-confirm]', { state: 'visible' });
    await page.click('[data-address-confirm]');
    await page.waitForFunction(
      () => document.querySelector('.wizard__step[data-step="6"]')?.getAttribute('data-active') === 'true',
      null,
      { timeout: 15_000 },
    );
    await page.waitForFunction(() => document.querySelector('[data-estimate-reveal]')?.hidden === true);
    assert.equal(await page.locator('[data-pay-now]').isVisible(), false, 'approximate addresses cannot pay online');
    assert.equal(
      await page.locator('[data-verify-address]').isVisible(),
      false,
      'a failed exact match must not offer the same verification loop again',
    );
    const note = (await page.locator('[data-payment-note]').innerText()).replace(/\s+/g, ' ');
    assert.match(note, /couldn't verify this address|secure payment link/i);
    assert.doesNotMatch(note, /Verify your service address/i);
    assert.match(
      (await page.locator('[data-submit]').innerText()).replace(/\s+/g, ' '),
      /Reserve This Cleaning/,
    );
  } finally {
    await context.close();
  }
});

test('an exact address with unavailable travel routes to manual review instead of a verify loop', async () => {
  const { context, page } = await open(1440, 1000, { travel: 'unavailable' });
  try {
    await reachFinalWithUnconfirmedAddress(page);
    await page.click('[data-verify-address]');
    await page.waitForSelector('[data-address-confirm]', { state: 'visible' });
    await page.click('[data-address-confirm]');
    await page.waitForFunction(
      () => document.querySelector('.wizard__step[data-step="6"]')?.getAttribute('data-active') === 'true',
      null,
      { timeout: 15_000 },
    );
    await page.waitForFunction(() => document.querySelector('[data-estimate-reveal]')?.hidden === true);
    assert.equal(await page.locator('[data-pay-now]').isVisible(), false, 'unverified travel cannot pay online');
    assert.equal(
      await page.locator('[data-verify-address]').isVisible(),
      false,
      'an exact address must not be re-verified just because travel failed',
    );
    const note = (await page.locator('[data-payment-note]').innerText()).replace(/\s+/g, ' ');
    assert.match(note, /Your cleaning request is ready/i);
    assert.doesNotMatch(note, /Verify your service address/i);
    assert.match(
      (await page.locator('[data-submit]').innerText()).replace(/\s+/g, ' '),
      /Reserve This Cleaning/,
    );
  } finally {
    await context.close();
  }
});
