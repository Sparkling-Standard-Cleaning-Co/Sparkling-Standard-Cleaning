// Photo-upload browser acceptance: shared section on all four engines,
// thumbnails, remove/replace, persistence across steps, real HEIC conversion
// and honest error states. R2 is deliberately mocked; no real storage call.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const PORT = 4424;
const BASE = `http://localhost:${PORT}`;
const HEIC = path.resolve('tests/fixtures/photo-sample.heic');

let server;
let browser;

before(async () => {
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
});

async function open(pathname, width = 1440, height = 1100) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('pcc-consent-v1', JSON.stringify({ analytics: false, ads: false, v: 1 }));
    localStorage.setItem('pcc-promo-state', JSON.stringify({ state: 'dismissed', at: new Date().toISOString() }));
    sessionStorage.setItem('pcc-promo-shown-session', '1');
  });
  await page.route('**/api/photo-upload', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          enabled: true,
          maxBytes: 8 * 1024 * 1024,
          maxCount: 6,
          maxTotalBytes: 32 * 1024 * 1024,
          turnstileRequired: false,
        }),
      });
      return;
    }
    const post = route.request().postData() ?? '';
    const ref = /name="request_ref"\r?\n\r?\n([a-f0-9]+)/.exec(post)?.[1] ?? 'a'.repeat(24);
    const category = /name="category"\r?\n\r?\n([a-z_]+)/.exec(post)?.[1] ?? 'bathroom';
    const fileMatch = [...post.matchAll(/filename="([^"]+)"/g)].map((match) => match[1]);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        photos: fileMatch.map((name, index) => ({
          key: `leads/2026/10/${ref}/${category}-${String(index + 1).padStart(32, '0')}.jpg`,
          category,
          bytes: 2048,
          name,
        })),
      }),
    });
  });
  await page.goto(BASE + pathname, { waitUntil: 'load' });
  await page.addStyleTag({ content: '.mobile-action-bar,.consent-banner,.promo-popup{display:none!important}' });
  return { context, page };
}

async function advanceCommercialToStep4(page) {
  await page.fill('#fac-org', 'Photo Test Co');
  await page.fill('#fac-name', 'Photo Test');
  await page.locator('[data-address-manual-summary]').click();
  await page.fill('#est-zip', '32503');
  await page.locator('[data-facility-next]').click();
  await page.selectOption('#fac-type', 'office');
  await page.fill('#fac-sqft', '2000');
  await page.fill('#fac-restrooms', '6');
  await page.selectOption('#fac-frequency', 'weekly');
  await page.locator('[data-facility-next]').click();
  await page.selectOption('#fac-window', 'daytime');
  await page.locator('[data-facility-next]').click();
}

test('the shared photo section appears on all four engines with the right categories', async () => {
  const expectations = [
    ['/estimate/residential/', ['Bathroom', 'Kitchen', 'Main living or work area', 'Additional photos']],
    ['/estimate/str/', ['Bedrooms', 'Bathrooms', 'Kitchen', 'Laundry / linens', 'Additional photos']],
    ['/estimate/commercial/', ['Facility / entry', 'Floors', 'Restrooms', 'Special workload', 'Additional photos']],
    ['/estimate/church/', ['Sanctuary', 'Fellowship hall', 'Classrooms', 'Nursery', 'Kitchen', 'Church offices', 'Additional photos']],
  ];
  for (const [pathname, labels] of expectations) {
    const { context, page } = await open(pathname);
    try {
      await page.waitForFunction(() => {
        const section = document.querySelector('[data-photo-section]');
        return section && !section.hasAttribute('hidden');
      });
      const options = await page.locator('[data-photo-category] option').allTextContents();
      assert.deepEqual(options.map((label) => label.trim()), labels, pathname);
      assert.match(
        await page.locator('[data-photo-section]').innerText(),
        /Photos are required for an accurate estimate and confirmed booking/i,
      );
    } finally {
      await context.close();
    }
  }
});

test('uploads, removes, replaces and preserves a photo while moving through steps', async () => {
  const { context, page } = await open('/estimate/commercial/');
  try {
    await advanceCommercialToStep4(page);
    await page.locator('[data-photo-section]').waitFor({ state: 'visible' });
    await page.locator('[data-photo-input]').setInputFiles({
      name: 'front-room.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(2048).fill(0)]),
    });
    await page.waitForFunction(() => document.querySelectorAll('[data-photo-grid] img').length === 1);
    assert.match(await page.locator('[data-photo-status]').innerText(), /attached/);
    assert.match(await page.locator('[data-photo-grid]').innerText(), /front-room\.jpg/);

    await page.locator('[data-photo-grid] .photo-upload__thumb-action', { hasText: 'Remove' }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-photo-grid] img').length === 0);

    await page.locator('[data-photo-input]').setInputFiles({
      name: 'first.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(2048).fill(0)]),
    });
    await page.waitForFunction(() => document.querySelectorAll('[data-photo-grid] img').length === 1);
    const chooserPromise = page.waitForEvent('filechooser');
    await page.locator('[data-photo-grid] .photo-upload__thumb-action', { hasText: 'Replace' }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: 'replacement.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(2048).fill(0)]),
    });
    await page.waitForFunction(() =>
      document.querySelector('[data-photo-grid]')?.textContent?.includes('replacement.jpg'),
    );

    await page.locator('[data-facility-back]').click();
    await page.locator('[data-facility-next]').click();
    assert.equal(await page.locator('[data-photo-grid] img').count(), 1);
  } finally {
    await context.close();
  }
});

test('converts a real HEIC fixture to a JPEG before upload', async () => {
  const { context, page } = await open('/estimate/commercial/');
  try {
    await advanceCommercialToStep4(page);
    await page.locator('[data-photo-section]').waitFor({ state: 'visible' });
    await page.locator('[data-photo-input]').setInputFiles(HEIC);
    await page.waitForFunction(() => document.querySelectorAll('[data-photo-grid] img').length === 1, null, {
      timeout: 30_000,
    });
    await page.waitForFunction(
      () => /photo-sample\.jpg/.test(document.querySelector('[data-photo-grid]')?.textContent ?? ''),
      null,
      { timeout: 10_000 },
    );
    assert.match(await page.locator('[data-photo-grid]').innerText(), /photo-sample\.jpg/);
    const status = await page.locator('[data-photo-status]').innerText();
    assert.match(status, /attached/);
  } finally {
    await context.close();
  }
});

test('invalid files are rejected locally and the section stays hidden when storage is disabled', async () => {
  const { context, page } = await open('/estimate/commercial/');
  try {
    await advanceCommercialToStep4(page);
    await page.locator('[data-photo-input]').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not a photo'),
    });
    await page.waitForFunction(() => /Unsupported file type/.test(document.querySelector('[data-photo-status]')?.textContent ?? ''));
    assert.equal(await page.locator('[data-photo-grid] img').count(), 0);
  } finally {
    await context.close();
  }

  const disabled = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const disabledPage = await disabled.newPage();
  await disabledPage.route('**/api/photo-upload', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, enabled: false, maxBytes: 0, maxCount: 0, maxTotalBytes: 0 }),
    }),
  );
  await disabledPage.goto(BASE + '/estimate/commercial/', { waitUntil: 'load' });
  await delay(400);
  assert.equal(await disabledPage.locator('[data-photo-section]').getAttribute('hidden'), '');
  await disabled.close();
});
