// Browser accessibility checks for the estimator — labels, combobox and
// listbox semantics, keyboard selection, focus movement and tab order.
//
// Run with: npm run test:browser. Provider APIs are mocked; no external
// service is contacted. Uses only the project's Playwright dependency.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4402;
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

const ADDRESS = { label: '100 S Baylen St, Pensacola, FL 32502', lat: 30.4111, lng: -87.2164 };

async function openEstimate(width = 1280, height = 900) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.route('**/api/geocode', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.action === 'suggest') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          suggestions: [{ id: 'osm:w1:addr', label: ADDRESS.label, lat: ADDRESS.lat, lng: ADDRESS.lng }],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        result: { ...ADDRESS, zip: '32502', city: 'Pensacola', state: 'FL', source: 'mapmap' },
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
  await page.route('**tiles.openfreemap.org/**', (route) => route.abort());
  await page.goto(BASE + '/estimate/', { waitUntil: 'load' });
  return { context, page };
}

test('every estimable form control has an accessible name', async () => {
  const { context, page } = await openEstimate();
  try {
    const controls = await page.evaluate(() => {
      const form = document.querySelector('[data-estimate-form]');
      return [...form.querySelectorAll('input, select, textarea')]
        .filter((element) => element.type !== 'hidden' && !element.closest('[hidden]'))
        .map((element) => ({
          name: element.name || element.id,
          label:
            (element.labels ? [...element.labels].map((label) => label.textContent.trim()).join(' ') : '') ||
            element.getAttribute('aria-label') ||
            '',
        }));
    });
    assert.ok(controls.length >= 15, `expected the full control set, saw ${controls.length}`);
    for (const control of controls) {
      assert.ok(control.label.length > 0, `control "${control.name}" has no accessible name`);
    }
  } finally {
    await context.close();
  }
});

test('the address field exposes combobox semantics and keyboard selection', async () => {
  const { context, page } = await openEstimate();
  try {
    await page.click('label.option:has(input[name="serviceType"][value="standard"])');
    await page.click('[data-next]');

    const field = page.locator('#est-address');
    assert.equal(await field.getAttribute('role'), 'combobox');
    assert.equal(await field.getAttribute('aria-expanded'), 'false');
    assert.equal(await field.getAttribute('aria-controls'), 'est-address-suggestions');

    await field.fill('100 S Baylen');
    await page.waitForSelector('#est-address-suggestions', { state: 'visible' });
    assert.equal(await field.getAttribute('aria-expanded'), 'true', 'expanded while suggestions show');
    assert.equal(await page.locator('#est-address-suggestions').getAttribute('role'), 'listbox');
    assert.equal(await page.locator('#est-address-suggestions li').first().getAttribute('role'), 'option');

    // Keyboard selection: ArrowDown highlights, Enter picks.
    await page.keyboard.press('ArrowDown');
    const active = await field.getAttribute('aria-activedescendant');
    assert.match(active ?? '', /^est-address-option-0$/, 'arrow keys move the active option');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-address-confirm]', { state: 'visible' });
    assert.equal(await field.getAttribute('aria-expanded'), 'false', 'collapsed after selection');

    // Focus moves to the confirmation action.
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-address-confirm') !== null);
    assert.equal(focused, true, 'focus lands on Confirm this location');
  } finally {
    await context.close();
  }
});

test('interactive controls have accessible names and no positive tabindex', async () => {
  const { context, page } = await openEstimate();
  try {
    await page.click('label.option:has(input[name="serviceType"][value="standard"])');
    await page.click('[data-next]');
    await page.fill('#est-address', '100 S Baylen');
    await page.waitForSelector('#est-address-suggestions li', { state: 'visible' });
    await page.click('#est-address-suggestions li');
    await page.waitForSelector('[data-address-confirm]', { state: 'visible' });

    const buttons = await page.evaluate(() =>
      [...document.querySelectorAll('button, a[href]')]
        .filter((element) => element.offsetParent !== null)
        .map((element) => (element.textContent ?? '').trim() || element.getAttribute('aria-label') || ''),
    );
    for (const name of buttons) {
      assert.ok(name.length > 0, 'every visible button/link needs an accessible name');
    }

    const positiveTabindex = await page.evaluate(
      () =>
        [...document.querySelectorAll('[tabindex]')].filter((element) => Number(element.getAttribute('tabindex')) > 0)
          .length,
    );
    assert.equal(positiveTabindex, 0, 'no positive tabindex breaks natural tab order');
  } finally {
    await context.close();
  }
});

test('the page keeps one h1 and a main landmark', async () => {
  const { context, page } = await openEstimate();
  try {
    assert.equal(await page.locator('h1').count(), 1);
    assert.equal(await page.locator('main#main').count(), 1);
  } finally {
    await context.close();
  }
});
