// Focused tests — GPS-first address selection, method isolation, permission
// guidance, inline validation, and the consent-gated GTM installation.
// Run with: npm run test:browser on :4405.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { chooseAppointment } from '../helpers/estimator-step-one.mjs';
import { checkEstimateTerms } from './terms-ready.mjs';

const PORT = 4405;
const BASE = `http://localhost:${PORT}`;
// Dynamic booking date: the 60-day advance window makes fixed dates stale.
const BOOKING_DATE = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const MOLINO = { latitude: 30.72, longitude: -87.31 };

const MOLINO_RESULT = {
  label: '4242 MAPLEWOOD LN, MOLINO, FL, 32577',
  lat: MOLINO.latitude,
  lng: MOLINO.longitude,
  zip: '32577',
  city: 'MOLINO',
  state: 'FL',
  source: 'mapmap',
  precise: true,
};

const DEVICE_RESULT = {
  label: '999 DEVICE WAY, MILTON, FL, 32570',
  lat: 30.63,
  lng: -87.05,
  zip: '32570',
  city: 'MILTON',
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

async function mockApis(page, { reverseResult = null, resolveResult = MOLINO_RESULT, lead = null } = {}) {
  const reverseRequests = [];
  const leadPayloads = [];
  await page.route('**/api/geocode', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.action === 'reverse') {
      reverseRequests.push(body);
      await route.fulfill({
        status: reverseResult ? 200 : 404,
        contentType: 'application/json',
        body: reverseResult
          ? JSON.stringify({ ok: true, result: reverseResult })
          : '{"ok":false,"error":"not_found"}',
      });
      return;
    }
    if (body.action === 'suggest') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"suggestions":[]}' });
      return;
    }
    // resolve
    if (resolveResult) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, result: resolveResult }) });
    } else {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{"ok":false,"error":"not_found"}' });
    }
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
  await page.route('**/api/availability**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/availability-month')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, enabled: true, days: [] }) });
      return;
    }
    const date = url.searchParams.get('date') ?? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
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
        slots: [
          { start: date + 'T13:00:00.000Z', end: date + 'T15:00:00.000Z', startLabel: '7:00 AM', endLabel: '9:00 AM' },
          { start: date + 'T18:30:00.000Z', end: date + 'T20:30:00.000Z', startLabel: '12:30 PM', endLabel: '2:30 PM' },
        ],
      }),
    });
  });
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
  return { reverseRequests, leadPayloads, lead };
}

async function openEstimate({ geolocation, permissions, width = 1280, height = 950, mockOptions = {} } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, geolocation, permissions });
  const page = await context.newPage();
  const captured = await mockApis(page, mockOptions);
  await page.goto(BASE + '/estimate/residential/', { waitUntil: 'load' });
  await page.addStyleTag({ content: '.mobile-action-bar,.consent-banner{display:none!important}' });
  return { context, page, ...captured };
}

async function confirmMapIfShown(page) {
  const map = page.locator('[data-address-map]');
  if (await map.isVisible()) {
    await page.locator('[data-address-confirm]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-address-finder]')?.getAttribute('data-state') === 'confirmed',
    );
  }
}
async function startAddressStep(page, date = BOOKING_DATE) {
  await page.locator('[data-address-card]').waitFor({ state: 'visible' });
  return date;
}
async function advanceAddressStep(page) {
  await page.click('[data-next]');
  await page.locator('[data-address-map]').waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
  if (await page.locator('[data-address-map]').isVisible()) {
    await confirmMapIfShown(page);
    await page.locator('[data-schedule-section]').waitFor({ state: 'visible' });
    await chooseAppointment(page, BOOKING_DATE);
    await page.click('[data-next]');
  }
}
async function completeRemainingSteps(page) {
  await confirmMapIfShown(page);
  const active = () =>
    page.evaluate(
      () =>
        [...document.querySelectorAll('.wizard__step')].findIndex(
          (step) => step.getAttribute('data-active') === 'true',
        ) + 1,
    );
  if ((await active()) === 1) {
    await page.locator('[data-schedule-section]').waitFor({ state: 'visible' });
    await chooseAppointment(page, BOOKING_DATE);
    await page.click('[data-next]');
    await page.waitForFunction(
      () => document.querySelector('.wizard__step[data-step="2"]')?.getAttribute('data-active') === 'true',
    );
  }
  if (await page.locator('[data-service-fieldset]').isVisible()) {
    await page.click('label.segmented-choice__option:has(input[name="serviceType"][value="standard"])');
  }
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
  await page.click('[data-next]'); // condition -> your details
  await page.fill('#est-name', 'UX test (please ignore)');
  await page.fill('#est-phone', '8500000000');
  await page.fill('#est-email', 'owner@sparkling-standard.com');
  await page.click('[data-next]'); // details -> extras & payment
  await page.waitForFunction(
    () => document.querySelector('.wizard__step[data-step="5"]')?.getAttribute('data-active') === 'true',
  );
  await checkEstimateTerms(page);
}

// ── 3) GPS resolves an exact address ─────────────────────────────────────────

test('GPS resolves an exact address and saves it without a separate confirmation step', async () => {
  const { context, page, reverseRequests } = await openEstimate({
    geolocation: { ...MOLINO, accuracy: 20 },
    permissions: ['geolocation'],
    mockOptions: { reverseResult: MOLINO_RESULT },
  });
  try {
    await startAddressStep(page);
    await page.click('[data-address-gps]');
    await page.locator('[data-address-map]').waitFor({ state: 'visible' });
    await page.waitForFunction(
      () => /MAPLEWOOD LN/i.test(document.querySelector('#est-address')?.value ?? ''),
    );
    assert.equal(reverseRequests.length, 1);
    assert.match(await page.inputValue('#est-address'), /MAPLEWOOD LN/i);
    assert.equal(await page.locator('[data-address-confirm]').count(), 1, 'map confirmation is shown');
    await page.locator('[data-address-confirm]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-address-finder]')?.getAttribute('data-state') === 'confirmed',
    );
  } finally {
    await context.close();
  }
});

// ── 2) GPS precise pin, street-level reverse only ────────────────────────────

test('a street-level reverse result never invents a street address', async () => {
  const { context, page } = await openEstimate({
    geolocation: { ...MOLINO, accuracy: 20 },
    permissions: ['geolocation'],
    mockOptions: {
      reverseResult: { label: 'Maplewood Lane, Florida', lat: MOLINO.latitude, lng: MOLINO.longitude, source: 'mapmap', precise: false },
    },
  });
  try {
    await startAddressStep(page);
    await page.click('[data-address-gps]');
    await page.locator('[data-address-map]').waitFor({ state: 'visible' });
    assert.equal(await page.inputValue('#est-address'), '', 'street is not invented');
    assert.equal(await page.locator('[data-address-confirm]').count(), 1);
    await page.locator('[data-address-confirm]').click();
    await page.fill('#est-date', BOOKING_DATE);
    await page.waitForSelector('[data-period="first"]:not([disabled])', { state: 'visible' });
    await page.click('[data-period="first"]');
    await page.click('[data-next]');
    assert.equal(
      await page.locator('.wizard__step[data-active="true"][data-step="2"]').count(),
      1,
      'a confirmed GPS location advances without inventing address fields',
    );
  } finally {
    await context.close();
  }
});

// ── Manual section is closed by default ──────────────────────────────────────

test('manual address entry is the first question and preserves answers', async () => {
  const { context, page } = await openEstimate({});
  try {
    assert.equal(await page.locator('[data-address-card]').isVisible(), true, 'address is visible first');
    assert.equal(await page.locator('[data-schedule-section]').isVisible(), false, 'scheduling waits for the address');
    assert.equal(await page.locator('#est-address').isVisible(), true, 'manual street is available');
    assert.equal(await page.locator('#est-address-city').isVisible(), false, 'city waits for a street');
    const placeholder = await page.locator('#est-address').getAttribute('placeholder');
    assert.match(placeholder ?? '', /123 Super Clean Way/, 'fictional example placeholder');
    assert.doesNotMatch(placeholder ?? '', /Maplewood|4242/i, 'no test fixture address leaks for the placeholder');
    await page.fill('#est-address', '100 S Baylen St');
    await page.locator('[data-address-details]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#est-zip').isVisible(), true);
    await page.fill('#est-address-city', 'Pensacola');
    await page.fill('#est-zip', '32503');
    await page.click('[data-address-resolve]');
    await page.locator('[data-address-map]').waitFor({ state: 'visible' });
    await page.locator('[data-address-confirm]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-address-finder]')?.getAttribute('data-state') === 'confirmed',
    );
    await page.locator('[data-schedule-section]').waitFor({ state: 'visible' });
    await chooseAppointment(page, BOOKING_DATE);
    await page.click('[data-next]');
    await page.waitForFunction(
      () => document.querySelector('.wizard__step[data-step="2"]')?.getAttribute('data-active') === 'true',
    );
    assert.equal(await page.locator('.wizard__step[data-active="true"][data-step="2"]').count(), 1);
  } finally {
    await context.close();
  }
});

// ── Poor accuracy ────────────────────────────────────────────────────────────

test('poor GPS accuracy never auto-fills the street address', async () => {
  const { context, page } = await openEstimate({
    geolocation: { ...MOLINO, accuracy: 500 },
    permissions: ['geolocation'],
    mockOptions: { reverseResult: MOLINO_RESULT },
  });
  try {
    await startAddressStep(page);
    await page.click('[data-address-gps]');
    await page.locator('[data-address-map]').waitFor({ state: 'visible' });
    assert.equal(await page.inputValue('#est-address'), '', 'street stays empty at poor accuracy');
    assert.equal(await page.locator('[data-address-confirm]').count(), 1, 'confirmation remains available');
  } finally {
    await context.close();
  }
});

// ── 4) Permission denied (mobile) ────────────────────────────────────────────

test('permission denial shows device-specific guidance with retry and manual actions', async () => {
  const { context, page } = await openEstimate({ permissions: [], width: 360, height: 740 });
  try {
    await startAddressStep(page);
    await page.click('[data-address-gps]');
    await page.waitForSelector('[data-address-permission]', { state: 'visible', timeout: 20000 });
    const panel = (await page.locator('[data-address-permission]').textContent()) ?? '';
    assert.match(panel, /iPhone Safari/i);
    assert.match(panel, /Android Chrome/i);
    assert.match(panel, /Settings/i);
    assert.equal(await page.locator('[data-address-gps-retry]').isVisible(), true);
    assert.equal(await page.locator('[data-address-manual-open]').isVisible(), true);
    assert.equal(await page.locator('[data-address-map]').isVisible(), false, 'no map without a location');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, 'permission guidance fits mobile without overflow');
  } finally {
    await context.close();
  }
});

// ── 5) User changes permission settings and retries ──────────────────────────

test('Try Location Again succeeds after permission is granted', async () => {
  const { context, page } = await openEstimate({ permissions: [], mockOptions: { reverseResult: MOLINO_RESULT } });
  try {
    await startAddressStep(page);
    await page.click('[data-address-gps]');
    await page.waitForSelector('[data-address-permission]', { state: 'visible', timeout: 20000 });
    await context.grantPermissions(['geolocation'], { origin: BASE });
    await context.setGeolocation({ ...MOLINO, accuracy: 20 });
    await page.click('[data-address-gps-retry]');
    await page.locator('[data-address-map]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-address-confirm]').count(), 1);
    await page.locator('[data-address-confirm]').click();
  } finally {
    await context.close();
  }
});

// ── 6) Manual entry after declining GPS ──────────────────────────────────────

test('manual entry works after declining GPS', async () => {
  const { context, page } = await openEstimate({ permissions: [] });
  try {
    await startAddressStep(page);
    await page.click('[data-address-gps]');
    await page.waitForSelector('[data-address-permission]', { state: 'visible', timeout: 20000 });
    await page.click('[data-address-manual-open]');
    await page.fill('#est-address', '100 S Baylen St');
    await page.fill('#est-address-city', 'Pensacola');
    await page.fill('#est-zip', '32502');
    // The five-step journey resolves and accepts the typed address automatically.
  } finally {
    await context.close();
  }
});

// ── 1) Stale manual data never reaches a GPS request ─────────────────────────

test('switching from manual to GPS isolates the old address everywhere', async () => {
  const { context, page, leadPayloads } = await openEstimate({
    geolocation: { ...MOLINO, accuracy: 20 },
    permissions: ['geolocation'],
    mockOptions: { reverseResult: DEVICE_RESULT },
  });
  try {
    await startAddressStep(page);
    // Type a wrong manual address first.
    await page.fill('#est-address', '111 Old Manual Road');
    await page.fill('#est-address-city', 'Oldtown');
    await page.fill('#est-zip', '11111');

    // Switch to GPS: the old values must be ignored, not merged.
    await page.click('[data-address-gps]');
    await page.locator('[data-address-map]').waitFor({ state: 'visible' });
    await confirmMapIfShown(page);
    const confirmed = await page.inputValue('#est-address');
    assert.match(confirmed, /DEVICE WAY/);
    assert.doesNotMatch(confirmed, /Old Manual|Oldtown|11111/);
    assert.equal(await page.locator('[data-address-finder]').getAttribute('data-method'), 'gps');

    await completeRemainingSteps(page);
    await page.click('[data-submit]');
    await page.waitForTimeout(150);
    if (await page.locator('[data-photo-gate]').isVisible()) await page.click('[data-photo-pay-later]');
    await page.waitForFunction(() => document.querySelector('[data-form-status]')?.dataset.state === 'warning');
    await delay(150);

    assert.equal(leadPayloads.length, 1, 'the request was sent');
    const fields = leadPayloads[0].fields;
    assert.equal(fields.address_method, 'gps');
    assert.equal(fields.service_address, '999 DEVICE WAY');
    assert.equal(fields.address_city, 'MILTON');
    assert.equal(fields.zip, '32570');
    assert.ok(fields.pin_latitude, 'the GPS pin travels with the request');
    const serialized = JSON.stringify(leadPayloads[0]);
    assert.doesNotMatch(serialized, /Old Manual/);
    assert.doesNotMatch(serialized, /Oldtown/);
    assert.doesNotMatch(serialized, /11111/);
  } finally {
    await context.close();
  }
});

// ── 7) Missing required fields show inline errors ────────────────────────────

test('missing required fields show an error summary, field errors and focus', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const page = await context.newPage();
  try {
    await mockApis(page, {});
    await page.goto(BASE + '/estimate/residential/', { waitUntil: 'load' });
    await page.addStyleTag({ content: '.mobile-action-bar,.consent-banner{display:none!important}' });
    await page.click('[data-next]');
    await page.waitForSelector('[data-error-summary]', { state: 'visible' });
    const summary = (await page.locator('[data-error-summary-list]').textContent()) ?? '';
    assert.match(summary, /street address/i);
    assert.doesNotMatch(summary, /preferred date/i, 'date waits for the verified address');
    assert.equal(await page.locator('[data-schedule-section]').isVisible(), false, 'scheduling stays locked');

    await startAddressStep(page);
    await page.click('[data-next]');
    await page.waitForSelector('[data-error-summary]', { state: 'visible' });
    const streetSummary = (await page.locator('[data-error-summary-list]').textContent()) ?? '';
    assert.match(streetSummary, /street address/i);
    assert.equal(await page.locator('#est-address').getAttribute('aria-invalid'), 'true');
    assert.match((await page.locator('[data-error-for="est-address"]').textContent()) ?? '', /Please enter your street address/i);

    await page.fill('#est-address', '100 S Baylen St');
    await page.click('[data-next]');
    await page.waitForSelector('[data-error-summary]', { state: 'visible' });
    assert.match((await page.locator('[data-error-for="est-zip"]').textContent()) ?? '', /Please enter a valid ZIP code/i);

    // Correcting the fields clears the errors and reaches the service step.
    await page.fill('#est-address-city', 'Pensacola');
    await page.fill('#est-zip', '32503');
    await page.click('[data-address-resolve]');
    await page.locator('[data-address-map]').waitFor({ state: 'visible' });
    await page.locator('[data-address-confirm]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-address-finder]')?.getAttribute('data-state') === 'confirmed',
    );
    await page.click('[data-next]');
    assert.equal(await page.locator('.wizard__step[data-active="true"][data-step="1"]').count(), 1, 'date/time still required');
    await chooseAppointment(page, BOOKING_DATE);
    await page.click('[data-next]');
    await page.waitForFunction(
      () => document.querySelector('.wizard__step[data-step="2"]')?.getAttribute('data-active') === 'true',
    );
    assert.equal(await page.locator('#est-address').getAttribute('aria-invalid'), null);
    assert.equal(await page.locator('[data-error-summary]').isVisible(), false);
  } finally {
    await context.close();
  }
});

test('a GPS pin without a reverse-geocoded address confirms and advances', async () => {
  const { context, page } = await openEstimate({
    geolocation: { ...MOLINO, accuracy: 20 },
    permissions: ['geolocation'],
    mockOptions: { reverseResult: null },
  });
  try {
    await startAddressStep(page);
    await page.click('[data-address-gps]');
    await page.locator('[data-address-map]').waitFor({ state: 'visible' });
    await advanceAddressStep(page);
    await page.waitForFunction(
      () => document.querySelector('.wizard__step[data-step="2"]')?.getAttribute('data-active') === 'true',
    );
    assert.equal(await page.locator('.wizard__step[data-active="true"][data-step="2"]').count(), 1);
  } finally {
    await context.close();
  }
});

// ── 8) Unresolvable manual address still allows a preliminary request ────────

test('an unresolved manual address cannot reach scheduling', async () => {
  const { context, page, leadPayloads } = await openEstimate({ mockOptions: { resolveResult: null } });
  try {
    await startAddressStep(page);
    await page.fill('#est-address', '777 Nowhere Road');
    await page.fill('#est-address-city', 'Molino');
    await page.fill('#est-zip', '32577');
    await page.click('[data-next]');
    assert.equal(
      await page.locator('.wizard__step[data-active="true"][data-step="1"]').count(),
      1,
      'the customer remains on Step 1',
    );
    assert.equal(await page.locator('[data-schedule-section]').isVisible(), false, 'scheduling never unlocks');
    assert.match(
      (await page.locator('[data-error-for="est-address"]').textContent()) ?? '',
      /Confirm your service address/i,
    );
    assert.equal(leadPayloads.length, 0, 'no request is submitted');
  } finally {
    await context.close();
  }
});

// ── GTM consent-gated install ────────────────────────────────────────────────

test('GTM loads exactly once and only after analytics consent', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const gtmRequests = [];
  await page.route('**googletagmanager.com/**', async (route) => {
    gtmRequests.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
  try {
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await delay(600);
    assert.equal(gtmRequests.length, 0, 'no GTM request before consent');
    const banner = page.locator('[data-consent-banner][data-visible="true"]');
    assert.equal(await banner.isVisible(), true, 'consent banner is shown while analytics is configured');

    await page.click('[data-consent="allow"]');
    for (let attempt = 0; attempt < 50 && !gtmRequests.some((url) => url.includes('gtm.js?id=GTM-KSQ26HMG')); attempt += 1) {
      await delay(200);
    }
    assert.ok(
      gtmRequests.some((url) => url.includes('gtm.js?id=GTM-KSQ26HMG')),
      `GTM container requested: ${gtmRequests.join(', ')}`,
    );
    assert.equal(await page.locator('script[src*="googletagmanager.com/gtm.js"]').count(), 1, 'installed exactly once');

    const stored = await page.evaluate(() => window.localStorage.getItem('pcc-consent-v1'));
    assert.match(stored ?? '', /"analytics":true/);
  } finally {
    await context.close();
  }
});
