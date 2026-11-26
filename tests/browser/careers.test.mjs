import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4572;
const BASE = 'http://localhost:' + PORT;
let server; let browser;
before(async () => {
  server = spawn(process.execPath, ['node_modules/astro/astro.js', 'preview', '--port', String(PORT)], { stdio: 'ignore', windowsHide: true });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(BASE + '/careers/')).ok) { browser = await chromium.launch(); return; } } catch {}
    await delay(500);
  }
  throw new Error('preview server did not become ready');
});
after(async () => { await browser?.close(); server?.kill(); });

async function open() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.route('**/api/careers-application', async (route) => {
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, reference: 'APP-20261120-ABC123', status: 'received', resumeStored: true }) });
  });
  await page.route('**/api/careers-status*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, reference: 'APP-20261120-ABC123', status: 'reviewing', submittedAt: '2026-11-20T12:00:00.000Z', updatedAt: '2026-11-20T12:00:00.000Z' }) });
  });
  await page.goto(BASE + '/careers/', { waitUntil: 'networkidle' });
  await page.evaluate(() => { for (const selector of ['[data-promo-popup]','[data-consent-banner]','.consent-banner']) document.querySelectorAll(selector).forEach((node) => node.remove()); });
  return { context, page };
}

test('the careers page supports experienced and entry-level applications', async () => {
  const { context, page } = await open();
  try {
    assert.match(await page.textContent('body') ?? '', /Build Your Future With Sparkling Standard/);
    assert.match(await page.textContent('body') ?? '', /Tampa Bay applications are/);
    assert.equal(await page.locator('[data-careers-form] select[name="experience_level"] option').count(), 5);
    assert.equal(await page.locator('[data-careers-form] select[name="desired_role"] option').count(), 9);
    assert.equal(await page.locator('[data-careers-form] input[name="available_days"]').count(), 7);
    assert.equal(await page.locator('[data-careers-form] input[name="privacy_ack"]').count(), 1);
    assert.equal(await page.locator('[data-careers-form] input[name="resume"]').getAttribute('accept'), '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  } finally { await context.close(); }
});

test('an application submits securely and returns a reference', async () => {
  const { context, page } = await open();
  try {
    await page.fill('[data-careers-form] input[name="first_name"]', 'Synthetic');
    await page.fill('[data-careers-form] input[name="last_name"]', 'Applicant');
    await page.fill('[data-careers-form] input[name="email"]', 'applicant@example.test');
    await page.fill('[data-careers-form] input[name="phone"]', '8505550100');
    await page.fill('[data-careers-form] input[name="city"]', 'Pensacola');
    await page.fill('[data-careers-form] input[name="postal_code"]', '32502');
    await page.selectOption('[data-careers-form] select[name="experience_level"]', 'entry');
    await page.selectOption('[data-careers-form] select[name="desired_role"]', 'residential');
    await page.selectOption('[data-careers-form] select[name="branch_preference"]', 'pensacola');
    await page.selectOption('[data-careers-form] select[name="transportation"]', 'own_vehicle');
    await page.check('[data-careers-form] input[name="available_days"][value="mon"]');
    await page.check('[data-careers-form] input[name="availability_morning"]');
    await page.fill('[data-careers-form] input[name="desired_weekly_hours"]', '30');
    await page.fill('[data-careers-form] textarea[name="availability"]', 'Weekdays and Saturday mornings');
    await page.setInputFiles('[data-careers-form] input[name="resume"]', { name: 'resume.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 synthetic') });
    await page.check('[data-careers-form] input[name="essential_duties_ack"]');
    await page.check('[data-careers-form] input[name="privacy_ack"]');
    await page.check('[data-careers-form] input[name="consent"]');
    await page.check('[data-careers-form] input[name="accuracy_ack"]');
    await page.click('[data-careers-form] button[type="submit"]');
    await page.waitForSelector('[data-careers-result]:not([hidden])');
    assert.match(await page.textContent('[data-careers-result]') ?? '', /APP-20261120-ABC123/);
    assert.match(await page.textContent('[data-careers-result]') ?? '', /not an offer or a promise of work/i);
  } finally { await context.close(); }
});

test('an applicant can check status with reference and email', async () => {
  const { context, page } = await open();
  try {
    await page.click('#status summary');
    await page.fill('[data-career-status-form] input[name="reference"]', 'APP-20261120-ABC123');
    await page.fill('[data-career-status-form] input[name="email"]', 'applicant@example.test');
    await page.click('[data-career-status-form] button[type="submit"]');
    await page.waitForFunction(() => /reviewing/.test(document.querySelector('[data-career-status-result]')?.textContent ?? ''));
    assert.match(await page.textContent('[data-career-status-result]') ?? '', /reviewing/);
  } finally { await context.close(); }
});
