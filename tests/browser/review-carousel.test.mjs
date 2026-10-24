// Browser tests — premium layered review carousel (Initiative 5.0 §8).
// Run with: npm run test:browser (preview server on :4418).

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
];

test('all three authentic reviews render with first-name-only attributions', async () => {
  const { context, page } = await open(1280);
  try {
    const cards = page.locator('[data-review-card]');
    assert.equal(await cards.count(), 3, 'three reviews');
    const text = await page.locator('#reviews').innerText();
    for (const fragment of quotes) assert.ok(text.includes(fragment), `quote preserved: ${fragment}`);
    const authors = await page.locator('[data-review-card] footer strong').allTextContents();
    assert.deepEqual(authors.map((a) => a.trim()), ['Christina', 'Richard', 'Laura']);
    for (const surname of ['Sherwin', 'Lionhart', 'Harman']) {
      assert.ok(!text.includes(surname), `surname not published: ${surname}`);
    }
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
    const laura = card('Laura');
    await page.waitForFunction(() => document.querySelector('[data-review-carousel]')?.dataset.enhanced === 'true');

    assert.equal(await christina.getAttribute('data-offset'), '0');
    assert.equal(await christina.getAttribute('aria-current'), 'true');
    // Exactly one front card and two neighbours in the -1/+1 slots.
    const offsets = await page.locator('[data-review-card]').evaluateAll((nodes) =>
      nodes.map((node) => node.dataset.offset),
    );
    assert.deepEqual(offsets.sort(), ['-1', '0', '1'].sort());

    // Neighbours remain visible (not blurred/hidden) on desktop.
    for (const side of [richard, laura]) {
      assert.ok((await side.evaluate((el) => getComputedStyle(el).opacity)) >= '0.9');
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
    assert.match(await status.innerText(), /Review 2 of 3 — Richard/);
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
    assert.equal(await side.evaluate((el) => getComputedStyle(el).pointerEvents), 'none');
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
    assert.equal(await page.locator('[data-review-card]').count(), 3);
    const text = await page.locator('#reviews').innerText();
    for (const fragment of quotes) assert.ok(text.includes(fragment), `no-JS review readable: ${fragment}`);
    assert.equal(await page.locator('[data-review-carousel]').getAttribute('data-enhanced'), null);
  } finally {
    await context.close();
  }
});
