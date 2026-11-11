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
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1280, height: 1000 },
    ...(options.reducedMotion ? { reducedMotion: options.reducedMotion } : {}),
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('pcc-consent-v1', JSON.stringify({ analytics: false, ads: false, v: 1 }));
    localStorage.setItem('pcc-promo-state', JSON.stringify({ state: 'dismissed', at: new Date().toISOString() }));
    sessionStorage.setItem('pcc-promo-shown-session', '1');
  });
  if (options.paymentReady) {
    await page.route('**/api/estimate-checkout', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, enabled: true, mode: 'live' }),
        });
        return;
      }
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false }),
      });
    });
  }
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

test('confirming the address lands on the next question instead of dropping below it', async () => {
  const { context, page } = await setupPage({ viewport: { width: 390, height: 844 } });
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
    await page.locator('[data-address-confirm]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-address-finder]')?.getAttribute('data-state') === 'confirmed',
    );
    await delay(700);
    const position = await page.evaluate(() => {
      const calendar = document.querySelector('[data-booking-calendar]');
      const confirmed = document.querySelector('[data-address-confirmed]');
      const header = document.querySelector('.site-header');
      if (!calendar) return null;
      return {
        calendar: calendar.getBoundingClientRect().toJSON(),
        confirmedVisible: confirmed instanceof HTMLElement ? !confirmed.hidden : false,
        headerBottom: header?.getBoundingClientRect().bottom ?? 0,
        viewport: window.innerHeight,
        address: document.querySelector('#est-address')?.value ?? '',
        scrollY: window.scrollY,
      };
    });
    assert.ok(position, 'the availability section exists');
    assert.match(position.address, /Baylen/i, 'the confirmed address is preserved');
    assert.equal(position.confirmedVisible, true, 'the confirmed destination is shown');
    assert.ok(position.calendar.top < position.viewport, 'the next question is not below the viewport');
    assert.ok(position.calendar.bottom > 0, 'the next question is not entirely above the viewport');
    assert.ok(
      position.calendar.top >= position.headerBottom - 2,
      'the next question starts below the sticky header',
    );
  } finally {
    await context.close();
  }
});

﻿test('entering the final step frames the estimate reveal, then keeps it stable', async () => {
  const { context, page } = await setupPage({ viewport: { width: 390, height: 844 } });
  try {
    await completeToFinalStep(page);
    await page.locator('[data-estimate-reveal]').waitFor({ state: 'visible' });
    const position = await page.evaluate(() => {
      const stage = document.querySelector('.estimate-reveal-stage');
      const reveal = document.querySelector('[data-estimate-reveal]');
      const header = document.querySelector('.site-header');
      if (!stage || !reveal) return null;
      const stageRect = stage.getBoundingClientRect();
      const revealRect = reveal.getBoundingClientRect();
      return {
        stageTop: stageRect.top,
        revealTop: revealRect.top,
        revealBottom: revealRect.bottom,
        headerBottom: header?.getBoundingClientRect().bottom ?? 0,
        viewport: window.innerHeight,
      };
    });
    assert.ok(position);
    assert.ok(position.stageTop >= position.headerBottom - 2, 'reveal starts below the sticky header');
    assert.ok(position.stageTop <= 220, 'reveal starts near the top, not midway down the page');
    assert.ok(position.revealTop < position.viewport, 'the five-second visual is visible');
    assert.ok(position.revealBottom > 0, 'the five-second visual is not above the viewport');
    await page.waitForFunction(
      () => document.querySelector('[data-estimate-reveal]')?.hasAttribute('hidden') === true,
      undefined,
      { timeout: 7000 },
    );
    assert.equal(await page.locator('[data-reservation-summary]').isVisible(), true, 'the estimate is readable after the visual completes');
    const before = await page.evaluate(
      () => document.querySelector('.estimate-reveal-stage')?.getBoundingClientRect().top ?? 0,
    );
    await page.locator('#est-terms').evaluate((element) => element.click());
    await delay(300);
    const after = await page.evaluate(
      () => document.querySelector('.estimate-reveal-stage')?.getBoundingClientRect().top ?? 0,
    );
    assert.ok(Math.abs(after - before) <= 6, 'terms changes do not scroll the final step again');
    await page.click('[data-appointment-edit]');
    assert.equal(
      await page.locator('.wizard__step[data-step="1"]').getAttribute('data-active'),
      'true',
      'Reschedule returns to step 1',
    );
    for (const step of [2, 3, 4, 5]) {
      await page.click('[data-next]');
      await page.waitForFunction(
        (value) =>
          document.querySelector(`.wizard__step[data-step="${value}"]`)?.getAttribute('data-active') ===
          'true',
        step,
      );
    }
    assert.equal(
      await page.locator('[data-estimate-reveal]').isVisible(),
      false,
      'returning to the final step does not replay the five-second visual',
    );
    assert.equal(await page.locator('[data-reservation-summary]').isVisible(), true);
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
test('the final appointment card uses the approved wording and Add-ons is always visible', async () => {
  const { context, page } = await setupPage();
  try {
    await completeToFinalStep(page);
    const card = page.locator('[data-appointment-summary]');
    const cardText = (await card.innerText()).replace(/\s+/g, ' ');
    assert.match(cardText, /Your appointment for/i);
    assert.doesNotMatch(cardText, /Preferred start/i);
    assert.doesNotMatch(cardText, /confirmed after our team reviews/i);
    assert.match((await page.locator('[data-appointment-edit]').innerText()).trim(), /Reschedule/i);
    await page.locator('[data-reservation-summary]').waitFor({ state: 'visible' });
    await page.waitForFunction(
      () => document.querySelector('[data-estimate-reveal]')?.hasAttribute('hidden') === true,
    );
    await page.waitForFunction(() =>
      document.querySelector('[data-price-breakdown]')?.textContent?.includes('Add-ons'),
    );
    const breakdown = (await page.locator('[data-price-breakdown]').innerText()).replace(/\s+/g, ' ');
    assert.match(breakdown, /Add-ons/);
    assert.match(breakdown, /\$0\.00/);
    assert.equal(
      await page.locator('#est-promo-code').getAttribute('placeholder'),
      'Enter promo code (optional)',
    );
    await page.click('[data-appointment-edit]');
    assert.equal(
      await page.locator('.wizard__step[data-step="1"]').getAttribute('data-active'),
      'true',
      'Reschedule returns to date/time selection',
    );
  } finally {
    await context.close();
  }
});

function moneyValue(text) {
  return Number(String(text).replace(/[^0-9.]/g, '')) || 0;
}

async function applyDiscounts(page) {
  await page.click('[data-apply-discounts]');
}

test('a valid promo updates the itemized total, highlights the saving and scrolls to it', async () => {
  const { context, page } = await setupPage({ reducedMotion: 'reduce' });
  try {
    await completeToFinalStep(page);
    await page.locator('[data-reservation-summary]').waitFor({ state: 'visible' });
    await page.waitForFunction(
      () => document.querySelector('[data-estimate-reveal]')?.hasAttribute('hidden') === true,
    );
    await page.waitForFunction(() =>
      (document.querySelector('[data-reservation-price]')?.innerText ?? '').trim().length > 0,
    );
    const before = moneyValue(await page.locator('[data-reservation-price]').innerText());
    await page.route('**/api/promotion', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          code: 'THANKS75',
          name: 'Thanksgiving Deep Clean Special',
          discountCents: 7500,
        }),
      });
    });
    await page.fill('#est-promo-code', 'THANKS75');
    await applyDiscounts(page);
    await page.waitForFunction(
      () => document.querySelector('[data-discount-status]')?.textContent?.includes('THANKS75'),
    );
    const breakdown = (await page.locator('[data-price-breakdown]').innerText()).replace(/\s+/g, ' ');
    assert.match(breakdown, /THANKS75 promotion applied/);
    assert.match(breakdown, /\$75\.00/);
    assert.match(breakdown, /ESTIMATED TOTAL/);
    const after = moneyValue(await page.locator('[data-reservation-price]').innerText());
    assert.equal(after, before - 75);
    const status = (await page.locator('[data-discount-status]').innerText()).replace(/\s+/g, ' ');
    assert.match(status, /you saved \$75\.00/i);
    assert.doesNotMatch(status, /A valid code|not available|expired/i);
    await delay(400);
    const visible = await page.evaluate(() => {
      const summary = document.querySelector('[data-reservation-summary]');
      if (!summary) return null;
      const rect = summary.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, viewport: window.innerHeight };
    });
    assert.ok(visible);
    assert.ok(visible.top < visible.viewport, 'the updated breakdown is in view');
    assert.ok(visible.bottom > 0, 'the updated breakdown is not above the viewport');
  } finally {
    await context.close();
  }
});

test('an invalid promo stays at the field with a specific error and never changes the total', async () => {
  const { context, page } = await setupPage({ reducedMotion: 'reduce' });
  try {
    await completeToFinalStep(page);
    await page.locator('[data-reservation-summary]').waitFor({ state: 'visible' });
    await page.waitForFunction(
      () => document.querySelector('[data-estimate-reveal]')?.hasAttribute('hidden') === true,
    );
    await page.waitForFunction(() =>
      (document.querySelector('[data-reservation-price]')?.innerText ?? '').trim().length > 0,
    );
    const before = moneyValue(await page.locator('[data-reservation-price]').innerText());
    await page.route('**/api/promotion', async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'promotion_expired' }),
      });
    });
    await page.fill('#est-promo-code', 'OLDPROMO');
    await applyDiscounts(page);
    await delay(500);
    await page.waitForFunction(
      () => document.querySelector('[data-discount-status]')?.textContent?.includes('expired'),
    );
    const after = moneyValue(await page.locator('[data-reservation-price]').innerText());
    assert.equal(after, before, 'the total is unchanged');
    const status = (await page.locator('[data-discount-status]').innerText()).replace(/\s+/g, ' ');
    assert.match(status, /expired/i);
    const promoField = await page.locator('#est-promo-code').boundingBox();
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    assert.ok(promoField && promoField.y < viewportHeight, 'the promo field remains in view');
  } finally {
    await context.close();
  }
});

test('a smaller valid code never replaces a better applied offer', async () => {
  const { context, page } = await setupPage({ reducedMotion: 'reduce' });
  try {
    await completeToFinalStep(page);
    await page.locator('[data-reservation-summary]').waitFor({ state: 'visible' });
    await page.waitForFunction(
      () => document.querySelector('[data-estimate-reveal]')?.hasAttribute('hidden') === true,
    );
    await page.route('**/api/promotion', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}');
      const isSmall = String(body.code).toUpperCase() === 'SMALL15';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          isSmall
            ? { ok: true, code: 'SMALL15', name: 'Small offer', discountCents: 1500 }
            : { ok: true, code: 'THANKS75', name: 'Thanksgiving Deep Clean Special', discountCents: 7500 },
        ),
      });
    });
    await page.fill('#est-promo-code', 'THANKS75');
    await applyDiscounts(page);
    await page.waitForFunction(
      () => document.querySelector('[data-discount-status]')?.textContent?.includes('THANKS75'),
    );
    const afterBetter = moneyValue(await page.locator('[data-reservation-price]').innerText());
    await page.fill('#est-promo-code', 'SMALL15');
    await applyDiscounts(page);
    await delay(500);
    await page.waitForFunction(
      () => document.querySelector('[data-discount-status]')?.textContent?.includes('existing THANKS75'),
    );
    const afterSmaller = moneyValue(await page.locator('[data-reservation-price]').innerText());
    assert.equal(afterSmaller, afterBetter, 'the better saving is retained');
    const breakdown = (await page.locator('[data-price-breakdown]').innerText()).replace(/\s+/g, ' ');
    assert.match(breakdown, /THANKS75 promotion applied/);
    assert.doesNotMatch(breakdown, /SMALL15/);
  } finally {
    await context.close();
  }
});

test('promo and gift certificate apply together with the gift shown first and the amount due updated', async () => {
  const { context, page } = await setupPage({ reducedMotion: 'reduce', paymentReady: true });
  try {
    await completeToFinalStep(page);
    await page.locator('[data-reservation-summary]').waitFor({ state: 'visible' });
    await page.waitForFunction(
      () => document.querySelector('[data-estimate-reveal]')?.hasAttribute('hidden') === true,
    );
    await page.waitForFunction(() =>
      (document.querySelector('[data-reservation-price]')?.innerText ?? '').trim().length > 0,
    );
    const before = moneyValue(await page.locator('[data-reservation-price]').innerText());
    await page.route('**/api/promotion', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          code: 'THANKS75',
          name: 'Thanksgiving Deep Clean Special',
          discountCents: 7500,
        }),
      });
    });
    await page.route('**/api/gift-balance?code=*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          code: 'SSGC-TEST-2345',
          status: 'active',
          active: true,
          valueCents: 10000,
          redeemedCents: 0,
          remainingCents: 5000,
        }),
      });
    });
    await page.locator('[data-pay-now]').waitFor({ state: 'visible' });
    await page.locator('[data-gift-field]').waitFor({ state: 'visible' });
    await page.fill('#est-promo-code', 'THANKS75');
    await page.fill('#est-gift-code', 'SSGC-TEST-2345');
    await applyDiscounts(page);
    await page.waitForFunction(
      () => document.querySelector('[data-discount-status]')?.textContent?.includes('Gift certificate applied'),
    );
    const rows = await page.locator('[data-price-breakdown] li').evaluateAll((items) =>
      items.map((item) => item.innerText.replace(/\s+/g, ' ')),
    );
    const giftIndex = rows.findIndex((row) => /Gift certificate applied/.test(row));
    const promoIndex = rows.findIndex((row) => /THANKS75 promotion applied/.test(row));
    assert.ok(giftIndex >= 0 && promoIndex >= 0);
    assert.ok(giftIndex < promoIndex, 'the gift line is presented before the promotion line');
    assert.match(rows[giftIndex], /\$50\.00/);
    assert.match(rows[promoIndex], /\$75\.00/);
    assert.match(rows.join(' '), /AMOUNT DUE/);
    const after = moneyValue(await page.locator('[data-reservation-price]').innerText());
    assert.equal(after, before - 75 - 50);
    const status = (await page.locator('[data-discount-status]').innerText()).replace(/\s+/g, ' ');
    assert.match(status, /THANKS75/);
    assert.match(status, /Gift certificate applied/);
    await page.fill('#est-gift-code', '');
    await applyDiscounts(page);
    await page.waitForFunction(() => {
      const text = document.querySelector('[data-discount-status]')?.textContent ?? '';
      return !text.includes('Checking') && text.includes('THANKS75 applied') && !text.includes('Gift certificate');
    });
    const rowsAfterRemoval = (await page.locator('[data-price-breakdown]').innerText()).replace(/\s+/g, ' ');
    assert.doesNotMatch(rowsAfterRemoval, /Gift certificate applied/);
    const afterRemoval = moneyValue(await page.locator('[data-reservation-price]').innerText());
    assert.equal(afterRemoval, before - 75, 'removing the gift restores the amount due');
  } finally {
    await context.close();
  }
});

test('small Android viewport also anchors address confirmation to availability', async () => {
  const { context, page } = await setupPage({ viewport: { width: 360, height: 800 } });
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
    await page.locator('[data-address-confirm]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-address-finder]')?.getAttribute('data-state') === 'confirmed',
    );
    await delay(1200);
    const position = await page.evaluate(() => {
      const calendar = document.querySelector('[data-booking-calendar]');
      if (!calendar) return null;
      const rect = calendar.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, viewport: window.innerHeight };
    });
    assert.ok(position);
    assert.ok(position.top >= 0 && position.top < position.viewport);
    assert.ok(position.bottom > 0);
  } finally {
    await context.close();
  }
});
