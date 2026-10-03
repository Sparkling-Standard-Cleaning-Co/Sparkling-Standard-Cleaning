// Browser tests — six-step wizard navigation, navigator behavior, fresh-start
// guarantees, validation, submission failure handling and mobile overflow.
//
// Run with: npm run test:browser   (builds first, then serves the build on :4399)
//
// Uses the project's own Playwright devDependency; no @playwright/test runner.
// Provider APIs are mocked (page.route) — no external service is contacted.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4399;
const BASE = `http://localhost:${PORT}`;
// Dynamic booking date: the 60-day advance window makes fixed dates stale.
const BOOKING_DATE = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

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

async function mockApis(page) {
  await page.route('**/api/geocode', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, suggestions: [] }),
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
  // The map is an enhancement; keep tile traffic off in the test suite.
  await page.route('**tiles.openfreemap.org/**', (route) => route.abort());
}

async function openWizard(width, height) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await mockApis(page);
  await page.goto(BASE + '/estimate/', { waitUntil: 'load' });
  await page.addStyleTag({ content: '.mobile-action-bar,.consent-banner{display:none!important}' });
  await page.click('[data-address-manual-summary]');
  return { context, page };
}

const activeStep = (page) =>
  page.evaluate(() => {
    const active = document.querySelector('.wizard__step[data-active="true"]');
    return active ? Number(active.getAttribute('data-step')) : null;
  });

const isVisible = (page, selector) => page.locator(selector).isVisible();

async function fillStepOne(page, zip = '32503') {
  await page.click('label.option:has(input[name="serviceType"][value="standard"])');
  await page.fill('#est-address', '100 S Baylen St');
  await page.fill('#est-zip', zip);
  await page.click('[data-next]');
}

async function fillHome(page) {
  await page.selectOption('#est-property', 'house');
  await page.fill('#est-sqft', '1600');
  await page.fill('#est-bedrooms', '3');
  await page.fill('#est-full-baths', '2');
  await page.fill('#est-half-baths', '0');
  await page.click('[data-next]');
}

async function fillCondition(page) {
  await page.selectOption('#est-frequency', 'biweekly');
  await page.click('label.option:has(input[name="condition"][value="maintained"])');
  await page.selectOption('#est-last-clean', 'within_month');
  await page.selectOption('#est-pets', 'none');
  await page.click('[data-next]');
}

async function fillExtrasAndScheduling(page) {
  await page.click('[data-next]'); // step 4: no add-ons
  await page.fill('#est-date', BOOKING_DATE);
  await page.selectOption('#est-arrival', 'morning');
  await page.click('[data-next]');
}

// ── Navigation contract at every viewport ────────────────────────────────────

for (const [name, width, height] of [
  ['mobile', 360, 740],
  ['tablet', 768, 1024],
  ['desktop', 1440, 900],
]) {
  test(`six-step navigation contract (${name})`, async () => {
    const { context, page } = await openWizard(width, height);
    try {
      // Navigator: six items, first current, future steps locked.
      assert.equal(await page.locator('[data-step-item]').count(), 6);
      assert.equal(await page.locator('.wizard__step').count(), 6);
      assert.equal(await page.locator('[data-step-item="1"]').getAttribute('data-state'), 'current');
      assert.equal(await page.locator('[data-step-item="2"]').getAttribute('data-state'), 'upcoming');
      assert.equal(await page.locator('[data-step-jump="2"]').isDisabled(), true, 'future steps cannot be skipped');
      assert.equal(await page.locator('[data-step-jump="1"]').getAttribute('aria-current'), 'step');
      assert.equal(
        await page.locator('[data-step-jump="2"]').getAttribute('aria-label'),
        'Step 2: Your Home',
      );

      assert.equal(await activeStep(page), 1);
      assert.equal(await isVisible(page, '[data-next]'), true, 'Continue visible on step 1');
      assert.equal(await isVisible(page, '[data-back]'), false, 'Back hidden on step 1');
      assert.equal(await isVisible(page, '[data-submit]'), false, 'Submit hidden on step 1');
      assert.equal(await isVisible(page, '[data-estimate-live]'), false, 'live panel hidden initially');
      assert.equal(await isVisible(page, '[data-str-only]'), false, 'STR-only field hidden for standard');
      assert.equal(await isVisible(page, '[data-address-finder]'), true, 'address finder shares step 1');

      await fillStepOne(page);
      assert.equal(await activeStep(page), 2);
      assert.equal(await page.locator('[data-step-item="1"]').getAttribute('data-state'), 'complete');
      assert.equal(await page.locator('[data-step-item="2"]').getAttribute('data-state'), 'current');
      assert.equal(await page.locator('[data-step-jump="1"]').isDisabled(), false, 'completed steps are revisitable');
      await fillHome(page);
      assert.equal(await activeStep(page), 3);
      await fillCondition(page);
      assert.equal(await activeStep(page), 4);
      await fillExtrasAndScheduling(page);
      assert.equal(await activeStep(page), 6);

      // Final step: Back + ONE primary action.
      assert.equal(await isVisible(page, '[data-back]'), true, 'Back visible on final step');
      assert.equal(await isVisible(page, '[data-next]'), false, 'Continue hidden on final step');
      assert.equal(await isVisible(page, '[data-submit]'), true, 'Submit visible on final step');
      const visiblePrimary = await page.locator('.wizard__nav .btn--primary:visible').count();
      assert.equal(visiblePrimary, 1, 'exactly one primary action on the final step');

      await page.click('[data-back]');
      assert.equal(await activeStep(page), 5);
      assert.equal(await isVisible(page, '[data-next]'), true, 'Continue visible after going back');
      assert.equal(await isVisible(page, '[data-submit]'), false, 'Submit hidden after going back');
    } finally {
      await context.close();
    }
  });
}

// ── Navigator revisiting ─────────────────────────────────────────────────────

test('completed steps can be revisited from the navigator without losing answers', async () => {
  const { context, page } = await openWizard(1280, 900);
  try {
    await fillStepOne(page, '32571');
    await fillHome(page);
    assert.equal(await activeStep(page), 3);

    await page.click('[data-step-jump="1"]');
    assert.equal(await activeStep(page), 1, 'navigator jumps back to a completed step');
    assert.equal(await page.locator('input[name="serviceType"][value="standard"]').isChecked(), true);
    assert.equal(await page.inputValue('#est-zip'), '32571', 'answers are preserved');
    assert.equal(await page.inputValue('#est-sqft'), '1600', 'later answers are preserved too');

    // Future steps remain locked from the navigator.
    assert.equal(await page.locator('[data-step-jump="3"]').isDisabled(), true);
  } finally {
    await context.close();
  }
});

// ── Validation blocks advancement ────────────────────────────────────────────

test('step 1 requires a service selection and a ZIP before advancing', async () => {
  const { context, page } = await openWizard(390, 900);
  try {
    await page.click('[data-next]');
    assert.equal(await activeStep(page), 1, 'stayed without a service choice');

    await page.click('label.option:has(input[name="serviceType"][value="standard"])');
    await page.click('[data-next]');
    assert.equal(await activeStep(page), 1, 'stayed without an address');
    assert.equal(await page.locator('#est-address').getAttribute('aria-invalid'), 'true');
    assert.match(
      (await page.locator('[data-error-for="est-address"]').textContent()) ?? '',
      /Please enter your street address/i,
    );

    await page.fill('#est-zip', '32503');
    await page.click('[data-next]');
    assert.equal(await activeStep(page), 1, 'stayed without a street address');

    await page.fill('#est-address', '100 S Baylen St');
    await page.click('[data-next]');
    assert.equal(await activeStep(page), 2, 'advances once step 1 is complete');
  } finally {
    await context.close();
  }
});

// ── Fresh start guarantees ───────────────────────────────────────────────────

test('a reload starts a fresh blank questionnaire at step 1', async () => {
  const { context, page } = await openWizard(390, 900);
  try {
    await fillStepOne(page);
    await fillHome(page);
    assert.equal(await activeStep(page), 3);
    await page.reload({ waitUntil: 'load' });
    assert.equal(await activeStep(page), 1, 'reload returns to step 1');
    assert.equal(await page.inputValue('#est-zip'), '', 'no answers are restored');
    assert.equal(await page.locator('input[name="serviceType"]:checked').count(), 0);
    assert.equal(await page.inputValue('#est-sqft'), '');
    assert.equal(await page.locator('[data-estimate-live]').isVisible(), false, 'no stale price panel');
  } finally {
    await context.close();
  }
});

test('navigating away and back through site navigation starts a fresh estimate', async () => {
  const { context, page } = await openWizard(1280, 900);
  try {
    await fillStepOne(page);
    await fillHome(page);
    await page.goto(BASE + '/about/', { waitUntil: 'load' });
    await page.click('[data-cta="header-estimate"]');
    await page.waitForURL('**/estimate/');
    assert.equal(await activeStep(page), 1, 'a fresh visit starts at step 1');
    assert.equal(await page.inputValue('#est-zip'), '');
  } finally {
    await context.close();
  }
});

test('browser back/forward never resurrects an old questionnaire', async () => {
  const { context, page } = await openWizard(1280, 900);
  try {
    await fillStepOne(page);
    await fillHome(page);
    await page.goto(BASE + '/about/', { waitUntil: 'load' });
    await page.goBack({ waitUntil: 'load' });
    assert.equal(await activeStep(page), 1, 'back navigation starts fresh');
    assert.equal(await page.inputValue('#est-zip'), '', 'no old answers from bfcache');
    assert.equal(await page.locator('input[name="serviceType"]:checked').count(), 0);
  } finally {
    await context.close();
  }
});

test('Start Over clears the questionnaire even though nothing is stored', async () => {
  const { context, page } = await openWizard(1280, 900);
  try {
    await fillStepOne(page);
    assert.equal(await activeStep(page), 2);
    await page.click('[data-estimate-reset]');
    assert.equal(await activeStep(page), 1);
    assert.equal(await page.locator('input[name="serviceType"]:checked').count(), 0);
    assert.equal(await page.inputValue('#est-zip'), '');
    const storedKeys = await page.evaluate(() =>
      Object.keys(window.localStorage).filter((key) => key.includes('estimate') || key.includes('draft')),
    );
    assert.equal(storedKeys.length, 0, 'no estimate draft is stored in localStorage');
  } finally {
    await context.close();
  }
});

// ── Stable step transitions ─────────────────────────────────────────────────

test('step transitions keep the questionnaire in a stable viewport across widths', async () => {
  for (const [width, height] of [[390, 844], [768, 1024], [1280, 900]]) {
    const { context, page } = await openWizard(width, height);
    try {
      await page.click('label.option:has(input[name="serviceType"][value="standard"])');
      await page.fill('#est-address', '100 S Baylen St');
      await page.fill('#est-zip', '32503');
      // Simulate reaching the Continue button at the bottom of the page.
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
      await page.click('[data-next]');
      assert.equal(await activeStep(page), 2, `${width}px: Next advances`);
      const top = await page.evaluate(
        () => document.querySelector('[data-estimate-form]').getBoundingClientRect().top,
      );
      assert.ok(top >= -2 && top <= 220, `${width}px: form visible after Next (top=${Math.round(top)})`);
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
      await page.click('[data-back]');
      const backTop = await page.evaluate(
        () => document.querySelector('[data-estimate-form]').getBoundingClientRect().top,
      );
      assert.ok(backTop >= -2 && backTop <= 220, `${width}px: form visible after Back (top=${Math.round(backTop)})`);
    } finally {
      await context.close();
    }
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
    await fillStepOne(page);
    await fillHome(page);
    await fillCondition(page);
    await fillExtrasAndScheduling(page);
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

// ── Lead submission regression: autofill honeypot + error classification ─────

test('the estimator has no autofill-magnet honeypot and keeps a hidden trap', async () => {
  const { context, page } = await openWizard(1280, 900);
  try {
    assert.equal(await page.locator('input[name="company_website"]').count(), 0, 'the old autofillable trap is gone');
    assert.equal(await page.locator('label:has-text("Company website")').count(), 0, 'no Company website label remains');
    const trap = page.locator('input[name="extra_ref"]');
    assert.equal(await trap.count(), 1, 'the hardened trap field is present');
    assert.equal(await trap.getAttribute('autocomplete'), 'off');
    assert.equal(await trap.getAttribute('data-lpignore'), 'true');
    assert.equal(await trap.getAttribute('tabindex'), '-1');
  } finally {
    await context.close();
  }
});

test('a filled trap field is rejected locally without losing the customer answers', async () => {
  const { context, page } = await openWizard(390, 900);
  try {
    const requests = [];
    await page.route('**/api/lead', async (route) => {
      requests.push(route.request().postData());
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await fillStepOne(page);
    await fillHome(page);
    await fillCondition(page);
    await fillExtrasAndScheduling(page);
    await page.fill('#est-name', 'Browser test (please ignore)');
    await page.fill('#est-phone', '8500000000');
    await page.fill('#est-email', 'owner@sparkling-standard.com');

    // Simulate a bot (or anything else) populating the hidden trap.
    await page.evaluate(() => {
      const trap = document.querySelector('input[name="extra_ref"]');
      if (trap) trap.value = 'https://spam.example';
    });
    await page.click('[data-submit]');
    await page.waitForSelector('[data-form-status][data-state="error"]', { timeout: 20000 });
    const status = (await page.locator('[data-form-status]').textContent()) ?? '';
    assert.match(status, /could not be verified/i, `trap rejection copy: "${status}"`);
    assert.equal(requests.length, 0, 'a trapped submission is never sent');
    assert.equal(await page.inputValue('#est-name'), 'Browser test (please ignore)', 'answers are preserved');
    assert.equal(await page.locator('[data-submit]').isDisabled(), false, 'the customer can try again');
  } finally {
    await context.close();
  }
});

test('relay rejection causes produce distinct, recoverable copy and preserve answers', async () => {
  const { context, page } = await openWizard(390, 900);
  try {
    let mode = 'verification';
    await page.route('**/api/lead', async (route) => {
      const responses = {
        verification: { status: 400, body: { ok: false, error: 'verification_failed' } },
        spam: { status: 403, body: { ok: false, error: 'spam_rejected' } },
        invalid: { status: 400, body: { ok: false, error: 'invalid_request' } },
      };
      const pick = responses[mode];
      await route.fulfill({
        status: pick.status,
        contentType: 'application/json',
        body: JSON.stringify(pick.body),
      });
    });
    await fillStepOne(page);
    await fillHome(page);
    await fillCondition(page);
    await fillExtrasAndScheduling(page);
    await page.fill('#est-name', 'Browser test (please ignore)');
    await page.fill('#est-phone', '8500000000');
    await page.fill('#est-email', 'owner@sparkling-standard.com');

    await page.click('[data-submit]');
    await page.waitForFunction(() =>
      /security check/i.test(document.querySelector('[data-form-status]')?.textContent ?? ''),
    );
    assert.equal(await page.inputValue('#est-name'), 'Browser test (please ignore)', 'answers kept after verification failure');

    mode = 'spam';
    await page.click('[data-submit]');
    await page.waitForFunction(() =>
      /could not be verified/i.test(document.querySelector('[data-form-status]')?.textContent ?? ''),
    );

    mode = 'invalid';
    await page.click('[data-submit]');
    await page.waitForFunction(() =>
      /didn't come through/i.test(document.querySelector('[data-form-status]')?.textContent ?? ''),
    );
    assert.equal(await page.inputValue('#est-email'), 'owner@sparkling-standard.com', 'answers kept after every rejection');
    assert.equal(await page.locator('[data-submit]').isDisabled(), false, 'retry stays available');
  } finally {
    await context.close();
  }
});

// ── Advance-reservation window (60 days, no priority tier) ───────────────────

test('the preferred date is bounded to the configured advance-reservation window', async () => {
  const { context, page } = await openWizard(1280, 900);
  try {
    await fillStepOne(page);
    await fillHome(page);
    await fillCondition(page);
    await page.click('[data-next]'); // step 4 (extras) → step 5 (scheduling)
    const bounds = await page.$eval('#est-date', (input) => ({
      min: input.min,
      max: input.max,
    }));
    assert.match(bounds.min, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(bounds.max, /^\d{4}-\d{2}-\d{2}$/);
    const days = (Date.parse(bounds.max) - Date.parse(bounds.min)) / 86_400_000;
    assert.equal(days, 60, 'the window is exactly 60 days');

    // A date beyond the window is rejected with a clear message.
    const beyond = new Date(Date.parse(bounds.max) + 86_400_000).toISOString().slice(0, 10);
    await page.$eval('#est-date', (input, value) => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, beyond);
    await page.click('[data-next]');
    const message = (await page.locator('[data-error-for="est-date"]').textContent()) ?? '';
    assert.match(message, /60 days ahead/i, `window message: "${message}"`);
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
    await fillStepOne(page);
    assert.ok((await overflow()) <= 1, 'home step overflow');
    await fillHome(page);
    await fillCondition(page);
    await fillExtrasAndScheduling(page);
    assert.ok((await overflow()) <= 1, 'final step overflow');
  } finally {
    await context.close();
  }
});
