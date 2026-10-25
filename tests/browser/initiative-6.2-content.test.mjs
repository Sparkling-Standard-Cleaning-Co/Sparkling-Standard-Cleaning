// Initiative 6.2 presentation and content corrections. Real built pages only.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4418;
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
  await page.addStyleTag({ content: '.mobile-action-bar,.consent-banner,.promo-popup{display:none!important}' });
  return { context, page };
}

test('the estimate hub forwards campaign context and legacy residential deep links', async () => {
  {
    const { context, page } = await open('/estimate/?utm_source=facebook&utm_campaign=fall-6.2');
    try {
      await page.waitForFunction(() =>
        (document.querySelector('.estimate-hub__card')?.getAttribute('href') ?? '').includes('utm_source=facebook'),
      );
      const residentialHref = await page.locator('.estimate-hub__card').first().getAttribute('href');
      assert.equal(residentialHref, '/estimate/residential/?utm_source=facebook&utm_campaign=fall-6.2');
      const commercialHref = await page.locator('.estimate-hub__card').nth(1).getAttribute('href');
      assert.equal(commercialHref, '/estimate/commercial/?utm_source=facebook&utm_campaign=fall-6.2');
    } finally {
      await context.close();
    }
  }
  {
    const { context, page } = await open('/estimate/?service=deep');
    try {
      await page.waitForURL(/\/estimate\/residential\/\?service=deep/);
      assert.equal(await page.locator('[data-estimate-form]').count(), 1);
      assert.equal(await page.locator('input[name="serviceType"][value="deep"]').isChecked(), true);
    } finally {
      await context.close();
    }
  }
});

test('service area is title -> concise description -> map, without the top ZIP button', async () => {
  const { context, page } = await open('/service-area/');
  try {
    assert.equal(await page.locator('[data-cta="area-estimate"]').count(), 0, 'top ZIP CTA removed');
    const text = await page.locator('main').innerText();
    assert.doesNotMatch(text, /depending on distance/i);
    assert.match(text, /Pensacola–Cantonment area/);
    const map = page.locator('.area-map');
    assert.equal(await map.isVisible(), true);
    const intro = await page.locator('.area-intro').boundingBox();
    const mapBox = await map.boundingBox();
    assert.ok(intro && mapBox && intro.y < mapBox.y, 'the map follows the short introduction');
    assert.equal(await page.locator('.section-head h2', { hasText: 'Where Sparkling Standard cleans' }).count(), 0);
  } finally {
    await context.close();
  }
});

test('homepage removes representative-photo captions and the Bible quotation cleanup is applied', async () => {
  const { context, page } = await open('/');
  try {
    const text = await page.locator('body').innerText();
    assert.doesNotMatch(text, /Representative interiors/i);
    assert.doesNotMatch(text, /project photos are added/i);
    assert.match(text, /Galatians 5:13/);
    assert.match(text, /Colossians 3:23/);
    assert.doesNotMatch(text, /Mark 12:31/);
    assert.doesNotMatch(text, /Thou shalt love thy neighbour/i);
    assert.doesNotMatch(text, /\(KJV, excerpt\)/i);
  } finally {
    await context.close();
  }
});

test('footer has distinct read and leave review actions and the approved review copy', async () => {
  const { context, page } = await open('/');
  try {
    const footer = page.locator('footer.site-footer');
    const read = footer.getByRole('link', { name: /Read Our Reviews/i });
    assert.equal(await read.count(), 1);
    assert.equal(await read.getAttribute('href'), '/#reviews');
    assert.equal(await read.getAttribute('data-cta'), 'footer-reviews-read');
    const leave = footer.getByRole('link', { name: /Leave Us a Review/i });
    assert.equal(await leave.count(), 1);
    assert.equal(await leave.getAttribute('data-review-link'), 'google');
    assert.match((await footer.innerText()) ?? '', /Your review could help neighbors find Sparkling Standard, a cleaning service they can depend on\./);
    const companyLinks = await footer.locator('.site-footer__grid > div').nth(1).locator('a').allTextContents();
    assert.equal(companyLinks.some((label) => /^Reviews$/i.test(label.trim())), false, 'Company nav has no redundant Reviews item');
  } finally {
    await context.close();
  }
});

test('reviews use larger stars with a source label and authentic first-name attributions', async () => {
  const { context, page } = await open('/');
  try {
    const stars = page.locator('.review-card__stars svg');
    assert.equal(await stars.count(), 15, 'three five-star reviews');
    const width = await stars.first().getAttribute('width');
    assert.equal(width, '22');
    assert.equal(await page.locator('.review-carousel__source').count(), 3);
    const text = await page.locator('#reviews').innerText();
    assert.match(text, /Christina/);
    assert.match(text, /Richard/);
    assert.match(text, /Laura/);
  } finally {
    await context.close();
  }
});

test('supportive home page explains eligibility and never selects the discount automatically', async () => {
  const { context, page } = await open('/supportive-home-cleaning/');
  try {
    const text = await page.locator('main').innerText();
    assert.match(text, /10%/);
    assert.match(text, /65 or older|65\b/i);
    assert.match(text, /first responder/i);
    assert.match(text, /veteran/i);
    assert.match(text, /disabilit/i);
    assert.match(text, /other eligible community members/i);
    assert.match(text, /No diagnosis/i);
    assert.match(text, /not a charitable donation|not medical|cleaning only/i);
    const cta = page.locator('a[data-cta="supportive-estimate"]').first();
    assert.match((await cta.getAttribute('href')) ?? '', /\/estimate\/residential\/\?service=supportive&supportive=yes/);
  } finally {
    await context.close();
  }
});

test('white-tile icons render as complete artwork on the homepage cards and values', async () => {
  const { context, page } = await open('/');
  try {
    const tiles = page.locator('.premium-icon__image');
    assert.ok((await tiles.count()) >= 9, 'service and value tiles render');
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll('.premium-icon__image')].some((svg) => {
        const box = svg.getBoundingClientRect();
        return box.width < 20 || box.height < 20;
      }),
    );
    assert.equal(clipped, false, 'icons are rendered at a visible size');
  } finally {
    await context.close();
  }
});
