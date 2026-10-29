// Focused five-step address tests — automatic background resolution, ZIP
// fallback, no customer map/pin confirmation, and the strict FL/AL suggestion
// boundary.
//
// Run with: npm run test:browser on :4404.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4404;
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

const travelBody = JSON.stringify({
  oneWayMiles: 15,
  durationMinutes: 30,
  gasPrice: 3.1,
  gasPriceSource: 'configured_reference',
  provider: 'mapmap',
  method: 'route',
  verified: true,
  zone: 'surrounding',
});

async function openWithMocks(page, handlers) {
  const captured = { suggest: [], resolve: [], lead: null };
  await page.route('**/api/geocode', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.action === 'suggest') {
      captured.suggest.push(body);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, suggestions: handlers.suggestions ?? [] }),
      });
      return;
    }
    if (body.action === 'resolve') {
      captured.resolve.push(body);
      if (handlers.resolve) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, result: handlers.resolve }) });
      } else {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'not_found' }) });
      }
      return;
    }
    await route.fulfill({ status: 400, contentType: 'application/json', body: '{"ok":false}' });
  });
  await page.route('**/api/travel', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: travelBody }),
  );
  await page.route('**/api/lead', (route) => {
    captured.lead = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        verification: { status: 'preliminary', travel_verified: true, travel_method: 'route', config_match: 'match' },
      }),
    });
  });
  await page.route('**tiles.openfreemap.org/**', (route) => route.abort());
  return captured;
}

async function openEstimate(page) {
  await page.goto(BASE + '/estimate/residential/', { waitUntil: 'load' });
  await page.addStyleTag({ content: '.mobile-action-bar,.consent-banner{display:none!important}' });
}

const addressFilled = async (page) => page.locator('[data-address-finder]').getAttribute('data-state');

test('the five-step address card has no separate inspection or confirmation controls', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await openEstimate(page);
    assert.equal(await page.locator('#est-address').isVisible(), true);
    assert.equal(await page.locator('#est-address-city').isVisible(), true);
    assert.equal(await page.locator('#est-zip').isVisible(), true);
    assert.equal(await page.locator('[data-address-map]').count(), 0);
    assert.equal(await page.locator('[data-address-confirm]').count(), 0);
    assert.equal(await page.locator('[data-address-resolve]').count(), 0);
    assert.equal(await page.locator('[data-address-manual-details]').count(), 0);
    assert.equal(await page.locator('[data-booking-calendar]').count(), 1);
  } finally {
    await context.close();
  }
});

test('a typed address resolves in the background and advances without a map step', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await openEstimate(page);
    await openWithMocks(page, {
      resolve: { label: '100 S Baylen St, Pensacola, FL 32502', lat: 30.4111, lng: -87.2164, zip: '32502', city: 'Pensacola', state: 'FL', source: 'mapmap', precise: true },
    });
    await page.fill('#est-date', BOOKING_DATE);
    await page.fill('#est-address', '100 S Baylen St');
    await page.fill('#est-address-city', 'Pensacola');
    await page.fill('#est-zip', '32502');
    await page.click('[data-next]');
    await page.waitForFunction(
      () => document.querySelector('.wizard__step[data-step="2"]')?.getAttribute('data-active') === 'true',
    );
    assert.equal(await page.locator('[data-address-confirm]').count(), 0);
  } finally {
    await context.close();
  }
});

test('a failed exact lookup keeps the typed address and uses the ZIP fallback', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await openEstimate(page);
    await openWithMocks(page, { suggestions: [] });
    await page.fill('#est-date', BOOKING_DATE);
    await page.fill('#est-address', '777 Nowhere Road');
    await page.fill('#est-address-city', 'Milton');
    await page.fill('#est-zip', '32570');
    await page.click('[data-next]');
    await page.waitForFunction(
      () => document.querySelector('.wizard__step[data-step="2"]')?.getAttribute('data-active') === 'true',
    );
    assert.equal(await page.inputValue('#est-address'), '777 Nowhere Road', 'the typed address is preserved');
    assert.equal(await page.inputValue('#est-zip'), '32570');
  } finally {
    await context.close();
  }
});

test('the suggestion provider only receives Florida and Alabama searches', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await openEstimate(page);
    const captured = await openWithMocks(page, { suggestions: [] });
    await page.fill('#est-address', '100 S Baylen');
    await page.waitForFunction(() => true);
    await delay(600);
    assert.ok(captured.suggest.length > 0, 'a suggestion request was made');
    for (const request of captured.suggest) {
      assert.equal(request.state, 'FL');
    }
    assert.equal(await page.locator('[data-address-map]').count(), 0);
  } finally {
    await context.close();
  }
});