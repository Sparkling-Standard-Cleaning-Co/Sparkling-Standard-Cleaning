// Owner correction (2026-10-29): commercial/church appointment starts use the
// compact hour/minute picker and are not restricted to the residential windows.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4512;
const BASE = `http://localhost:${PORT}`;
const DATE = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);

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

async function openCommercial() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('pcc-consent-v1', JSON.stringify({ analytics: false, ads: false, v: 1 }));
    localStorage.setItem('pcc-promo-state', JSON.stringify({ state: 'dismissed', at: new Date().toISOString() }));
    sessionStorage.setItem('pcc-promo-shown-session', '1');
  });
  await page.route('**/api/geocode', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
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
          label: '100 S Baylen St, Pensacola, FL 32502',
          lat: 30.4111,
          lng: -87.2164,
          zip: '32502',
          city: 'Pensacola',
          state: 'FL',
          source: 'mapmap',
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
  await page.route('**/api/availability**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        enabled: true,
        timeZone: 'America/Chicago',
        timeZoneLabel: 'Central Time',
        date: DATE,
        durationMinutes: 120,
        available: true,
        slots: [
          { start: `${DATE}T14:00:00.000Z`, end: `${DATE}T16:00:00.000Z`, startLabel: '9:00 AM', endLabel: '11:00 AM' },
          { start: `${DATE}T14:30:00.000Z`, end: `${DATE}T16:30:00.000Z`, startLabel: '9:30 AM', endLabel: '11:30 AM' },
          { start: `${DATE}T15:00:00.000Z`, end: `${DATE}T17:00:00.000Z`, startLabel: '10:00 AM', endLabel: '12:00 PM' },
          { start: `${DATE}T20:00:00.000Z`, end: `${DATE}T22:00:00.000Z`, startLabel: '3:00 PM', endLabel: '5:00 PM' },
        ],
      }),
    }),
  );
  await page.route('**/api/booking-hold', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        holdId: `${DATE}__12345678-1234-1234-1234-123456789abc`,
        expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
        status: 'held',
      }),
    }),
  );
  await page.route('**tiles.openfreemap.org/**', (route) => route.abort());
  await page.goto(BASE + '/estimate/commercial/', { waitUntil: 'load' });
  await page.addStyleTag({ content: '.mobile-action-bar,.consent-banner,.promo-popup{display:none!important}' });
  return { context, page };
}

test('commercial uses the compact picker and allows any available start', async () => {
  const { context, page } = await openCommercial();
  try {
    await page.fill('#fac-org', 'Commercial Picker Test');
    await page.fill('#fac-name', 'Test Owner');
    await page.locator('[data-address-manual-summary]').click();
    await page.fill('#est-address', '100 S Baylen St');
    await page.fill('#est-address-city', 'Pensacola');
    await page.selectOption('#est-address-state', 'FL');
    await page.fill('#est-zip', '32502');
    await page.click('[data-facility-next]');
    await page.locator('[data-facility-step-panel="2"]').waitFor({ state: 'visible' });
    await page.selectOption('#fac-type', 'office');
    await page.fill('#fac-sqft', '2000');
    await page.fill('#fac-restrooms', '6');
    await page.selectOption('#fac-frequency', 'weekly');
    await page.click('[data-facility-next]');
    await page.locator('[data-facility-step-panel="3"]').waitFor({ state: 'visible' });
    await page.selectOption('#fac-window', { index: 1 });
    await page.fill('#fac-start', DATE);
    await page.click('[data-facility-next]');
    await page.locator('[data-facility-step-panel="4"]').waitFor({ state: 'visible' });
    await page.waitForSelector('[data-booking-picker]', { state: 'visible' });
    const picker = page.locator('[data-booking-picker]');
    assert.equal(await picker.locator('.booking-picker__slot').count(), 0, 'no long time-button list');
    assert.equal(await picker.locator('[data-booking-picker-time]').isVisible(), true);
    const hours = await picker.locator('[data-booking-hour] option').allTextContents();
    assert.ok(hours.includes('09'));
    assert.ok(hours.includes('03'), 'afternoon start is offered without a residential window restriction');
    const minutes = await picker.locator('[data-booking-minute] option').allTextContents();
    assert.ok(minutes.includes('00'));
    assert.ok(minutes.includes('30'));
    assert.equal((await picker.locator('[data-booking-meridiem]').textContent())?.trim(), 'AM');
    await picker.locator('[data-booking-hold-selected]').click();
    await page.waitForFunction(() => document.querySelector('[data-booking-hold]')?.hasAttribute('hidden') === false);
    assert.match((await picker.locator('[data-booking-hold]').textContent()) ?? '', /Temporary hold until/i);
  } finally {
    await context.close();
  }
});