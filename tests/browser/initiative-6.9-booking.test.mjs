import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4506;
const BASE = `http://localhost:${PORT}`;
const BOOKING_DATE = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const SLOT_START = `${BOOKING_DATE}T13:00:00.000Z`;
const SLOT_END = `${BOOKING_DATE}T15:00:00.000Z`;

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

test('a real available slot becomes an expiring hold and travels with the request', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const captured = {};
  try {
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
          date: BOOKING_DATE,
          durationMinutes: 120,
          available: true,
          slots: [{ start: SLOT_START, end: SLOT_END, startLabel: '7:00 AM', endLabel: '9:00 AM' }],
        }),
      }),
    );
    await page.route('**/api/booking-hold', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          holdId: `${BOOKING_DATE}__12345678-1234-1234-1234-123456789abc`,
          expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
          start: SLOT_START,
          end: SLOT_END,
          status: 'held',
        }),
      }),
    );
    await page.route('**/api/estimate-checkout', (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' }),
    );
    await page.route('**/api/lead', async (route) => {
      captured.payload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          verification: { status: 'verified', travel_verified: true, travel_method: 'route', config_match: 'match' },
        }),
      });
    });
    await page.route('**tiles.openfreemap.org/**', (route) => route.abort());

    await page.goto(BASE + '/estimate/residential/', { waitUntil: 'load' });
    await page.addStyleTag({ content: '.mobile-action-bar,.consent-banner,.promo-popup{display:none!important}' });
    await page.fill('#est-date', BOOKING_DATE);
    await page.waitForSelector('[data-calendar-period]', { state: 'visible' });
    await page.click('[data-period="first"]');
    await page.locator('[data-address-card]').waitFor({ state: 'visible' });
    await page.fill('#est-address', '100 S Baylen St');
    await page.fill('#est-address-city', 'Pensacola');
    await page.fill('#est-zip', '32502');
    await page.click('[data-address-resolve]');
    await page.locator('[data-address-map]').waitFor({ state: 'visible' });
    await page.locator('[data-address-confirm]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-address-finder]')?.getAttribute('data-state') === 'confirmed',
    );
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
    await page.fill('#est-name', 'Booking Test');
    await page.fill('#est-phone', '8500000000');
    await page.fill('#est-email', 'owner@sparkling-standard.com');
    await page.click('[data-next]'); // extras & payment
    await page.locator('#est-terms').scrollIntoViewIfNeeded();
    await page.check('#est-terms');
    await page.click('[data-submit]');
    await page.waitForTimeout(150);
    if (await page.locator('[data-photo-gate]').isVisible()) await page.click('[data-photo-pay-later]');
    await page.waitForFunction(() => document.querySelector('[data-form-status]')?.dataset.state === 'success');
    await delay(150);
    const fields = captured.payload.fields;
    assert.equal(fields.booking_hold_id, `${BOOKING_DATE}__12345678-1234-1234-1234-123456789abc`);
    assert.equal(fields.preferred_slot_start, SLOT_START);
    assert.equal(fields.preferred_slot_end, SLOT_END);
  } finally {
    await context.close();
  }
});
