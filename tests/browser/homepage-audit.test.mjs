// Regression test for Hayli's homepage audit â€” explicitly verifies that the
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
      'An in-depth reset for a home that needs extra care - available as a one-time cleaning and required before a new recurring residential arrangement. The complete procedure lives on the Deep Cleaning page.',
  },
  {
    title: 'Move-in and Move-out Cleaning',
    copy:
      "Give your home a fresh start with a thorough, top-to-bottom cleaning. Whether you're moving into a new home or preparing to sell or rent your property, we'll leave it sparkling clean, and ready for its next residents.",
  },
  {
    title: 'Short-term Rental Turnover Cleaning',
    copy:
      'A complete turnover service for Airbnb and Vrbo hosts that protects your reviews and keeps bookings coming. More than a quick clean, we provide a reset between guests to help ensure your rental is sanitary, refreshed, and ready for the next arrival.',
  },
  {
    title: 'Commercial Cleaning',
    copy:
      "Recurring or one-time commercial cleaning for local businesses and facilities. Each service is professionally scoped to your space, with scheduling tailored to your operation's needs.",
  },
  {
    title: 'Church Cleaning',
    copy:
      'A complete church cleaning service for sanctuaries, fellowship halls, nurseries, restrooms, and offices - scheduled around services and church life.',
  },
];

const normalize = (value) => value.replace(/\s+/g, ' ').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u2014/g, '-').trim();

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
      assert.ok(deepText.includes('required before a new recurring residential arrangement'), 'Deep Cleaning card states the one-time service and recurring prerequisite');
      assert.ok(deepText.includes('complete procedure lives on the Deep Cleaning page'), 'Deep Cleaning card points to the full service page');

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert.ok(overflow <= 1, `no horizontal overflow (${overflow}px)`);

      const columns = await page
        .locator('.service-list--photo')
        .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      assert.equal(columns, width >= 1024 ? 3 : 1, 'service cards use the intended balanced grid');
      const rowsAligned = await page.locator('.service-list--photo').evaluate((el) => {
        const rows = new Map();
        for (const card of el.querySelectorAll('.service-card')) {
          const rect = card.getBoundingClientRect();
          const key = Math.round(rect.top);
          const heights = rows.get(key) ?? [];
          heights.push(Math.round(rect.height));
          rows.set(key, heights);
        }
        return [...rows.values()].every((heights) => new Set(heights).size === 1);
      });
      assert.equal(rowsAligned, true, 'cards sharing a grid row have equal heights');

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
    assert.match(text, /Seniors and Elderly/);
    assert.match(text, /First responders/);
    assert.match(text, /Military veterans/);
    assert.match(text, /Those with Disabilities/);
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

test('the footer review action uses reading glasses and the contact actions keep their order', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await page.goto(BASE + '/', { waitUntil: 'load' });
    const button = page.locator('[data-cta="footer-reviews-read"]');
    assert.equal(await button.locator('svg').count(), 1);
    const path = await button.locator('svg path').getAttribute('d');
    assert.equal(await button.locator('svg').getAttribute('width'), '24', 'glasses render large enough to read');
    assert.equal(await button.locator('svg').getAttribute('stroke-width'), '2.2');
    assert.match(path ?? '', /^M0\.5 8\.5 2\.5 10/);
    assert.match(path ?? '', /M4\.5 8h4a2/);
    assert.doesNotMatch(path ?? '', /^M21 21l-4\.35-4\.35/, 'the old search icon is gone');
    assert.doesNotMatch(normalize((await button.innerText()) ?? ''), /^$/, 'action label remains visible');

    const actions = page.locator('.site-footer__contact-actions .btn');
    assert.equal(await actions.count(), 4, 'Call, Text, Email and Contact Form render');
    const labels = await actions.evaluateAll((items) =>
      items.map((item) => item.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
    );
    assert.match(labels[0] ?? '', /^Call \(850\) 426-8479$/);
    assert.match(labels[1] ?? '', /^Text \(850\) 426-8479$/);
    assert.equal(labels[2], 'Email Us');
    assert.equal(labels[3], 'Contact Form');
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

test('the GPS helper paragraphs are removed from every estimator form', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    for (const path of ['/estimate/residential/', '/estimate/str/', '/estimate/commercial/', '/estimate/church/']) {
      await page.goto(BASE + path, { waitUntil: 'load' });
      const body = normalize((await page.textContent('body')) ?? '');
      assert.doesNotMatch(body, /Best if you are physically at the property/i, `${path} residential helper removed`);
      assert.doesNotMatch(body, /Only use this if you are physically at the facility/i, `${path} facility helper removed`);
      assert.equal(await page.locator('[data-address-gps]').count(), 1, `${path} keeps the location button`);
    }
  } finally {
    await context.close();
  }
});

test('the 17-icon system is rendered on the mapped homepage surfaces', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await page.goto(BASE + '/', { waitUntil: 'load' });
    assert.equal(await page.locator('.service-card .premium-icon__image').count(), 6, 'six service icons');
    assert.equal(await page.locator('.trust-item .premium-icon__image').count(), 4, 'four value icons');
    assert.equal(await page.locator('.community-support__list .premium-icon__image').count(), 5, 'five community group icons');
    assert.equal(await page.locator('.community-support__intro .premium-icon__image').count(), 1, 'community support icon');
    assert.equal(await page.locator('.reviews-head__icon .premium-icon__image').count(), 1, 'reviews icon');
    assert.equal(await page.locator('.premium-icon__svg').count(), 0, 'retired vector icons are gone');

    await page.goto(BASE + '/supportive-home-cleaning/', { waitUntil: 'load' });
    assert.equal(await page.locator('.supportive-eligibility__icon').count(), 5, 'five eligibility icons');
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