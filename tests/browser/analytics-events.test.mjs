// Focused analytics tests — the website side of the GA4 pipeline:
// consent gate, click-intent events, estimator funnel events, and the rule
// that submit conversions fire ONLY after the provider acknowledges a request.
// Run with: npm run test:browser on :4408.
//
// GTM itself is stubbed (an empty JS response), so these tests prove event
// GENERATION in window.dataLayer, not GA4 receipt (which needs the owner's
// dashboard; see docs/analytics/GTM-CONTAINER-SETUP.md).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4408;
const BASE = `http://localhost:${PORT}`;
const BOOKING_DATE = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

const ADDRESS_RESULT = {
  label: '100 S BAYLEN ST, PENSACOLA, FL, 32502',
  lat: 30.41,
  lng: -87.21,
  zip: '32502',
  city: 'PENSACOLA',
  state: 'FL',
  source: 'mapmap',
  precise: true,
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

function customEvents(page) {
  return page.evaluate(() =>
    (window.dataLayer ?? [])
      .map((entry) => (entry && typeof entry === 'object' && typeof entry.event === 'string' ? entry.event : null))
      .filter((name) => name !== null),
  );
}

function eventPayload(page, name) {
  return page.evaluate(
    (eventName) => (window.dataLayer ?? []).find((entry) => entry && entry.event === eventName) ?? null,
    name,
  );
}

async function acceptAnalytics(page) {
  await page.waitForSelector('[data-consent-banner][data-visible="true"]', { timeout: 15000 });
  await page.click('[data-consent="allow"]');
  await page.waitForFunction(() => window.pccConsent?.granted() === true);
}

async function mockApis(page, { leadStatus = 200 } = {}) {
  const leadPayloads = [];
  await page.route('**googletagmanager.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }),
  );
  await page.route('**/api/geocode', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.action === 'suggest') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"suggestions":[]}' });
      return;
    }
    if (body.action === 'resolve') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, result: ADDRESS_RESULT }),
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{"ok":false,"error":"not_found"}' });
  });
  await page.route('**/api/travel', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        oneWayMiles: 8,
        durationMinutes: 20,
        gasPrice: 3.1,
        gasPriceSource: 'configured_reference',
        provider: 'mapmap',
        method: 'route',
        verified: true,
        zone: 'core',
      }),
    }),
  );
  await page.route('**/api/lead', (route) => {
    leadPayloads.push(route.request().postDataJSON());
    return route.fulfill({
      status: leadStatus,
      contentType: 'application/json',
      body:
        leadStatus === 200
          ? JSON.stringify({
              ok: true,
              verification: { status: 'preliminary', travel_verified: true, travel_method: 'route', config_match: 'match' },
            })
          : JSON.stringify({ ok: false, error: 'server_error' }),
    });
  });
  await page.route('**tiles.openfreemap.org/**', (route) => route.abort());
  return { leadPayloads };
}

async function openEstimate(page) {
  await page.goto(BASE + '/estimate/', { waitUntil: 'load' });
  await acceptAnalytics(page);
  await page.addStyleTag({ content: '.mobile-action-bar,.consent-banner{display:none!important}' });
  await page.click('label.option:has(input[name="serviceType"][value="standard"])');
}

async function fillAddressAndDetails(page) {
  await page.click('[data-address-manual-summary]');
  await page.fill('#est-address', '100 S Baylen St');
  await page.fill('#est-address-city', 'Pensacola');
  await page.fill('#est-zip', '32502');
  await page.click('[data-address-resolve]');
  await page.waitForSelector('[data-address-confirm]', { state: 'visible' });
  await page.click('[data-address-confirm]');
  await page.waitForSelector('[data-address-confirmed]', { state: 'visible' });

  await page.click('[data-next]'); // step 2
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
  await page.click('[data-next]'); // extras
  await page.fill('#est-date', BOOKING_DATE);
  await page.selectOption('#est-arrival', 'morning');
  await page.click('[data-next]');
  await page.fill('#est-name', 'UX test (please ignore)');
  await page.fill('#est-phone', '8500000000');
  await page.fill('#est-email', 'owner@sparkling-standard.com');
}

test('no Google script loads and no event fires before an analytics choice', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await mockApis(page);
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await delay(400);
    assert.equal(await page.locator('script[src*="googletagmanager.com"]').count(), 0, 'GTM not loaded before consent');
    assert.deepEqual(await customEvents(page), [], 'no custom event before consent');
  } finally {
    await context.close();
  }
});

test('phone and text intent events fire only after consent', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await mockApis(page);
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await acceptAnalytics(page);
    assert.equal(await page.locator('script[src*="googletagmanager.com/gtm.js"]').count(), 1, 'GTM loads once after consent');

    await page.evaluate(() => document.querySelector('a[href^="tel:"]')?.click());
    await page.waitForFunction(() => (window.dataLayer ?? []).some((entry) => entry?.event === 'call_click'));
    assert.equal(await page.locator('script[src*="googletagmanager.com/gtm.js"]').count(), 1, 'still exactly one GTM script');

    await page.evaluate(() => document.querySelector('a[href^="sms:"]')?.click());
    await page.waitForFunction(() => (window.dataLayer ?? []).some((entry) => entry?.event === 'text_click'));

    const call = await eventPayload(page, 'call_click');
    assert.ok(call.cta_slot, 'call_click carries an allowlisted cta_slot');
    const events = await customEvents(page);
    assert.ok(events.filter((name) => name === 'call_click').length === 1, 'call_click fires once per click');
  } finally {
    await context.close();
  }
});

test('the estimator emits start, step and complete events, and a delivered request emits the submit events', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await context.newPage();
  const { leadPayloads } = await mockApis(page);
  try {
    await openEstimate(page);
    await page.waitForFunction(() => (window.dataLayer ?? []).some((entry) => entry?.event === 'estimate_start'));

    await fillAddressAndDetails(page);
    await page.waitForFunction(() => (window.dataLayer ?? []).some((entry) => entry?.event === 'estimate_complete'));

    const started = await eventPayload(page, 'estimate_start');
    assert.equal(started.service_type, 'standard');
    const complete = await eventPayload(page, 'estimate_complete');
    assert.equal(complete.outcome, 'estimated');

    const steps = await page.evaluate(() =>
      (window.dataLayer ?? [])
        .filter((entry) => entry?.event === 'estimate_step')
        .map((entry) => entry.step),
    );
    assert.ok(steps.includes(1) && steps.includes(2), `step events recorded: ${steps.join(', ')}`);

    const beforeSubmit = await customEvents(page);
    assert.ok(!beforeSubmit.includes('cleaning_request_submit'), 'no submit event before the request is sent');

    await page.click('[data-submit]');
    await page.waitForFunction(() => (window.dataLayer ?? []).some((entry) => entry?.event === 'cleaning_request_submit'));

    const submitted = await eventPayload(page, 'cleaning_request_submit');
    assert.equal(submitted.journey, 'residential');
    assert.equal(submitted.service_type, 'standard');
    const booking = await eventPayload(page, 'booking_request');
    assert.ok(booking, 'a reservation with a preferred date also emits booking_request');
    assert.equal(leadPayloads.length, 1, 'exactly one request was delivered');

    const unexpectedKeys = await page.evaluate(() => {
      const allowed = new Set([
        'event',
        'service_type',
        'journey',
        'facility_type',
        'step',
        'outcome',
        'cta_slot',
        'platform',
        'gtm.start',
      ]);
      return (window.dataLayer ?? [])
        .filter((entry) => entry && typeof entry === 'object' && typeof entry.event === 'string')
        .flatMap((entry) => Object.keys(entry).filter((key) => !allowed.has(key)));
    });
    assert.deepEqual(unexpectedKeys, [], 'only allowlisted payload keys reach the data layer');
  } finally {
    await context.close();
  }
});

test('a failed submission never emits a conversion event', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await context.newPage();
  const { leadPayloads } = await mockApis(page, { leadStatus: 500 });
  try {
    await openEstimate(page);
    await fillAddressAndDetails(page);
    await page.click('[data-submit]');
    await page.waitForFunction(() => document.querySelector('[data-form-status]')?.dataset.state === 'error');
    await delay(200);

    assert.equal(leadPayloads.length, 1, 'the request was attempted');
    const events = await customEvents(page);
    assert.ok(!events.includes('cleaning_request_submit'), 'no conversion on provider failure');
    assert.ok(!events.includes('booking_request'), 'no booking request event on provider failure');
  } finally {
    await context.close();
  }
});
