// Focused tests — "Use My Current Location" GPS flow and the consent-gated
// Google Tag Manager installation. Run with: npm run test:browser on :4405.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4405;
const BASE = `http://localhost:${PORT}`;
const MOLINO = { latitude: 30.719, longitude: -87.442 };

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

async function mockReverse(page, result) {
  const reverseRequests = [];
  await page.route('**/api/geocode', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.action === 'reverse') {
      reverseRequests.push(body);
      if (result) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, result }) });
      } else {
        await route.fulfill({ status: 404, contentType: 'application/json', body: '{"ok":false,"error":"not_found"}' });
      }
      return;
    }
    if (body.action === 'suggest') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"suggestions":[]}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        result: {
          label: '100 S BAYLEN ST, PENSACOLA, FL, 32502',
          lat: 30.4111,
          lng: -87.2164,
          zip: '32502',
          city: 'PENSACOLA',
          state: 'FL',
          source: 'census',
          precise: true,
        },
      }),
    });
  });
  await page.route('**/api/travel', (route) =>
    route.fulfill({
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
  return reverseRequests;
}

async function openEstimate({ geolocation, permissions, width = 1280, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, geolocation, permissions });
  const page = await context.newPage();
  const reverseRequests = await mockReverse(page, geolocation ? {
    label: '6360 HAUPERT LN, MOLINO, FL, 32577',
    lat: MOLINO.latitude,
    lng: MOLINO.longitude,
    zip: '32577',
    city: 'MOLINO',
    state: 'FL',
    source: 'mapmap',
    precise: true,
  } : null);
  await page.goto(BASE + '/estimate/', { waitUntil: 'load' });
  await page.addStyleTag({ content: '.mobile-action-bar,.consent-banner{display:none!important}' });
  await page.click('label.option:has(input[name="serviceType"][value="standard"])');
  return { context, page, reverseRequests };
}

test('Use My Current Location fills a precise address only after explicit confirmation', async () => {
  const { context, page, reverseRequests } = await openEstimate({
    geolocation: { ...MOLINO, accuracy: 20 },
    permissions: ['geolocation'],
  });
  try {
    await page.click('[data-address-gps]');
    await page.waitForFunction(() => document.querySelector('#est-address')?.value.includes('HAUPERT'));
    assert.equal(reverseRequests.length, 1, 'reverse geocoding was requested once');
    assert.equal(reverseRequests[0].lat, MOLINO.latitude);
    assert.equal(reverseRequests[0].lng, MOLINO.longitude);
    assert.equal(await page.inputValue('#est-address-city'), 'MOLINO');
    assert.equal(await page.inputValue('#est-address-state'), 'FL');
    assert.equal(await page.inputValue('#est-zip'), '32577');
    const status = (await page.locator('[data-address-status]').textContent()) ?? '';
    assert.match(status, /confirm this is the property/i);

    // Nothing is confirmed until the customer explicitly confirms the pin.
    assert.equal(await page.locator('[data-address-confirmed]').isVisible(), false);
    await page.waitForSelector('[data-address-confirm]', { state: 'visible' });
    await page.click('[data-address-confirm]');
    await page.waitForSelector('[data-address-confirmed]', { state: 'visible' });
    const label = (await page.locator('[data-address-confirmed-label]').textContent()) ?? '';
    assert.match(label, /HAUPERT LN/);
    assert.match(label, /MOLINO/);
  } finally {
    await context.close();
  }
});

test('poor GPS accuracy never auto-fills the address', async () => {
  const { context, page } = await openEstimate({
    geolocation: { ...MOLINO, accuracy: 500 },
    permissions: ['geolocation'],
  });
  try {
    await page.click('[data-address-gps]');
    await page.waitForFunction(() =>
      /approximate|accurate to about/i.test(document.querySelector('[data-address-status]')?.textContent ?? ''),
    );
    assert.equal(await page.inputValue('#est-address'), '', 'street is not invented');
    assert.equal(await page.inputValue('#est-address-city'), '', 'city is not invented');
    // The pin exists and can be confirmed explicitly, but the address is not claimed.
    assert.equal(await page.locator('[data-address-confirm]').isVisible(), true);
  } finally {
    await context.close();
  }
});

test('permission denial falls back gracefully and manual entry still works', async () => {
  const { context, page } = await openEstimate({ geolocation: undefined, permissions: [] });
  try {
    await page.click('[data-address-gps]');
    await page.waitForFunction(() =>
      /denied|couldn't get your location/i.test(document.querySelector('[data-address-status]')?.textContent ?? ''),
      undefined,
      { timeout: 15000 },
    );
    const status = (await page.locator('[data-address-status]').textContent()) ?? '';
    assert.match(status, /denied|couldn't get your location/i);
    assert.equal(await page.locator('[data-address-confirm]').isVisible(), false, 'no pin without permission');

    // Manual entry remains fully available.
    await page.fill('#est-address', '100 S Baylen St');
    await page.click('[data-address-resolve]');
    await page.waitForSelector('[data-address-confirm]', { state: 'visible' });
  } finally {
    await context.close();
  }
});

test('GTM loads exactly once and only after analytics consent', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const gtmRequests = [];
  await page.route('**googletagmanager.com/**', async (route) => {
    gtmRequests.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
  try {
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await delay(600);
    assert.equal(gtmRequests.length, 0, 'no GTM request before consent');
    const banner = page.locator('[data-consent-banner][data-visible="true"]');
    assert.equal(await banner.isVisible(), true, 'consent banner is shown while analytics is configured');

    await page.click('[data-consent="allow"]');
    for (let attempt = 0; attempt < 50 && !gtmRequests.some((url) => url.includes('gtm.js?id=GTM-KSQ26HMG')); attempt += 1) {
      await delay(200);
    }
    assert.ok(
      gtmRequests.some((url) => url.includes('gtm.js?id=GTM-KSQ26HMG')),
      `GTM container requested: ${gtmRequests.join(', ')}`,
    );
    assert.equal(await page.locator('script[src*="googletagmanager.com/gtm.js"]').count(), 1, 'installed exactly once');

    const stored = await page.evaluate(() => window.localStorage.getItem('pcc-consent-v1'));
    assert.match(stored ?? '', /"analytics":true/);
  } finally {
    await context.close();
  }
});
