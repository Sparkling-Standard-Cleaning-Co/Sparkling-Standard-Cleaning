import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4513;
const BASE = `http://localhost:${PORT}`;
const BOOKING_DATE = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const OTHER_DATE = new Date(Date.now() + 31 * 86_400_000).toISOString().slice(0, 10);
const MORNING_START = `${BOOKING_DATE}T13:00:00.000Z`;
const MORNING_END = `${BOOKING_DATE}T15:00:00.000Z`;
const AFTERNOON_START = `${BOOKING_DATE}T18:30:00.000Z`;
const AFTERNOON_END = `${BOOKING_DATE}T20:30:00.000Z`;

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

function slotsFor(date) {
  if (date === OTHER_DATE) {
    return [{ start: `${OTHER_DATE}T18:30:00.000Z`, end: `${OTHER_DATE}T20:30:00.000Z`, startLabel: '12:30 PM', endLabel: '2:30 PM' }];
  }
  return [
    { start: MORNING_START, end: MORNING_END, startLabel: '7:00 AM', endLabel: '9:00 AM' },
    { start: `${BOOKING_DATE}T13:30:00.000Z`, end: `${BOOKING_DATE}T15:30:00.000Z`, startLabel: '7:30 AM', endLabel: '9:30 AM' },
    { start: AFTERNOON_START, end: AFTERNOON_END, startLabel: '12:30 PM', endLabel: '2:30 PM' },
  ];
}

async function setupPage(options = {}) {
  const context = await browser.newContext({ viewport: options.viewport ?? { width: 1280, height: 1000 } });
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
  const availability = options.availability ?? (async (route) => {
    const url = new URL(route.request().url());
    const date = url.searchParams.get('date') ?? BOOKING_DATE;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        enabled: true,
        timeZone: 'America/Chicago',
        timeZoneLabel: 'Central Time',
        date,
        durationMinutes: 120,
        available: true,
        slots: slotsFor(date),
      }),
    });
  });
  await page.route('**/api/availability**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/availability-month')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, enabled: true, days: [] }),
      });
      return;
    }
    await availability(route);
  });
  await page.route('**tiles.openfreemap.org/**', (route) => route.abort());
  await page.goto(BASE + '/estimate/residential/', { waitUntil: 'load' });
  await page.addStyleTag({ content: '.mobile-action-bar,.consent-banner,.promo-popup{display:none!important}' });
  return { context, page };
}

async function selectDate(page, date = BOOKING_DATE) {
  await page.fill('#est-date', date);
  await page.waitForSelector('[data-calendar-period]', { state: 'visible' });
  await page.waitForFunction(() => document.querySelector('[data-calendar-loading]')?.hasAttribute('hidden') === true);
  await page.waitForSelector('[data-period="first"]:not([disabled])', { state: 'visible' });
}

async function confirmAddress(page) {
  await page.locator('[data-address-card]').waitFor({ state: 'visible' });
  await page.fill('#est-address', '100 S Baylen St');
  await page.fill('#est-address-city', 'Pensacola');
  await page.fill('#est-zip', '32502');
  // Address resolution and the calendar availability revalidation can race in
  // slower CI environments. Retry the resolver once if the first click lands
  // while the finder is transitioning between states; a genuine resolve
  // failure still fails after both attempts.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.click('[data-address-resolve]');
    try {
      await page.locator('[data-address-map]').waitFor({ state: 'visible', timeout: 8_000 });
      break;
    } catch {
      if (attempt === 1) throw new Error('address map did not appear after resolve retry');
      await page.waitForTimeout(500);
    }
  }
  await page.locator('[data-address-confirm]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-address-finder]')?.getAttribute('data-state') === 'confirmed',
  );
}

async function completeToFinalStep(page) {
  await selectDate(page);
  await page.click('[data-period="first"]');
  await confirmAddress(page);
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
  await page.click('label.option:has(input[name="condition"][value="maintained"])');
  await page.selectOption('#est-last-clean', 'within_month');
  await page.selectOption('#est-pets', 'none');
  await page.click('[data-next]');
  await page.fill('#est-name', 'Estimator UX Test');
  await page.fill('#est-phone', '8500000000');
  await page.fill('#est-email', 'owner@sparkling-standard.com');
  await page.click('[data-next]');
  await page.waitForFunction(
    () => document.querySelector('.wizard__step[data-step="5"]')?.getAttribute('data-active') === 'true',
  );
}

function inViewport(rect, viewportHeight) {
  return rect.top >= 0 && rect.top < viewportHeight && rect.bottom > 0;
}

test('Morning and Afternoon selections keep the exact time picker in view', async () => {
  const { context, page } = await setupPage();
  try {
    await selectDate(page);
    for (const period of ['first', 'afternoon']) {
      await page.click(`[data-period="${period}"]`);
      await page.waitForSelector('[data-calendar-picker]', { state: 'visible' });
      await delay(450);
      const result = await page.evaluate(() => {
        const picker = document.querySelector('[data-calendar-picker]');
        const heading = picker?.querySelector('.booking-calendar__picker-heading');
        const fields = picker?.querySelector('.booking-calendar__time-fields');
        if (!picker || !heading || !fields) return null;
        const pickerRect = picker.getBoundingClientRect();
        const headingRect = heading.getBoundingClientRect();
        const fieldsRect = fields.getBoundingClientRect();
        return {
          viewportHeight: window.innerHeight,
          picker: { top: pickerRect.top, bottom: pickerRect.bottom },
          heading: { top: headingRect.top, bottom: headingRect.bottom },
          fields: { top: fieldsRect.top, bottom: fieldsRect.bottom },
        };
      });
      assert.ok(result, 'the picker renders');
      assert.ok(inViewport(result.heading, result.viewportHeight), `${period}: heading is in view`);
      assert.ok(inViewport(result.fields, result.viewportHeight), `${period}: time fields are in view`);
      assert.ok(result.picker.bottom <= result.viewportHeight + 1, `${period}: picker is not below the viewport`);
    }
  } finally {
    await context.close();
  }
});

test('confirming the address does not jump the page and late resolution does not scroll', async () => {
  const { context, page } = await setupPage();
  try {
    await selectDate(page);
    await page.click('[data-period="first"]');
    await page.locator('[data-address-card]').waitFor({ state: 'visible' });
    await page.fill('#est-address', '100 S Baylen St');
    await page.fill('#est-address-city', 'Pensacola');
    await page.fill('#est-zip', '32502');
    await page.click('[data-address-resolve]');
    await page.locator('[data-address-map]').waitFor({ state: 'visible' });
    await page.locator('[data-address-confirm]').scrollIntoViewIfNeeded();
    await delay(150);
    const before = await page.evaluate(() => window.scrollY);
    await page.locator('[data-address-confirm]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-address-finder]')?.getAttribute('data-state') === 'confirmed',
    );
    await delay(500);
    const after = await page.evaluate(() => window.scrollY);
    assert.ok(Math.abs(after - before) <= 8, `address confirmation kept the viewport (${before} -> ${after})`);
  } finally {
    await context.close();
  }
});

test('entering the final step scrolls to the beginning of the estimate content once', async () => {
  const { context, page } = await setupPage();
  try {
    await completeToFinalStep(page);
    const position = await page.evaluate(() => {
      const step = document.querySelector('.wizard__step[data-step="5"]');
      const heading = step?.querySelector('.wizard__step-heading');
      if (!step || !heading) return null;
      const header = document.querySelector('.site-header');
      const headerBottom = header?.getBoundingClientRect().bottom ?? 0;
      return { stepTop: step.getBoundingClientRect().top, headingTop: heading.getBoundingClientRect().top, headerBottom, scrollY: window.scrollY };
    });
    assert.ok(position);
    assert.ok(position.stepTop >= position.headerBottom - 2, 'final step starts below the sticky header');
    assert.ok(position.stepTop <= 260, 'final step starts near the top, not midway down the page');
    const before = await page.evaluate(
      () => document.querySelector('.wizard__step[data-step="5"]')?.getBoundingClientRect().top ?? 0,
    );
    await page.locator('#est-terms').evaluate((element) => element.click());
    await delay(300);
    const after = await page.evaluate(
      () => document.querySelector('.wizard__step[data-step="5"]')?.getBoundingClientRect().top ?? 0,
    );
    assert.ok(Math.abs(after - before) <= 6, 'terms changes do not scroll the final step again');
  } finally {
    await context.close();
  }
});

test('desktop and mobile final-action wording match and fit every required width', async () => {
  const { context, page } = await setupPage();
  try {
    await completeToFinalStep(page);
    const labels = await page.evaluate(() => {
      const pay = document.querySelector('[data-pay-now]');
      const later = document.querySelector('[data-submit]');
      for (const button of document.querySelectorAll('[data-final-actions] .btn')) button.hidden = false;
      return { pay: pay?.textContent?.trim() ?? '', later: later?.textContent?.trim() ?? '' };
    });
    assert.equal(labels.pay, 'Pay Now and Reserve This Cleaning');
    assert.equal(labels.later, 'Request to Reserve This Cleaning (Pay Later)');
    for (const width of [320, 360, 375, 390, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await delay(100);
      const measured = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('[data-final-actions] .btn')].filter(
          (button) => !button.hidden && button.getBoundingClientRect().width > 0,
        );
        return {
          pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
          buttons: buttons.map((button) => ({
            text: button.textContent?.trim() ?? '',
            overflow: button.scrollWidth - button.clientWidth,
            left: button.getBoundingClientRect().left,
            right: button.getBoundingClientRect().right,
            viewport: window.innerWidth,
          })),
        };
      });
      assert.ok(measured.pageOverflow <= 1, `${width}px: no page horizontal overflow`);
      for (const button of measured.buttons) {
        assert.ok(button.overflow <= 1, `${width}px: "${button.text}" does not overflow`);
        assert.ok(button.left >= -1 && button.right <= button.viewport + 1, `${width}px: button stays in the viewport`);
      }
      assert.equal(measured.buttons[0]?.text, labels.pay);
      assert.equal(measured.buttons[1]?.text, labels.later);
    }
  } finally {
    await context.close();
  }
});

test('availability shows loading feedback, clears it, and offers a working retry', async () => {
  let attempt = 0;
  let release;
  const { context, page } = await setupPage({
    availability: async (route) => {
      const url = new URL(route.request().url());
      const date = url.searchParams.get('date') ?? BOOKING_DATE;
      attempt += 1;
      if (attempt === 1) {
        await new Promise((resolve) => {
          release = resolve;
        });
      }
      if (attempt === 3) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          enabled: true,
          timeZone: 'America/Chicago',
          date,
          durationMinutes: 120,
          available: true,
          slots: slotsFor(date),
        }),
      });
    },
  });
  try {
    await selectDate(page);
    await page.click('[data-period="first"]');
    await page.locator('[data-address-card]').waitFor({ state: 'visible' });
    await page.fill('#est-address', '100 S Baylen St');
    await page.fill('#est-address-city', 'Pensacola');
    await page.fill('#est-zip', '32502');
    await page.waitForSelector('[data-calendar-loading]', { state: 'visible' });
    assert.match((await page.textContent('[data-calendar-loading]')) ?? '', /Checking available appointments/);
    release();
    await page.waitForSelector('[data-calendar-loading]', { state: 'hidden' });
    assert.equal(await page.locator('[data-calendar-loading]').isVisible(), false);

    await confirmAddress(page);
    await page.waitForFunction(() => document.querySelector('[data-calendar-loading]')?.hasAttribute('hidden') === true);

    await page.fill('#est-date', OTHER_DATE);
    await page.waitForSelector('[data-calendar-times-retry]', { state: 'visible' });
    assert.match((await page.textContent('[data-calendar-status]')) ?? '', /could not load available times/i);
    attempt = 3;
    await page.click('[data-calendar-times-retry]');
    await page.waitForFunction(
      () => document.querySelector('[data-calendar-loading]')?.hasAttribute('hidden') === true,
    );
    await page.click('[data-period="afternoon"]');
    await page.waitForSelector('[data-calendar-picker]', { state: 'visible' });
  } finally {
    await context.close();
  }
});

test('rapid date changes never let a stale availability response win', async () => {
  const releases = new Map();
  const { context, page } = await setupPage({
    availability: async (route) => {
      const url = new URL(route.request().url());
      const date = url.searchParams.get('date') ?? BOOKING_DATE;
      if (date === BOOKING_DATE) {
        await new Promise((resolve) => releases.set(date, resolve));
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          enabled: true,
          timeZone: 'America/Chicago',
          date,
          durationMinutes: 120,
          available: true,
          slots: slotsFor(date),
        }),
      });
    },
  });
  try {
    await selectDate(page);
    await page.click('[data-period="first"]');
    await confirmAddress(page);
    await page.waitForFunction(() => document.querySelector('[data-calendar-loading]')?.hasAttribute('hidden') === false);
    await page.fill('#est-date', OTHER_DATE);
    await page.waitForFunction(() => document.querySelector('[data-calendar-loading]')?.hasAttribute('hidden') === true);
    releases.get(BOOKING_DATE)?.();
    await delay(400);
    const selected = (await page.textContent('[data-calendar-selected-label]')) ?? '';
    assert.ok(selected.length > 0 && !/Select a date first/.test(selected), 'the newer date remains selected');
    assert.equal(await page.locator('[data-period="first"]').isDisabled(), true, 'stale morning slots never win');
    await page.click('[data-period="afternoon"]');
    await page.waitForSelector('[data-calendar-picker]', { state: 'visible' });
    const hourOptions = (await page.locator('[data-time-hour] option').allTextContents()).map((value) => value.trim());
    assert.deepEqual(hourOptions, ['12']);
  } finally {
    await context.close();
  }
});
