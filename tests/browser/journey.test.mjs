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

const PORT = 4400;
const BASE = `http://localhost:${PORT}`;

const ADDRESS = {
  label: '100 S Baylen St, Pensacola, FL 32502',
  lat: 30.4111,
  lng: -87.2164,
  zip: '32502',
  city: 'Pensacola',
  state: 'FL',
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
        body: JSON.stringify({ ok: true, result: { ...ADDRESS, source: 'mapmap' } }),
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
  await page.addStyleTag({
    content: '.mobile-action-bar{display:none!important} .site-header{position:static!important}',
  });
  const travelRequests = await mockProviders(page, options);
  await page.goto(BASE + '/estimate/', { waitUntil: 'load' });
  return { context, page, travelRequests };
}

const isVisible = (page, selector) => page.locator(selector).isVisible();

async function step1(page) {
  await page.click('label.option:has(input[name="serviceType"][value="standard"])');
  await page.click('[data-next]');
}

async function addressStep(page, { manual = false } = {}) {
  if (manual) {
    await page.fill('#est-address', '100 S Baylen St');
    await page.click('[data-address-manual]');
    await page.click('[data-address-resolve]');
  } else {
    await page.fill('#est-address', '100 S Baylen');
    await page.waitForSelector('#est-address-suggestions li', { state: 'visible' });
    await page.click('#est-address-suggestions li');
  }
  await page.waitForSelector('[data-address-confirm]', { state: 'visible' });
  // ZIP must never be silently invented by the browser when the provider has
  // one: the resolved ZIP fills the required field.
  await page.waitForFunction(() => document.querySelector('#est-zip')?.value === '32502');
  await page.click('[data-address-confirm]');
  await page.waitForSelector('[data-address-confirmed]', { state: 'visible' });
  await page.click('[data-next]');
}

async function zipOnlyAddressStep(page, zip = '32503') {
  await page.fill('#est-zip', zip);
  await page.click('[data-next]');
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
  // One-time standard cleans use the $50/labor-hour category, which keeps the
  // expected test prices explicit; recurring rates are covered by unit tests.
  await page.selectOption('#est-frequency', 'one_time');
  await page.click('label.option:has(input[name="condition"][value="maintained"])');
  await page.selectOption('#est-last-clean', 'within_month');
  await page.selectOption('#est-pets', 'none');
  await page.click('[data-next]');
}

async function extrasStep(page, addons = []) {
  for (const id of addons) {
    // Click the styled label (the visible option), not the hidden input.
    await page.click(`label.option:has(input[name="addons"][value="${id}"])`);
  }
  await page.click('[data-next]');
}

async function timingStep(page) {
  await page.fill('#est-date', '2026-12-01');
  await page.selectOption('#est-arrival', 'morning');
  await page.click('[data-next]');
}

async function contactFields(page) {
  await page.fill('#est-name', 'Browser journey (please ignore)');
  await page.fill('#est-phone', '8500000000');
  await page.fill('#est-email', 'owner@sparkling-standard.com');
}

// ── Address autocomplete + confirmation ──────────────────────────────────────

test('address autocomplete: debounced suggestions resolve and confirm a destination', async () => {
  const { context, page } = await openEstimate(1440, 900);
  try {
    await step1(page);
    await page.fill('#est-address', '100 S Baylen');
    await page.waitForSelector('#est-address-suggestions li', { state: 'visible' });
    const suggestion = (await page.locator('#est-address-suggestions li').first().textContent())?.trim();
    assert.equal(suggestion, ADDRESS.label);

    await page.click('#est-address-suggestions li');
    await page.waitForSelector('[data-address-confirm]', { state: 'visible' });
    assert.equal(await isVisible(page, '[data-address-map]'), true, 'map confirmation card appears');
    assert.equal(
      await isVisible(page, '[data-address-confirmed]'),
      false,
      'nothing is confirmed before the customer confirms',
    );

    await page.click('[data-address-confirm]');
    await page.waitForSelector('[data-address-confirmed]', { state: 'visible' });
    const label = (await page.locator('[data-address-confirmed-label]').textContent())?.trim() ?? '';
    assert.match(label, /100 S Baylen St/, 'confirmed label shown');
    assert.doesNotMatch(label, /32502, FL 32502|Pensacola, FL 32502 · Pensacola/, 'region is not duplicated');
    assert.equal(
      await page.locator('[data-address-finder]').getAttribute('data-state'),
      'confirmed',
    );
    assert.equal(await page.inputValue('#est-zip'), '32502', 'provider ZIP fills the coverage field');
    await shot(page, '01-address-confirmed-desktop');
  } finally {
    await context.close();
  }
});

test('manual address entry works when suggestions are not used', async () => {
  const { context, page } = await openEstimate(1440, 900);
  try {
    await step1(page);
    await page.click('[data-address-manual]');
    assert.equal(await isVisible(page, '[data-address-manual-panel]'), true);
    await page.fill('#est-address', '100 S Baylen St');
    await page.click('[data-address-resolve]');
    await page.waitForSelector('[data-address-confirm]', { state: 'visible' });
    await page.click('[data-address-confirm]');
    await page.waitForSelector('[data-address-confirmed]', { state: 'visible' });
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
    await page.waitForSelector('[data-address-confirm]', { state: 'visible' });
    await page.click('[data-address-confirm]');
    await page.waitForSelector('[data-address-confirmed]', { state: 'visible' });
    assert.equal(await page.inputValue('#est-zip'), '32502');
  } finally {
    await context.close();
  }
});

test('confirmed coordinates — not a ZIP centroid — reach the routing lookup', async () => {
  const { context, page, travelRequests } = await openEstimate(1440, 900);
  try {
    await step1(page);
    await page.fill('#est-address', '100 S Baylen');
    await page.waitForSelector('#est-address-suggestions li', { state: 'visible' });
    await page.click('#est-address-suggestions li');
    await page.waitForSelector('[data-address-confirm]', { state: 'visible' });
    await page.click('[data-address-confirm]');
    await page.waitForSelector('[data-address-confirmed]', { state: 'visible' });
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

test('the proposed price calculates correctly and extras change it', async () => {
  const { context, page } = await openEstimate(1440, 900);
  try {
    await step1(page);
    await addressStep(page);
    await homeStep(page);
    await conditionStep(page);
    // Baseline: 4.91 labor-hours × $50 = $245.50 → rounded up to $250.
    await page.waitForSelector('[data-estimate-price]:not(:empty)');
    await page.waitForFunction(
      () => document.querySelector('[data-estimate-price]')?.textContent === '$250',
      undefined,
      { timeout: 10000 },
    );
    assert.match(
      (await page.locator('[data-estimate-travel]').textContent()) ?? '',
      /Travel verified/,
      'verified travel is labeled',
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, '02-price-desktop');

    // Inside oven adds 0.6 labor-hours → $275.50 → $280.
    await extrasStep(page, ['inside_oven']);
    await page.waitForFunction(
      () => document.querySelector('[data-estimate-price]')?.textContent === '$280',
      undefined,
      { timeout: 10000 },
    );
  } finally {
    await context.close();
  }
});

test('a routing failure degrades to an honest preliminary estimate', async () => {
  const { context, page } = await openEstimate(1440, 900, { travelFails: true });
  try {
    await step1(page);
    await zipOnlyAddressStep(page);
    await homeStep(page);
    await conditionStep(page);
    await page.waitForSelector('[data-estimate-price]:not(:empty)');
    const price = (await page.locator('[data-estimate-price]').textContent()) ?? '';
    assert.match(price, /^\$\d+/, 'the price still appears from zone travel math');
    const travel = (await page.locator('[data-estimate-travel]').textContent()) ?? '';
    assert.match(travel, /preliminary/i, 'travel is labeled preliminary');
    assert.doesNotMatch(travel, /Travel verified/i, 'never claims verified travel');
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
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
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
    assert.match(summaryText, /Standard/);
    assert.match(summaryText, /One-time/);
    assert.match(summaryText, /1,600 sqft/);
    assert.match(summaryText, /Inside oven/);
    assert.match(summaryText, /100 S Baylen St/);
    assert.match(summaryText, /Verified route/);

    const reference = (await page.locator('[data-reservation-reference]').textContent()) ?? '';
    assert.match(reference, /Quote reference SS-\d{8}-[0-9A-Z]{6}/);

    // Call and text actions are real, correctly formed links.
    const callHref = await page.locator('[data-reserve-call]').getAttribute('href');
    assert.equal(callHref, 'tel:+18502468479');
    const textHref = await page.locator('[data-reserve-text]').getAttribute('href');
    assert.match(textHref ?? '', /^sms:\+18502468479\?&body=/);
    assert.match(decodeURIComponent(textHref ?? ''), /SS-\d{8}-[0-9A-Z]{6}/, 'text prefill carries the quote reference');

    // One primary action: the reservation submit.
    const submitLabel = (await page.locator('[data-submit]').textContent())?.trim();
    assert.match(submitLabel ?? '', /Reserve This Cleaning/);

    await contactFields(page);
    await page.click('[data-submit]');
    await page.waitForFunction(() => document.querySelector('[data-form-status]')?.dataset.state === 'success');
    await delay(150);

    assert.ok(captured.payload, 'the reservation request was sent');
    const fields = captured.payload.fields;
    assert.equal(captured.payload.subject.includes('Reservation request'), true, 'subject marks a reservation');
    assert.equal(fields.request_type, 'reservation_request');
    assert.equal(fields.quoted_price, '280');
    assert.match(fields.quote_reference, /^SS-\d{8}-[0-9A-Z]{6}$/);
    assert.equal(fields.quote_config_version, '2026-10-01.option-c.v1');
    assert.equal(fields.service_address, '100 S Baylen St');
    assert.equal(fields.address_unit, '');
    assert.equal(fields.address_confirmed, 'yes');
    assert.equal(fields.pin_latitude, '30.411100');
    assert.equal(fields.pin_longitude, '-87.216400');
    assert.equal(fields.pin_source, 'mapmap');
    assert.equal(fields.addon_ids, 'inside_oven');
    assert.equal(fields.preferred_date, '2026-12-01');
    assert.equal(fields.arrival_preference, 'morning');
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
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
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

    await page.click('[data-submit]');
    await page.waitForFunction(() => document.querySelector('[data-form-status]')?.dataset.state === 'success');
    await delay(150);
    assert.equal(captured.payload.fields.quoted_price, '250', 'the real calculated price is submitted');
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
    await page.waitForSelector('[data-address-confirm]', { state: 'visible' });
    assert.ok((await overflow()) <= 1, 'no overflow on the address step');
    await page.click('[data-address-confirm]');
    await page.waitForSelector('[data-address-confirmed]', { state: 'visible' });
    await shot(page, '04-address-confirmed-mobile');
    await page.click('[data-next]');
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
