// Regression test for Hayli's homepage audit — explicitly verifies that the
// rendered homepage carries all five complete approved service descriptions,
// including the mandatory Deep Cleaning recurring prerequisite.
//
// Run with: npm run test:browser (preview server on :4416).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4416;
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

const approved = [
  {
    title: 'Recurring Residential Cleaning',
    copy:
      'A consistent, scheduled cleaning that keeps your home maintained, tidy, and sparkling. Choose a weekly, biweekly, or monthly schedule to keep your home looking its best.',
  },
  {
    title: 'Deep Cleaning',
    copy:
      'An in-depth reset for a home that needs extra care and attention. Our deep cleaning service focuses on areas that can get buildup over time, from hand wiping baseboards and blinds to detailing walls and doors (See our Deep Cleaning procedure and available add-ons for a full list of services). We go beyond the basics to leave your home feeling renewed, and thoroughly clean.',
  },
  {
    title: 'Move-in and Move-out Cleaning',
    copy:
      'Give your home a fresh start with a thorough, top-to-bottom cleaning. Whether you’re moving into a new home or preparing to sell or rent your property, we’ll leave it sparkling clean, and ready for its next residents.',
  },
  {
    title: 'Short-term Rental Turnover Cleaning',
    copy:
      'A complete turnover service for Airbnb and Vrbo hosts that protects your reviews and keeps bookings coming. More than a quick clean, we provide a reset between guests to help ensure your rental is sanitary, refreshed, and ready for the next arrival.',
  },
  {
    title: 'Commercial Cleaning',
    copy:
      'Recurring or one-time commercial cleaning for local businesses and facilities. Each service is professionally scoped to your space, with scheduling tailored to your operation’s needs.',
  },
];

const deepPrerequisite =
  'This service is ideal for one-time cleanings and is required before beginning recurring residential maintenance cleaning. It’s also recommended for returning clients when dirt, grime, or buildup begins to accumulate beyond what routine maintenance cleaning is designed to address.';

const normalize = (value) => value.replace(/\s+/g, ' ').trim();

for (const [label, width, height] of [
  ['desktop', 1440, 1000],
  ['mobile', 390, 844],
]) {
  test(`homepage renders all five complete service descriptions (${label})`, async () => {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    try {
      await page.goto(BASE + '/', { waitUntil: 'load' });
      await page.locator('#services').scrollIntoViewIfNeeded();

      const cards = page.locator('.service-card');
      assert.equal(await cards.count(), 5, 'five primary service cards');

      for (const entry of approved) {
        const card = page.locator('.service-card', { hasText: entry.title }).first();
        assert.equal(await card.count(), 1, `${entry.title} card present`);
        const text = normalize((await card.textContent()) ?? '');
        assert.ok(text.includes(entry.copy), `${entry.title} full approved description is rendered`);
      }

      const deepCard = page.locator('.service-card', { hasText: 'Deep Cleaning' }).first();
      const deepText = normalize((await deepCard.textContent()) ?? '');
      assert.ok(deepText.includes(deepPrerequisite), 'Deep Cleaning card states the mandatory recurring prerequisite');
      assert.ok(deepText.includes('returning clients'), 'Deep Cleaning card includes the returning-client recommendation');

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert.ok(overflow <= 1, `no horizontal overflow (${overflow}px)`);

      const body = normalize((await page.textContent('body')) ?? '');
      assert.doesNotMatch(body, /Details We Notice|Detail proof|How it works/i);
    } finally {
      await context.close();
    }
  });
}

test('the estimate section is still above the founder section', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await page.goto(BASE + '/', { waitUntil: 'load' });
    const estimate = await page.locator('#estimate-heading').boundingBox();
    const founder = await page.locator('#founder-heading').boundingBox();
    assert.ok(estimate && founder);
    assert.ok(estimate.y < founder.y, 'estimate precedes the founder story');
  } finally {
    await context.close();
  }
});
