// Address-first Step 1 and scheduling scroll regression.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4531;
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

async function open(width, height) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('pcc-consent-v1', JSON.stringify({ analytics: false, ads: false, v: 1 }));
    localStorage.setItem('pcc-promo-state', JSON.stringify({ state: 'dismissed', at: new Date().toISOString() }));
    sessionStorage.setItem('pcc-promo-shown-session', '1');
  });
  await page.route('**/api/estimate-checkout', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, enabled: true, mode: 'live' }) });
      return;
    }
    await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
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
          label: '100 S Baylen St, Pensacola, FL 32502', lat: 30.4111, lng: -87.2164,
          zip: '32502', city: 'Pensacola', state: 'FL', source: 'mapmap', precise: true,
        },
      }),
    });
  });
  await page.route('**/api/travel', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ oneWayMiles: 15, durationMinutes: 30, gasPrice: 3.1, gasPriceSource: 'configured_reference', provider: 'mapmap', method: 'route', verified: true, zone: 'core' }),
  }));
  await page.route('**/api/availability**', async (route) => {
    const url = new URL(route.request().url());
    const date = url.searchParams.get('date') ?? BOOKING_DATE;
    if (url.pathname.endsWith('/availability-month')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, enabled: true, days: [] }) });
      return;
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true, enabled: true, timeZone: 'America/Chicago', timeZoneLabel: 'Central Time', date,
        durationMinutes: 120, available: true,
        slots: [
          { start: `${date}T13:00:00.000Z`, end: `${date}T15:00:00.000Z`, startLabel: '7:00 AM', endLabel: '9:00 AM' },
          { start: `${date}T18:30:00.000Z`, end: `${date}T20:30:00.000Z`, startLabel: '12:30 PM', endLabel: '2:30 PM' },
        ],
      }),
    });
  });
  await page.route('**tiles.openfreemap.org/**', (route) => route.abort());
  await page.goto(BASE + '/estimate/residential/', { waitUntil: 'load' });
  await page.addStyleTag({ content: '.mobile-action-bar,.consent-banner,.promo-popup{display:none!important}' });
  return { context, page };
}

async function confirmAddress(page, zip = '32502') {
  await page.locator('[data-address-card]').waitFor({ state: 'visible' });
  await page.fill('#est-address', '100 S Baylen St');
  await page.fill('#est-address-city', 'Pensacola');
  await page.fill('#est-zip', zip);
  await page.click('[data-address-resolve]');
  await page.locator('[data-address-map]').waitFor({ state: 'visible' });
  await page.locator('[data-address-confirm]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-address-finder]')?.getAttribute('data-state') === 'confirmed',
  );
  await page.locator('[data-schedule-section]').waitFor({ state: 'visible' });
}

function inViewport(rect, viewport) {
  return rect.top >= 0 && rect.top < viewport && rect.bottom > 0;
}

for (const [label, width, height] of [
  ['small Android', 360, 800],
  ['iPhone', 390, 844],
  ['tablet', 768, 1024],
  ['desktop', 1440, 900],
]) {
  test(`address verification precedes scheduling and scrolls to the next question (${label})`, async () => {
    const { context, page } = await open(width, height);
    try {
      assert.equal(await page.locator('[data-address-card]').isVisible(), true, 'address is the first question');
      assert.equal(await page.locator('[data-schedule-section]').isVisible(), false, 'scheduling is locked before address confirmation');
      assert.equal(await page.locator('[data-calendar-gate]').isVisible(), true, 'the scheduling gate explains the order');
      assert.equal(await page.locator('#est-address').isVisible(), true);

      await confirmAddress(page);
      await delay(900);
      const scheduling = await page.evaluate(() => {
        const intro = document.querySelector('.booking-calendar__intro');
        const section = document.querySelector('[data-schedule-section]');
        const header = document.querySelector('.site-header');
        if (!intro || !section) return null;
        return {
          visible: !section.hidden,
          top: intro.getBoundingClientRect().top,
          headerBottom: header?.getBoundingClientRect().bottom ?? 0,
          viewport: window.innerHeight,
          gateHidden: document.querySelector('[data-calendar-gate]')?.hasAttribute('hidden') ?? false,
          confirmedVisible: !document.querySelector('[data-address-confirmed]')?.hasAttribute('hidden'),
        };
      });
      assert.ok(scheduling);
      assert.equal(scheduling.visible, true);
      assert.equal(scheduling.gateHidden, true);
      assert.equal(scheduling.confirmedVisible, true);
      assert.ok(scheduling.top >= scheduling.headerBottom - 2, 'scheduling heading is below the sticky header');
      assert.ok(scheduling.top < scheduling.viewport, 'scheduling is visible without manual scrolling');

      await page.fill('#est-date', BOOKING_DATE);
      await page.waitForSelector('[data-period="first"]:not([disabled])', { state: 'visible' });
      await page.click('[data-period="first"]');
      await page.locator('[data-calendar-picker]').waitFor({ state: 'visible' });
      await page.waitForSelector('[data-time-hour]', { state: 'visible' });
      const picker = await page.evaluate(() => {
        const element = document.querySelector('[data-calendar-picker]');
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, viewport: window.innerHeight };
      });
      assert.ok(picker);
      assert.ok(inViewport(picker, picker.viewport), 'time picker is positioned in view');

      await page.selectOption('[data-time-hour]', '7');
      await page.selectOption('[data-time-minute]', { label: '00' });
      await page.waitForFunction(() => (document.querySelector('[data-calendar-time-input]')?.value ?? '').length > 0);
      assert.equal(await page.locator('[data-calendar-time-input]').inputValue(), '7:00 AM');
      await page.waitForFunction(() => {
        const label = document.querySelector('[data-calendar-selected-label]')?.getBoundingClientRect();
        const next = document.querySelector('[data-next]')?.getBoundingClientRect();
        return (
          label && label.top >= 0 && label.bottom <= window.innerHeight &&
          next && next.top >= 0 && next.bottom <= window.innerHeight
        );
      }, undefined, { timeout: 5000 });
      const selected = await page.evaluate(() => {
        const label = document.querySelector('[data-calendar-selected-label]');
        const next = document.querySelector('[data-next]');
        if (!label || !next) return null;
        const labelRect = label.getBoundingClientRect();
        const nextRect = next.getBoundingClientRect();
        return {
          label: { top: labelRect.top, bottom: labelRect.bottom },
          next: { top: nextRect.top, bottom: nextRect.bottom },
          viewport: window.innerHeight,
        };
      });
      assert.ok(selected);
      assert.ok(inViewport(selected.label, selected.viewport), 'selected time remains visible');
      assert.ok(inViewport(selected.next, selected.viewport), 'Continue remains within reach');

      await page.click('[data-next]');
      await page.waitForFunction(
        () => document.querySelector('.wizard__step[data-step="2"]')?.getAttribute('data-active') === 'true',
      );
      const stepTwo = await page.evaluate(() => {
        const heading = document.querySelector('.wizard__step[data-step="2"] .wizard__step-heading');
        const header = document.querySelector('.site-header');
        if (!heading) return null;
        return {
          top: heading.getBoundingClientRect().top,
          headerBottom: header?.getBoundingClientRect().bottom ?? 0,
          viewport: window.innerHeight,
        };
      });
      assert.ok(stepTwo);
      assert.ok(stepTwo.top >= stepTwo.headerBottom - 2, 'next step heading is below the sticky header');
      assert.ok(stepTwo.top < stepTwo.viewport, 'next step heading is visible');

      await page.click('[data-back]');
      await page.waitForFunction(
        () => document.querySelector('.wizard__step[data-step="1"]')?.getAttribute('data-active') === 'true',
      );
      const back = await page.evaluate(() => {
        const title = document.querySelector('[data-address-card] .address-card__title');
        if (!title) return null;
        const rect = title.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, viewport: window.innerHeight };
      });
      assert.ok(back);
      assert.ok(inViewport(back, back.viewport), 'back navigation restores the address question');

      await page.locator('[data-address-change-compact]').click();
      await page.waitForFunction(
        () => document.querySelector('[data-schedule-section]')?.hasAttribute('hidden') === true,
      );
      assert.equal(await page.locator('[data-schedule-section]').isVisible(), false, 'changing the address re-locks scheduling');
      assert.equal(await page.inputValue('#est-date'), '', 'the invalidated appointment date is cleared');
      assert.equal(await page.locator('[data-calendar-gate]').isVisible(), true);
    } finally {
      await context.close();
    }
  });
}
