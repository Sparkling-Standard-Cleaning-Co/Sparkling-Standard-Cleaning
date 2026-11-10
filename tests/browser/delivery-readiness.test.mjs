// Browser regression test — runtime request-delivery readiness.
//
// The static build must never declare delivery disconnected just because the
// public fallback key is absent. The warning may only appear when the Pages
// Function explicitly reports no delivery path.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4428;
const BASE = `http://localhost:${PORT}`;
const ESTIMATE_PATHS = [
  '/estimate/residential/',
  '/estimate/str/',
  '/estimate/commercial/',
  '/estimate/church/',
];

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

async function openWithReadiness(path, readiness) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('pcc-consent-v1', JSON.stringify({ analytics: false, ads: false, v: 1 }));
    localStorage.setItem('pcc-promo-state', JSON.stringify({ state: 'dismissed', at: new Date().toISOString() }));
    sessionStorage.setItem('pcc-promo-shown-session', '1');
  });
  await page.route('**/api/lead-readiness', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        ready: readiness,
        checks: {
          owner_email: readiness,
          database: true,
          customer_email: true,
          turnstile: false,
          photo_storage: true,
        },
        version: 2,
      }),
    });
  });
  await page.goto(BASE + path, { waitUntil: 'load' });
  await page.waitForFunction(
    (ready) =>
      document.documentElement.dataset.deliveryStatus === (ready ? 'ready' : 'unavailable'),
    readiness,
  );
  return { context, page };
}

for (const path of ESTIMATE_PATHS) {
  test(`${path} hides the delivery warning when the production relay is ready`, async () => {
    const { context, page } = await openWithReadiness(path, true);
    try {
      const warning = page.locator('[data-delivery-warning]');
      assert.equal(await warning.count(), 1, 'one delivery warning node');
      assert.equal(await warning.isVisible(), false, 'no false preview warning');
      assert.equal(await warning.textContent(), '');
    } finally {
      await context.close();
    }
  });
}

test('the warning appears only when the server explicitly reports no delivery path', async () => {
  const { context, page } = await openWithReadiness('/estimate/residential/', false);
  try {
    const warning = page.locator('[data-delivery-warning]');
    assert.equal(await warning.isVisible(), true);
    assert.match((await warning.textContent()) ?? '', /temporarily unavailable|not connected/i);
  } finally {
    await context.close();
  }
});

test('the contact form uses the same runtime readiness contract', async () => {
  const { context, page } = await openWithReadiness('/contact/', true);
  try {
    const warning = page.locator('[data-delivery-warning]');
    assert.equal(await warning.count(), 1);
    assert.equal(await warning.isVisible(), false);
  } finally {
    await context.close();
  }
});
