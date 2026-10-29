// Focused owner corrections (2026-10-29):
//  - compact Community Support checkbox
//  - compact hour/minute appointment picker
//  - photos moved to Condition & Frequency and deferred-confirmation choice
//  - removed "using the details you confirmed" / address-saving copy
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4511;
const BASE = `http://localhost:${PORT}`;
const BOOKING_DATE = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);

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

async function open(width = 1440, height = 1000) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const leadPayloads = [];
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
  await page.route('**/api/estimate-checkout', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"enabled":true,"mode":"live"}' })
      : route.fulfill({ status: 502, contentType: 'application/json', body: '{"ok":false,"error":"stripe_unavailable"}' }),
  );
  await page.route('**/api/photo-upload', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, enabled: true, maxBytes: 8388608, maxCount: 6, maxTotalBytes: 33554432, turnstileRequired: false }),
        })
      : route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false}' }),
  );
  await page.route('**/api/lead', async (route) => {
    leadPayloads.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, verification: { status: 'verified', travel_verified: true, travel_method: 'route', config_match: 'match' } }),
    });
  });
  await page.route('**tiles.openfreemap.org/**', (route) => route.abort());
  await page.goto(BASE + '/estimate/residential/', { waitUntil: 'load' });
  await page.addStyleTag({ content: '.mobile-action-bar,.consent-banner,.promo-popup{display:none!important}' });
  return { context, page, leadPayloads };
}

async function stepTwo(page) {
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
  await page.waitForFunction(() => document.querySelector('.wizard__step[data-step="2"]')?.getAttribute('data-active') === 'true');
}

async function reachCondition(page) {
  await stepTwo(page);
  await page.click('label.option:has(input[name="serviceType"][value="standard"])');
  await page.selectOption('#est-property', 'house');
  await page.fill('#est-sqft', '1600');
  await page.fill('#est-bedrooms', '3');
  await page.fill('#est-full-baths', '2');
  await page.fill('#est-half-baths', '0');
  await page.click('[data-next]');
}

async function reachFinal(page) {
  await reachCondition(page);
  await page.selectOption('#est-frequency', 'one_time');
  await page.locator('[data-dirt-guide] summary').click(); await page.locator('[data-dirt-level="2"]').click();
  await page.selectOption('#est-last-clean', 'within_month');
  await page.selectOption('#est-pets', 'none');
  await page.click('[data-next]'); // your details
  await page.fill('#est-name', 'UX correction test (please ignore)');
  await page.fill('#est-phone', '8500000000');
  await page.fill('#est-email', 'owner@sparkling-standard.com');
  await page.click('[data-next]'); // extras & payment
  await page.waitForSelector('[data-reservation-summary]', { state: 'visible' });
  await page.check('#est-terms', { force: true });
}

test('Community Support is one small checkbox linked to the terms', async () => {
  const { context, page } = await open();
  try {
    await reachFinal(page);
    const check = page.locator('.supportive-check');
    await check.waitFor({ state: 'visible' });
    assert.equal(await check.isVisible(), true);
    assert.match((await check.innerText()).replace(/\s+/g, ' '), /I qualify for Sparkling Standard.?s 10% Community Support discount\./);
    assert.equal(await check.locator('a[href="/terms/#community-support"]').count(), 1);
    assert.equal(await page.locator('.supportive-block').count(), 0, 'large Community Support box removed');
    assert.equal(await page.locator('textarea[name="supportiveNotes"]').count(), 0, 'supportive notes textarea removed');
    assert.equal(await page.locator('input[name="supportiveEligible"]').isChecked(), false);
  } finally {
    await context.close();
  }
});

test('the time picker is compact and uses the two residential windows', async () => {
  const { context, page } = await open();
  try {
    await page.fill('#est-date', BOOKING_DATE);
    await page.waitForSelector('[data-calendar-period]', { state: 'visible' });
    assert.equal(await page.locator('.booking-calendar__time').count(), 0, 'no large time-button list');
    await page.click('[data-period="first"]');
    const hourOptions = await page.locator('[data-time-hour] option').allTextContents();
    assert.deepEqual(hourOptions, ['07', '08']);
    const minuteOptions = await page.locator('[data-time-minute] option').allTextContents();
    assert.deepEqual(minuteOptions, ['00', '15', '30', '45']);
    assert.equal((await page.locator('[data-time-meridiem]').textContent())?.trim(), 'AM');
    await page.click('[data-period="afternoon"]');
    const afternoonHours = await page.locator('[data-time-hour] option').allTextContents();
    assert.deepEqual(afternoonHours, ['12', '01', '02']);
    assert.equal((await page.locator('[data-time-meridiem]').textContent())?.trim(), 'PM');
  } finally {
    await context.close();
  }
});

test('Step 1 reveals time, address and details progressively', async () => {
  const { context, page } = await open();
  try {
    assert.equal(await page.locator('[data-address-card]').isVisible(), false, 'address waits for a time');
    assert.equal(await page.locator('[data-calendar-period]').isVisible(), false, 'period waits for a date');
    await page.fill('#est-date', BOOKING_DATE);
    await page.waitForSelector('[data-calendar-period]', { state: 'visible' });
    assert.equal(await page.locator('[data-address-card]').isVisible(), false, 'address still waits for a time');
    await page.click('[data-period="first"]');
    await page.locator('[data-address-card]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-address-details]').isVisible(), false, 'city waits for a street');
    await page.fill('#est-address', '100 S Baylen St');
    await page.locator('[data-address-details]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#est-address-city').isVisible(), true);
    assert.equal(await page.locator('#est-zip').isVisible(), true);
  } finally {
    await context.close();
  }
});

test('the Continue button is sticky on mobile', async () => {
  const { context, page } = await open(390, 844);
  try {
    assert.equal(await page.locator('.mobile-action-bar').count(), 0, 'global quick actions are replaced');
    const nav = page.locator('.wizard__nav');
    assert.equal(await nav.evaluate((el) => getComputedStyle(el).position), 'fixed');
    assert.equal(await nav.locator('[data-next]').isVisible(), true);
    assert.equal((await nav.locator('[data-next]').innerText()).trim(), 'Continue');
    assert.equal(await nav.locator('[data-back]').isVisible(), false, 'nothing to go back to on step 1');
  } finally {
    await context.close();
  }
});

test('the dirt guide is a compact single-select with ten explained levels', async () => {
  const { context, page } = await open();
  try {
    await reachCondition(page);
    await page.selectOption('#est-frequency', 'one_time');
    const guide = page.locator('[data-dirt-guide]');
    const summary = guide.locator('summary');
    assert.equal((await summary.innerText()).trim(), 'Choose a dirt level (1–10)');
    await summary.click();
    assert.equal(await guide.locator('.dirt-guide__option').count(), 10);
    assert.equal(await guide.locator('[data-dirt-level="1"]').innerText(), '1\nDisney Princess Clean\nAlready sparkling. You mainly need light maintenance: dusting, surfaces, floors and bathrooms.');
    await guide.locator('[data-dirt-level="5"]').click();
    assert.equal(await guide.locator('input[name="dirtLevel"]:checked').count(), 1);
    assert.match(await summary.innerText(), /Level 5 — Surface Clean but Needs Elbow Grease/);
    assert.match(await guide.locator('[data-dirt-impact]').innerText(), /Extra detail time/);
    assert.equal(await guide.locator('details').evaluate((el) => el.open), false, 'guide collapses after selection');
  } finally {
    await context.close();
  }
});

test('Continue opens the dirt guide, scrolls to it and shows the red error', async () => {
  const { context, page } = await open(390, 844);
  try {
    await reachCondition(page);
    await page.selectOption('#est-frequency', 'one_time');
    await page.click('[data-next]');
    const guide = page.locator('[data-dirt-guide]');
    assert.equal(await guide.locator('details').evaluate((el) => el.open), true, 'the invalid guide opens');
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute('name')),
      'dirtLevel',
      'the first missing control receives focus',
    );
    assert.equal(await page.locator('[data-error-summary]').isVisible(), true);
    assert.match(await guide.locator('.field-error').innerText(), /dirt level/i);
    await page.waitForTimeout(700);
    const box = await guide.locator('[data-dirt-level="1"]').boundingBox();
    assert.ok(box && box.y >= 0 && box.y < 844, 'the invalid section is scrolled into view');
  } finally {
    await context.close();
  }
});
test('photos are in Condition & Frequency, and the last step has no photo upload', async () => {
  const { context, page } = await open();
  try {
    await reachCondition(page);
    await page.selectOption('#est-frequency', 'one_time');
    await page.locator('[data-dirt-guide] summary').click();
    await page.locator('[data-dirt-level="2"]').click();
    const section = page.locator('[data-photo-section]');
    assert.equal(await section.isVisible(), true);
    assert.equal(
      await section.evaluate((el) => el.closest('[data-step]')?.getAttribute('data-step')),
      '3',
    );
    await page.selectOption('#est-last-clean', 'within_month');
    await page.selectOption('#est-pets', 'none');
    await page.click('[data-next]');
    await page.click('[data-next]');
    assert.equal(await page.locator('[data-step="5"] [data-photo-section]').count(), 0);
  } finally {
    await context.close();
  }
});

test('Pay Now without photos offers Upload Now or Pay Now, Confirm Later', async () => {
  const { context, page, leadPayloads } = await open();
  try {
    await reachFinal(page);
    await page.click('[data-pay-now]');
    const gate = page.locator('[data-photo-gate]');
    assert.equal(await gate.isVisible(), true);
    assert.match((await gate.innerText()).replace(/\s+/g, ' '), /Photos are required for an accurate estimate and confirmed booking/i);
    assert.equal(leadPayloads.length, 0, 'no request is sent before the customer chooses');

    await page.click('[data-photo-upload-now]');
    assert.equal(
      await page.evaluate(() => document.querySelector('.wizard__step[data-active="true"]')?.getAttribute('data-step')),
      '3',
    );
    assert.equal(await page.locator('[data-photo-section]').isVisible(), true);

    await page.click('[data-next]'); // extras
    await page.click('[data-next]'); // final again
    await page.click('[data-pay-now]');
    await page.click('[data-photo-pay-later]');
    await page.waitForFunction(() => /secure checkout could not start/i.test(document.querySelector('[data-form-status]')?.textContent ?? ''));
    assert.equal(leadPayloads.length, 1);
    const fields = leadPayloads[0].fields;
    assert.equal(fields.photos_deferred, 'yes');
    assert.equal(fields.photos_outstanding, 'yes');
  } finally {
    await context.close();
  }
});

test('the removed review and address-saving copy is absent', async () => {
  const { context, page } = await open();
  try {
    const body = (await page.textContent('body')) ?? '';
    assert.doesNotMatch(body, /USING THE DETAILS YOU CONFIRMED/i);
    assert.doesNotMatch(body, /Saving your address so we can prepare/i);
    await page.fill('#est-date', BOOKING_DATE);
    await page.waitForSelector('[data-calendar-period]', { state: 'visible' });
    await page.click('[data-period="first"]');
    await page.locator('[data-address-card]').waitFor({ state: 'visible' });
    await page.fill('#est-address', '100 S Baylen St');
    await page.fill('#est-address-city', 'Pensacola');
    await page.fill('#est-zip', '32502');
    await page.click('[data-next]');
    await page.waitForTimeout(500);
    const after = (await page.textContent('body')) ?? '';
    assert.doesNotMatch(after, /Saving your address so we can prepare/i);
    assert.doesNotMatch(after, /USING THE DETAILS YOU CONFIRMED/i);
  } finally {
    await context.close();
  }
});
test('final checkout shows calculated add-on prices and bundle savings', async () => {
  const { context, page } = await open();
  try {
    await reachFinal(page);
    await page.locator('[data-extras-accordion] summary').click();
    const step = await page.evaluate(() =>
      document.querySelector('[data-addon-price]')?.closest('[data-step]')?.getAttribute('data-step'),
    );
    assert.equal(step, '5', 'extras live in the final checkout step');
    const oven = page.locator('[data-addon-price="inside_oven"]');
    assert.match((await oven.textContent()) ?? '', /\$\d/, 'individual extra shows a dollar price');
    assert.doesNotMatch((await oven.textContent()) ?? '', /Optional extra|Calculating/i);
    const bundles = page.locator('.bundle-offer');
    assert.ok((await bundles.count()) >= 6, 'expanded bundle menu is present');
    await page.locator('label.option:has(input[name="addons"][value="inside_oven"])').click();
    await page.waitForFunction(() =>
      /\$\d/.test(document.querySelector('[data-addon-price="inside_oven"]')?.textContent ?? ''),
    );
    const bundleText = (await page.locator('.bundle-offers').innerText()).replace(/\s+/g, ' ');
    assert.match(bundleText, /\$\d+.*save|save.*\$\d+/i, 'bundle price and savings are shown');
  } finally {
    await context.close();
  }
});

test('the final step has one green pay action, one pay-later action and a stacked total', async () => {
  const { context, page } = await open();
  try {
    await reachFinal(page);
    const actions = page.locator('.wizard__final-actions');
    assert.equal(await actions.isVisible(), true);
    assert.equal(await page.locator('[data-pay-now]').count(), 1, 'no duplicate pay button in the form');
    assert.equal(await page.locator('[data-pay-now]').isVisible(), true);
    assert.equal(await page.locator('[data-pay-now]').evaluate((el) => el.classList.contains('btn--success')), true);
    assert.match((await page.locator('[data-pay-now]').innerText()).trim(), /Pay Now and Reserve This Cleaning/);
    assert.match((await page.locator('[data-submit]').innerText()).trim(), /Request to Reserve This Cleaning \(Pay Later\)/);
    const breakdown = (await page.locator('[data-price-breakdown]').innerText()).replace(/\s+/g, ' ');
    assert.match(breakdown, /Sales tax \$0\.00/);
    assert.match(breakdown, /ESTIMATED TOTAL \$/);
    assert.equal(await page.locator('[data-extras-accordion]').evaluate((el) => el.open), false, 'extras start collapsed');
    assert.match((await page.locator('[data-extras-summary]').innerText()).trim(), /No extras selected/);
    const support = page.locator('[data-supportive-section]');
    await support.waitFor({ state: 'visible' });
    assert.equal(
      await support.evaluate((el) => el.nextElementSibling?.classList.contains('terms-acceptance')),
      true,
      'Community Support sits immediately before the terms acceptance',
    );
  } finally {
    await context.close();
  }
});