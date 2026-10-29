// Browser tests — Initiative 6.0 four-engine estimate architecture.
// Run with: npm run test:browser (preview server on :4419).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { pricing, pricingValue } from '../../src/config/pricing.ts';
import { calculateChurchEstimate } from '../../src/lib/estimate/commercial.ts';
import { formatUsd } from '../../src/lib/format.ts';

const PORT = 4419;
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

test('the estimate hub presents the four engines with the right destinations', async () => {
  const { context, page } = await open('/estimate/');
  try {
    const cards = page.locator('.estimate-hub__card');
    assert.equal(await cards.count(), 4, 'four engine cards');
    const hrefs = await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')));
    assert.deepEqual(hrefs, [
      '/estimate/residential/',
      '/estimate/commercial/',
      '/estimate/str/',
      '/estimate/church/',
    ]);
    const text = await page.locator('.estimate-hub').innerText();
    for (const label of ['Residential Cleaning', 'Commercial Cleaning', 'Short-Term Rental Turnovers', 'Church Cleaning']) {
      assert.ok(text.includes(label), `${label} card present`);
    }
    // One authoritative turnover pathway: the residential wizard does not
    // offer STR as a fourth service choice.
    const strChoice = page.locator('[data-service-fieldset] label.option', {
      has: page.locator('input[value="str_turnover"]'),
    });
    assert.equal(await strChoice.isVisible(), false, 'STR is not offered in the residential service grid');
  } finally {
    await context.close();
  }
});

test('a residential service preset preselects the service, frequency and supportive pathway', async () => {
  const { context, page } = await open('/estimate/residential/?service=deep');
  try {
    assert.equal(await page.locator('input[name="serviceType"][value="deep"]').isChecked(), true);
    assert.equal(await page.locator('#est-frequency').inputValue(), 'one_time');
    // The supportive block lives on step 3; assert its visibility state rather
    // than its on-screen presence while step 1 is active.
    assert.equal(await page.locator('[data-supportive-section]').evaluate((el) => el.hidden), false);
    assert.equal(await page.locator('[data-engine-note]').isVisible(), false);
  } finally {
    await context.close();
  }
});

test('the supportive preset opens the optional 10% pathway without preselecting eligibility', async () => {
  const { context, page } = await open('/estimate/residential/?service=supportive&supportive=yes');
  try {
    assert.equal(await page.locator('input[name="serviceType"][value="standard"]').isChecked(), true);
    assert.equal(await page.locator('[data-supportive-section]').evaluate((el) => el.hidden), false);
    const eligible = page.locator('input[name="supportiveEligible"]');
    assert.equal(await eligible.count(), 1);
    assert.equal(await eligible.isChecked(), false, 'eligibility is never preselected');
    assert.equal(await page.locator('a[href="/supportive-home-cleaning/"]').count() >= 1, true);
    assert.equal(await page.locator('a[href="/terms/#community-support"]').count(), 1);
    assert.equal(await page.locator('#est-supportive-notes').count(), 0, 'the large notes field is removed');
  } finally {
    await context.close();
  }
});

test('the STR page runs the turnover engine without a second service choice', async () => {
  const { context, page } = await open('/estimate/str/');
  try {
    assert.equal(await page.locator('[data-estimate-form]').count(), 1, 'one wizard');
    await page.waitForFunction(() => document.querySelector('[data-engine-note]')?.hidden === false);
    assert.equal(await page.locator('input[name="serviceType"][value="str_turnover"]').isChecked(), true);
    assert.equal(await page.locator('[data-service-fieldset]').isVisible(), false, 'no duplicate service picker');
    const headings = await page.locator('[data-step-title]').allTextContents();
    assert.equal(headings[0].trim(), 'When & Where');
    assert.equal(headings[4].trim(), 'Your Turnover Estimate');
    // Turnover-specific facts are enabled; the residential supportive block is not.
    assert.equal(
      await page.locator('#est-rental-properties').evaluate((el) => el.closest('[data-str-only]').hidden),
      false,
    );
    assert.equal(
      await page.locator('#est-turnover-frequency').evaluate((el) => el.closest('[data-str-only]').hidden),
      false,
    );
    assert.equal(await page.locator('[data-supportive-section]').evaluate((el) => el.hidden), true);
  } finally {
    await context.close();
  }
});

test('the commercial engine uses the shared address finder and has no church content', async () => {
  const { context, page } = await open('/estimate/commercial/');
  try {
    assert.equal(await page.locator('[data-facility-form][data-engine="commercial"]').count(), 1);
    assert.equal(await page.locator('[data-address-finder]').count(), 1, 'shared location finder present');
    assert.equal(await page.locator('[data-estimate-form]').count(), 0, 'no residential wizard');
    assert.equal(await page.locator('.church-commitment').count(), 0, 'no church discount block');
    assert.equal(await page.locator('a[href="/estimate/"][href]').count() >= 1, true);
  } finally {
    await context.close();
  }
});

test('the church engine presents the owner-directed 10% discount and optional partnership', async () => {
  const { context, page } = await open('/estimate/church/');
  try {
    const commitment = page.locator('.church-commitment');
    assert.equal(await commitment.count(), 1);
    const text = await commitment.innerText();
    assert.match(text, new RegExp(`${pricing.churchDiscount.percent.value}% off eligible cleaning services`));
    assert.match(text, /not a charitable donation/);
    const partnership = page.locator('input[name^="partnership_"]');
    assert.equal(await partnership.count(), 5, 'five optional partnership choices');
    for (let index = 0; index < 5; index += 1) {
      assert.equal(await partnership.nth(index).isChecked(), false, 'none preselected');
    }
    assert.equal(await page.locator('[data-address-finder]').count(), 1);
  } finally {
    await context.close();
  }
});

async function completeFacilityStepOne(page, organization = 'Test facility (please ignore)') {
  await page.fill('#fac-org', organization);
  await page.fill('#fac-name', 'Test Contact');
  await page.evaluate(() => {
    const details = document.querySelector('[data-address-manual-details]');
    if (details instanceof HTMLDetailsElement) details.open = true;
  });
  await page.fill('#est-address', '100 S Baylen St');
  await page.fill('#est-address-city', 'Pensacola');
  await page.fill('#est-zip', '32502');
  await page.click('[data-facility-next]');
  await page.waitForFunction(() => document.querySelector('[data-facility-step-panel="2"]')?.hidden === false);
}

async function reachFacilityReview(page) {
  await page.click('[data-facility-next]');
  await page.selectOption('#fac-window', { index: 1 });
  await page.click('[data-facility-next]');
  await page.waitForFunction(() => document.querySelector('[data-facility-step-panel="4"]')?.hidden === false);
  await page.waitForFunction(() => document.querySelector('[data-estimate-reveal]')?.hidden === true);
}

test('the facility form validates the current step with field-specific messages', async () => {
  const { context, page } = await open('/estimate/commercial/');
  try {
    await page.click('[data-facility-next]');
    const summary = (await page.locator('[data-error-summary]').innerText()) ?? '';
    assert.match(summary, /Enter the business or organization name/i);
    assert.match(summary, /Enter the contact name for this request/i);
    assert.doesNotMatch(summary, /ZIP code/i, 'the optional facility ZIP must not block step one');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'fac-org');
    assert.equal(await page.locator('[data-facility-step-panel="2"]').evaluate((el) => el.hidden), true);
    await completeFacilityStepOne(page);
    assert.equal(await page.locator('[data-facility-step-panel="2"]').evaluate((el) => el.hidden), false);
    assert.equal(await page.locator('[data-facility-step-panel="1"]').evaluate((el) => el.hidden), true);
  } finally {
    await context.close();
  }
});

test('the commercial engine shows a preliminary per-visit price for an ordinary office', async () => {
  const { context, page } = await open('/estimate/commercial/');
  try {
    await completeFacilityStepOne(page);
    await page.selectOption('#fac-type', 'office');
    await page.fill('#fac-sqft', '2000');
    await page.fill('#fac-restrooms', '6');
    await page.selectOption('#fac-frequency', 'weekly');
    await page.selectOption('#fac-condition', 'average');
    await reachFacilityReview(page);
    await page.waitForSelector('[data-facility-estimate]:not([hidden])');
    const price = (await page.locator('[data-facility-estimate-price]').textContent()) ?? '';
    assert.match(price, /^\$\d+/);
    const value = Number(price.replace(/[^0-9]/g, ''));
    assert.ok(value >= pricingValue(pricing.minimumJob), `preliminary per-visit price is at least the minimum (${price})`);
    const note = (await page.locator('[data-facility-estimate-note]').textContent()) ?? '';
    assert.match(note, /Nonbinding preliminary estimate/i);
    const tax = (await page.locator('[data-facility-estimate-tax]').textContent()) ?? '';
    assert.match(tax, /sales tax of 7\.5% applies|taxable at 7\.5%/i);
    const reviewNote = (await page.locator('[data-facility-review-note]').textContent()) ?? '';
    assert.match(reviewNote, /nonbinding preliminary estimate/i, 'a priced request is not called a scope review');
    assert.doesNotMatch(reviewNote, /scope-review request/i);
  } finally {
    await context.close();
  }
});

test('the church engine reconciles the configured discount and routes very large scopes to review', async () => {
  const { context, page } = await open('/estimate/church/');
  try {
    await completeFacilityStepOne(page, 'Test Church (please ignore)');
    await page.fill('#fac-sqft', '4000');
    await page.fill('#fac-restrooms', '6');
    await page.selectOption('#fac-frequency', 'weekly');
    await reachFacilityReview(page);
    await page.waitForSelector('[data-facility-estimate]:not([hidden])');
    const lines = (await page.locator('[data-facility-estimate-lines]').innerText()) ?? '';
    if (pricing.churchDiscount.enabled.value) {
      const percent = pricing.churchDiscount.percent.value;
      assert.ok(lines.includes(`Church discount (${percent}%)`));
      assert.match(lines, /Subtotal after discount/i);
      const expected = calculateChurchEstimate({
        cleanableSqft: 4000,
        restroomFixtures: 6,
        breakroom: false,
        frequency: 'weekly',
      });
      assert.ok(expected.price.discount);
      assert.ok(lines.includes(formatUsd(expected.price.discount.amount, { forceCents: true })));
      const priceText = (await page.locator('[data-facility-estimate-price]').textContent()) ?? '';
      assert.equal(priceText, formatUsd(expected.price.total, { forceCents: true }), 'the exact discounted price reconciles');
    }
    const tax = (await page.locator('[data-facility-estimate-tax]').textContent()) ?? '';
    assert.match(tax, /unless a current Florida exemption certificate is on file/i);
    // A very large facility must not receive an invented number. Return to the
    // scope step, change the size, and advance back to the final review.
    await page.click('[data-facility-step-jump="2"]');
    await page.fill('#fac-sqft', '30000');
    await page.fill('#fac-restrooms', '24');
    await reachFacilityReview(page);
    await page.waitForFunction(
      () => document.querySelector('[data-facility-estimate-price]')?.textContent?.includes('confirm this with you'),
    );
    const reviewText = (await page.locator('[data-facility-estimate-price]').textContent()) ?? '';
    assert.match(reviewText, /confirm this with you/i);
    const reviewNote = (await page.locator('[data-facility-review-note]').textContent()) ?? '';
    assert.match(reviewNote, /personal review/i, 'Tier C is described as a personal review');
    assert.doesNotMatch(reviewNote, /nonbinding preliminary estimate/i);
  } finally {
    await context.close();
  }
});

test('mobile hub and church form stay inside the viewport', async () => {
  for (const path of ['/estimate/', '/estimate/church/']) {
    const { context, page } = await open(path, 390, 844);
    try {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert.ok(overflow <= 1, `${path} has no horizontal overflow (${overflow}px)`);
    } finally {
      await context.close();
    }
  }
});
