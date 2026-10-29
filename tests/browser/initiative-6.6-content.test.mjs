// Initiative 6.6 owner-audit corrections: approved copy, four-value banner,
// Deep Cleaning scope, service-area wording, centered facility intros, state
// restrictions, optional facility ZIP and bundle offers. Built pages only.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4426;
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

async function open(path, width = 1280, height = 900) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('pcc-consent-v1', JSON.stringify({ analytics: false, ads: false, v: 1 }));
    localStorage.setItem('pcc-promo-state', JSON.stringify({ state: 'dismissed', at: new Date().toISOString() }));
    sessionStorage.setItem('pcc-promo-shown-session', '1');
  });
  await page.goto(BASE + path, { waitUntil: 'load' });
  return { context, page };
}

const normalize = (value) => value.replace(/\s+/g, ' ').trim();

test('the homepage carries the four approved values, centered Our Values copy and the new CTA', async () => {
  const { context, page } = await open('/', 1440, 1100);
  try {
    const items = page.locator('.trust-item');
    assert.equal(await items.count(), 4);
    assert.equal(await items.locator('.trust-item__text').count(), 0);
    assert.equal(await items.locator('.trust-item__verses').count(), 0);
    assert.deepEqual(
      (await items.locator('.trust-item__title').allTextContents()).map((text) => text.trim()),
      ['Locally Owned', 'Flexible Scheduling', 'Christian Values', 'Competitive Pricing'],
    );

    const values = page.locator('.difference-intro');
    const valuesText = normalize((await values.innerText()) ?? '');
    assert.match(valuesText, /Our Values/);
    assert.match(valuesText, /porch light left on/);
    assert.match(valuesText, /treating every customer like a neighbor/);
    assert.match(valuesText, /Galatians 5:13/);
    assert.equal(await values.locator('h2').evaluate((node) => getComputedStyle(node).textAlign), 'center');
    assert.equal(await values.locator('.difference-intro__copy').evaluate((node) => getComputedStyle(node).textAlign), 'center');

    assert.equal(normalize((await page.locator('#estimate-heading').innerText()) ?? ''), 'Is your space ready to sparkle?');
    assert.match(normalize((await page.locator('.estimate-card').innerText()) ?? ''), /Colossians 3:23/);
  } finally {
    await context.close();
  }
});

test('Deep Cleaning keeps its scope policy while removing the audited blocks and adding the owner explanation', async () => {
  const { context, page } = await open('/deep-cleaning/', 1280, 1000);
  try {
    const text = normalize((await page.locator('main').innerText()) ?? '');
    assert.match(text, /What a Deep Clean Is/);
    assert.match(text, /required before a new recurring residential cleaning arrangement begins/);
    assert.match(text, /establishes the standard your ongoing visits are designed to maintain/);
    assert.doesNotMatch(text, /See our Deep Cleaning procedure/);
    assert.doesNotMatch(text, /Anyone who wants to see what/);
    assert.doesNotMatch(text, /What this service doesn't cover/);
    assert.doesNotMatch(text, /Prefer to ask first\?/);
    const closing = page.locator('.cta-band');
    assert.equal(await closing.locator('p').count(), 0, 'the audited closing sentence is removed');
    assert.equal(await closing.locator('.btn').count(), 2, 'both closing buttons remain');
  } finally {
    await context.close();
  }
});

test('Move-in/Move-out no longer shows the removed scope section', async () => {
  const { context, page } = await open('/move-in-move-out-cleaning/', 1280, 1000);
  try {
    const text = normalize((await page.locator('main').innerText()) ?? '');
    assert.doesNotMatch(text, /What this service doesn't cover/);
    assert.doesNotMatch(text, /Prefer to ask first\?/);
    assert.match(text, /Built around the walkthrough/);
  } finally {
    await context.close();
  }
});

test('the service-area page removes the audited claims and keeps the legend', async () => {
  const { context, page } = await open('/service-area/', 1440, 1100);
  try {
    const text = normalize((await page.locator('main').innerText()) ?? '');
    assert.doesNotMatch(text, /confirmed service area today/i);
    assert.doesNotMatch(text, /no fake maps, no invented radius claims/i);
    assert.doesNotMatch(text, /The instant estimate checks your ZIP as you enter it/i);
    assert.doesNotMatch(text, /A county tint is never an automatic whole-county guarantee/i);
    assert.match(text, /care and consideration/);
    assert.match(text, /Core Service Area/);
    assert.equal(await page.locator('.area-map__note').count(), 1);
  } finally {
    await context.close();
  }
});

test('commercial and church intros are fully centered above their forms', async () => {
  for (const path of ['/estimate/commercial/', '/estimate/church/']) {
    const { context, page } = await open(path, 1280, 900);
    try {
      const head = page.locator('.estimate-intro .section-head');
      assert.equal(await head.evaluate((node) => getComputedStyle(node).textAlign), 'center');
      assert.equal(await page.locator('.estimate-intro .section-head a').count(), 1);
    } finally {
      await context.close();
    }
  }
});

test('the address form limits states and the facility ZIP is optional when a location is confirmed', async () => {
  const { context, page } = await open('/estimate/commercial/', 1280, 900);
  try {
    await page.locator('summary.address-manual__summary').click();
    const options = await page.locator('#est-address-state option').evaluateAll((nodes) =>
      nodes.map((node) => ({
        value: node.value,
        text: node.textContent?.trim() ?? '',
        disabled: node.disabled,
      })),
    );
    assert.deepEqual(options.map((option) => option.value), ['FL', 'AL', 'GA']);
    assert.equal(options[2].disabled, true);
    assert.match(options[2].text, /Coming Soon/);

    const zip = page.locator('#est-zip');
    assert.equal(await zip.getAttribute('required'), null);
    assert.match(normalize((await page.locator('label[for="est-zip"]').innerText()) ?? ''), /if known/);
  } finally {
    await context.close();
  }
});

test('the residential wizard removes the audited lead and offers approved bundles', async () => {
  const { context, page } = await open('/estimate/residential/', 1280, 900);
  try {
    assert.equal(await page.locator('.estimate-intro p.lead').count(), 0);
    const sidebar = normalize((await page.locator('aside').innerText()) ?? '');
    assert.match(sidebar, /No two homes are the same/);
    assert.match(sidebar, /Your home\. Your estimate\. Your schedule\. Your choice\./);

    const bundles = page.locator('.bundle-offer');
    assert.ok((await bundles.count()) >= 6, 'the expanded bundle menu renders');
    const text = normalize((await page.locator('.bundle-offers').textContent()) ?? '');
    assert.match(text, /Kitchen Refresh Bundle/);
    assert.match(text, /Deep Detail Bundle/);
    assert.match(text, /Recurring Care Bundle/);
    assert.match(text, /Move-In Ready Bundle/);
    assert.match(text, /Pet & Family Refresh Bundle/);
    assert.match(text, /Whole-Home Detail Bundle/);
    assert.match(text, /Save 10% when selected together/);
  } finally {
    await context.close();
  }
});

test('a confirmed facility location can continue without a ZIP code', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.route('**/api/geocode', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        result: {
          label: '123 MAIN ST, PENSACOLA, FL',
          lat: 30.4213,
          lng: -87.2169,
          city: 'Pensacola',
          state: 'FL',
          source: 'mapmap',
          precise: true,
        },
      }),
    });
  });
  await page.route('**tiles.openfreemap.org/**', (route) => route.abort());
  try {
    await page.goto(BASE + '/estimate/commercial/', { waitUntil: 'load' });
    await page.locator('#fac-org').fill('Test Facility');
    await page.locator('#fac-name').fill('Test Owner');
    await page.locator('summary.address-manual__summary').click();
    await page.locator('#est-address').fill('123 Main St');
    await page.locator('#est-address-city').fill('Pensacola');
    await page.locator('#est-address-state').selectOption('FL');
    await page.locator('[data-address-resolve]').click();
    await page.locator('[data-address-map]').waitFor({ state: 'visible' });
    await page.locator('[data-address-confirm]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-address-finder]')?.getAttribute('data-state') === 'confirmed',
    );
    await page.locator('[data-facility-next]').click();
    await page.locator('[data-facility-step-panel="2"]').waitFor({ state: 'visible' });
    assert.match(normalize((await page.locator('[data-facility-step-label]').innerText()) ?? ''), /Step 2 of 4/);
  } finally {
    await context.close();
  }
});
test('Pay Now appears only for an exact Tier A facility quote when Stripe is configured', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.route('**/api/geocode', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        result: {
          label: '100 S BAYLEN ST, PENSACOLA, FL, 32502',
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
  await page.route('**/api/travel', async (route) => {
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
  let leadRequests = 0;
  let checkoutRequests = 0;
  await page.route('**/api/lead', async (route) => {
    leadRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        via: 'relay',
        verification: {
          status: 'verified',
          travel_verified: true,
          travel_method: 'route',
          config_match: 'match',
        },
      }),
    });
  });
  await page.route('**/api/estimate-checkout', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, enabled: true }),
      });
      return;
    }
    checkoutRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'stripe_unavailable' }),
    });
  });
  try {
    await page.goto(BASE + '/estimate/commercial/', { waitUntil: 'load' });
    await page.locator('#fac-org').fill('Test Facility');
    await page.locator('#fac-name').fill('Test Owner');
    await page.locator('summary.address-manual__summary').click();
    await page.locator('#est-address').fill('100 S Baylen St');
    await page.locator('#est-address-city').fill('Pensacola');
    await page.locator('#est-address-state').selectOption('FL');
    await page.locator('#est-zip').fill('32502');
    await page.locator('[data-address-resolve]').click();
    await page.locator('[data-address-map]').waitFor({ state: 'visible' });
    await page.locator('[data-address-confirm]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-address-finder]')?.getAttribute('data-state') === 'confirmed',
    );
    await page.locator('[data-facility-next]').click();
    await page.locator('[data-facility-step-panel="2"]').waitFor({ state: 'visible' });
    await page.selectOption('#fac-type', 'office');
    await page.fill('#fac-sqft', '2000');
    await page.fill('#fac-restrooms', '6');
    await page.selectOption('#fac-frequency', 'weekly');
    await page.locator('[data-facility-next]').click();
    await page.locator('[data-facility-step-panel="3"]').waitFor({ state: 'visible' });
    await page.selectOption('#fac-window', { index: 1 });
    await page.locator('[data-facility-next]').click();
    await page.locator('[data-facility-step-panel="4"]').waitFor({ state: 'visible' });
    await page.locator('[data-facility-pay-now]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-facility-pay-now]').innerText(), 'Pay Now Securely');
    assert.match(normalize((await page.locator('[data-facility-pay-note]').innerText()) ?? ''), /without paying upfront/);
    await page.fill('#fac-phone', '8500000000');
    await page.fill('#fac-email', 'customer@example.test');
    await page.check('#commercial-terms');
    await page.locator('[data-facility-pay-now]').click();
    await page.waitForFunction(() => document.querySelector('[data-facility-pay-now]')?.getAttribute('aria-busy') === 'true');
    assert.equal(await page.locator('[data-facility-pay-now]').isDisabled(), true);
    assert.match(normalize((await page.locator('[data-facility-pay-now]').innerText()) ?? ''), /Preparing Secure Checkout/);
    await page.waitForFunction(() => (document.querySelector('[data-form-status]')?.textContent ?? '').includes('secure checkout could not start'));
    assert.equal(leadRequests, 1);
    assert.equal(checkoutRequests, 1);
    assert.equal(await page.locator('[data-facility-submit]').isDisabled(), true);
    assert.equal(normalize((await page.locator('[data-facility-submit]').innerText()) ?? ''), 'Request Received');
    await page.locator('[data-facility-pay-now]').click();
    await page.waitForTimeout(1100);
    assert.equal(checkoutRequests, 2);
    assert.equal(leadRequests, 1, 'payment retry must not submit a duplicate lead');
  } finally {
    await context.close();
  }
});
test('an approximate facility address becomes a manual-review request instead of a verify loop', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.route('**/api/geocode', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        result: {
          label: 'Molino area (ZIP 32577)',
          lat: 30.72,
          lng: -87.31,
          zip: '32577',
          city: 'Molino',
          state: 'FL',
          source: 'census',
          precise: false,
          approximate: true,
        },
      }),
    });
  });
  await page.route('**/api/travel', async (route) => {
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
  await page.route('**/api/estimate-checkout', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, enabled: true }),
    });
  });
  await page.route('**tiles.openfreemap.org/**', (route) => route.abort());
  try {
    await page.goto(BASE + '/estimate/commercial/', { waitUntil: 'load' });
    await page.locator('#fac-org').fill('Test Facility');
    await page.locator('#fac-name').fill('Test Owner');
    await page.locator('summary.address-manual__summary').click();
    await page.locator('#est-address').fill('4242 Maplewood Ln');
    await page.locator('#est-address-city').fill('Molino');
    await page.locator('#est-address-state').selectOption('FL');
    await page.locator('#est-zip').fill('32577');
    await page.locator('[data-address-resolve]').click();
    await page.locator('[data-address-map]').waitFor({ state: 'visible' });
    await page.locator('[data-address-confirm]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-address-finder]')?.getAttribute('data-state') === 'confirmed',
    );
    await page.locator('[data-facility-next]').click();
    await page.locator('[data-facility-step-panel="2"]').waitFor({ state: 'visible' });
    await page.selectOption('#fac-type', 'office');
    await page.fill('#fac-sqft', '2000');
    await page.fill('#fac-restrooms', '6');
    await page.selectOption('#fac-frequency', 'weekly');
    await page.locator('[data-facility-next]').click();
    await page.locator('[data-facility-step-panel="3"]').waitFor({ state: 'visible' });
    await page.selectOption('#fac-window', { index: 1 });
    await page.locator('[data-facility-next]').click();
    await page.locator('[data-facility-step-panel="4"]').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('[data-estimate-reveal]')?.hidden === true);
    assert.equal(await page.locator('[data-facility-pay-now]').isVisible(), false);
    assert.equal(
      await page.locator('[data-facility-verify-address]').isVisible(),
      false,
      'no address-verification loop exists',
    );
    const guidance = normalize((await page.locator('[data-facility-payment-guidance]').innerText()) ?? '');
    assert.match(guidance, /couldn't verify the exact facility address/i);
  } finally {
    await context.close();
  }
});
test('the GPS action shows a disabled, busy loading state while locating', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition() {
          // Deliberately never calls back: the loading state stays visible.
        },
      },
    });
  });
  try {
    await page.goto(BASE + '/estimate/residential/', { waitUntil: 'load' });
    await page.fill('#est-date', new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10));
    await page.waitForSelector('[data-calendar-period]', { state: 'visible' });
    await page.click('[data-period="first"]');
    await page.locator('[data-address-card]').waitFor({ state: 'visible' });
    const button = page.locator('[data-address-gps]');
    await button.click();
    await page.waitForFunction(() => document.querySelector('[data-address-gps]')?.getAttribute('aria-busy') === 'true');
    assert.equal(await button.isDisabled(), true);
    assert.match(normalize((await button.innerText()) ?? ''), /Finding Your Location/);
  } finally {
    await context.close();
  }
});
test('the canceled-checkout page preserves a safe reference and return path', async () => {
  const { context, page } = await open('/estimate/payment-canceled/?reference=SS-20261027-ABC123&return=%2Festimate%2Fresidential%2F', 390, 844);
  try {
    assert.match(normalize((await page.locator('[data-checkout-reference]').innerText()) ?? ''), /SS-20261027-ABC123/);
    assert.equal(await page.locator('[data-return-estimate]').getAttribute('href'), '/estimate/residential/');
    assert.match(normalize((await page.locator('main').innerText()) ?? ''), /No completed payment was confirmed/);
  } finally {
    await context.close();
  }
});

test('the payment status page distinguishes paid, pending and unavailable verification', async () => {
  for (const scenario of [
    { paid: true, status: 'complete', text: /Your payment was received/ },
    { paid: false, status: 'open', text: /No completed payment is showing yet/ },
    { paid: false, status: 'expired', text: /checkout expired without a completed payment/ },
  ]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.route('**/api/estimate-checkout?session_id=*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          paid: scenario.paid,
          status: scenario.status,
          amount: 125,
          reference: 'SS-20261027-ABC123',
        }),
      }),
    );
    try {
      await page.goto(BASE + '/estimate/payment-success/?session_id=cs_test_123', { waitUntil: 'load' });
      await page.waitForFunction((pattern) => new RegExp(pattern, 'i').test(document.querySelector('[data-payment-state]')?.textContent ?? ''), scenario.text.source);
      assert.match(normalize((await page.locator('[data-payment-state]').innerText()) ?? ''), scenario.text);
      assert.match(normalize((await page.locator('[data-payment-reference]').innerText()) ?? ''), /SS-20261027-ABC123/);
    } finally {
      await context.close();
    }
  }
});