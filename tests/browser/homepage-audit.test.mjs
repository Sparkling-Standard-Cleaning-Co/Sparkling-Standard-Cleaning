// Regression test for Hayli's homepage audit — explicitly verifies that the
// rendered homepage carries all six complete approved service descriptions,
// including Church Cleaning and the mandatory Deep Cleaning prerequisite.
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
  {
    title: 'Church Cleaning',
    copy:
      'A complete church cleaning service for sanctuaries, fellowship halls, nurseries, restrooms, and offices — scheduled around services and church life.',
  },
];

const deepPrerequisite =
  'This service is ideal for one-time cleanings and is required before beginning recurring residential maintenance cleaning. It’s also recommended for returning clients when dirt, grime, or buildup begins to accumulate beyond what routine maintenance cleaning is designed to address.';

const normalize = (value) => value.replace(/\s+/g, ' ').trim();

for (const [label, width, height] of [
  ['desktop', 1440, 1000],
  ['mobile', 390, 844],
]) {
  test(`homepage renders all six complete service descriptions (${label})`, async () => {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    try {
      await page.goto(BASE + '/', { waitUntil: 'load' });
      await page.locator('#services').scrollIntoViewIfNeeded();

      const cards = page.locator('.service-card');
      assert.equal(await cards.count(), 6, 'six core service cards');

      for (const entry of approved) {
        const card = page.locator('.service-card', { hasText: entry.title }).first();
        assert.equal(await card.count(), 1, `${entry.title} card present`);
        const text = normalize((await card.textContent()) ?? '');
        assert.ok(text.includes(entry.copy), `${entry.title} full approved description is rendered`);
      }

      const churchCard = page.locator('.service-card', { hasText: 'Church Cleaning' }).first();
      assert.equal(await churchCard.locator('.card__more').getAttribute('href'), '/church-cleaning/');
      assert.equal(await churchCard.locator('.service-card__media img').count(), 1, 'Church Cleaning has a representative photo');

      const deepCard = page.locator('.service-card', { hasText: 'Deep Cleaning' }).first();
      const deepText = normalize((await deepCard.textContent()) ?? '');
      assert.ok(deepText.includes(deepPrerequisite), 'Deep Cleaning card states the mandatory recurring prerequisite');
      assert.ok(deepText.includes('returning clients'), 'Deep Cleaning card includes the returning-client recommendation');

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert.ok(overflow <= 1, `no horizontal overflow (${overflow}px)`);

      if (width >= 1024) {
        const columns = await page
          .locator('.service-list--photo')
          .evaluate((el) => getComputedStyle(el).columnCount);
        assert.equal(columns, '3', 'desktop services flow through three balanced columns');
      } else {
        const columns = await page
          .locator('.service-list--photo')
          .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
        assert.equal(columns, 1, 'phones keep one service column');
      }

      const body = normalize((await page.textContent('body')) ?? '');
      assert.doesNotMatch(body, /Details We Notice|Detail proof|How it works/i);
    } finally {
      await context.close();
    }
  });
}

test('the community support spotlight links to the program and is not a seventh service card', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.locator('#community-support-heading').scrollIntoViewIfNeeded();
    const heading = page.locator('#community-support-heading');
    assert.equal(normalize((await heading.innerText()) ?? ''), 'Giving Back to Those Who Give So Much.');
    const text = normalize((await page.locator('.community-support').innerText()) ?? '');
    assert.match(text, /Seniors and elderly residents/);
    assert.match(text, /First responders/);
    assert.match(text, /Veterans and people with disabilities/);
    assert.match(text, /Other eligible community members/);
    assert.doesNotMatch(text, /10%|\$\d/, 'no invented discount percentage or price');
    assert.equal(await page.locator('.community-support .service-card').count(), 0);
    const cta = page.locator('[data-cta="home-community-support"]');
    assert.equal(await cta.getAttribute('href'), '/supportive-home-cleaning/');
    assert.equal(normalize((await cta.innerText()) ?? ''), 'Explore Community Support Cleaning');
  } finally {
    await context.close();
  }
});

test('the community support panel stays inside a phone viewport', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(BASE + '/', { waitUntil: 'load' });
    const panel = page.locator('.community-support__panel');
    await panel.scrollIntoViewIfNeeded();
    const metrics = await panel.evaluate((el) => {
      const copy = el.querySelector('.community-support__copy');
      const cta = el.querySelector('.community-support__cta');
      const panelRect = el.getBoundingClientRect();
      const copyRect = copy?.getBoundingClientRect();
      const ctaRect = cta?.getBoundingClientRect();
      return {
        panelLeft: panelRect.left,
        panelRight: panelRect.right,
        copyLeft: copyRect?.left ?? 0,
        copyRight: copyRect?.right ?? 0,
        ctaRight: ctaRect?.right ?? 0,
      };
    });
    assert.ok(metrics.copyLeft >= metrics.panelLeft, 'copy starts inside the panel');
    assert.ok(metrics.copyRight <= metrics.panelRight + 1, 'copy does not clip at the right edge');
    assert.ok(metrics.ctaRight <= metrics.panelRight + 1, 'CTA does not clip at the right edge');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(overflow <= 1, `no page overflow (${overflow}px)`);
  } finally {
    await context.close();
  }
});

test('the footer review action uses a magnifying glass instead of a star', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await page.goto(BASE + '/', { waitUntil: 'load' });
    const button = page.locator('[data-cta="footer-reviews-read"]');
    assert.equal(await button.locator('svg').count(), 1);
    const path = await button.locator('svg path').getAttribute('d');
    assert.match(path ?? '', /^M21 21l-4\.35-4\.35/);
    assert.doesNotMatch(normalize((await button.innerText()) ?? ''), /^$/, 'action label remains visible');
  } finally {
    await context.close();
  }
});

test('the contact form privacy note stays concise and keeps the policy link', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await page.goto(BASE + '/contact/', { waitUntil: 'load' });
    const form = page.locator('[data-variant="contact"]');
    const text = normalize((await form.innerText()) ?? '');
    assert.doesNotMatch(text, /never for analytics/i);
    assert.match(text, /By sending this message you agree to our privacy policy\./);
    assert.equal(await form.locator('a[href="/privacy/"]').count(), 1);
  } finally {
    await context.close();
  }
});

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
