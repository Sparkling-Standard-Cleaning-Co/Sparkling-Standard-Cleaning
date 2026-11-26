// Owner-directed appointment defaults and mandatory additional-crew workflow.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4558;
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
  end: `${DATE}T21:45:00.000Z`,
  startLabel: '12:30 PM',
  endLabel: '4:45 PM',
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

async function openScenario({ staffingPending = false, checkoutFailure = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const holdRequests = [];
  const checkoutRequests = [];
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
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          enabled: true,
          days: [
            {
              date: DATE,
              enabled: true,
              morningAvailable: true,
              afternoonAvailable: true,
              morningSlots: 1,
              afternoonSlots: 1,
              available: true,
              known: true,
              slotCount: 2,
            },
          ],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        enabled: true,
        timeZone: 'America/Chicago',
        timeZoneLabel: 'Central Time',
        date: DATE,
        available: true,
        slots: [MORNING, AFTERNOON],
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
        holdId: `${body.date}__22222222-2222-4222-8222-222222222222`,
        expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
        start: body.start,
        end: body.end,
        status: 'held',
        ...(staffingPending
          ? {
              staffingPending: true,
              requiredCrewSize: 2,
              staffingNote:
                'This time is held for you. The cleaning needs a crew of 2 cleaners; our team will confirm the crew before your service.',
            }
          : {}),
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
      status: checkoutFailure ? 409 : 503,
      contentType: 'application/json',
      body: JSON.stringify(checkoutFailure ?? { ok: false, error: 'payment_not_ready' }),
    });
  });
  await page.route('https://checkout.stripe.com/**', (route) => route.abort());
  await page.route('**tiles.openfreemap.org/**', (route) => route.abort());
  await page.goto(BASE + '/estimate/residential/', { waitUntil: 'load' });
  await page.addStyleTag({ content: '.mobile-action-bar,.consent-banner,.promo-popup{display:none!important}' });
  return { context, page, holdRequests, checkoutRequests };
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

async function finishToPayment(page) {
  await page.click('[data-period="afternoon"]');
  await page.waitForSelector('[data-calendar-picker]', { state: 'visible' });
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
  await page.fill('#est-name', 'Crew pending regression test (please ignore)');
  await page.fill('#est-phone', '8500000000');
  await page.fill('#est-email', 'owner@sparkling-standard.com');
  await page.click('[data-next]');
  await page.waitForSelector('[data-reservation-summary]', { state: 'visible' });
  if (await page.locator('#est-terms').isVisible().catch(() => false)) await page.check('#est-terms');
}

test('choosing an appointment window defaults to its first available start', async () => {
  const { context, page } = await openScenario();
  try {
    await chooseAddressAndDate(page);
    await page.click('[data-period="afternoon"]');
    await page.waitForSelector('[data-calendar-picker]', { state: 'visible' });
    await page.waitForFunction(() => document.querySelector('[data-calendar-time-input]')?.value === '12:30 PM');
    assert.equal(await page.inputValue('[data-time-hour]'), '12');
    assert.equal(await page.inputValue('[data-time-minute]'), '750', 'the minute select stores minutes after midnight');

    await page.click('[data-period="first"]');
    await page.waitForFunction(() => document.querySelector('[data-calendar-time-input]')?.value === '7:30 AM');
    assert.equal(await page.inputValue('[data-time-hour]'), '7', '7:00 AM is unavailable, so the earliest real start is used');
    assert.equal(await page.inputValue('[data-time-minute]'), '450');
  } finally {
    await context.close();
  }
});

test('a mandatory second cleaner keeps both payment paths with a clear disclosure', async () => {
  const { context, page, holdRequests, checkoutRequests } = await openScenario({ staffingPending: true });
  try {
    await chooseAddressAndDate(page);
    await finishToPayment(page);
    assert.equal(await page.locator('[data-pay-now]').isVisible(), true);
    assert.equal(await page.locator('[data-submit]').isVisible(), true);
    assert.equal(await page.locator('[data-staffing-pending-note]').isVisible(), false, 'not shown before the final hold');
    const checkoutResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/estimate-checkout') && response.request().method() === 'POST',
    );
    await page.click('[data-pay-now]');
    await checkoutResponse;
    await page.waitForTimeout(150);
    assert.equal(holdRequests.length, 1);
    assert.equal(checkoutRequests.length, 1);
    assert.equal(await page.locator('[data-staffing-pending-note]').isVisible(), true);
    const note = (await page.textContent('[data-staffing-pending-note]')) ?? '';
    assert.match(note, /Additional cleaner required/i);
    assert.match(note, /2 cleaners/i);
    assert.match(note, /preserved/i);
  } finally {
    await context.close();
  }
});

test('a verified-quote failure never permanently blocks Pay Now retry', async () => {
  const { context, page, checkoutRequests } = await openScenario({
    checkoutFailure: { ok: false, error: 'quote_not_payable', reason: 'quote_not_verified' },
  });
  try {
    await chooseAddressAndDate(page);
    await finishToPayment(page);
    await page.click('[data-pay-now]');
    await page.waitForFunction(() => {
      const status = document.querySelector('[data-form-status]');
      return Boolean(status && /could not verify the exact travel route/i.test(status.textContent ?? ''));
    });
    const retry = page.locator('[data-pay-now]');
    assert.equal(await retry.isVisible(), true, 'the customer can retry without starting over');
    assert.equal(await retry.isDisabled(), false);
    await retry.click();
    await page.waitForTimeout(300);
    assert.equal(checkoutRequests.length, 2, 'a second secure-payment attempt is allowed');
  } finally {
    await context.close();
  }
});
