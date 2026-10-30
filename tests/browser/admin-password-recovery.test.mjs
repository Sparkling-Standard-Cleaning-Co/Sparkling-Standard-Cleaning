// Owner acceptance checks for the /admin/ sign-in gate and self-service
// password recovery. The operations API is mocked; no production account or
// email is contacted.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4430;
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

async function openAdmin({ validReset = false, width = 1280, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const calls = [];
  await page.route('**/api/admin/auth*', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          configured: true,
          setupRequired: false,
          authenticated: false,
          actor: null,
          csrf: null,
        }),
      });
      return;
    }
    const body = JSON.parse(request.postData() ?? '{}');
    calls.push(body);
    if (body.action === 'reset_check') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, valid: validReset, expiresAt: null }),
      });
      return;
    }
    if (body.action === 'request_reset') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          message:
            'If that email belongs to an active administrator account, a single-use reset link is on its way.',
        }),
      });
      return;
    }
    if (body.action === 'reset_password') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'invalid_action' }),
    });
  });
  return { context, page, calls };
}

test('the sign-in page visibly offers Forgot Password', async () => {
  const { context, page } = await openAdmin();
  try {
    await page.goto(BASE + '/admin/');
    const login = page.locator('[data-admin-login]');
    await login.waitFor({ state: 'visible' });
    assert.equal(await login.locator('input[name="email"]').isVisible(), true);
    assert.equal(await login.locator('input[name="password"]').isVisible(), true);
    const forgot = page.getByRole('button', { name: 'Forgot Password?' });
    assert.equal(await forgot.isVisible(), true, 'Forgot Password is visible on the sign-in form');
    assert.equal(await page.locator('[data-admin-forgot-form]').isVisible(), false);
  } finally {
    await context.close();
  }
});

test('Forgot Password opens a simple recovery form and confirms generically', async () => {
  const { context, page, calls } = await openAdmin();
  try {
    await page.goto(BASE + '/admin/');
    await page.getByRole('button', { name: 'Forgot Password?' }).click();
    const recovery = page.locator('[data-admin-forgot-form]');
    await recovery.waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-admin-login]').isVisible(), false);
    await recovery.locator('input[name="email"]').fill('owner@sparkling-standard.com');
    await recovery.getByRole('button', { name: 'Send Reset Link' }).click();
    await page.locator('[data-admin-forgot-status]').filter({ hasText: 'single-use reset link' }).waitFor();
    const submitted = calls.find((call) => call.action === 'request_reset');
    assert.equal(submitted?.email, 'owner@sparkling-standard.com');
    assert.match(await page.locator('[data-admin-forgot-status]').innerText(), /expires in 30 minutes/i);
    await recovery.getByRole('button', { name: 'Return to Sign In' }).click();
    await page.locator('[data-admin-login]').waitFor({ state: 'visible' });
  } finally {
    await context.close();
  }
});

test('an invalid or expired reset link fails closed and offers a fresh one', async () => {
  const { context, page } = await openAdmin({ validReset: false });
  try {
    await page.goto(BASE + '/admin/?reset=expired-token');
    await page.locator('[data-admin-forgot-form]').waitFor({ state: 'visible' });
    assert.match(await page.locator('[data-admin-error]').innerText(), /invalid, expired or already used/i);
    assert.equal(page.url().includes('reset='), false, 'the one-time token is removed from the address bar');
    assert.equal(await page.locator('[data-admin-reset]').isVisible(), false);
  } finally {
    await context.close();
  }
});

test('a valid reset link enforces the 8-character rule and signs the user back in', async () => {
  const { context, page, calls } = await openAdmin({ validReset: true });
  try {
    await page.goto(BASE + '/admin/?reset=good-token');
    const form = page.locator('[data-admin-reset]');
    await form.waitFor({ state: 'visible' });
    assert.equal(await form.locator('input[name="password"]').getAttribute('minlength'), '8');
    assert.match(await form.innerText(), /At least 8 characters, including one special character/i);

    const passwordInput = form.locator('input[name="password"]');
    await passwordInput.fill('short');
    await form.locator('input[name="confirmPassword"]').fill('short');
    await form.getByRole('button', { name: 'Update Password' }).click();
    await page.waitForTimeout(300);
    assert.equal(calls.some((call) => call.action === 'reset_password'), false, 'a short password never reaches the server');
    assert.match(
      await passwordInput.evaluate((element) => element.validationMessage),
      /at least 8 characters/i,
    );

    await form.locator('input[name="password"]').fill('FreshPass!1');
    await form.locator('input[name="confirmPassword"]').fill('FreshPass!1');
    await form.getByRole('button', { name: 'Update Password' }).click();
    await page.locator('[data-admin-login]').waitFor({ state: 'visible' });
    assert.match(await page.locator('[data-admin-success]').innerText(), /Password updated/i);
    const submitted = calls.find((call) => call.action === 'reset_password');
    assert.equal(submitted?.password, 'FreshPass!1');
  } finally {
    await context.close();
  }
});

test('the recovery interface works on a phone-sized viewport', async () => {
  const { context, page } = await openAdmin({ width: 390, height: 844 });
  try {
    await page.goto(BASE + '/admin/');
    const forgot = page.getByRole('button', { name: 'Forgot Password?' });
    await forgot.waitFor({ state: 'visible' });
    const box = await forgot.boundingBox();
    assert.ok(box && box.y >= 0 && box.y < 844, 'Forgot Password is inside the phone viewport');
    await forgot.click();
    await page.locator('[data-admin-forgot-form]').waitFor({ state: 'visible' });
    const input = page.locator('[data-admin-forgot-form] input[name="email"]');
    const inputBox = await input.boundingBox();
    assert.ok(inputBox && inputBox.width > 180, 'the recovery email field is usable at 390px');
  } finally {
    await context.close();
  }
});
