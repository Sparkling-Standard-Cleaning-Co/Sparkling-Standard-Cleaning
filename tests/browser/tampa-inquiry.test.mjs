import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4457;
const BASE = `http://localhost:${PORT}`;
let server;
let browser;

before(async () => {
  server = spawn(process.execPath, ['node_modules/astro/astro.js', 'preview', '--port', String(PORT)], { stdio: 'ignore', windowsHide: true });
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

test('the Tampa page is a polished inquiry page, not a booking or technical status page', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    const response = await page.goto(BASE + '/locations/tampa-bay/', { waitUntil: 'load' });
    assert.equal(response?.status(), 200);
    const text = await page.locator('main').innerText();
    assert.match(text, /Exceptional cleaning is coming to Tampa Bay/i);
    assert.match(text, /residential and commercial/i);
    assert.match(text, /inquiry, not a confirmed appointment/i);
    assert.doesNotMatch(text, /Google Business Profile/i);
    assert.doesNotMatch(text, /Fulfillment|feature flag|server-authoritative/i);
    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    assert.match(robots ?? '', /noindex/i);
    assert.equal(await page.locator('[data-lead-form][data-variant="tampa"]').count(), 1);
  } finally {
    await context.close();
  }
});

test('a Tampa inquiry submits branch_tampa and never creates a booking', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  let captured = null;
  try {
    await page.route('**/api/lead-readiness*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ready: true, checks: { owner_email: true } }) }),
    );
    await page.route('**/api/lead', (route) => {
      captured = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    await page.goto(BASE + '/locations/tampa-bay/', { waitUntil: 'load' });
    await page.fill('#tampa-name', 'Tampa Inquiry Test');
    await page.fill('#tampa-phone', '8135550100');
    await page.fill('#tampa-email', 'tampa-inquiry@example.test');
    await page.selectOption('#tampa-inquiry-type', 'commercial_account');
    await page.fill('#tampa-address', '100 Test Street');
    await page.fill('#tampa-city', 'Tampa');
    await page.fill('#tampa-zip', '33602');
    await page.fill('#tampa-message', 'Testing a Tampa Bay commercial office inquiry.');
    await page.waitForTimeout(2800);
    await page.getByRole('button', { name: /Send Tampa Bay Inquiry/i }).click();
    await page.waitForFunction(() => location.pathname === '/thank-you/', null, { timeout: 5000 }).catch(() => {});
    assert.ok(captured, 'lead payload captured');
    const fields = captured.fields;
    assert.equal(fields.branch_id, 'branch_tampa');
    assert.equal(fields.request_type, 'contact');
    assert.equal(fields.inquiry_type, 'commercial_account');
    assert.equal(fields.service_address, '100 Test Street');
    assert.equal(fields.address_city, 'Tampa');
    assert.equal(fields.zip, '33602');
    assert.equal(fields.quote_reference, undefined, 'no booking quote is created from an inquiry');
  } finally {
    await context.close();
  }
});
