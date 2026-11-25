// Regression: viewing the Terms or Privacy policy from a checkout
// acknowledgment must not navigate away or erase the customer's progress.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4556;
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
      if ((await fetch(BASE + '/', { signal: AbortSignal.timeout(1500) })).ok) {
        browser = await chromium.launch();
        return;
      }
    } catch {
      // not ready yet
    }
    await delay(500);
  }
  throw new Error('preview server did not become ready');
});

after(async () => {
  await browser?.close();
  server?.kill();
});

async function open(width = 1280, height = 900) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  return { context, page };
}

function cloudflareObfuscate(email, key = 0x42) {
  return [key, ...[...email].map((character) => character.charCodeAt(0) ^ key)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

for (const viewport of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test(`policy links open an accessible modal without losing checkout state (${viewport.name})`, async () => {
    const { context, page } = await open(viewport.width, viewport.height);
    try {
      await page.goto(BASE + '/gift-certificates/', { waitUntil: 'load' });
      const startUrl = page.url();
      const acceptance = page.locator('[data-terms-acceptance]').first();
      const checkbox = acceptance.locator('input[type="checkbox"]');
      assert.equal(await checkbox.isChecked(), false);

      await acceptance.getByRole('link', { name: 'Terms and Conditions' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ state: 'visible' });
      await page.waitForFunction(() =>
        document.querySelector('[data-legal-policy-body]')?.textContent?.includes('Terms of service'),
      );
      assert.equal(page.url(), startUrl, 'opening the policy never navigates away');
      assert.equal(await checkbox.isChecked(), false, 'viewing the policy never checks acceptance');
      assert.match((await dialog.textContent()) ?? '', /Terms of service/);
      assert.equal(
        await dialog.getByRole('link', { name: /Open full page in a new tab/i }).getAttribute('target'),
        '_blank',
      );

      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(page.url(), startUrl);

      await acceptance.getByRole('link', { name: 'Privacy Policy' }).click();
      await dialog.waitFor({ state: 'visible' });
      await page.waitForFunction(() =>
        document.querySelector('[data-legal-policy-body]')?.textContent?.includes('Privacy policy'),
      );
      assert.match((await dialog.textContent()) ?? '', /Privacy policy/);
      assert.equal(page.url(), startUrl);
      assert.equal(await checkbox.isChecked(), false);

      await dialog.getByRole('button', { name: /Close and return to checkout/i }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(page.url(), startUrl);
      assert.equal(      await page.locator('#gift-purchaser-name').isVisible(), true);
    } finally {
      await context.close();
    }
  });
}

test('Cloudflare-obfuscated policy email renders as a real visible mailto link', async () => {
  const { context, page } = await open(1280, 900);
  try {
    const encoded = cloudflareObfuscate('customer-service@sparkling-standard.com');
    await page.route('**/terms/', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<html><body><main id="main"><h1>Terms of service</h1><p>Questions? Email <a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="${encoded}">[email protected]</a>.</p></main></body></html>`,
      }),
    );
    await page.goto(BASE + '/gift-certificates/', { waitUntil: 'load' });
    const acceptance = page.locator('[data-terms-acceptance]').first();
    await acceptance.getByRole('link', { name: 'Terms and Conditions' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });
    await page.waitForFunction(() =>
      document.querySelector('[data-legal-policy-body]')?.textContent?.includes('customer-service@sparkling-standard.com'),
    );
    const text = (await dialog.textContent()) ?? '';
    assert.doesNotMatch(text, /\[email protected\]/i);
    const emailLink = dialog.getByRole('link', { name: 'customer-service@sparkling-standard.com' });
    assert.equal(await emailLink.isVisible(), true);
    assert.equal(await emailLink.getAttribute('href'), 'mailto:customer-service@sparkling-standard.com');
  } finally {
    await context.close();
  }
});
