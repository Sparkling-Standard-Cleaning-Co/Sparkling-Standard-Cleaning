import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { chooseTime } from '../helpers/estimator-step-one.mjs';

const PORT = 4527;
const BASE = `http://localhost:${PORT}`;
const DATE = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const MORNING = {
  start: `${DATE}T13:30:00.000Z`,
  end: `${DATE}T15:30:00.000Z`,
  startLabel: '7:30 AM',
  endLabel: '9:30 AM',
};
const AFTERNOON = {
  start: `${DATE}T18:30:00.000Z`,
  end: `${DATE}T20:30:00.000Z`,
  startLabel: '12:30 PM',
  endLabel: '2:30 PM',
};

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

async function openScenario({ lateAfternoon = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const checkoutRequests = [];
  const holdRequests = [];
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
        provider: 'mapmap',
        method: 'route',
        verified: true,
        zone: 'core',
      }),
    }),
  );
  await page.route('**/api/availability**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/availability-month')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"enabled":true,"days":[]}' });
      return;
    }
    const actualDuration = Number(url.searchParams.get('durationMinutes') ?? 0);
    const slots = lateAfternoon && actualDuration > 120
      ? [MORNING]
      : [MORNING, AFTERNOON];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        enabled: true,
        timeZone: 'America/Chicago',
        timeZoneLabel: 'Central Time',
        date: DATE,
        durationMinutes: actualDuration || 120,
        available: true,
        slots,
      }),
    });
  });
  await page.route('**/api/booking-hold', async (route) => {
    const body = route.request().postDataJSON();
    holdRequests.push(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        holdId: `${body.date}__11111111-1111-4111-8111-111111111111`,
        expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
        start: body.start,
        end: body.end,
        status: 'held',
      }),
    });
  });
  await page.route('**/api/lead', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        verification: { status: 'verified', travel_verified: true, travel_method: 'route', config_match: 'match' },
      }),
    });
  });
  await page.route('**/api/estimate-checkout', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"ok":true,"enabled":true,"mode":"live"}',
      });
      return;
    }
    checkoutRequests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"ok":true,"url":"https://checkout.stripe.com/test-window"}',
    });
  });
  await page.route('https://checkout.stripe.com/**', (route) => route.abort());
  await page.route('**tiles.openfreemap.org/**', (route) => route.abort());
  await page.goto(BASE + '/estimate/residential/', { waitUntil: 'load' });
  await page.addStyleTag({ content: '.mobile-action-bar,.consent-banner,.promo-popup{display:none!important}' });
  return { context, page, checkoutRequests, holdRequests };
}

async function chooseAddressAndDate(page) {
  await page.locator('[data-address-card]').waitFor({ state: 'visible' });
  await page.fill('#est-address', '100 S Baylen St');
  await page.fill('#est-address-city', 'Pensacola');
  await page.fill('#est-zip', '32502');
  await page.click('[data-address-resolve]');
  await page.locator('[data-address-map]').waitFor({ state: 'visible' });
  await page.locator('[data-address-confirm]').click();
  await page.waitForFunction(() => document.querySelector('[data-address-finder]')?.getAttribute('data-state') === 'confirmed');
  await page.fill('#est-date', DATE);
  await page.waitForFunction(() => document.querySelector('[data-calendar-loading]')?.hasAttribute('hidden') === true);
  await page.waitForSelector('[data-period="afternoon"]:not([disabled])', { state: 'visible' });
}

async function finishToPayment(page, period) {
  await page.click(`[data-period="${period}"]`);
  await page.waitForSelector('[data-calendar-picker]', { state: 'visible' });
  await chooseTime(page);
  await page.click('[data-next]');
  await page.waitForFunction(() => document.querySelector('.wizard__step[data-step="2"]')?.getAttribute('data-active') === 'true');

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
  await page.waitForTimeout(200);
  if (await page.locator('[data-photo-gate]').isVisible().catch(() => false)) {
    await page.click('[data-photo-pay-later]');
    await page.waitForTimeout(200);
  }
  await page.waitForFunction(() => document.querySelector('.wizard__step[data-step="4"]')?.getAttribute('data-active') === 'true');
  await page.fill('#est-name', 'Arrival window regression test (please ignore)');
  await page.fill('#est-phone', '8500000000');
  await page.fill('#est-email', 'owner@sparkling-standard.com');
  await page.click('[data-next]');
  await page.waitForSelector('[data-reservation-summary]', { state: 'visible' });
  if (await page.locator('#est-terms').isVisible().catch(() => false)) await page.check('#est-terms');
}

test('eligible morning and afternoon windows both initiate secure checkout', async () => {
  for (const period of ['first', 'afternoon']) {
    const { context, page, checkoutRequests, holdRequests } = await openScenario();
    try {
      await chooseAddressAndDate(page);
      await finishToPayment(page, period);
      assert.equal(await page.locator('[data-pay-now]').isVisible(), true, `${period}: Pay Now is visible`);
      const checkoutResponse = page.waitForResponse(
        (response) =>
          response.url().includes('/api/estimate-checkout') &&
          response.request().method() === 'POST',
      );
      await page.click('[data-pay-now]');
      await checkoutResponse;
      await page.waitForTimeout(150);
      assert.equal(holdRequests.length, 1, `${period}: the selected slot was held before payment`);
      assert.equal(checkoutRequests.length, 1, `${period}: checkout initialization ran exactly once`);
      assert.equal(
        checkoutRequests[0].fields.preferred_time,
        period === 'first' ? '7:30 AM' : '12:30 PM',
        `${period}: the original arrival time reaches checkout`,
      );
    } finally {
      await context.close();
    }
  }
});

test('an afternoon start that cannot hold with final duration is explained without starting checkout', async () => {
  const { context, page, checkoutRequests, holdRequests } = await openScenario({ lateAfternoon: true });
  try {
    await chooseAddressAndDate(page);
    await finishToPayment(page, 'afternoon');
    assert.equal(await page.locator('[data-pay-now]').isVisible(), true, 'Pay Now remains available for retry');
    await page.click('[data-pay-now]');
    await page.waitForTimeout(700);
    assert.equal(holdRequests.length, 0, 'no hold is created for the invalid final duration');
    assert.equal(checkoutRequests.length, 0, 'no checkout is started without a held slot');
    const status = (await page.textContent('[data-form-status]')) ?? '';
    assert.match(status, /No payment has been taken|live held slot|cannot start yet/i);
    assert.doesNotMatch(status, /approval|approve/i, 'a scheduling failure is not described as an approval requirement');
    assert.equal(await page.locator('[data-submit]').isVisible(), true, 'the customer can still reserve without paying');
  } finally {
    await context.close();
  }
});
