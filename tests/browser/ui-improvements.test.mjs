import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4580;
const MULTI_PORT = 4581;
const BASE = `http://localhost:${PORT}`;
let server; let multiServer; let browser;

function mime(file) {
  const extension = path.extname(file).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.woff2': 'font/woff2',
    '.ico': 'image/x-icon',
  }[extension] ?? 'application/octet-stream';
}

function multiBranchHtml() {
  let html = fs.readFileSync(path.join('dist', 'service-area', 'index.html'), 'utf8');
  html = html.replace(
    /<div data-service-area-single-start[\s\S]*?data-service-area-single-end[^>]*><\/div>/i,
    '',
  );
  html = html.replace(
    /<template([^>]*)data-service-area-multi-template([^>]*)>([\s\S]*?)<\/template>/i,
    '<div data-service-area-multi>$3</div>',
  );
  html = html.replace(
    /(<h1[^>]*data-service-area-heading[^>]*>)[\s\S]*?(<\/h1>)/i,
    '$1Serving Northwest Florida and Tampa Bay$2',
  );
  html = html.replace(
    /(<p[^>]*data-service-area-lead[^>]*>)[\s\S]*?(<\/p>)/i,
    '$1Based in the Pensacola-Cantonment area, Sparkling Standard serves homes and businesses across Northwest Florida and approved Tampa Bay communities, with select nearby Alabama locations available by arrangement.$2',
  );
  html = html.replace(
    /<title>[^<]*<\/title>/i,
    '<title>Service Areas | Pensacola and Tampa Bay | Sparkling Standard</title>',
  );
  html = html.replace(
    /(<meta name="description" content=")[^"]*(")/i,
    '$1Sparkling Standard serves Pensacola, Cantonment and approved Northwest Florida communities, plus approved Tampa Bay areas in Pasco, Pinellas and Hillsborough Counties.$2',
  );
  return html;
}

before(async () => {
  multiServer = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://localhost:${MULTI_PORT}`);
    if (url.pathname === '/service-area/' || url.pathname === '/service-area') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(multiBranchHtml());
      return;
    }
    const requested = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = path.join('dist', requested);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': mime(file) });
    response.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => multiServer.listen(MULTI_PORT, resolve));
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
    } catch {}
    await delay(500);
  }
  throw new Error('preview server did not become ready');
});

after(async () => {
  await browser?.close();
  server?.kill();
  multiServer?.close();
});

test('the Community Support card has no decorative circle and the Proverbs separator is compact', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(BASE + '/', { waitUntil: 'load' });
    const panel = page.locator('.community-support__panel');
    assert.equal(await panel.count(), 1);
    const pseudo = await panel.evaluate((element) => {
      const style = getComputedStyle(element, '::after');
      return { content: style.content, width: style.width, border: style.borderTopWidth };
    });
    assert.equal(pseudo.content, 'none', 'no decorative circle pseudo-element remains');
    assert.ok(pseudo.width === 'auto' || pseudo.width === '0px' || pseudo.width === '0');

    const verse = page.locator('.scripture-block--compact');
    assert.equal(await verse.count(), 1, 'Proverbs 16:3 uses the compact variant');
    assert.match(await verse.innerText(), /Commit thy works unto the LORD/);
    assert.match(await verse.innerText(), /PROVERBS 16:3 \(KJV\)/i);
    const spacing = await page.locator('.section--scripture').evaluate((element) => {
      const style = getComputedStyle(element);
      return parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    });
    assert.ok(spacing <= 32, `the verse separator stays slim (${spacing}px)`);
    const accent = await verse.evaluate((element) => {
      const style = getComputedStyle(element, '::before');
      return { content: style.content, height: style.height };
    });
    assert.notEqual(accent.content, 'none');
    assert.ok(parseFloat(accent.height) <= 2, 'the accent is a thin rule');
  } finally {
    await context.close();
  }
});

test('the shared footer remains fully tappable above the sticky mobile CTA at every phone width', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(BASE + '/', { waitUntil: 'load' });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(250);
      const geometry = await page.evaluate(() => {
        const bar = document.querySelector('.mobile-action-bar');
        const gift = document.querySelector('.site-footer__bottom a[href="/gift-certificates/"]');
        const footer = document.querySelector('.site-footer');
        if (!bar || !gift || !footer) return null;
        return {
          barTop: bar.getBoundingClientRect().top,
          giftBottom: gift.getBoundingClientRect().bottom,
          footerBottom: footer.getBoundingClientRect().bottom,
          viewport: window.innerHeight,
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      assert.ok(geometry, `footer and CTA render at ${width}px`);
      assert.equal(geometry.overflowX <= 1, true, `no horizontal overflow at ${width}px`);
      assert.ok(
        geometry.giftBottom <= geometry.barTop + 1,
        `Gift Certificates link clears the CTA at ${width}px (${geometry.giftBottom} <= ${geometry.barTop})`,
      );
      assert.ok(geometry.footerBottom <= geometry.viewport + 1, `footer end is reachable at ${width}px`);
      await page.goto(BASE + '/careers/', { waitUntil: 'load' });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(200);
      const careers = await page.evaluate(() => {
        const bar = document.querySelector('.mobile-action-bar')?.getBoundingClientRect();
        const gift = document.querySelector('.site-footer__bottom a[href="/gift-certificates/"]')?.getBoundingClientRect();
        return bar && gift ? { barTop: bar.top, giftBottom: gift.bottom } : null;
      });
      assert.ok(careers && careers.giftBottom <= careers.barTop + 1, `shared footer clears the CTA on Careers at ${width}px`);
    }
  } finally {
    await context.close();
  }
});

test('Tampa OFF: Service Area is a Pensacola-only page with one map and no branch selector', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await page.goto(BASE + '/service-area/', { waitUntil: 'load' });
    const text = await page.locator('main').innerText();
    assert.doesNotMatch(text, /Choose your branch/i);
    assert.doesNotMatch(text, /One company\. One operating region/i);
    assert.doesNotMatch(text, /Tampa Bay \/ Central Florida/i);
    assert.match(text, /Pensacola/);
    assert.equal(await page.locator('[data-service-area-single] .area-map').count(), 1);
    assert.equal(await page.locator('[data-service-area-multi]').count(), 0, 'multi content is inert until Tampa is live');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(overflow <= 1, `no horizontal overflow (${overflow}px)`);
  } finally {
    await context.close();
  }
});

test('Tampa ON preview: the page automatically renders both regions and all three maps', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 1000 } });
  const page = await context.newPage();
  try {
    await page.goto(`http://localhost:${MULTI_PORT}/service-area/`, { waitUntil: 'load' });
    const text = await page.locator('main').innerText();
    assert.match(text, /Serving Northwest Florida and Tampa Bay/);
    assert.doesNotMatch(text, /Serving Pensacola, Cantonment, and beyond/);
    assert.match(text, /Sparkling Standard .* Our Service Areas/);
    assert.match(text, /Pensacola \/ Northwest Florida/);
    assert.match(text, /Tampa Bay \/ Central Florida/);
    assert.match(text, /Pasco, Pinellas and Hillsborough/);
    assert.match(text, /20 miles or less/);
    assert.equal(await page.locator('.area-map').count(), 3, 'overview, Pensacola and Tampa maps render');
    assert.equal(await page.locator('.area-map--overview').count(), 1);
    assert.equal(await page.locator('.area-map--regional').count(), 1);
    assert.equal(await page.locator('a[href="/locations/pensacola/"]').count() >= 1, true);
    assert.equal(await page.locator('a[href="/locations/tampa-bay/"]').count() >= 1, true);
    assert.doesNotMatch(text, /Choose your branch/i);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(overflow <= 1, `no horizontal overflow (${overflow}px)`);
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const desktopPage = await desktop.newPage();
    try {
      await desktopPage.goto(`http://localhost:${MULTI_PORT}/service-area/`, { waitUntil: 'load' });
      const columns = await desktopPage.locator('.service-region').first().evaluate(
        (element) => getComputedStyle(element).gridTemplateColumns,
      );
      assert.match(columns, /\S+ \S+/, 'the branch regions become balanced desktop columns');
    } finally {
      await desktop.close();
    }
  } finally {
    await context.close();
  }
});
