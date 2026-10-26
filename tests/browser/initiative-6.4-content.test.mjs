// Initiative 6.4 owner-audit corrections: service-area map, centered values,
// reading glasses and the public Community Support name. Built pages only.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4422;
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

const normalize = (value) => value.replace(/\s+/g, ' ').trim();

test('the service-area map shows contiguous real counties with clear policy layers', async () => {
  const { context, page } = await open('/service-area/', 1440, 1100);
  try {
    assert.equal(await page.locator('.area-map__core .area-map__county').count(), 2, 'two core Florida counties');
    assert.equal(
      await page.locator('.area-map__arrangement .area-map__county').count(),
      2,
      'two by-arrangement Alabama counties',
    );
    assert.equal(await page.locator('.area-map__labels > text').count(), 18, 'eighteen county labels');

    const labels = (await page.locator('.area-map__county-label').allTextContents()).map(normalize);
    for (const label of ['Escambia FL', 'Santa Rosa FL', 'Baldwin AL', 'Escambia AL', 'Okaloosa FL', 'Bay FL']) {
      assert.ok(labels.includes(label), `${label} labelled`);
    }

    const water = page.locator('.area-map__water-label');
    assert.equal(await water.count(), 1);
    assert.equal(normalize((await water.textContent()) ?? ''), 'Gulf Of America');
    const waterBox = await water.boundingBox();
    const mapBox = await page.locator('.area-map__svg').boundingBox();
    assert.ok(waterBox && mapBox && waterBox.y > mapBox.y + mapBox.height * 0.7, 'water label sits over the Gulf');

    const legend = normalize((await page.locator('.area-map__legend').innerText()) ?? '');
    assert.match(legend, /Core Service Area/);
    assert.match(legend, /Service by Arrangement \/ Approval/);
    assert.match(legend, /Surrounding Geographic Context/);
    assert.match(legend, /Confirm Your Address/);

    const overlaps = await page.locator('.area-map__county-label').evaluateAll((nodes) => {
      const boxes = nodes.map((node) => ({ text: node.textContent, box: node.getBoundingClientRect() }));
      const collisions = [];
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i].box;
          const b = boxes[j].box;
          const overlap =
            Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
          if (overlap) collisions.push(`${boxes[i].text} / ${boxes[j].text}`);
        }
      }
      return collisions;
    });
    assert.deepEqual(overlaps, [], 'desktop county labels do not collide');

    const note = normalize((await page.locator('.area-map__note').innerText()) ?? '');
    assert.match(note, /Escambia and Santa Rosa counties in Florida/);
    assert.match(note, /Baldwin and Escambia counties in Alabama/);
  } finally {
    await context.close();
  }
});

test('the map stays readable and honest at phone width without county-label collisions', async () => {
  const { context, page } = await open('/service-area/', 390, 900);
  try {
    assert.equal(await page.locator('.area-map__county-label').first().isVisible(), false);
    const visibleLabels = await page.locator('.area-map__county-label').evaluateAll((nodes) =>
      nodes.filter((node) => getComputedStyle(node).display !== 'none').length,
    );
    assert.equal(visibleLabels, 0, 'county labels are suppressed rather than overlapping');
    assert.equal(await page.locator('.area-map__city-label').count(), 5, 'all five city labels remain');
    assert.equal(await page.locator('.area-map__water-label').isVisible(), true);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(overflow <= 1, `no page overflow (${overflow}px)`);
    assert.match(normalize((await page.locator('.area-map__note').innerText()) ?? ''), /core service area/);
  } finally {
    await context.close();
  }
});

test('the four values are centered and keep the approved order and artwork names', async () => {
  const { context, page } = await open('/', 1440, 1000);
  try {
    const items = page.locator('.trust-item');
    assert.equal(await items.count(), 4);
    const titles = (await items.locator('.trust-item__title').allTextContents()).map((text) => text.trim());
    assert.deepEqual(titles, ['Locally Owned', 'Flexible Scheduling', 'Christian Values', 'Competitive Pricing']);

    for (let i = 0; i < 4; i += 1) {
      const item = items.nth(i);
      assert.equal(await item.evaluate((node) => getComputedStyle(node).textAlign), 'center');
      const icon = await item.locator('.premium-icon').boundingBox();
      const title = await item.locator('.trust-item__title').boundingBox();
      assert.ok(icon && title, 'icon and title render');
      assert.ok(
        Math.abs(icon.x + icon.width / 2 - (title.x + title.width / 2)) <= 2,
        `value ${i + 1} icon and title share a centerline`,
      );
    }
  } finally {
    await context.close();
  }
});

test('Community Support Cleaning is the public name everywhere and the route stays canonical', async () => {
  const { context, page } = await open('/supportive-home-cleaning/', 1280, 900);
  try {
    const text = normalize((await page.locator('main').innerText()) ?? '');
    assert.match(text, /Community Support Cleaning/);
    assert.doesNotMatch(text, /Supportive Home/i);
    assert.match((await page.title()) ?? '', /Community Support Cleaning/);
    assert.equal(await page.locator('.breadcrumbs span[aria-current="page"]').count(), 1);
    assert.equal(
      normalize((await page.locator('.breadcrumbs span[aria-current="page"]').innerText()) ?? ''),
      'Community Support Cleaning',
    );

    await page.goto(BASE + '/', { waitUntil: 'load' });
    const homeText = normalize((await page.locator('body').innerText()) ?? '');
    assert.doesNotMatch(homeText, /Supportive Home/i);
    assert.match(homeText, /Community Support Cleaning/);
    assert.match(homeText, /Here in the Florida Panhandle, in the heart of the Bible Belt/);
    assert.match(homeText, /how neighbors care for one another/);
  } finally {
    await context.close();
  }
});
