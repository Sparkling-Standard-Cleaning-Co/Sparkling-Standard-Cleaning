// Focused tests — GPS-first address selection, method isolation, permission
// guidance, inline validation, and the consent-gated GTM installation.
// Run with: npm run test:browser on :4405.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4405;
const BASE = `http://localhost:${PORT}`;
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
  await page.goto(BASE + '/estimate/', { waitUntil: 'load' });
  await page.addStyleTag({ content: '.mobile-action-bar,.consent-banner{display:none!important}' });
  await page.click('label.option:has(input[name="serviceType"][value="standard"])');
  return { context, page, ...captured };
}

async function completeRemainingSteps(page) {
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
  await page.fill('#est-name', 'UX test (please ignore)');
  await page.fill('#est-phone', '8500000000');
  await page.fill('#est-email', 'owner@sparkling-standard.com');
}

// ── 3) GPS resolves an exact address ─────────────────────────────────────────

test('GPS resolves an exact address and only confirms it explicitly', async () => {
  const { context, page, reverseRequests } = await openEstimate({
    geolocation: { ...MOLINO, accuracy: 20 },
    permissions: ['geolocation'],
    mockOptions: { reverseResult: MOLINO_RESULT },
  });
  try {
    await page.click('[data-address-gps]');
    await page.waitForFunction(() => /We found this address/.test(document.querySelector('[data-address-status]')?.textContent ?? ''));
    assert.equal(reverseRequests.length, 1);
    assert.equal(await page.inputValue('#est-address'), ''); // manual fields stay isolated
    const label = (await page.locator('[data-address-confirmed-label]').textContent()) ?? '';
    assert.equal(label, '', 'nothing is confirmed before the customer confirms');
    await page.waitForSelector('[data-address-confirm]', { state: 'visible' });
    await page.click('[data-address-confirm]');
    await page.waitForSelector('[data-address-confirmed]', { state: 'visible' });
    assert.match((await page.locator('[data-address-confirmed-label]').textContent()) ?? '', /MAPLEWOOD LN/);
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
    await page.click('[data-address-gps]');
    await page.waitForFunction(() => /couldn't match your location to an exact street address/.test(document.querySelector('[data-address-status]')?.textContent ?? ''));
    assert.equal(await page.inputValue('#est-address'), '', 'street is not invented');
    assert.equal(await page.locator('[data-gps-zip]').count(), 0, 'no ZIP prompt exists for GPS');
    await page.waitForSelector('[data-address-confirm]', { state: 'visible' });
    await page.click('[data-address-confirm]');
    await page.waitForSelector('[data-address-confirmed]', { state: 'visible' });
    assert.match(
      (await page.locator('[data-address-confirmed-label]').textContent()) ?? '',
      /Current location from your device/,
    );
    // A confirmed GPS destination continues without any ZIP entry.
    await page.click('[data-next]');
    assert.equal(
      await page.locator('.wizard__step[data-active="true"][data-step="2"]').count(),
      1,
      'GPS without ZIP advances to step 2',
    );
  } finally {
    await context.close();
  }
});

// ── Manual section is closed by default ──────────────────────────────────────

test('the manual address section starts closed and reopens only on request', async () => {
  const { context, page } = await openEstimate({});
  try {
    assert.equal(await page.locator('[data-address-manual-details]').getAttribute('open'), null, 'closed on load');
    assert.equal(await page.locator('#est-address').isVisible(), false, 'manual fields hidden by default');
    await page.click('[data-address-manual-summary]');
    assert.equal(await page.locator('#est-address').isVisible(), true, 'manual fields appear when opened');
    const placeholder = await page.locator('#est-address').getAttribute('placeholder');
    assert.match(placeholder ?? '', /123 Super Clean Way/, 'fictional example placeholder');
    assert.doesNotMatch(placeholder ?? '', /Maplewood|4242/i, 'no test fixture address leaks into the placeholder');
    // Navigating a step forward and back preserves the customer's purposeful choice.
    await page.fill('#est-address', '100 S Baylen St');
    await page.fill('#est-zip', '32503');
    await page.click('[data-next]');
    await page.click('[data-back]');
    assert.equal(await page.locator('[data-address-manual-details]').getAttribute('open'), '', 'stays open after back navigation');
    assert.equal(await page.inputValue('#est-address'), '100 S Baylen St', 'answers preserved');
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
    await page.click('[data-address-gps]');
    await page.waitForFunction(() => /approximate|accurate to about/i.test(document.querySelector('[data-address-status]')?.textContent ?? ''));
    assert.equal(await page.inputValue('#est-address'), '', 'street stays empty at poor accuracy');
    assert.equal(await page.locator('[data-address-confirm]').isVisible(), true);
  } finally {
    await context.close();
  }
});

// ── 4) Permission denied (mobile) ────────────────────────────────────────────

test('permission denial shows device-specific guidance with retry and manual actions', async () => {
  const { context, page } = await openEstimate({ permissions: [], width: 360, height: 740 });
  try {
    await page.click('[data-address-gps]');
    await page.waitForSelector('[data-address-permission]', { state: 'visible', timeout: 20000 });
    const panel = (await page.locator('[data-address-permission]').textContent()) ?? '';
    assert.match(panel, /iPhone Safari/i);
    assert.match(panel, /Android Chrome/i);
    assert.match(panel, /Settings/i);
    assert.equal(await page.locator('[data-address-gps-retry]').isVisible(), true);
    assert.equal(await page.locator('[data-address-manual-open]').isVisible(), true);
    assert.equal(await page.locator('[data-address-confirm]').isVisible(), false, 'no pin without permission');
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
    await page.click('[data-address-gps]');
    await page.waitForSelector('[data-address-permission]', { state: 'visible', timeout: 20000 });
    await context.grantPermissions(['geolocation'], { origin: BASE });
    await context.setGeolocation({ ...MOLINO, accuracy: 20 });
    await page.click('[data-address-gps-retry]');
    await page.waitForFunction(() => /We found this address/.test(document.querySelector('[data-address-status]')?.textContent ?? ''));
    await page.waitForSelector('[data-address-confirm]', { state: 'visible' });
  } finally {
    await context.close();
  }
});

// ── 6) Manual entry after declining GPS ──────────────────────────────────────

test('manual entry works after declining GPS', async () => {
  const { context, page } = await openEstimate({ permissions: [] });
  try {
    await page.click('[data-address-gps]');
    await page.waitForSelector('[data-address-permission]', { state: 'visible', timeout: 20000 });
    await page.click('[data-address-manual-open]');
    await page.fill('#est-address', '100 S Baylen St');
    await page.fill('#est-address-city', 'Pensacola');
    await page.fill('#est-zip', '32502');
    await page.click('[data-address-resolve]');
    await page.waitForSelector('[data-address-confirm]', { state: 'visible' });
    await page.click('[data-address-confirm]');
    await page.waitForSelector('[data-address-confirmed]', { state: 'visible' });
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
    // Type a wrong manual address first.
    await page.click('[data-address-manual-summary]');
    await page.fill('#est-address', '111 Old Manual Road');
    await page.fill('#est-address-city', 'Oldtown');
    await page.fill('#est-zip', '11111');

    // Switch to GPS: the old values must be ignored, not merged.
    await page.click('[data-address-gps]');
    await page.waitForFunction(() => /We found this address/.test(document.querySelector('[data-address-status]')?.textContent ?? ''));
    await page.waitForSelector('[data-address-confirm]', { state: 'visible' });
    await page.click('[data-address-confirm]');
    await page.waitForSelector('[data-address-confirmed]', { state: 'visible' });
    const confirmed = (await page.locator('[data-address-confirmed-label]').textContent()) ?? '';
    assert.match(confirmed, /DEVICE WAY/);
    assert.doesNotMatch(confirmed, /Old Manual|Oldtown|11111/);

    await completeRemainingSteps(page);
    await page.click('[data-submit]');
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
    await page.goto(BASE + '/estimate/', { waitUntil: 'load' });
    await page.addStyleTag({ content: '.mobile-action-bar,.consent-banner{display:none!important}' });
    await page.click('[data-next]');
    await page.waitForSelector('[data-error-summary]', { state: 'visible' });
    const summary = (await page.locator('[data-error-summary-list]').textContent()) ?? '';
    assert.match(summary, /Please select a cleaning service/i);

    await page.click('label.option:has(input[name="serviceType"][value="standard"])');
    await page.click('[data-next]');
    assert.equal(await page.locator('#est-address').getAttribute('aria-invalid'), 'true');
    assert.match((await page.locator('[data-error-for="est-address"]').textContent()) ?? '', /Please enter your street address/i);
    assert.match((await page.locator('[data-error-for="est-zip"]').textContent()) ?? '', /Please enter a valid ZIP code/i);
    const focused = await page.evaluate(() => document.activeElement?.id);
    assert.equal(focused, 'est-address', 'focus moves to the first invalid field');

    // Correcting the fields clears the errors.
    await page.fill('#est-address', '100 S Baylen St');
    await page.fill('#est-zip', '32503');
    await page.click('[data-next]');
    assert.equal(await page.locator('#est-address').getAttribute('aria-invalid'), null);
    assert.equal(await page.locator('[data-error-summary]').isVisible(), false);
  } finally {
    await context.close();
  }
});

test('an unconfirmed GPS pin is validated as an address that needs confirmation', async () => {
  const { context, page } = await openEstimate({
    geolocation: { ...MOLINO, accuracy: 20 },
    permissions: ['geolocation'],
    mockOptions: { reverseResult: null },
  });
  try {
    await page.click('[data-address-gps]');
    await page.waitForSelector('[data-address-confirm]', { state: 'visible' });
    await page.click('[data-next]');
    assert.equal(await page.locator('.wizard__step[data-active="true"][data-step="1"]').count(), 1, 'stays on step 1');
    const summary = (await page.locator('[data-error-summary-list]').textContent()) ?? '';
    assert.match(summary, /confirm your current location/i);
  } finally {
    await context.close();
  }
});

// ── 8) Unresolvable manual address still allows a preliminary request ────────

test('an unresolved manual address can still be submitted for confirmation', async () => {
  const { context, page, leadPayloads } = await openEstimate({ mockOptions: { resolveResult: null } });
  try {
    await page.click('[data-address-manual-summary]');
    await page.fill('#est-address', '777 Nowhere Road');
    await page.fill('#est-address-city', 'Molino');
    await page.fill('#est-zip', '32577');
    await page.click('[data-address-resolve]');
    await page.waitForSelector('[data-address-finder][data-state="unresolved"]');
    assert.match(
      (await page.locator('[data-address-status]').textContent()) ?? '',
      /couldn't pinpoint the exact address/i,
    );
    await completeRemainingSteps(page);
    await page.waitForSelector('[data-reservation-summary]', { state: 'visible' });
    assert.match((await page.locator('[data-reservation-price]').textContent()) ?? '', /^\$\d+/);
    await page.click('[data-submit]');
    await page.waitForFunction(() => document.querySelector('[data-form-status]')?.dataset.state === 'warning');
    await delay(150);
    const fields = leadPayloads[0].fields;
    assert.equal(fields.address_method, 'manual');
    assert.equal(fields.address_confirmed, 'no');
    assert.equal(fields.service_address, '777 Nowhere Road');
    assert.equal(fields.zip, '32577');
    assert.equal(fields.pin_latitude, undefined);
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
