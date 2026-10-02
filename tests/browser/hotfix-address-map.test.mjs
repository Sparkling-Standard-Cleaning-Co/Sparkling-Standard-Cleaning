// Focused hotfix tests — address lookup for house numbers MapMap does not
// contain (Molino) and an Alabama address, plus the no-silent-street rule.
//
// Run with: npm run test:browser on :4404.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4404;
const BASE = `http://localhost:${PORT}`;

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

const travelBody = JSON.stringify({
  oneWayMiles: 15,
  durationMinutes: 30,
  gasPrice: 3.1,
  gasPriceSource: 'configured_reference',
  provider: 'mapmap',
  method: 'route',
  verified: true,
  zone: 'surrounding',
});

async function openWithMocks(page, handlers) {
  const captured = { suggest: [], resolve: [], lead: null };
  await page.route('**/api/geocode', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.action === 'suggest') {
      captured.suggest.push(body);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          suggestions: handlers.suggestions,
          ...(handlers.needsLocation ? { needsLocation: true } : {}),
        }),
      });
      return;
    }
    if (body.action === 'resolve') {
      captured.resolve.push(body);
      if (handlers.resolve) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, result: handlers.resolve }) });
      } else {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'not_found' }) });
      }
      return;
    }
    await route.fulfill({ status: 400, contentType: 'application/json', body: '{"ok":false}' });
  });
  await page.route('**/api/travel', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: travelBody }),
  );
  await page.route('**/api/lead', (route) => {
    captured.lead = route.request().postDataJSON();
    const status = handlers.leadStatus ?? 'preliminary';
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        verification: { status, travel_verified: true, travel_method: 'route', config_match: 'match' },
      }),
    });
  });
  await page.route('**tiles.openfreemap.org/**', (route) => route.abort());
  await page.goto(BASE + '/estimate/', { waitUntil: 'load' });
  return captured;
}

async function completeAfterAddress(page) {
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
  await page.fill('#est-date', '2026-12-01');
  await page.selectOption('#est-arrival', 'morning');
  await page.click('[data-next]');
  await page.fill('#est-name', 'Hotfix test (please ignore)');
  await page.fill('#est-phone', '8500000000');
  await page.fill('#est-email', 'owner@sparkling-standard.com');
}

test('a street-level suggestion never replaces the entered house number; the address is preserved for review', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    const captured = await openWithMocks(page, {
      // MapMap knows the street but not 6360; resolve finds no exact address.
      suggestions: [
        {
          id: 'osm:w10919246:street',
          label: 'Haupert Lane, Florida, 32577, United States',
          kind: 'street',
          lat: 30.7165,
          lng: -87.3439,
        },
      ],
      resolve: null,
    });

    await page.click('label.option:has(input[name="serviceType"][value="standard"])');
    await page.fill('#est-address', '6360 Haupert Lane');
    await page.fill('#est-address-city', 'Molino');
    await page.selectOption('#est-address-state', 'FL');
    await page.fill('#est-zip', '32577');
    await page.waitForSelector('#est-address-suggestions li', { state: 'visible' });

    // Autocomplete is built from all entered information.
    const lastSuggest = captured.suggest.at(-1);
    assert.match(lastSuggest.query, /6360 Haupert Lane/);
    assert.match(lastSuggest.query, /Molino/);
    assert.match(lastSuggest.query, /FL/);
    assert.match(lastSuggest.query, /32577/);

    await page.click('#est-address-suggestions li');
    await page.waitForSelector('[data-address-finder][data-state="unresolved"]', { timeout: 10000 });
    assert.equal(await page.locator('[data-address-confirm]').isVisible(), false, 'no precise pin was offered');
    const status = (await page.locator('[data-address-status]').textContent()) ?? '';
    assert.match(status, /saved for our review|pinpoint/i, `manual-review status: "${status}"`);

    // The customer's original address is preserved.
    assert.equal(await page.inputValue('#est-address'), '6360 Haupert Lane');
    assert.equal(await page.inputValue('#est-address-city'), 'Molino');
    assert.equal(await page.inputValue('#est-address-state'), 'FL');
    assert.equal(await page.inputValue('#est-zip'), '32577');

    await completeAfterAddress(page);
    // Travel stays preliminary without a confirmed destination.
    const travel = (await page.locator('[data-estimate-travel]').textContent()) ?? '';
    assert.match(travel, /Travel estimate/i);
    assert.doesNotMatch(travel, /Travel confirmed/i);

    await page.click('[data-submit]');
    await page.waitForFunction(() => document.querySelector('[data-form-status]')?.dataset.state === 'warning');
    assert.ok(captured.lead, 'request sent');
    const fields = captured.lead.fields;
    assert.equal(fields.address_confirmed, 'no');
    assert.equal(fields.service_address, '6360 Haupert Lane');
    assert.equal(fields.address_city, 'Molino');
    assert.equal(fields.address_state, 'FL');
    assert.equal(fields.zip, '32577');
    assert.equal(fields.pin_latitude, undefined, 'no pin coordinates are submitted');
  } finally {
    await context.close();
  }
});

test('an exact Census result (Alabama) confirms the destination and carries city/state into the request', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    const captured = await openWithMocks(page, {
      suggestions: [
        {
          id: 'osm:w556142699:addr',
          label: '201 E Louisville Ave, Atmore, Alabama, 36502, United States',
          kind: 'address',
          lat: 31.0238,
          lng: -87.4939,
        },
      ],
      resolve: {
        label: '201 E LOUISVILLE AVE, ATMORE, AL, 36502',
        lat: 31.0238,
        lng: -87.4939,
        zip: '36502',
        city: 'ATMORE',
        state: 'AL',
        source: 'census',
        precise: true,
      },
      leadStatus: 'verified',
    });

    await page.click('label.option:has(input[name="serviceType"][value="standard"])');
    await page.fill('#est-address', '201 E Louisville Ave');
    await page.fill('#est-address-city', 'Atmore');
    await page.selectOption('#est-address-state', 'AL');
    await page.fill('#est-zip', '36502');
    await page.waitForSelector('#est-address-suggestions li', { state: 'visible' });
    await page.click('#est-address-suggestions li');
    await page.waitForSelector('[data-address-confirm]', { state: 'visible' }, { timeout: 10000 });
    await page.click('[data-address-confirm]');
    await page.waitForSelector('[data-address-confirmed]', { state: 'visible' });

    const label = (await page.locator('[data-address-confirmed-label]').textContent()) ?? '';
    assert.match(label, /ATMORE|Atmore/i);
    assert.match((await page.inputValue('#est-address-city')).toUpperCase(), /ATMORE/);
    assert.equal(await page.inputValue('#est-address-state'), 'AL');

    await completeAfterAddress(page);
    await page.click('[data-submit]');
    await page.waitForFunction(() => document.querySelector('[data-form-status]')?.dataset.state === 'success');
    await delay(100);
    assert.ok(captured.lead, 'request sent');
    const fields = captured.lead.fields;
    assert.equal(fields.address_confirmed, 'yes');
    assert.equal(fields.service_address, '201 E Louisville Ave');
    assert.match(fields.address_city.toUpperCase(), /ATMORE/);
    assert.equal(fields.address_state, 'AL');
    assert.equal(fields.zip, '36502');
    assert.ok(fields.pin_latitude, 'the confirmed pin travels with the request');
  } finally {
    await context.close();
  }
});

test('irrelevant provider matches prompt for a city or ZIP instead of showing nationwide results', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    const captured = await openWithMocks(page, { suggestions: [], needsLocation: true });
    await page.click('label.option:has(input[name="serviceType"][value="standard"])');
    await page.fill('#est-address', '3370 S Highway 97');
    await page.waitForFunction(
      () => /narrow the search/i.test(document.querySelector('[data-address-status]')?.textContent ?? ''),
      undefined,
      { timeout: 15000 },
    );
    assert.equal(await page.locator('#est-address-suggestions li').count(), 0, 'no suggestions remain visible');
    assert.equal(await page.locator('#est-address-suggestions').isVisible(), false);
    const last = captured.suggest.at(-1);
    assert.equal(last.state, 'FL');
    assert.match(last.street, /3370 S Highway 97/);
  } finally {
    await context.close();
  }
});

test('the map worker is configured and its failure path is honest (no page crash)', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await openWithMocks(page, {
      suggestions: [
        {
          id: 'osm:w1:addr',
          label: '100 S Baylen St, Pensacola, Florida, 32502, United States',
          kind: 'address',
          lat: 30.4111,
          lng: -87.2164,
        },
      ],
      resolve: {
        label: '100 S BAYLEN ST, PENSACOLA, FL, 32502',
        lat: 30.4111,
        lng: -87.2164,
        zip: '32502',
        city: 'PENSACOLA',
        state: 'FL',
        source: 'census',
        precise: true,
      },
    });
    await page.click('label.option:has(input[name="serviceType"][value="standard"])');
    await page.fill('#est-address', '100 S Baylen St');
    await page.fill('#est-address-city', 'Pensacola');
    await page.selectOption('#est-address-state', 'FL');
    await page.fill('#est-zip', '32502');
    await page.waitForSelector('#est-address-suggestions li', { state: 'visible' });
    await page.click('#est-address-suggestions li');
    await page.waitForSelector('[data-address-confirm]', { state: 'visible' }, { timeout: 10000 });
    // The maplibre worker asset is part of the build; the page must initialize
    // the map without an uncaught script error (tiles are blocked here).
    await delay(1500);
    assert.deepEqual(pageErrors, [], `no uncaught page errors: ${pageErrors.join(' | ')}`);
    assert.equal(await page.locator('.maplibregl-marker').count(), 1, 'map marker initialized');
  } finally {
    await context.close();
  }
});
