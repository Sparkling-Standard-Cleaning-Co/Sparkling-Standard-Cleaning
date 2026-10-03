// Attribution integration tests — the full chain from a campaign landing page
// through internal navigation to the lead payload the owner receives.
// Run with: npm run test:browser on :4409.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4409;
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

async function hideConsent(page) {
  await page.addStyleTag({ content: '.consent-banner{display:none!important}' });
}

function readAttribution(page, key) {
  return page.evaluate((storageKey) => {
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  }, key);
}

async function mockApis(page) {
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
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        verification: { status: 'preliminary', travel_verified: true, travel_method: 'route', config_match: 'match' },
      }),
    });
  });
  await page.route('**tiles.openfreemap.org/**', (route) => route.abort());
  return { leadPayloads };
}

async function completeEstimate(page) {
  await page.click('label.option:has(input[name="serviceType"][value="standard"])');
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
  await page.click('[data-submit]');
  await page.waitForFunction(() => {
    const state = document.querySelector('[data-form-status]')?.dataset.state;
    return state === 'success' || state === 'warning' || state === 'error';
  });
}

test('a Facebook campaign arrival survives navigation to the estimator and reaches the lead record', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await context.newPage();
  const { leadPayloads } = await mockApis(page);
  try {
    await page.goto(
      `${BASE}/recurring-cleaning/?utm_source=facebook&utm_medium=organic_social&utm_campaign=recurring&utm_content=feed`,
      { waitUntil: 'load' },
    );
    await hideConsent(page);
    const arrived = await readAttribution(page, 'pcc-attribution-latest');
    assert.equal(arrived.source, 'facebook');
    assert.equal(arrived.landingPage, '/recurring-cleaning/');

    // Real internal navigation through the site to the estimator.
    await page.locator('a[href="/estimate/"]').first().click();
    await page.waitForURL('**/estimate/');
    await hideConsent(page);
    const afterNav = await readAttribution(page, 'pcc-attribution-latest');
    assert.equal(afterNav.source, 'facebook', 'campaign survives internal navigation');
    assert.equal(afterNav.landingPage, '/recurring-cleaning/', 'campaign landing page is kept');
    assert.equal(afterNav.referrerOrigin, undefined, 'same-domain navigation is not a referral');

    await completeEstimate(page);
    assert.equal(leadPayloads.length, 1, 'the request was delivered');
    const fields = leadPayloads[0].fields;
    assert.equal(fields.first_utm_source, 'facebook');
    assert.equal(fields.latest_utm_source, 'facebook');
    assert.equal(fields.latest_utm_medium, 'organic_social');
    assert.equal(fields.latest_utm_campaign, 'recurring');
    assert.equal(fields.latest_utm_content, 'feed');
    assert.equal(fields.landing_page, '/recurring-cleaning/');
    assert.equal(fields.referrer_origin, undefined);
  } finally {
    await context.close();
  }
});

test('a new campaign updates latest-touch while internal and direct views preserve it', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await context.newPage();
  await mockApis(page);
  try {
    await page.goto(`${BASE}/?utm_source=facebook&utm_medium=organic_social&utm_campaign=facebook_page`, {
      waitUntil: 'load',
    });
    await page.goto(
      `${BASE}/?utm_source=nextdoor&utm_medium=organic_social&utm_campaign=neighborhood&utm_content=sponsored`,
      { waitUntil: 'load' },
    );
    const first = await readAttribution(page, 'pcc-attribution-first');
    const latest = await readAttribution(page, 'pcc-attribution-latest');
    assert.equal(first.source, 'facebook', 'first-touch is never overwritten');
    assert.equal(latest.source, 'nextdoor', 'the new campaign becomes latest-touch');
    assert.equal(latest.campaign, 'neighborhood');

    await hideConsent(page);
    await page.locator('a[href="/about/"]').first().click();
    await page.waitForURL('**/about/');
    const afterInternal = await readAttribution(page, 'pcc-attribution-latest');
    assert.equal(afterInternal.source, 'nextdoor', 'internal navigation preserves the campaign');

    await page.goto(BASE + '/contact/', { waitUntil: 'load' });
    const afterDirect = await readAttribution(page, 'pcc-attribution-latest');
    assert.equal(afterDirect.source, 'nextdoor', 'a direct view preserves the campaign');
  } finally {
    await context.close();
  }
});

test('an external referral is recorded while no campaign exists', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await context.addInitScript(() => {
    Object.defineProperty(document, 'referrer', { get: () => 'https://www.google.com/search', configurable: true });
  });
  const page = await context.newPage();
  await mockApis(page);
  try {
    await page.goto(BASE + '/house-cleaning/', { waitUntil: 'load' });
    const referral = await readAttribution(page, 'pcc-attribution-latest');
    assert.equal(referral.referrerOrigin, 'https://www.google.com');
    assert.equal(referral.landingPage, '/house-cleaning/');
    assert.equal(referral.source, undefined);
  } finally {
    await context.close();
  }
});

test('same-domain internal navigation is never recorded as a referral', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await context.newPage();
  await mockApis(page);
  try {
    await page.goto(BASE + '/house-cleaning/', { waitUntil: 'load' });
    await hideConsent(page);
    await page.locator('a[href="/about/"]').first().click();
    await page.waitForURL('**/about/');
    const latest = await readAttribution(page, 'pcc-attribution-latest');
    assert.equal(latest.referrerOrigin, undefined, 'the same-origin referrer is ignored');
    assert.equal(latest.landingPage, '/house-cleaning/', 'the entry page is kept');
  } finally {
    await context.close();
  }
});
