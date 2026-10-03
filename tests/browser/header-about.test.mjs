// Browser tests — desktop header alignment/about navigation and the About
// page's founder + heritage story. Run with: npm run test:browser on :4403.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4403;
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

async function open(path, width, height = 900) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.goto(BASE + path, { waitUntil: 'load' });
  return { context, page };
}

const centerY = (box) => box.y + box.height / 2;

for (const width of [1024, 1280, 1440, 1680]) {
  test(`desktop header fits and aligns at ${width}px`, async () => {
    const { context, page } = await open('/', width);
    try {
      // About is a first-class desktop navigation item.
      const about = page.locator('.site-nav__links a[href="/about/"]');
      assert.equal(await about.isVisible(), true, 'About link visible in desktop nav');
      assert.equal((await about.textContent())?.trim(), 'About');

      // Every label shares one vertical centerline and a single-line height.
      const boxes = await page.locator('.site-nav__links a').evaluateAll((links) =>
        links.map((link) => {
          const rect = link.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }),
      );
      assert.equal(boxes.length, 6, 'six primary navigation links');
      const centers = boxes.map(centerY);
      const firstCenter = centers[0];
      for (const center of centers) {
        assert.ok(Math.abs(center - firstCenter) <= 1, `labels share the centerline (${center} vs ${firstCenter})`);
      }
      const firstHeight = boxes[0].height;
      for (const box of boxes) {
        assert.ok(Math.abs(box.height - firstHeight) <= 1, 'all labels have the same height (no wrapping)');
      }

      // No overlap between logo, nav, phone button and the estimate CTA.
      const headerBox = await page.locator('.site-header__inner').boundingBox();
      const brandBox = await page.locator('.site-header .brand').boundingBox();
      const phoneButton = page.locator('.site-nav .btn--ghost');
      const ctaButton = page.locator('.site-nav .btn--primary');
      const phoneBox = (await phoneButton.count()) > 0 && (await phoneButton.isVisible())
        ? await phoneButton.boundingBox()
        : null;
      const ctaBox = await ctaButton.boundingBox();
      const navBox = await page.locator('.site-nav__links').boundingBox();
      assert.ok(headerBox && brandBox && ctaBox && navBox);
      assert.ok(brandBox.x + brandBox.width <= navBox.x + 1, 'logo does not overlap the nav');
      if (phoneBox) {
        assert.ok(navBox.x + navBox.width <= phoneBox.x + 1, 'nav does not overlap the phone button');
        assert.ok(phoneBox.x + phoneBox.width <= ctaBox.x + 1, 'phone does not overlap the estimate CTA');
      } else {
        assert.ok(navBox.x + navBox.width <= ctaBox.x + 1, 'nav does not overlap the estimate CTA');
      }
      assert.ok(ctaBox.x + ctaBox.width <= headerBox.x + headerBox.width + 1, 'CTA stays inside the header');

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert.ok(overflow <= 1, `no horizontal overflow at ${width}px`);
    } finally {
      await context.close();
    }
  });
}

test('the brand lockup carries the full identity and links home', async () => {
  const { context, page } = await open('/', 1280, 900);
  try {
    const brand = page.locator('.site-header .brand');
    assert.equal(await brand.getAttribute('href'), '/');
    assert.equal(await brand.locator('.brand__crest svg').count(), 1, 'crest mark present');
    assert.equal((await brand.locator('.brand__sparkling').textContent())?.trim(), 'Sparkling');
    assert.equal((await brand.locator('.brand__standard').textContent())?.trim(), 'Standard');
    assert.match((await brand.locator('.brand__descriptor').textContent()) ?? '', /Cleaning Co\./);
    assert.match((await brand.locator('.brand__tagline').textContent()) ?? '', /Details Are Our Standard/i);
    assert.match((await brand.getAttribute('aria-label')) ?? '', /home/i);
    // One of the two prepared treatments is applied (romantic script is default).
    assert.match(
      (await brand.locator('.brand__text').getAttribute('class')) ?? '',
      /brand__text--(soft-serif|romantic-script)/,
    );
  } finally {
    await context.close();
  }
});

test('the compact mobile brand stays readable without the header tagline', async () => {
  const { context, page } = await open('/', 390, 844);
  try {
    assert.equal(await page.locator('.site-header .brand__tagline').isVisible(), false, 'tagline hides on compact phones');
    assert.equal(await page.locator('.site-header .brand__descriptor').isVisible(), true, 'Cleaning Co. stays visible');
    assert.equal(await page.locator('.site-header .brand__crest svg').isVisible(), true, 'crest stays visible');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(overflow <= 1, `no horizontal overflow on mobile (${overflow})`);
  } finally {
    await context.close();
  }
});

test('the About page keeps the founder story and adds the heritage section', async () => {
  const { context, page } = await open('/about/', 1280, 900);
  try {
    // Founder story is preserved.
    const story = page.locator('#story');
    assert.equal(await story.count(), 1, 'founder story section present');
    const storyText = (await story.textContent()) ?? '';
    assert.match(storyText, /grandmother/i, 'grandmother story preserved');

    // Heritage section supports the story without replacing it.
    const heritage = page.locator('#heritage');
    assert.equal(await heritage.count(), 1, 'heritage section present');
    await heritage.scrollIntoViewIfNeeded();
    const heritageText = (await heritage.textContent()) ?? '';
    assert.match(heritageText, /Traditions worth carrying forward/);
    assert.match(heritageText, /proudly American/i);
    assert.match(heritageText, /European family heritage/i);
    assert.match(heritageText, /hard work, faith, family, responsibility and pride in craftsmanship/i);
    assert.match(heritageText, /dignity and respect/i);
    // No invented countries or immigration specifics.
    assert.doesNotMatch(heritageText, /England|Germany|Ireland|Italy|Poland|immigrat/i);

    // Natural estimate CTA remains present.
    assert.equal(await page.locator('[data-cta="about-estimate"]').getAttribute('href'), '/estimate/');
    assert.ok(await page.locator('a[href="/estimate/"]').count() >= 2, 'estimate CTA in hero and closing band');
  } finally {
    await context.close();
  }
});
