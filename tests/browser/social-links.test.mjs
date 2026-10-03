// Browser tests — the Follow Us section: confirmed platforms only, safe
// outbound links, accessible names, no UTM parameters, responsive layout.
// Run with: npm run test:browser on :4407.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4407;
const BASE = `http://localhost:${PORT}`;

// Render order follows SocialLinks.astro PROFILE_ORDER: local discovery,
// visual/video, then additional social distribution.
const CONFIRMED = [
  {
    label: 'Facebook',
    href: 'https://www.facebook.com/profile.php?id=61595026949584',
  },
  {
    label: 'Nextdoor',
    href: 'https://nextdoor.com/page/sparkling-standard-cleaning-co/',
  },
  {
    label: 'TikTok',
    href: 'https://www.tiktok.com/@sparkling_standard?lang=en',
  },
  {
    label: 'Pinterest',
    href: 'https://www.pinterest.com/SparklingStandard/',
  },
  {
    label: 'Rumble',
    href: 'https://rumble.com/user/SparklingStandard',
  },
  {
    label: 'Gab',
    href: 'https://gab.com/Sparkling_Standard',
  },
  {
    label: 'Parler',
    href: 'https://app.parler.com/Sparkling-Standard',
  },
  {
    label: 'Locals',
    href: 'https://sparkling-standards.locals.com',
  },
];

// Platforms that must NEVER render while business.ts carries PENDING URLs.
const PENDING_LABELS = [
  'Google Business Profile',
  'Bing Places',
  'Yelp',
  'Instagram',
  'YouTube',
  'X',
  'Threads',
  'LinkedIn',
  'Alignable',
  'Reddit',
];

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

test('the footer shows a distinct Follow Us section with only confirmed platforms', async () => {
  const { context, page } = await open('/', 1280);
  try {
    const section = page.locator('[data-social-follow]');
    assert.equal(await section.isVisible(), true, 'Follow Us section is visible');
    assert.match((await section.locator('h2').textContent()) ?? '', /Follow Us/);

    const links = page.locator('[data-social-links] a');
    assert.equal(await links.count(), CONFIRMED.length, 'only confirmed profiles render');
    for (const [index, profile] of CONFIRMED.entries()) {
      const link = links.nth(index);
      assert.equal(await link.getAttribute('href'), profile.href, `${profile.label} href`);
      assert.equal(await link.getAttribute('target'), '_blank', `${profile.label} opens in a new tab`);
      assert.match(await link.getAttribute('rel'), /noopener/, `${profile.label} rel noopener`);
      assert.match(await link.getAttribute('rel'), /noreferrer/, `${profile.label} rel noreferrer`);
      assert.equal(await link.getAttribute('data-cta'), `social-${profile.label.toLowerCase()}`);
      assert.match((await link.textContent()) ?? '', new RegExp(profile.label));
      assert.match((await link.textContent()) ?? '', /opens in a new tab/, 'new-tab affordance for screen readers');
      assert.doesNotMatch(profile.href, /[?&]utm_/, 'outbound profile URLs never carry UTMs');
    }

    // Logo-only presentation: no visible platform labels, but every link keeps
    // an explicit, descriptive accessible name.
    assert.equal(
      await page.locator('[data-social-links] .social-links__label').count(),
      0,
      'no visible platform labels in the logo-only design',
    );
    for (const profile of CONFIRMED) {
      const named = page.getByRole('link', {
        name: new RegExp(`^${profile.label} — Sparkling Standard Cleaning Co\\. \\(opens in a new tab\\)$`),
      });
      assert.equal(await named.count(), 1, `${profile.label} has a descriptive accessible name`);
    }

    // Every confirmed profile carries a real platform mark — never a monogram
    // placeholder — and the Nextdoor glyph is the official house-"n" favicon.
    for (let index = 0; index < CONFIRMED.length; index += 1) {
      const svg = links.nth(index).locator('svg');
      assert.equal(await svg.count(), 1, `${CONFIRMED[index].label} has an icon`);
      assert.equal(await svg.locator('text').count(), 0, `${CONFIRMED[index].label} uses no monogram placeholder`);
      assert.ok(
        (await svg.locator('path, rect, circle').count()) >= 1,
        `${CONFIRMED[index].label} icon has drawn geometry`,
      );
    }
    const nextdoorSvg = await links.nth(1).locator('svg').innerHTML();
    assert.match(nextdoorSvg, /M71\.2012 60\.1136/, 'Nextdoor uses the official house-n favicon geometry');
    assert.match(nextdoorSvg, /#1B8751/i, 'Nextdoor uses the official brand green');

    // Each profile is one 52px circular button.
    for (let index = 0; index < CONFIRMED.length; index += 1) {
      const box = await links.nth(index).boundingBox();
      assert.ok(box && box.width >= 44 && box.height >= 44, `${CONFIRMED[index].label} is a ≥44px target`);
      assert.ok(
        box && Math.abs(box.width - box.height) <= 1 && box.width <= 56,
        `${CONFIRMED[index].label} is a compact circular button (52px)`,
      );
    }

    const text = (await section.textContent()) ?? '';
    for (const pending of PENDING_LABELS) {
      const escaped = pending.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.doesNotMatch(text, new RegExp(`\\b${escaped}\\b`), `${pending} must not render while PENDING`);
    }
  } finally {
    await context.close();
  }
});

test('the Follow Us section adapts to mobile without horizontal overflow', async () => {
  const { context, page } = await open('/', 390, 844);
  try {
    const section = page.locator('[data-social-follow]');
    await section.scrollIntoViewIfNeeded();
    assert.equal(await section.isVisible(), true);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(overflow <= 1, `no horizontal overflow (${overflow}px)`);
    const links = page.locator('[data-social-links] a');
    assert.equal(await links.count(), CONFIRMED.length);
    // WCAG 2.2 target size: every social link is at least 44px tall.
    for (let index = 0; index < CONFIRMED.length; index += 1) {
      const box = await links.nth(index).boundingBox();
      assert.ok(box && box.height >= 44, `link ${index} target height ${box?.height}`);
    }
    // Phones: two balanced rows of four.
    const rows = await links.evaluateAll((nodes) => {
      const tops = nodes.map((node) => Math.round(node.getBoundingClientRect().top));
      return [...new Set(tops)].map((top) => tops.filter((value) => value === top).length);
    });
    assert.deepEqual(rows, [4, 4], 'icons form two balanced rows of four');
  } finally {
    await context.close();
  }
});

test('very narrow phones show eight circular buttons without overflow', async () => {
  const { context, page } = await open('/', 320, 780);
  try {
    const section = page.locator('[data-social-follow]');
    await section.scrollIntoViewIfNeeded();
    const links = page.locator('[data-social-links] a');
    assert.equal(await links.count(), CONFIRMED.length);
    for (let index = 0; index < CONFIRMED.length; index += 1) {
      const box = await links.nth(index).boundingBox();
      assert.ok(box && box.width >= 44 && box.height >= 44, `button ${index} is a ≥44px target`);
      assert.ok(Math.abs((box?.width ?? 0) - (box?.height ?? 0)) <= 1, `button ${index} is circular`);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(overflow <= 1, `no horizontal overflow (${overflow}px)`);
  } finally {
    await context.close();
  }
});

test('the old inline contact-column social icons are gone (no duplicates)', async () => {
  const { context, page } = await open('/', 390);
  try {
    const socialLists = await page.locator('[data-social-links]').count();
    assert.equal(socialLists, 1, 'exactly one social link list');
    // The contact column must not carry its own social links anymore.
    const contactLinks = await page
      .locator('.site-footer__grid a[href*="facebook.com"], .site-footer__grid a[href*="nextdoor.com"]')
      .count();
    assert.equal(contactLinks, 0, 'no duplicated social icons inside the contact column');
  } finally {
    await context.close();
  }
});
