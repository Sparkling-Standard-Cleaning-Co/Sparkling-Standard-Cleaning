// Browser tests — premium layered review carousel (Initiative 5.0 §8).
// Run with: npm run test:browser (preview server on :4418).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4420;
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

async function open(width, height = 900, options = {}) {
  const context = await browser.newContext({ viewport: { width, height }, ...options });
  const page = await context.newPage();
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.locator('#reviews').scrollIntoViewIfNeeded();
  return { context, page };
}

const quotes = [
  'did an amazing job',
  'Very respectful, AMAZING cleaning',
  'Quality, affordable, attention to detail',
  'crispy couch',
  'I recently hired Sparkling Standard for a deep clean',
  'Excellent office cleaning service',
  'outstanding job every week',
];

test('all seven verified reviews render with owner-approved attributions', async () => {
  const { context, page } = await open(1280);
  try {
    const cards = page.locator('[data-review-card]');
    assert.equal(await cards.count(), 7, 'seven verified reviews');
    const text = (await page.locator('#reviews').textContent()) ?? '';
    for (const fragment of quotes) assert.ok(text.includes(fragment), `quote preserved: ${fragment}`);
    const authors = await page.locator('[data-review-card] footer strong').allTextContents();
    assert.deepEqual(authors.map((a) => a.trim()), ['Christina', 'Richard', 'Laura', 'Dennis D', 'K V', 'S Ismail', 'Rob & Christi Moore']);
    for (const surname of ['Sherwin', 'Lionhart', 'Harman', 'Larsh', 'Wood']) {
      assert.ok(!text.includes(surname), `surname not published: ${surname}`);
    }
    assert.equal(await page.locator('.reviews-summary').count(), 0, 'owner requested no summary text');
    assert.equal(await page.locator('.reviews-summary__note').count(), 0, 'owner requested no disclaimer text');
    for (const excluded of ['Bob', 'Amanda', 'Elizabeth']) {
      assert.ok(!text.includes(excluded), `${excluded} is excluded from the carousel`);
    }
    const dennis = page.locator('[data-review-card]', { has: page.locator('footer strong', { hasText: 'Dennis D' }) });
    assert.equal(await dennis.locator('.review-carousel__photos img').count(), 2, 'Dennis has two review photos');
    const laura = page.locator('[data-review-card]', { has: page.locator('footer strong', { hasText: 'Laura' }) });
    assert.equal(await laura.locator('.review-carousel__photos img').count(), 1, 'Laura has one review photo');
    assert.match(await dennis.locator('.review-carousel__photos img').first().getAttribute('alt'), /sofa|living room/i);

    // Laura's five-star rating is verified (Google Maps contributor profile),
    // so every review presents the same intentional star row.
    const starRows = page.locator('[data-review-card] [aria-label="Rated 5 out of 5 stars"]');
    assert.equal(await starRows.count(), 7, 'all reviews present five gold stars');
    for (let index = 0; index < 7; index += 1) {
      assert.equal(await starRows.nth(index).locator('svg').count(), 5, `review ${index + 1} has five stars`);
    }
  } finally {
    await context.close();
  }
});

test('stars are centered in authentic Google gold and reviewer names sit at the card bottom', async () => {
  const { context, page } = await open(1280);
  try {
    await page.waitForFunction(() => document.querySelector('[data-review-carousel]')?.dataset.enhanced === 'true');
    const stars = page.locator('[data-review-card] .review-card__stars').first();
    const svg = stars.locator('svg').first();
    const color = await svg.evaluate((el) => getComputedStyle(el).color);
    const fill = await svg.evaluate((el) => getComputedStyle(el).fill);
    assert.equal(color, 'rgb(251, 188, 4)', 'stars use Google review gold');
    assert.equal(fill, 'rgb(251, 188, 4)', 'star fill uses Google review gold');
    assert.equal(await stars.evaluate((el) => getComputedStyle(el).justifyContent), 'center');
    assert.equal(
      await page.locator('.review-carousel__stars').first().evaluate((el) => getComputedStyle(el).alignItems),
      'center',
    );
    const footerJustify = await page
      .locator('[data-review-card] footer')
      .first()
      .evaluate((el) => getComputedStyle(el).justifyContent);
    assert.equal(footerJustify, 'center', 'reviewer name is centered');

    const gaps = await page.locator('[data-review-card]').evaluateAll((cards) =>
      cards
        .filter((card) => card.getClientRects().length > 0)
        .map((card) => {
          const footer = card.querySelector('footer');
          if (!footer) return -1;
          return Math.round(card.getBoundingClientRect().bottom - footer.getBoundingClientRect().bottom);
        }),
    );
    assert.ok(gaps.every((gap) => gap >= 15 && gap <= 40), `names sit at the card bottom (${gaps.join(', ')})`);
  } finally {
    await context.close();
  }
});

test('cards share a consistent height and long reviews open accessible full text', async () => {
  const { context, page } = await open(1280);
  try {
    await page.waitForFunction(() => document.querySelector('[data-review-carousel]')?.dataset.enhanced === 'true');
    const card = (author) =>
      page.locator('[data-review-card]', { has: page.locator('footer strong', { hasText: author }) });
    const heights = await page.locator('[data-review-card]').evaluateAll((nodes) => nodes.filter((node) => node.getClientRects().length > 0).map((node) => node.offsetHeight));
    assert.equal(new Set(heights).size, 1, 'all cards share a consistent height');

    await page.locator('[data-review-dot][data-index="4"]').click();
    await page.waitForTimeout(1400);
    const active = page.locator('[data-review-card][aria-current="true"]');
    assert.equal((await active.locator('footer strong').innerText()).trim(), 'K V');
    const quote = active.locator('[data-review-quote]');
    assert.equal(await quote.evaluate((el) => getComputedStyle(el).overflowY), 'auto', 'review text has internal scrolling');
    assert.equal(await quote.evaluate((el) => el.scrollHeight > el.clientHeight), true, 'long review is scrollable');
    await quote.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    assert.ok(await quote.evaluate((el) => el.scrollTop > 0), 'review text scrolls with the mouse/wheel');
    const activeBox = await active.boundingBox();
    const sectionBox = await page.locator('#reviews').boundingBox();
    assert.ok(activeBox && sectionBox && activeBox.y >= sectionBox.y, 'card top is not clipped');
    const expand = active.locator('[data-review-expand]');
    assert.equal(await expand.isVisible(), true, 'long review exposes full-text control');
    await expand.click();
    const dialog = page.locator('[data-review-dialog]');
    assert.equal(await dialog.isVisible(), true, 'full review dialog opens');
    assert.match(await dialog.innerText(), /I recently hired Sparkling Standard for a deep clean/);
    await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), false, 'dialog closes with Escape');
    assert.equal(await card('Dennis D').locator('.review-carousel__photos img').count(), 2);
  } finally {
    await context.close();
  }
});

test('the center card is prominent and the neighbours are recessed', async () => {
  const { context, page } = await open(1280);
  try {
    const card = (author) =>
      page.locator('[data-review-card]', { has: page.locator('footer strong', { hasText: author }) });
    const christina = card('Christina');
    const richard = card('Richard');
    const rob = card('Rob & Christi');
    await page.waitForFunction(() => document.querySelector('[data-review-carousel]')?.dataset.enhanced === 'true');
    await page.waitForFunction(() => {
      const side = document.querySelector('[data-review-card][data-offset="1"]');
      return side && Number.parseFloat(getComputedStyle(side).opacity) >= 0.9;
    });

    assert.equal(await christina.getAttribute('data-offset'), '0');
    assert.equal(await christina.getAttribute('aria-current'), 'true');
    // Exactly one front card and two neighbours in the -1/+1 slots.
    const offsets = await page.locator('[data-review-card]').evaluateAll((nodes) =>
      nodes.map((node) => node.dataset.offset),
    );
    assert.equal(offsets.filter((value) => value === '0').length, 1, 'one active card');
    assert.equal(offsets.filter((value) => value === '-1').length, 1, 'one left neighbour');
    assert.equal(offsets.filter((value) => value === '1').length, 1, 'one right neighbour');
    assert.equal(offsets.length, 7, 'every review has a position');

    // Neighbours remain visible (not blurred/hidden) on desktop.
    for (const side of [richard, rob]) {
      assert.ok(Number(await side.evaluate((el) => getComputedStyle(el).opacity)) >= 0.9, 'neighbour remains readable');
    }
    // The front card is the top layer.
    assert.equal(
      await christina.evaluate((el) => getComputedStyle(el).zIndex),
      '3',
    );
    const box = await christina.boundingBox();
    assert.ok(box && box.width > 420, 'front card has a substantial readable width');
  } finally {
    await context.close();
  }
});

test('next/previous, dots, card click, keyboard and status announcement work', async () => {
  const { context, page } = await open(1280);
  try {
    const status = page.locator('[data-review-status]');
    const activeAuthor = () =>
      page.locator('[data-review-card][aria-current="true"] footer strong').innerText();

    assert.equal((await activeAuthor()).trim(), 'Christina');
    await page.locator('[data-review-next]').click();
    assert.equal((await activeAuthor()).trim(), 'Richard');
    assert.match(await status.innerText(), /Review 2 of 7/);
    await page.locator('[data-review-prev]').click();
    assert.equal((await activeAuthor()).trim(), 'Christina');
    await page.locator('[data-review-dot][data-index="2"]').click();
    assert.equal((await activeAuthor()).trim(), 'Laura');
    assert.equal(await page.locator('[data-review-dot][data-index="2"]').getAttribute('aria-pressed'), 'true');

    // Clicking a side card promotes it.
    const richard = page.locator('[data-review-card][data-index="1"]');
    await richard.click({ position: { x: 40, y: 40 } });
    assert.equal((await activeAuthor()).trim(), 'Richard');

    // Keyboard: arrow keys on the carousel root.
    await page.keyboard.press('ArrowRight');
    assert.equal((await activeAuthor()).trim(), 'Laura');
    await page.keyboard.press('ArrowLeft');
    assert.equal((await activeAuthor()).trim(), 'Richard');
  } finally {
    await context.close();
  }
});

test('the layered composition holds at the 1200px boundary without page overflow', async () => {
  const { context, page } = await open(1200, 900);
  try {
    await page.waitForFunction(() => document.querySelector('[data-review-carousel]')?.dataset.enhanced === 'true');
    const side = page.locator('[data-review-card][data-offset="-1"]');
    assert.ok(Number(await side.evaluate((el) => getComputedStyle(el).opacity)) > 0.9, 'side card visible');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(overflow <= 1, `no horizontal overflow at 1200px (${overflow}px)`);
  } finally {
    await context.close();
  }
});

test('mobile keeps one fully readable card with touch-friendly controls and no overflow', async () => {
  const { context, page } = await open(390, 844);
  try {
    const front = page.locator('[data-review-card][aria-current="true"]');
    assert.ok(await front.isVisible(), 'front card visible');
    const side = page.locator('[data-review-card][data-offset="-1"]');
    assert.equal(await side.evaluate((el) => getComputedStyle(el).display), 'none');
    const nextBox = await page.locator('[data-review-next]').boundingBox();
    assert.ok(nextBox && nextBox.height >= 44, 'touch target >= 44px');
    const stageHeight = await page
      .locator('.review-carousel__stage')
      .evaluate((el) => el.getBoundingClientRect().height);
    assert.ok(stageHeight < 900, `stage height is bounded by the longest review (${stageHeight}px)`);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(overflow <= 1, `no horizontal overflow (${overflow}px)`);
    await page.locator('[data-review-next]').click();
    assert.equal(
      (await page.locator('[data-review-card][aria-current="true"] footer strong').innerText()).trim(),
      'Richard',
    );
  } finally {
    await context.close();
  }
});

test('reduced motion removes transitions', async () => {
  const { context, page } = await open(1280, 900, { reducedMotion: 'reduce' });
  try {
    const duration = await page
      .locator('[data-review-card]')
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    // Chromium serializes a disabled transition as "1e-05s" rather than "0s".
    assert.ok(Number.parseFloat(duration) < 0.05, `transition effectively off (${duration})`);
  } finally {
    await context.close();
  }
});

test('without JavaScript every review remains readable', async () => {
  const { context, page } = await open(1280, 900, { javaScriptEnabled: false });
  try {
    assert.equal(await page.locator('[data-review-card]').count(), 7);
    const text = await page.locator('#reviews').innerText();
    for (const fragment of quotes) assert.ok(text.includes(fragment), `no-JS review readable: ${fragment}`);
    assert.equal(await page.locator('[data-review-carousel]').getAttribute('data-enhanced'), null);
  } finally {
    await context.close();
  }
});
