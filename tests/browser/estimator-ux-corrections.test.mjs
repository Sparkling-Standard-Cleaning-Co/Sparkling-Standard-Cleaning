// Focused owner corrections (2026-10-29):
//  - compact Community Support checkbox
//  - compact hour/minute appointment picker
//  - photos moved to Condition & Frequency and deferred-confirmation choice
//  - removed "using the details you confirmed" / address-saving copy
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4511;
const BASE = `http://localhost:${PORT}`;
const BOOKING_DATE = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);

let server;
let browser;

before(async () => {
  server = spawn(process.execPath, ['node_modules/astro/astro.js', 'preview', '--port', String(PORT)], {
    stdio: 'ignore',
    windowsHide: true,
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(BASE + '/', { signal: AbortSignal.timeout(1500) })).ok) {
        browser = await chromium.launch();
        return;
      }
    } catch {
      // not ready
    }
    await delay(500);
  }
  throw new Error('preview server did not become ready');
});

after(async () => {
  await browser?.close();
  server?.kill();
});

async function open(width = 1440, height = 1000) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const leadPayloads = [];
  await page.addInitScript(() => {
    localStorage.setItem('pcc-consent-v1', JSON.stringify({ analytics: false, ads: false, v: 1 }));
    localStorage.setItem('pcc-promo-state', JSON.stringify({ state: 'dismissed', at: new Date().toISOString() }));
    sessionStorage.setItem('pcc-promo-shown-session', '1');
  });
  await page.route('**/api/geocode', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.action === 'suggest') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"suggestions":[]}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        result: {
          label: '100 S Baylen St, Pensacola, FL 32502',
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
  await page.route('**/api/estimate-checkout', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"enabled":true,"mode":"live"}' })
      : route.fulfill({ status: 502, contentType: 'application/json', body: '{"ok":false,"error":"stripe_unavailable"}' }),
  );
  await page.route('**/api/photo-upload', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, enabled: true, maxBytes: 8388608, maxCount: 6, maxTotalBytes: 33554432, turnstileRequired: false }),
        })
      : route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            photos: [{ key: 'leads/2026/10/aaaaaaaaaaaaaaaaaaaaaaaa/bathroom-00000000000000000000000000000001.jpg', category: 'bathroom', bytes: 2048, name: 'condition.jpg' }],
          }),
        }),
  );
  await page.route('**/api/lead', async (route) => {
    leadPayloads.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, verification: { status: 'verified', travel_verified: true, travel_method: 'route', config_match: 'match' } }),
    });
  });
  await page.route('**tiles.openfreemap.org/**', (route) => route.abort());
  await page.goto(BASE + '/estimate/residential/', { waitUntil: 'load' });
  await page.addStyleTag({ content: '.mobile-action-bar,.consent-banner,.promo-popup{display:none!important}' });
  return { context, page, leadPayloads };
}

async function stepTwo(page) {
  await page.fill('#est-date', BOOKING_DATE);
  await page.waitForSelector('[data-calendar-period]', { state: 'visible' });
  await page.click('[data-period="first"]');
  await page.locator('[data-address-card]').waitFor({ state: 'visible' });
  await page.fill('#est-address', '100 S Baylen St');
  await page.fill('#est-address-city', 'Pensacola');
  await page.fill('#est-zip', '32502');
  await page.click('[data-address-resolve]');
  await page.locator('[data-address-map]').waitFor({ state: 'visible' });
  await page.locator('[data-address-confirm]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-address-finder]')?.getAttribute('data-state') === 'confirmed',
  );
  await page.click('[data-next]');
  await page.waitForFunction(() => document.querySelector('.wizard__step[data-step="2"]')?.getAttribute('data-active') === 'true');
}

async function reachCondition(page) {
  await stepTwo(page);
  await page.click('label.option:has(input[name="serviceType"][value="standard"])');
  await page.selectOption('#est-property', 'house');
  await page.fill('#est-sqft', '1600');
  await page.fill('#est-bedrooms', '3');
  await page.fill('#est-full-baths', '2');
  await page.fill('#est-half-baths', '0');
  await page.click('[data-next]');
}

async function priceRowText(page) {
  return page.locator('[data-price-breakdown] li').evaluateAll((items) =>
    items
      .map((item) =>
        [...item.children]
          .map((child) => child.textContent?.trim() ?? '')
          .filter(Boolean)
          .join(' '),
      )
      .join(' | '),
  );
}

async function reachRecurringFinal(page) {
  await reachCondition(page);
  await page.selectOption('#est-frequency', 'biweekly');
  await page.waitForSelector('input[name="initialDeepCleanAcknowledged"]', { state: 'visible' });
  await page.check('input[name="initialDeepCleanAcknowledged"]');
  await page.click('label.option:has(input[name="condition"][value="maintained"])');
  await page.selectOption('#est-last-clean', 'within_month');
  await page.selectOption('#est-pets', 'none');
  await uploadPhoto(page);
  await page.click('[data-next]');
  await page.fill('#est-name', 'UX correction test (please ignore)');
  await page.fill('#est-phone', '8500000000');
  await page.fill('#est-email', 'owner@sparkling-standard.com');
  await page.click('[data-next]');
  await page.waitForFunction(() => {
    const summary = document.querySelector('[data-reservation-summary]');
    return (
      summary &&
      !summary.hasAttribute('hidden') &&
      summary.getAttribute('data-revealing') !== 'true' &&
      document.querySelectorAll('[data-price-breakdown] li').length >= 3
    );
  });
}

async function uploadPhoto(page) {
  await page.locator('[data-photo-input]').setInputFiles({
    name: 'condition.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(2048).fill(0)]),
  });
  await page.waitForFunction(() => document.querySelectorAll('[data-photo-grid] img').length >= 1);
}

async function reachFinal(page) {
  await reachCondition(page);
  await page.selectOption('#est-frequency', 'one_time');
  await page.click('label.option:has(input[name="condition"][value="maintained"])');
  await page.selectOption('#est-last-clean', 'within_month');
  await page.selectOption('#est-pets', 'none');
  await uploadPhoto(page);
  await page.click('[data-next]'); // your details
  await page.fill('#est-name', 'UX correction test (please ignore)');
  await page.fill('#est-phone', '8500000000');
  await page.fill('#est-email', 'owner@sparkling-standard.com');
  await page.click('[data-next]'); // extras & payment
  await page.waitForFunction(() => {
    const summary = document.querySelector('[data-reservation-summary]');
    return (
      summary &&
      !summary.hasAttribute('hidden') &&
      summary.getAttribute('data-revealing') !== 'true' &&
      document.querySelectorAll('[data-price-breakdown] li').length >= 3
    );
  });
  const termsInput = page.locator('#est-terms');
    await termsInput.evaluate((element) => { if (!element.checked) element.click(); });
    await page.waitForFunction(() => document.querySelector('#est-terms')?.checked === true);
}

test('Community Support is one small checkbox linked to the terms', async () => {
  const { context, page } = await open();
  try {
    await reachFinal(page);
    const check = page.locator('.supportive-check');
    await check.waitFor({ state: 'visible' });
    assert.equal(await check.isVisible(), true);
    assert.match((await check.innerText()).replace(/\s+/g, ' '), /I qualify for Sparkling Standard.?s 10% Community Support discount\./);
    assert.equal(await check.locator('a[href="/terms/#community-support"]').count(), 1);
    assert.equal(await page.locator('.supportive-block').count(), 0, 'large Community Support box removed');
    assert.equal(await page.locator('textarea[name="supportiveNotes"]').count(), 0, 'supportive notes textarea removed');
    assert.equal(await page.locator('input[name="supportiveEligible"]').isChecked(), false);
  } finally {
    await context.close();
  }
});

test('the time picker is compact and uses the two residential windows', async () => {
  const { context, page } = await open();
  try {
    await page.fill('#est-date', BOOKING_DATE);
    await page.waitForSelector('[data-calendar-period]', { state: 'visible' });
    assert.equal(await page.locator('.booking-calendar__time').count(), 0, 'no large time-button list');
    await page.click('[data-period="first"]');
    const hourOptions = await page.locator('[data-time-hour] option').allTextContents();
    assert.deepEqual(hourOptions, ['07', '08']);
    const minuteOptions = await page.locator('[data-time-minute] option').allTextContents();
    assert.deepEqual(minuteOptions, ['00', '15', '30', '45']);
    assert.equal((await page.locator('[data-time-meridiem]').textContent())?.trim(), 'AM');
    await page.click('[data-period="afternoon"]');
    const afternoonHours = await page.locator('[data-time-hour] option').allTextContents();
    assert.deepEqual(afternoonHours, ['12', '01', '02']);
    assert.equal((await page.locator('[data-time-meridiem]').textContent())?.trim(), 'PM');
  } finally {
    await context.close();
  }
});

test('Step 1 reveals time, address and details progressively', async () => {
  const { context, page } = await open();
  try {
    assert.equal(await page.locator('[data-address-card]').isVisible(), false, 'address waits for a time');
    assert.equal(await page.locator('[data-calendar-period]').isVisible(), false, 'period waits for a date');
    await page.fill('#est-date', BOOKING_DATE);
    await page.waitForSelector('[data-calendar-period]', { state: 'visible' });
    assert.equal(await page.locator('[data-address-card]').isVisible(), false, 'address still waits for a time');
    await page.click('[data-period="first"]');
    await page.locator('[data-address-card]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-address-details]').isVisible(), false, 'city waits for a street');
    await page.fill('#est-address', '100 S Baylen St');
    await page.locator('[data-address-details]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#est-address-city').isVisible(), true);
    assert.equal(await page.locator('#est-zip').isVisible(), true);
  } finally {
    await context.close();
  }
});

test('the Continue button is sticky on mobile', async () => {
  const { context, page } = await open(390, 844);
  try {
    assert.equal(await page.locator('.mobile-action-bar').count(), 0, 'global quick actions are replaced');
    const nav = page.locator('.wizard__nav');
    assert.equal(await nav.evaluate((el) => getComputedStyle(el).position), 'fixed');
    assert.equal(await nav.locator('[data-next]').isVisible(), true);
    assert.equal((await nav.locator('[data-next]').innerText()).trim(), 'Continue');
    assert.equal(await nav.locator('[data-back]').isVisible(), false, 'nothing to go back to on step 1');
  } finally {
    await context.close();
  }
});

test('Your Cleaning Details shows the selected condition and no dirt level', async () => {
  const { context, page } = await open();
  try {
    await reachFinal(page);
    const summary = page.locator('[data-reservation-scope]');
    const text = (await summary.textContent()) ?? '';
    assert.match(text, /Condition/);
    assert.match(text, /Maintained/);
    assert.doesNotMatch(text, /Dirt level/i);
  } finally {
    await context.close();
  }
});

test('the condition selector is the original five explained choices', async () => {
  const { context, page } = await open();
  try {
    await reachCondition(page);
    await page.selectOption('#est-frequency', 'one_time');
    const group = page.locator('fieldset[data-group-error="condition"]');
    assert.equal(await group.isVisible(), true);
    assert.equal(await page.locator('[data-dirt-guide]').count(), 0, 'the ten-level guide is gone');
    assert.equal(await group.locator('input[name="condition"]').count(), 5);
    assert.deepEqual(
      await group.locator('input[name="condition"]').evaluateAll((nodes) => nodes.map((node) => node.value)),
      ['maintained', 'average', 'needs_attention', 'heavy', 'severe'],
    );
    await group.locator('label.option:has(input[value="average"])').click();
    assert.equal(await group.locator('input[name="condition"]:checked').count(), 1);
    assert.match(await group.innerText(), /Average/);
    assert.match(await group.innerText(), /Normal lived-in buildup/);
    assert.match(await group.innerText(), /Severe/);
    assert.match(await group.innerText(), /Needs an in-person review/);
  } finally {
    await context.close();
  }
});

test('Continue without a condition shows the red error and focuses the first choice', async () => {
  const { context, page } = await open(390, 844);
  try {
    await reachCondition(page);
    await page.selectOption('#est-frequency', 'one_time');
    await page.click('[data-next]');
    const group = page.locator('fieldset[data-group-error="condition"]');
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute('name')),
      'condition',
      'the first missing control receives focus',
    );
    assert.equal(await page.locator('[data-error-summary]').isVisible(), true);
    assert.match(await group.locator('.field-error').innerText(), /condition/i);
    await page.waitForTimeout(700);
    const box = await group.locator('input[value="maintained"]').boundingBox();
    assert.ok(box && box.y >= 0 && box.y < 844, 'the invalid section is scrolled into view');
  } finally {
    await context.close();
  }
});
test('photos are in Condition & Frequency, and the last step has no photo upload', async () => {
  const { context, page } = await open();
  try {
    await reachCondition(page);
    await page.selectOption('#est-frequency', 'one_time');
    await page.click('label.option:has(input[name="condition"][value="maintained"])');
    const section = page.locator('[data-photo-section]');
    assert.equal(await section.isVisible(), true);
    assert.equal(
      await section.evaluate((el) => el.closest('[data-step]')?.getAttribute('data-step')),
      '3',
    );
    await page.selectOption('#est-last-clean', 'within_month');
    await page.selectOption('#est-pets', 'none');
    await uploadPhoto(page);
    await page.click('[data-next]');
    await page.click('[data-next]');
    assert.equal(await page.locator('[data-step="5"] [data-photo-section]').count(), 0);
  } finally {
    await context.close();
  }
});

test('Continue without photos opens the compact photo choice and Later advances', async () => {
  const { context, page, leadPayloads } = await open();
  try {
    await reachCondition(page);
    await page.selectOption('#est-frequency', 'one_time');
    await page.click('label.option:has(input[name="condition"][value="maintained"])');
    await page.selectOption('#est-last-clean', 'within_month');
    await page.selectOption('#est-pets', 'none');
    await page.click('[data-next]');
    const gate = page.locator('[data-photo-gate]');
    await gate.waitFor({ state: 'visible' });
    assert.match((await gate.innerText()).replace(/\s+/g, ' '), /Photos of Your Space/);
    assert.equal(await page.locator('[data-photo-pay-later]').isVisible(), true);
    assert.equal(leadPayloads.length, 0);
    await page.click('[data-photo-pay-later]');
    assert.equal(
      await page.evaluate(() => document.querySelector('.wizard__step[data-active="true"]')?.getAttribute('data-step')),
      '4',
      'Later continues normally',
    );
  } finally {
    await context.close();
  }
});

test('the removed review and address-saving copy is absent', async () => {
  const { context, page } = await open();
  try {
    const body = (await page.textContent('body')) ?? '';
    assert.doesNotMatch(body, /USING THE DETAILS YOU CONFIRMED/i);
    assert.doesNotMatch(body, /Saving your address so we can prepare/i);
    await page.fill('#est-date', BOOKING_DATE);
    await page.waitForSelector('[data-calendar-period]', { state: 'visible' });
    await page.click('[data-period="first"]');
    await page.locator('[data-address-card]').waitFor({ state: 'visible' });
    await page.fill('#est-address', '100 S Baylen St');
    await page.fill('#est-address-city', 'Pensacola');
    await page.fill('#est-zip', '32502');
    await page.click('[data-next]');
    await page.waitForTimeout(500);
    const after = (await page.textContent('body')) ?? '';
    assert.doesNotMatch(after, /Saving your address so we can prepare/i);
    assert.doesNotMatch(after, /USING THE DETAILS YOU CONFIRMED/i);
  } finally {
    await context.close();
  }
});
test('final checkout shows calculated add-on prices and bundle savings', async () => {
  const { context, page } = await open();
  try {
    await reachFinal(page);
    await page.locator('[data-extras-accordion] summary').click();
    const step = await page.evaluate(() =>
      document.querySelector('[data-addon-price]')?.closest('[data-step]')?.getAttribute('data-step'),
    );
    assert.equal(step, '5', 'extras live in the final checkout step');
    const oven = page.locator('[data-addon-price="inside_oven"]');
    assert.match((await oven.textContent()) ?? '', /\$\d/, 'individual extra shows a dollar price');
    assert.doesNotMatch((await oven.textContent()) ?? '', /Optional extra|Calculating/i);
    const bundles = page.locator('.bundle-offer');
    assert.ok((await bundles.count()) >= 6, 'expanded bundle menu is present');
    await page.locator('label.option:has(input[name="addons"][value="inside_oven"])').click();
    await page.waitForFunction(() =>
      /\$\d/.test(document.querySelector('[data-addon-price="inside_oven"]')?.textContent ?? ''),
    );
    const bundleText = (await page.locator('.bundle-offers').innerText()).replace(/\s+/g, ' ');
    assert.match(bundleText, /\$\d+.*save|save.*\$\d+/i, 'bundle price and savings are shown');
  } finally {
    await context.close();
  }
});

test('the add-ons and cleaning-details accordions are independent and correctly titled', async () => {
  const { context, page } = await open();
  try {
    await reachFinal(page);
    const addons = page.locator('[data-extras-accordion]');
    const details = page.locator('[data-cleaning-details]');
    assert.equal(
      (await addons.locator('summary .extras-accordion__heading').textContent()).trim(),
      'Bundle and Save With These Add-Ons',
    );
    assert.equal(
      (await details.locator('summary .extras-accordion__heading').textContent()).trim(),
      'Your Cleaning Details',
    );
    assert.equal(await addons.evaluate((el) => el.open), false, 'add-ons start collapsed');
    assert.equal(await details.evaluate((el) => el.open), false, 'cleaning details start collapsed');

    await details.locator('summary').click();
    assert.equal(await details.evaluate((el) => el.open), true);
    const summary = (await page.locator('[data-reservation-scope]').textContent()).replace(/\s+/g, ' ');
    for (const expected of [
      'Cleaning type',
      'Frequency',
      'Extras',
      'Preferred date',
      'Preferred start',
      'Status',
      'Service address',
      'Travel',
    ]) {
      assert.ok(summary.includes(expected), `cleaning details includes ${expected}`);
    }

    await addons.locator('summary').click();
    assert.equal(await addons.evaluate((el) => el.open), true);
    assert.equal(await details.evaluate((el) => el.open), true, 'opening add-ons leaves details open');
    await addons.locator('summary').click();
    assert.equal(await addons.evaluate((el) => el.open), false);
    assert.equal(await details.evaluate((el) => el.open), true, 'closing add-ons leaves details open');

    await details.locator('summary').click();
    assert.equal(await details.evaluate((el) => el.open), false);
  } finally {
    await context.close();
  }
});

test('the final price breakdown is one full-width row per financial item', async () => {
  for (const [width, height] of [
    [1440, 1000],
    [390, 844],
    [360, 780],
  ]) {
    const { context, page } = await open(width, height);
    try {
      await reachFinal(page);
      const rows = page.locator('[data-price-breakdown] li');
      assert.ok((await rows.count()) >= 3);
      const columns = await page
        .locator('[data-price-breakdown]')
        .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length);
      assert.equal(columns, 1, `one pricing column at ${width}px`);
      const tops = await rows.evaluateAll((items) =>
        items.map((item) => Math.round(item.getBoundingClientRect().top)),
      );
      assert.equal(new Set(tops).size, tops.length, `every price item owns its row at ${width}px`);
      const widths = await rows.evaluateAll((items) =>
        items.map((item) => item.getBoundingClientRect().width),
      );
      assert.ok(widths.every((rowWidth) => rowWidth > 200), `price rows use the available width at ${width}px`);
      const alignments = await rows.evaluateAll((items) =>
        items.map((item) => getComputedStyle(item.lastElementChild).textAlign),
      );
      assert.ok(alignments.every((alignment) => alignment === 'right'));
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      assert.equal(overflow, false, `no horizontal overflow at ${width}px`);
    } finally {
      await context.close();
    }
  }
});

test('recurring first-visit pricing keeps the true price and totals on separate rows', async () => {
  const { context, page } = await open(390, 844);
  try {
    await reachRecurringFinal(page);
    const breakdown = await priceRowText(page);
    assert.match(breakdown, /True Deep Cleaning Price/);
    assert.match(breakdown, /FIRST VISIT TOTAL/);
    assert.match((await page.locator('[data-reservation-ongoing]').innerText()).trim(), /\$[\d,.]+ .*Biweekly Thereafter/);
    const tops = await page.locator('[data-price-breakdown] li').evaluateAll((items) =>
      items.map((item) => Math.round(item.getBoundingClientRect().top)),
    );
    assert.equal(new Set(tops).size, tops.length, 'no two pricing items share a row');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    assert.equal(overflow, false);
  } finally {
    await context.close();
  }
});

test('the final step has one green pay action, one pay-later action and a stacked total', async () => {
  const { context, page } = await open();
  try {
    await reachFinal(page);
    const actions = page.locator('.wizard__final-actions');
    assert.equal(await actions.isVisible(), true);
    assert.equal(await page.locator('[data-pay-now]').count(), 1, 'no duplicate pay button in the form');
    assert.equal(await page.locator('[data-pay-now]').isVisible(), true);
    assert.equal(await page.locator('[data-pay-now]').evaluate((el) => el.classList.contains('btn--success')), true);
    assert.match((await page.locator('[data-pay-now]').innerText()).trim(), /Pay Now and Reserve This Cleaning/);
    assert.match((await page.locator('[data-submit]').innerText()).trim(), /Request to Reserve This Cleaning \(Pay Later\)/);
    const breakdown = await priceRowText(page);
    assert.match(breakdown, /Sales tax \$0\.00/);
    assert.match(breakdown, /ESTIMATED TOTAL \$/);
    assert.equal(await page.locator('[data-extras-accordion]').evaluate((el) => el.open), false, 'extras start collapsed');
    assert.match((await page.locator('[data-extras-summary]').innerText()).trim(), /No extras selected/);
    const support = page.locator('[data-supportive-section]');
    await support.waitFor({ state: 'visible' });
    assert.equal(
      await support.evaluate((el) => el.nextElementSibling?.classList.contains('terms-acceptance')),
      true,
      'Community Support sits immediately before the terms acceptance',
    );
  } finally {
    await context.close();
  }
});