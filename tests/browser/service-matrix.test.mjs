// Service-specific wizard journeys (owner-directed estimator audit,
// 2026-10-23). Every cleaning type walks its relevant questions only:
// move-in/move-out, deep cleaning and STR turnovers are ONE-TIME services —
// the frequency question never appears and the submitted payload always
// carries one_time — while residential house cleaning offers the full rhythm
// matrix. Switching services mid-wizard must clear stale values.
//
// Run with: npm run test:browser

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { checkEstimateTerms } from './terms-ready.mjs';

const PORT = 4417;
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
  server.kill();
});

const ADDRESS = {
  label: '100 S Baylen St, Pensacola, FL 32502',
  lat: 30.4111,
  lng: -87.2164,
};

async function mockProviders(page) {
  await page.route('**/api/geocode', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.action === 'suggest') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          suggestions: [{ id: 'osm:w73681389:addr', label: ADDRESS.label, lat: ADDRESS.lat, lng: ADDRESS.lng }],
        }),
      });
      return;
    }
    if (body.action === 'resolve-id' || body.action === 'resolve') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          result: { ...ADDRESS, zip: '32502', city: 'Pensacola', state: 'FL', source: 'mapmap', precise: true },
        }),
      });
      return;
    }
    await route.fulfill({ status: 400, contentType: 'application/json', body: '{"ok":false}' });
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
  await page.route('**tiles.openfreemap.org/**', (route) => route.abort());
}

async function openEstimate(width, height, path = '/estimate/residential/') {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await mockProviders(page);
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
  await page.goto(BASE + path, { waitUntil: 'load' });
  if (path.startsWith('/estimate/?')) {
    await page.waitForURL(/\/estimate\/(residential|str)\//);
  }
  await page.addStyleTag({ content: '.mobile-action-bar,.consent-banner{display:none!important}' });
  return { context, page, captured };
}

async function addressAndHome(page, { service = 'standard', beds } = {}) {
  const bookingDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  await page.fill('#est-date', bookingDate);
  await page.waitForSelector('[data-calendar-period]', { state: 'visible' });
  await page.click('[data-period="first"]');
  await page.locator('[data-address-card]').waitFor({ state: 'visible' });
  await page.fill('#est-address', '100 S Baylen');
  await page.waitForSelector('#est-address-suggestions li', { state: 'visible' });
  await page.click('#est-address-suggestions li');
  await page.waitForFunction(() => document.querySelector('#est-zip')?.value === '32502');
  await page.fill('#est-address-city', 'Pensacola');
  await page.locator('[data-address-map]').waitFor({ state: 'visible' });
  await page.locator('[data-address-confirm]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-address-finder]')?.getAttribute('data-state') === 'confirmed',
  );
  await page.click('[data-next]');
  await page.waitForFunction(
    () => document.querySelector('.wizard__step[data-step="2"]')?.getAttribute('data-active') === 'true',
  );
  const serviceFieldset = page.locator('[data-service-fieldset]');
  if (await serviceFieldset.isVisible()) {
    await page.click(`label.option:has(input[name="serviceType"][value="${service}"])`);
  }
  await page.selectOption('#est-property', service === 'str_turnover' ? 'condo' : 'house');
  await page.fill('#est-sqft', service === 'str_turnover' ? '900' : '1600');
  await page.fill('#est-bedrooms', service === 'str_turnover' ? '2' : '3');
  await page.fill('#est-full-baths', service === 'str_turnover' ? '1' : '2');
  await page.fill('#est-half-baths', '0');
  if (beds !== undefined) {
    const bedsInput = page.locator('input[name="beds"]');
    if (await bedsInput.isVisible()) await bedsInput.fill(String(beds));
  }
  await page.click('[data-next]');
}

async function finishAndSubmit(page, captured, { deepAck = false } = {}) {
  await page.click('label.option:has(input[name="condition"][value="maintained"])');
  await page.selectOption('#est-last-clean', 'within_month');
  await page.selectOption('#est-pets', 'none');
  if (deepAck) {
    await page.waitForSelector('input[name="initialDeepCleanAcknowledged"]', { state: 'visible' });
    await page.check('input[name="initialDeepCleanAcknowledged"]');
  }
  await page.click('[data-next]'); // your details
  await page.fill('#est-name', 'Service matrix test (please ignore)');
  await page.fill('#est-phone', '8500000000');
  await page.fill('#est-email', 'owner@sparkling-standard.com');
  await page.click('[data-next]'); // extras & payment
  await page.waitForSelector('[data-reservation-summary]', { state: 'visible' });
  if (await page.locator('#est-terms').isVisible()) await checkEstimateTerms(page);
  await page.click('[data-submit]');
  await page.waitForTimeout(150);
  if (await page.locator('[data-photo-gate]').isVisible()) await page.click('[data-photo-pay-later]');
  await page.waitForFunction(() => document.querySelector('[data-form-status]')?.dataset.state === 'success', undefined, { timeout: 15000 });
  await delay(150);
  return captured.payload?.fields ?? {};
}

test('move-in/move-out: the frequency question never appears and the quote is one-time', async () => {
  const { context, page, captured } = await openEstimate(1440, 900);
  try {
    await addressAndHome(page, { service: 'move_in_out' });

    // Step 3: the frequency field is HIDDEN for a one-time service.
    const frequencyField = page.locator('[data-frequency-field]');
    assert.equal(await frequencyField.isHidden(), true, 'no rhythm question for a move');
    assert.equal(
      await page.locator('[data-recurring-deep]').isHidden(),
      true,
      'no deep-first notice for a move',
    );

    const fields = await finishAndSubmit(page, captured);
    assert.equal(fields.service_type, 'move_in_out');
    assert.equal(fields.frequency, 'one_time', 'the payload carries one_time, never a weekly rhythm');
    const summaryText = (await page.locator('[data-reservation-scope]').textContent()) ?? '';
    assert.match(summaryText, /Move-in and move-out cleaning/, 'the summary names the move service');
    assert.match(summaryText, /One-time/, 'the summary shows One-time');
    assert.doesNotMatch(summaryText, /Weekly|Every two weeks/, 'no recurring rhythm anywhere in the summary');
    assert.equal(fields.request_type, 'reservation_request');
  } finally {
    await context.close();
  }
});

test('deep cleaning is one-time: no rhythm question, one_time in the payload', async () => {
  const { context, page, captured } = await openEstimate(1440, 900);
  try {
    await addressAndHome(page, { service: 'deep' });
    assert.equal(await page.locator('[data-frequency-field]').isHidden(), true, 'no rhythm question for deep cleaning');
    const fields = await finishAndSubmit(page, captured);
    assert.equal(fields.service_type, 'deep');
    assert.equal(fields.frequency, 'one_time');
  } finally {
    await context.close();
  }
});

test('STR turnover: beds are asked, the rhythm is not, and the payload is per-turnover', async () => {
  const { context, page, captured } = await openEstimate(1440, 900, '/estimate/str/');
  try {
    await page.waitForFunction(() => document.querySelector('[data-engine-note]')?.hidden === false);
    await addressAndHome(page, { service: 'str_turnover', beds: 4 });
    assert.equal(await page.locator('[data-frequency-field]').isHidden(), true, 'no rhythm question for a turnover');
    const fields = await finishAndSubmit(page, captured);
    assert.equal(fields.service_type, 'str_turnover');
    assert.equal(fields.frequency, 'one_time', 'a turnover request is one-time (per turnover)');
    assert.equal(fields.beds, '4', 'the bed count travels with the request');
  } finally {
    await context.close();
  }
});

test('residential recurring: the rhythm matrix drives the two-price first-visit quote', async () => {
  const { context, page, captured } = await openEstimate(1440, 900);
  try {
    await addressAndHome(page);
    // Step 3: the rhythm question IS present for residential cleaning.
    assert.equal(await page.locator('[data-frequency-field]').isVisible(), true, 'the rhythm question shows');
    await page.selectOption('#est-frequency', 'weekly');
    const fields = await finishAndSubmit(page, captured, { deepAck: true });
    assert.equal(fields.service_type, 'standard');
    assert.equal(fields.frequency, 'weekly');
    assert.equal(fields.first_visit_total, fields.quoted_price, 'first-visit total submitted as the quoted price');
    assert.ok(fields.ongoing_price_per_visit, 'ongoing per-visit price submitted');
    assert.equal(fields.ongoing_frequency, 'weekly');
    const summaryText = (await page.locator('[data-reservation-scope]').textContent()) ?? '';
    assert.match(summaryText, /First visit/, 'the first-visit row shows');
    assert.match(summaryText, /Ongoing visits/, 'the ongoing row shows');
  } finally {
    await context.close();
  }
});

test('switching services mid-wizard clears stale rhythm and STR values', async () => {
  const { context, page, captured } = await openEstimate(1440, 900);
  try {
    await addressAndHome(page);
    // Choose a weekly rhythm while on residential cleaning…
    await page.selectOption('#est-frequency', 'weekly');
    await page.waitForSelector('input[name="initialDeepCleanAcknowledged"]', { state: 'visible' });
    // …then walk back to Service & Home and switch to move-in/out.
    await page.click('[data-step-jump="2"]');
    await page.click('label.option:has(input[name="serviceType"][value="move_in_out"])');
    await page.click('[data-next]'); // condition step
    // Step 3: the rhythm control is hidden AND normalized — the stale weekly
    // value must never survive into the quote or the submission.
    assert.equal(await page.locator('[data-frequency-field]').isHidden(), true, 'rhythm hidden after the switch');
    const selectValue = await page.locator('#est-frequency').inputValue();
    assert.equal(selectValue, 'one_time', 'the stale weekly rhythm was normalized to one_time');
    const deepAck = page.locator('input[name="initialDeepCleanAcknowledged"]');
    assert.equal(await deepAck.isChecked(), false, 'the deep-first acknowledgment cleared too');
    const fields = await finishAndSubmit(page, captured);
    assert.equal(fields.frequency, 'one_time', 'the submitted payload carries one_time after the switch');
    assert.equal(fields.service_type, 'move_in_out');
  } finally {
    await context.close();
  }
});

test('the legacy STR deep link opens the isolated turnover engine', async () => {
  const { context, page } = await openEstimate(1440, 900, '/estimate/?service=str_turnover');
  try {
    await page.waitForFunction(() => document.querySelector('[data-engine-note]')?.hidden === false);
    assert.equal(
      await page.locator('input[name="serviceType"][value="str_turnover"]').isChecked(),
      true,
      'the turnover engine is selected',
    );
    assert.equal(await page.locator('[data-service-fieldset]').isVisible(), false, 'no duplicate service picker');
    const headings = await page.locator('[data-step-title]').allTextContents();
    assert.equal(headings[0].trim(), 'When & Where');
    // Residential pages never offer or submit stale STR details.
    await page.goto(BASE + '/estimate/?service=deep', { waitUntil: 'load' });
    await page.waitForURL(/\/estimate\/residential\//);
    await page.waitForFunction(() => document.querySelector('[data-engine-note]')?.hidden === true);
    assert.equal(await page.locator('input[name="beds"]').inputValue(), '');
    assert.equal(
      await page.locator('#est-rental-properties').evaluate((el) => el.closest('[data-str-only]').hidden),
      true,
      'turnover fields are hidden for residential cleaning',
    );
  } finally {
    await context.close();
  }
});

test('commercial cleaning routes into the dedicated facility estimate engine', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(BASE + '/commercial-cleaning/', { waitUntil: 'load' });
    await page.addStyleTag({ content: '.consent-banner{display:none!important}' });
    // One authoritative request path: no duplicate embedded form.
    assert.equal(
      await page.locator('[data-lead-form][data-variant="commercial"]').count(),
      0,
      'no duplicate commercial form',
    );
    const cta = page.locator('a[href="/estimate/commercial/"]').first();
    assert.equal((await cta.count()) >= 1, true, 'the facility estimate CTA renders');
  } finally {
    await context.close();
  }
});
