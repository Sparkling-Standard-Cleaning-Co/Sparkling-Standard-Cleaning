// Browser tests — estimate wizard navigation, final-step actions, validation,
// double-submission prevention, draft restore, and mobile overflow.
//
// Run with: npm run test:browser   (builds first, then serves the build on :4399)
//
// Uses the project's own Playwright devDependency; no @playwright/test runner.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4399;
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

async function openWizard(width, height) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.addStyleTag({
    content: '.mobile-action-bar{display:none!important} .site-header{position:static!important}',
  });
  await page.goto(BASE + '/estimate/', { waitUntil: 'load' });
  return { context, page };
}

const activeStep = (page) =>
  page.evaluate(() => {
    const active = document.querySelector('.wizard__step[data-active="true"]');
    return active ? Number(active.getAttribute('data-step')) : null;
  });

const isVisible = (page, selector) => page.locator(selector).isVisible();

async function fillStep1(page, zip = '32503') {
  await page.click('label.option:has(input[name="serviceType"][value="standard"])');
  await page.fill('#est-zip', zip);
  await page.click('[data-next]');
}

async function fillStep2(page) {
  await page.selectOption('#est-property', 'house');
  await page.fill('#est-sqft', '1600');
  await page.fill('#est-bedrooms', '3');
  await page.fill('#est-full-baths', '2');
  await page.fill('#est-half-baths', '0');
  await page.click('[data-next]');
}

async function fillStep3(page) {
  await page.selectOption('#est-frequency', 'biweekly');
  await page.click('label.option:has(input[name="condition"][value="maintained"])');
  await page.selectOption('#est-last-clean', 'within_month');
  await page.selectOption('#est-pets', 'none');
  await page.click('[data-next]');
}

async function fillStep4And5(page) {
  await page.click('[data-next]'); // step 4: no add-ons
  await page.fill('#est-date', '2026-12-01');
  await page.selectOption('#est-arrival', 'morning');
  await page.click('[data-next]');
}

// ── Navigation contract at every viewport ────────────────────────────────────

for (const [name, width, height] of [
  ['mobile', 360, 740],
  ['tablet', 768, 1024],
  ['desktop', 1440, 900],
]) {
  test(`wizard navigation contract (${name})`, async () => {
    const { context, page } = await openWizard(width, height);
    try {
      // Step 1: Back and submit hidden, Continue visible.
      assert.equal(await activeStep(page), 1);
      assert.equal(await isVisible(page, '[data-next]'), true, 'Continue visible on step 1');
      assert.equal(await isVisible(page, '[data-back]'), false, 'Back hidden on step 1');
      assert.equal(await isVisible(page, '[data-submit]'), false, 'Submit hidden on step 1');
      // Same hidden-attribute defect surface: the live result panel and the
      // STR-only field must stay hidden until their conditions are met.
      assert.equal(await isVisible(page, '[data-estimate-live]'), false, 'live panel hidden initially');
      assert.equal(await isVisible(page, '[data-str-only]'), false, 'STR-only field hidden for standard');

      await fillStep1(page);
      assert.equal(await activeStep(page), 2);
      await fillStep2(page);
      assert.equal(await activeStep(page), 3);
      await fillStep3(page);
      assert.equal(await activeStep(page), 4);
      await fillStep4And5(page);
      assert.equal(await activeStep(page), 6);

      // Final step: Back + ONE primary action labelled Send My Request.
      assert.equal(await isVisible(page, '[data-back]'), true, 'Back visible on final step');
      assert.equal(await isVisible(page, '[data-next]'), false, 'Continue hidden on final step');
      assert.equal(await isVisible(page, '[data-submit]'), true, 'Submit visible on final step');
      const submitLabel = (await page.locator('[data-submit]').textContent())?.trim();
      assert.match(submitLabel ?? '', /Send My Request/i);

      const visiblePrimary = await page
        .locator('.wizard__nav .btn--primary:visible')
        .count();
      assert.equal(visiblePrimary, 1, 'exactly one primary action on the final step');

      // Back navigation restores Continue and hides the final submit.
      await page.click('[data-back]');
      assert.equal(await activeStep(page), 5);
      assert.equal(await isVisible(page, '[data-next]'), true, 'Continue visible after going back');
      assert.equal(await isVisible(page, '[data-submit]'), false, 'Submit hidden after going back');
    } finally {
      await context.close();
    }
  });
}

// ── Validation blocks advancement ────────────────────────────────────────────

test('step 1 does not advance without a service selection', async () => {
  const { context, page } = await openWizard(390, 900);
  try {
    await page.fill('#est-zip', '32503');
    await page.click('[data-next]');
    assert.equal(await activeStep(page), 1, 'stayed on step 1 without a required choice');
  } finally {
    await context.close();
  }
});

// ── Draft restore ────────────────────────────────────────────────────────────

test('saved draft restores the step after reload', async () => {
  const { context, page } = await openWizard(390, 900);
  try {
    await fillStep1(page);
    await fillStep2(page);
    assert.equal(await activeStep(page), 3);
    await page.reload({ waitUntil: 'load' });
    assert.equal(await activeStep(page), 3, 'draft restored to the saved step');
  } finally {
    await context.close();
  }
});

// ── Double-submission prevention + honest failure ────────────────────────────

test('final submit disables while sending and reports honest failure', async () => {
  const { context, page } = await openWizard(390, 900);
  try {
    await page.route('**/api/lead', async (route) => {
      await delay(1200);
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'not_configured' }),
      });
    });
    await fillStep1(page);
    await fillStep2(page);
    await fillStep3(page);
    await fillStep4And5(page);
    await page.fill('#est-name', 'Browser test (please ignore)');
    await page.fill('#est-phone', '8500000000');
    await page.fill('#est-email', 'owner@sparkling-standard.com');

    await page.click('[data-submit]');
    await delay(250);
    assert.equal(await page.locator('[data-submit]').isDisabled(), true, 'disabled while sending');

    await page.waitForSelector('[data-form-status][data-state="error"]', { timeout: 20000 });
    const status = (await page.locator('[data-form-status]').textContent()) ?? '';
    assert.match(status, /not connected|could not|try again/i, `honest failure copy: "${status}"`);
    assert.equal(await page.locator('[data-submit]').isDisabled(), false, 're-enabled after failure');
  } finally {
    await context.close();
  }
});

// ── Overflow across the wizard ───────────────────────────────────────────────

test('no horizontal overflow while advancing the wizard at 360px', async () => {
  const { context, page } = await openWizard(360, 740);
  try {
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok((await overflow()) <= 1, 'step 1 overflow');
    await fillStep1(page);
    assert.ok((await overflow()) <= 1, 'step 2 overflow');
    await fillStep2(page);
    await fillStep3(page);
    await fillStep4And5(page);
    assert.ok((await overflow()) <= 1, 'final step overflow');
  } finally {
    await context.close();
  }
});
