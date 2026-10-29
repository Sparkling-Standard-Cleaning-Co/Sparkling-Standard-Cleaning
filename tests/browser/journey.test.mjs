// Browser tests — the COMPLETE customer journey:
// street address → map confirmation → cleaning details → proposed price →
// reservation request / call / text.
//
// Every provider response is mocked via page.route; no external service or
// API key is contacted. Runs on :4400 alongside wizard.test.mjs (:4399).
//
// Run with: npm run test:browser

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { pricing, pricingValue } from '../../src/config/pricing.ts';
import { calculateEstimate } from '../../src/lib/estimate/calculate.ts';
import { selectInstantAmount } from '../../src/lib/estimate/quote.ts';
import { resolveAddonCharge } from '../../src/lib/estimate/addons.ts';
import { formatUsd } from '../../src/lib/format.ts';

const PORT = 4400;
const BASE = `http://localhost:${PORT}`;
// Dynamic booking date: the 60-day advance window makes fixed dates stale.
const BOOKING_DATE = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

const ADDRESS = {
  label: '100 S Baylen St, Pensacola, FL 32502',
  lat: 30.4111,
  lng: -87.2164,
  zip: '32502',
  city: 'Pensacola',
  state: 'FL',
};

const routeContext = {
  travel: {
    routed: {
      oneWayMiles: 15,
      durationMinutes: 30,
      gasPrice: 3.1,
      gasPriceSource: 'configured_reference',
      provider: 'mapmap',
      method: 'route',
      verified: true,
    },
    includedOneWayMiles: pricingValue(pricing.travel.includedOneWayMiles),
    mpg: pricingValue(pricing.travel.clientDefaults.mpg),
    wearPerMile: pricingValue(pricing.travel.perMileWearCost),
    referenceGasPrice: pricingValue(pricing.travel.fallbackGasPrice),
    zoneAdjustments: {
      core: 0,
      surrounding: pricingValue(pricing.travel.zoneAdjustments.surrounding),
    },
    maxInstantDistanceMiles: pricingValue(pricing.travel.clientDefaults.maxInstantDistanceMiles),
    maxDrivingMinutes: pricingValue(pricing.drivingPolicy.maxDrivingMinutes),
    reviewBandMinutes: pricingValue(pricing.drivingPolicy.reviewBandMinutes),
  },
};

const residentialInput = (overrides = {}) => ({
  serviceType: 'standard',
  propertyType: 'house',
  squareFeet: 1600,
  bedrooms: 3,
  fullBaths: 2,
  halfBaths: 0,
  frequency: 'one_time',
  condition: 'maintained',
  lastClean: 'within_month',
  addonIds: [],
  zip: '32502',
  pets: 'none',
  ...overrides,
});

function expectedResidentialPrice(overrides = {}) {
  const amount = selectInstantAmount(calculateEstimate(residentialInput(overrides), routeContext));
  assert.ok(amount !== null);
  return amount;
}

function addonCharge(id, rate) {
  const addon = pricing.addons.items.find((item) => item.id === id);
  assert.ok(addon, `${id} must exist`);
  return resolveAddonCharge(addon, rate, pricing.residentialExtras.priceFactor.value);
}

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

const screenshotDir = process.env.PCC_SCREENSHOT_DIR;
async function shot(page, name) {
  if (!screenshotDir) return;
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, `${name}.png`), fullPage: false });
}

async function mockProviders(page, options = {}) {
  const travelRequests = [];
  await page.route('**/api/geocode', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.action === 'suggest') {
      await delay(30); // simulate a real debounced provider round-trip
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          // MapMap suggestions carry name/context/lat/lon; the client plots
          // them directly and enriches via resolve. Gateways without embedded
          // coordinates are covered by a dedicated id-only test.
          suggestions: [
            options.suggestCoords === false
              ? { id: 'us:123', label: ADDRESS.label }
              : options.exactSuggestion
                ? {
                    id: 'osm:w73681389:addr',
                    kind: 'address',
                    label: '100 S Baylen St, Pensacola, FL 32502',
                    lat: ADDRESS.lat,
                    lng: ADDRESS.lng,
                  }
                : { id: 'osm:w73681389:addr', label: ADDRESS.label, lat: ADDRESS.lat, lng: ADDRESS.lng },
          ],
        }),
      });
      return;
    }
    if (body.action === 'resolve-id' || body.action === 'resolve') {
      await delay(30);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, result: { ...ADDRESS, source: 'mapmap', precise: true } }),
      });
      return;
    }
    await route.fulfill({ status: 400, contentType: 'application/json', body: '{"ok":false}' });
  });
  await page.route('**/api/travel', async (route) => {
    travelRequests.push(JSON.parse(route.request().postData() ?? '{}'));
    if (options.travelFails) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"error":"origin_not_configured"}' });
      return;
    }
    await route.fulfill({
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
    });
  });
  await page.route('**tiles.openfreemap.org/**', (route) => route.abort());
  return travelRequests;
}

async function openEstimate(width, height, options = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const travelRequests = await mockProviders(page, options);
  await page.goto(BASE + '/estimate/residential/', { waitUntil: 'load' });
  await page.addStyleTag({ content: '.mobile-action-bar,.consent-banner{display:none!important}' });
  return { context, page, travelRequests };
}

const isVisible = (page, selector) => page.locator(selector).isVisible();

async function step1(page) {
  await page.fill('#est-date', BOOKING_DATE);
  await page.waitForSelector('[data-calendar-period]', { state: 'visible' });
  await page.click('[data-period="first"]');
  await page.locator('[data-address-card]').waitFor({ state: 'visible' });
}

async function confirmMapIfShown(page) {
  const map = page.locator('[data-address-map]');
  if (!(await map.isVisible())) {
    const resolve = page.locator('[data-address-resolve]');
    if (await resolve.isVisible().catch(() => false)) {
      await resolve.click();
    }
    await map.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  }
  if (await map.isVisible()) {
    await page.locator('[data-address-confirm]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-address-finder]')?.getAttribute('data-state') === 'confirmed',
    );
  }
}

async function addressStep(page, { manual = false } = {}) {
  if (!manual && !(await page.inputValue('#est-zip'))) {
    if (!(await page.inputValue('#est-address'))) {
      await page.fill('#est-address', '100 S Baylen');
    }
    await page.waitForSelector('#est-address-suggestions li', { state: 'visible' });
    await page.click('#est-address-suggestions li');
  }
  if (manual) {
    if (!(await page.inputValue('#est-address'))) {
      await page.fill('#est-address', '100 S Baylen St');
    }
    if (!(await page.inputValue('#est-address-city'))) {
      await page.fill('#est-address-city', 'Pensacola');
    }
    if (!(await page.inputValue('#est-zip'))) {
      await page.fill('#est-zip', '32502');
    }
  } else {
    await page.waitForFunction(() => (document.querySelector('#est-zip')?.value ?? '').length >= 5);
    if (!(await page.inputValue('#est-address-city'))) {
      await page.fill('#est-address-city', 'Pensacola');
    }
  }
  await confirmMapIfShown(page);
  await page.click('[data-next]');
  await page.waitForFunction(
    () => document.querySelector('.wizard__step[data-step="2"]')?.getAttribute('data-active') === 'true',
  );
  await page.click('label.option:has(input[name="serviceType"][value="standard"])');
}

async function zipOnlyAddressStep(page, zip = '32503') {
  if (!(await page.inputValue('#est-address'))) {
    await page.fill('#est-address', '100 S Baylen St');
  }
  await page.fill('#est-address-city', 'Pensacola');
  await page.fill('#est-zip', zip);
  await confirmMapIfShown(page);
  await page.click('[data-next]');
  await page.waitForFunction(
    () => document.querySelector('.wizard__step[data-step="2"]')?.getAttribute('data-active') === 'true',
  );
  await page.click('label.option:has(input[name="serviceType"][value="standard"])');
}

async function homeStep(page) {
  await page.selectOption('#est-property', 'house');
  await page.fill('#est-sqft', '1600');
  await page.fill('#est-bedrooms', '3');
  await page.fill('#est-full-baths', '2');
  await page.fill('#est-half-baths', '0');
  await page.click('[data-next]');
}

async function conditionStep(page) {
  // Expected prices are derived from the current pricing configuration in the
  // price assertions; no owner value is hard-coded here.
  await page.selectOption('#est-frequency', 'one_time');
  await page.click('label.option:has(input[name="condition"][value="maintained"])');
  await page.selectOption('#est-last-clean', 'within_month');
  await page.selectOption('#est-pets', 'none');
  await page.click('[data-next]');
}

async function submitForm(page) {
  await page.click('[data-submit]');
  await page.waitForTimeout(150);
  if (await page.locator('[data-photo-gate]').isVisible()) {
    await page.click('[data-photo-pay-later]');
  }
}
async function contactFields(page) {
  if (await page.locator('#est-name').isVisible()) {
    await page.fill('#est-name', 'Browser journey (please ignore)');
  }
  if (await page.locator('#est-phone').isVisible()) {
    await page.fill('#est-phone', '8500000000');
  }
  if (await page.locator('#est-email').isVisible()) {
    await page.fill('#est-email', 'owner@sparkling-standard.com');
  }
  if (await page.locator('#est-terms').isVisible()) {
    await page.check('#est-terms', { force: true });
  }
}

async function timingStep(page) {
  await contactFields(page);
  if (await page.locator('[data-next]').isVisible()) {
    await page.click('[data-next]');
  }
  await page.waitForFunction(
    () => document.querySelector('.wizard__step[data-step="5"]')?.getAttribute('data-active') === 'true',
  );
}

async function extrasStep(page, addons = []) {
  const firstAddon = addons[0] ?? 'inside_oven';
  if (!(await page.locator(`label.option:has(input[name="addons"][value="${firstAddon}"])`).isVisible())) {
    await timingStep(page);
  }
  for (const id of addons) {
    // Click the styled label (the visible option), not the hidden input.
    await page.click(`label.option:has(input[name="addons"][value="${id}"])`);
  }
}

// ── Address autocomplete + confirmation ──────────────────────────────────────

test('address autocomplete: debounced suggestions resolve and confirm a destination', async () => {
  const { context, page } = await openEstimate(1440, 900);
  try {
    await step1(page);
    await page.fill('#est-address', '100 S Baylen');
    await page.waitForSelector('#est-address-suggestions li', { state: 'visible' });
    const suggestion = (await page.locator('#est-address-suggestions li').first().textContent())?.trim();
    assert.match(suggestion ?? '', /100 S Baylen St, Pensacola, FL 32502/);

    await page.click('#est-address-suggestions li');
    await page.locator('[data-address-map]').waitFor({ state: 'visible' });
    await page.locator('[data-address-confirm]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-address-finder]')?.getAttribute('data-state') === 'confirmed',
    );
    assert.equal(await page.locator('[data-address-map]').count(), 1, 'map confirmation is restored');
    assert.equal(await page.locator('[data-address-confirm]').count(), 1);
    assert.equal(
      await page.locator('[data-address-finder]').getAttribute('data-state'),
      'confirmed',
    );
    assert.match(await page.inputValue('#est-address'), /100 S Baylen/);
    assert.equal(await page.inputValue('#est-zip'), '32502', 'provider ZIP fills the coverage field');
    await shot(page, '01-address-confirmed-desktop');
  } finally {
    await context.close();
  }
});

test('an exact provider suggestion fills the required ZIP and advances', async () => {
  // Regression: exact suggestions with embedded coordinates skip the resolver,
  // so the label's ZIP must fill the required field — otherwise the step is
  // blocked (and editing the ZIP afterwards invalidates the confirmed pin).
  const { context, page } = await openEstimate(1440, 900, { exactSuggestion: true });
  try {
    await step1(page);
    await page.fill('#est-address', '100 S Baylen');
    await page.waitForSelector('#est-address-suggestions li', { state: 'visible' });
    await page.click('#est-address-suggestions li');
    await confirmMapIfShown(page);
    assert.equal(
      await page.inputValue('#est-zip'),
      '32502',
      'the provider label ZIP fills the required field without invalidating the candidate',
    );
    await page.fill('#est-date', BOOKING_DATE);
    await page.click('[data-next]');
    await page.waitForFunction(
      () => document.querySelector('.wizard__step[data-step="2"]')?.getAttribute('data-active') === 'true',
    );
    assert.equal(await isVisible(page, '#est-property'), true, 'the wizard advances to Service & Home');
  } finally {
    await context.close();
  }
});

test('manual address entry works without selecting a suggestion', async () => {
  const { context, page } = await openEstimate(1440, 900);
  try {
    await step1(page);
    await page.fill('#est-address', '100 S Baylen St');
    await page.fill('#est-address-city', 'Pensacola');
    await page.fill('#est-zip', '32502');
    await confirmMapIfShown(page);
    await page.click('[data-next]');
    await page.waitForFunction(
      () => document.querySelector('.wizard__step[data-step="2"]')?.getAttribute('data-active') === 'true',
    );
    assert.equal(await page.inputValue('#est-address'), '100 S Baylen St');
    assert.equal(await page.inputValue('#est-zip'), '32502');
  } finally {
    await context.close();
  }
});

test('id-only suggestion gateways still resolve through the retrieve endpoint', async () => {
  const { context, page } = await openEstimate(1440, 900, { suggestCoords: false });
  try {
    await step1(page);
    await page.fill('#est-address', '100 S Baylen');
    await page.waitForSelector('#est-address-suggestions li', { state: 'visible' });
    await page.click('#est-address-suggestions li');
    await confirmMapIfShown(page);
    assert.equal(await page.inputValue('#est-zip'), '32502');
  } finally {
    await context.close();
  }
});

test('resolved coordinates — not a ZIP centroid — reach the routing lookup', async () => {
  const { context, page, travelRequests } = await openEstimate(1440, 900);
  try {
    await step1(page);
    await page.fill('#est-address', '100 S Baylen');
    await page.waitForSelector('#est-address-suggestions li', { state: 'visible' });
    await page.click('#est-address-suggestions li');
    await confirmMapIfShown(page);
    await page.waitForFunction(
      (requests) => requests.some((entry) => entry.lat === 30.4111 && entry.lng === -87.2164),
      travelRequests,
      { timeout: 10000 },
    );
    const confirmedRequest = travelRequests.find((entry) => entry.lat === 30.4111);
    assert.equal(confirmedRequest.zip, '32502');
    assert.equal(confirmedRequest.lat, 30.4111);
    assert.equal(confirmedRequest.lng, -87.2164);
  } finally {
    await context.close();
  }
});

// ── Price experience ─────────────────────────────────────────────────────────

test('prices stay hidden until the final step, then the reveal shows the exact proposed total', async () => {
  const { context, page } = await openEstimate(1440, 900);
  try {
    await step1(page);
    await addressStep(page);
    await homeStep(page);
    await conditionStep(page);

    // Calculation continues internally, but no dollar total is visible or
    // announced while the customer answers questions.
    assert.equal(await page.locator('[data-estimate-live]').isVisible(), false, 'no live price panel');
    assert.equal(await page.locator('[data-addon-price]').first().isVisible(), false, 'no per-add-on dollar totals before the final step');
    assert.equal(await page.locator('[data-price-preview]').count(), 0, 'no price-so-far preview');
    await extrasStep(page, ['inside_oven']);

    await timingStep(page);
    await page.waitForSelector('[data-reservation-summary]', { state: 'visible' });
    const withOven = expectedResidentialPrice({ addonIds: ['inside_oven'] });
    assert.equal(await page.locator('[data-reservation-price]').textContent(), formatUsd(withOven));
    assert.match(
      (await page.locator('[data-reservation-qualification]').textContent()) ?? '',
      /Travel-inclusive proposed price/i,
      'confirmed travel is labeled only on the final estimate',
    );
    await page.waitForFunction(() => document.querySelector('[data-estimate-reveal]')?.hidden === true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, '02-price-desktop');
  } finally {
    await context.close();
  }
});

test('a routing failure degrades to an honest preliminary estimate at the final step', async () => {
  const { context, page } = await openEstimate(1440, 900, { travelFails: true });
  try {
    await step1(page);
    await zipOnlyAddressStep(page);
    await homeStep(page);
    await conditionStep(page);
    await extrasStep(page);
    await timingStep(page);
    await page.waitForSelector('[data-reservation-summary]', { state: 'visible' });
    const price = (await page.locator('[data-reservation-price]').textContent()) ?? '';
    assert.match(price, /^\$\d+/, 'the price still appears from zone travel math');
    const qualification = (await page.locator('[data-reservation-qualification]').textContent()) ?? '';
    assert.match(qualification, /Preliminary proposed price/i, 'travel is labeled as an estimate');
    assert.doesNotMatch(qualification, /Travel-inclusive proposed price/i, 'never claims confirmed travel');
  } finally {
    await context.close();
  }
});

// ── Reservation experience ───────────────────────────────────────────────────

test('reservation summary carries every answer and the call/text actions work', async () => {
  const { context, page } = await openEstimate(1440, 900);
  const captured = {};
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
  try {
    await step1(page);
    await addressStep(page);
    await homeStep(page);
    await conditionStep(page);
    await extrasStep(page, ['inside_oven']);
    await timingStep(page);

    await page.waitForSelector('[data-reservation-summary]', { state: 'visible' });
    const summaryText = (await page.locator('[data-reservation-scope]').textContent()) ?? '';
    assert.match(summaryText, /Residential cleaning/);
    assert.match(summaryText, /One-time/);
    assert.match(summaryText, /1,600 sqft/);
    assert.match(summaryText, /Inside oven/);
    assert.match(summaryText, /100 S Baylen/);
    assert.match(summaryText, /Confirmed route/);

    const reference = (await page.locator('[data-reservation-reference]').textContent()) ?? '';
    assert.match(reference, /Estimate reference SS-\d{8}-[0-9A-Z]{6}/);
    const qualification = (await page.locator('[data-reservation-qualification]').textContent()) ?? '';
    assert.match(qualification, /Travel-inclusive proposed price/i);

    // Call and text actions are real, correctly formed links.
    const callHref = await page.locator('[data-reserve-call]').getAttribute('href');
    assert.equal(callHref, 'tel:+18504268479');
    const textHref = await page.locator('[data-reserve-text]').getAttribute('href');
    assert.match(textHref ?? '', /^sms:\+18504268479\?&body=/);
    assert.match(decodeURIComponent(textHref ?? ''), /SS-\d{8}-[0-9A-Z]{6}/, 'text prefill carries the quote reference');

    // One primary action: the reservation submit.
    const submitLabel = (await page.locator('[data-submit]').textContent())?.trim();
    assert.match(submitLabel ?? '', /Reserve This Cleaning/);

    await contactFields(page);
    await submitForm(page);
    await page.waitForFunction(() => document.querySelector('[data-form-status]')?.dataset.state === 'success');
    await delay(150);

    assert.ok(captured.payload, 'the reservation request was sent');
    const fields = captured.payload.fields;
    assert.equal(captured.payload.subject.includes('Reservation request'), true, 'subject marks a reservation');
    assert.equal(fields.request_type, 'reservation_request');
    assert.equal(fields.quoted_price, String(expectedResidentialPrice({ addonIds: ['inside_oven'] })));
    assert.match(fields.quote_reference, /^SS-\d{8}-[0-9A-Z]{6}$/);
    assert.equal(fields.quote_config_version, pricing.instantQuote.configVersion.value);
    assert.equal(fields.service_address, '100 S Baylen');
    assert.equal(fields.address_unit, '');
    assert.equal(fields.address_confirmed, 'yes');
    assert.equal(fields.pin_latitude, '30.411100');
    assert.equal(fields.pin_longitude, '-87.216400');
    assert.equal(fields.pin_source, 'mapmap');
    assert.equal(fields.addon_ids, 'inside_oven');
    assert.equal(fields.preferred_date, BOOKING_DATE);
    assert.equal(fields.travel_verified, 'true');
    assert.equal(fields.travel_qualification, 'verified_route');
    await shot(page, '03-reservation-desktop');
  } finally {
    await context.close();
  }
});

test('unit is collected separately from the street address', async () => {
  const { context, page } = await openEstimate(1440, 900);
  try {
    await step1(page);
    await page.fill('#est-address-unit', '4B');
    await addressStep(page);
    // The confirmation label includes the unit.
    // (addressStep confirms and advances; assert via the stored summary later.)
    await homeStep(page);
    await conditionStep(page);
    await extrasStep(page);
    await timingStep(page);
    const summaryText = (await page.locator('[data-reservation-scope]').textContent()) ?? '';
    assert.match(summaryText, /Unit 4B/);
  } finally {
    await context.close();
  }
});

// ── Security: client-side manipulation cannot change the price ──────────────

test('client-side price manipulation does not change the submitted price', async () => {
  const { context, page } = await openEstimate(1440, 900);
  const captured = {};
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
  try {
    await step1(page);
    await addressStep(page);
    await homeStep(page);
    await conditionStep(page);
    await extrasStep(page);
    await timingStep(page);
    await contactFields(page);

    // Tamper with the DOM price a customer could edit in devtools.
    await page.evaluate(() => {
      const price = document.querySelector('[data-estimate-price]');
      if (price) price.textContent = '$1';
      const summary = document.querySelector('[data-reservation-price]');
      if (summary) summary.textContent = '$1';
    });

    await submitForm(page);
    await page.waitForFunction(() => document.querySelector('[data-form-status]')?.dataset.state === 'success');
    await delay(150);
    assert.equal(captured.payload.fields.quoted_price, '270', 'the real calculated price is submitted');
  } finally {
    await context.close();
  }
});

// ── Honest server verdicts on the receipt ───────────────────────────────────

async function completeReservation(page) {
  await step1(page);
  await addressStep(page);
  await homeStep(page);
  await conditionStep(page);
  await extrasStep(page);
  await timingStep(page);
  await contactFields(page);
}

test('a mismatch verdict is shown honestly and never claims the price was accepted', async () => {
  const { context, page } = await openEstimate(1440, 900);
  await page.route('**/api/lead', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        verification: { status: 'mismatch', travel_verified: true, travel_method: 'route', config_match: 'match' },
      }),
    }),
  );
  try {
    await completeReservation(page);
    await submitForm(page);
    await page.waitForSelector('[data-form-status][data-state="warning"]', { timeout: 15000 });
    const text = (await page.locator('[data-form-status]').textContent()) ?? '';
    assert.match(text, /needs a personal review/i);
    assert.match(text, /confirm the correct price/i);
    assert.doesNotMatch(text, /verified this price/i);
    assert.match(page.url(), /\/estimate\/residential\/$/, 'an unverified receipt stays on screen (no redirect away)');
  } finally {
    await context.close();
  }
});

test('a preliminary verdict names the travel uncertainty', async () => {
  const { context, page } = await openEstimate(1440, 900);
  await page.route('**/api/lead', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        verification: {
          status: 'preliminary',
          travel_verified: false,
          travel_method: 'straight_line_estimate',
          config_match: 'match',
        },
      }),
    }),
  );
  try {
    await completeReservation(page);
    await submitForm(page);
    await page.waitForSelector('[data-form-status][data-state="warning"]', { timeout: 15000 });
    const text = (await page.locator('[data-form-status]').textContent()) ?? '';
    assert.match(text, /drive time still needs a final check/i);
    assert.doesNotMatch(text, /verified this price/i);
  } finally {
    await context.close();
  }
});

// ── Mobile complete journey ──────────────────────────────────────────────────

test('the complete journey works on mobile without overflow', async () => {
  const { context, page } = await openEstimate(360, 740);
  try {
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await step1(page);
    await page.fill('#est-address', '100 S Baylen');
    await page.waitForSelector('#est-address-suggestions li', { state: 'visible' });
    await page.click('#est-address-suggestions li');
    await confirmMapIfShown(page);
    assert.ok((await overflow()) <= 1, 'no overflow on the address step');
    await shot(page, '04-address-confirmed-mobile');
    await page.click('[data-next]');
    await page.waitForFunction(
      () => document.querySelector('.wizard__step[data-step="2"]')?.getAttribute('data-active') === 'true',
    );
    await page.click('label.option:has(input[name="serviceType"][value="standard"])');
    await homeStep(page);
    await conditionStep(page);
    await extrasStep(page, ['inside_fridge']);
    await timingStep(page);
    await page.waitForSelector('[data-reservation-summary]', { state: 'visible' });
    assert.ok((await overflow()) <= 1, 'no overflow on the reservation step');
    assert.match(
      (await page.locator('[data-reservation-price]').textContent()) ?? '',
      /^\$\d+/,
    );
    await shot(page, '05-reservation-mobile');
  } finally {
    await context.close();
  }
});

// ── Existing forms remain functional ─────────────────────────────────────────

test('the contact form still submits and shows an honest success state', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await page.route('**/api/lead', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await page.goto(BASE + '/contact/', { waitUntil: 'load' });
    await page.addStyleTag({ content: '.mobile-action-bar,.consent-banner{display:none!important}' });
    await page.fill('#contact-name', 'Browser test (please ignore)');
    await page.fill('#contact-phone', '8500000000');
    await page.fill('#contact-email', 'owner@sparkling-standard.com');
    await page.fill('#contact-message', 'Automated privacy-safe test message — please ignore.');
    // The form has a minimum completion-time guard.
    await delay(2600);
    await page.click('[data-variant="contact"] button[type="submit"]');
    await page.waitForSelector('[data-variant="contact"] [data-form-status][data-state="success"]', {
      timeout: 10000,
    });
  } finally {
    await context.close();
  }
});

test('the contact form validates the email and prevents double submission', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  let requests = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  try {
    await page.route('**/api/lead', async (route) => {
      requests += 1;
      await gate;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await page.goto(BASE + '/contact/', { waitUntil: 'load' });
    await page.addStyleTag({ content: '.mobile-action-bar,.consent-banner{display:none!important}' });

    // An invalid email never reaches the network — native validation blocks it.
    await page.fill('#contact-name', 'Browser test (please ignore)');
    await page.fill('#contact-phone', '8500000000');
    await page.fill('#contact-email', 'not-an-email');
    await page.fill('#contact-message', 'Automated privacy-safe test message — please ignore.');
    await delay(2600);
    await page.click('[data-variant="contact"] button[type="submit"]');
    await delay(300);
    assert.equal(requests, 0, 'an invalid email never reaches the network');
    assert.equal(
      await page.locator('[data-variant="contact"] [data-form-status][data-state="success"]').count(),
      0,
      'no success state for an invalid submission',
    );

    // Fix the email, then submit twice quickly: exactly one request is sent.
    await page.fill('#contact-email', 'owner@sparkling-standard.com');
    const submit = page.locator('[data-variant="contact"] button[type="submit"]');
    await submit.click();
    await delay(120);
    assert.equal(await submit.isDisabled(), true, 'disabled while sending');
    await submit.click({ force: true }).catch(() => {});
    await delay(300);
    assert.equal(requests, 1, 'double submission sends exactly one request');

    release();
    await page.waitForSelector('[data-variant="contact"] [data-form-status][data-state="success"]', {
      timeout: 10000,
    });
  } finally {
    await context.close();
  }
});

// ── Security: no private origin, keys or billable services in the bundle ─────

test('built client output contains no private origin, credentials or payment endpoints', () => {
  const dist = path.resolve('dist');
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|html|css|json|txt|xml|map)$/.test(entry.name)) files.push(full);
    }
  };
  walk(dist);
  assert.ok(files.length > 0, 'built output exists');

  const secretEnv = {};
  if (fs.existsSync('.env')) {
    for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) continue;
      const [, key, raw] = match;
      if (
        ['TRAVEL_ORIGIN', 'ROUTES_API_KEY', 'MAPMAP_API_KEY', 'EIA_API_KEY', 'WEB3FORMS_ACCESS_KEY', 'TURNSTILE_SECRET_KEY'].includes(
          key,
        ) &&
        raw.trim()
      ) {
        secretEnv[key] = raw.trim();
      }
    }
  }

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const relative = path.relative(dist, file);
    assert.ok(!content.includes('TRAVEL_ORIGIN'), `${relative} references TRAVEL_ORIGIN`);
    assert.ok(!content.includes('ROUTES_API_KEY'), `${relative} references ROUTES_API_KEY`);
    assert.ok(!content.includes('MAPMAP_API_KEY'), `${relative} references MAPMAP_API_KEY`);
    for (const [key, value] of Object.entries(secretEnv)) {
      assert.ok(!content.includes(value), `${relative} contains a ${key} value`);
    }
    // No new billable service can be triggered from the client bundle.
    assert.doesNotMatch(content, /api\.stripe\.com|sk_live_|sk_test_/, `${relative} references payment credentials`);
  }
});

// ── Thank-you page: the single-use request summary ──────────────────────────

test('the thank-you page shows the single-use request summary exactly once', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    // Without a stored summary (direct visit) the card stays hidden.
    await page.goto(BASE + '/thank-you/', { waitUntil: 'load' });
    assert.equal(await page.locator('[data-request-summary]').isVisible(), false);

    await page.evaluate(() => {
      sessionStorage.setItem(
        'pcc-request-summary',
        JSON.stringify({
          request_type: 'reservation_request',
          service_type: 'standard',
          frequency: 'biweekly',
          service_address: '100 S Baylen St',
          address_city: 'Pensacola',
          address_state: 'FL',
          zip: '32502',
          preferred_date: '2026-12-15',
          quoted_range: '$180–$220',
          quote_reference: 'SS-20261002-ABC123',
        }),
      );
    });
    await page.reload({ waitUntil: 'load' });

    const card = page.locator('[data-request-summary]');
    assert.equal(await card.isVisible(), true, 'the summary card renders from the stored receipt');
    const text = (await card.textContent()) ?? '';
    assert.match(text, /Reservation request/);
    assert.match(text, /Residential cleaning/);
    assert.match(text, /Every two weeks/);
    assert.match(text, /100 S Baylen St, Pensacola, FL 32502/);
    assert.match(text, /Tuesday, December 15, 2026/);
    assert.match(text, /Provisional estimate range/i);
    assert.match(text, /\$180–\$220/);
    assert.match(text, /SS-20261002-ABC123/);
    assert.match(text, /Final scope, pricing and availability may require confirmation/i);
    // The page still states the request-only status prominently.
    assert.match((await page.locator('h1').textContent()) ?? '', /Request received/i);
    assert.match(
      (await page.locator('.lead').first().textContent()) ?? '',
      /not a confirmed\s+booking yet/i,
    );

    // Single use: a reload no longer shows it.
    await page.reload({ waitUntil: 'load' });
    assert.equal(await page.locator('[data-request-summary]').isVisible(), false);
  } finally {
    await context.close();
  }
});
