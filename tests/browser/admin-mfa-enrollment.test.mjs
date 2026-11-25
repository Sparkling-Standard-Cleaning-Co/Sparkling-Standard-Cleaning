// Owner MFA enrollment UI regression. The admin APIs are mocked; no
// production account, code or email is contacted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4599;
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
      if ((await fetch(BASE + '/')).ok) {
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

async function openAdmin() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  await page.route('**/api/admin/auth*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        configured: true,
        setupRequired: false,
        authenticated: true,
        actor: {
          id: 'admin_owner',
          name: 'Owner',
          role: 'owner',
          branchId: null,
          permissions: ['*'],
          mfaEnabled: false,
          mfaMethod: 'totp',
        },
        csrf: 'csrf-test',
      }),
    });
  });
  await page.route('**/api/admin/overview*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, counts: {}, recentLeads: [] }),
    });
  });
  await page.route('**/api/admin/accounts**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      assert.equal(body.action, 'mfa_email_start');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          method: 'email',
          challengeToken: 'synthetic-email-challenge',
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          resendAfterSeconds: 60,
        }),
      });
      return;
    }
    const url = new URL(request.url());
    if (url.searchParams.get('view') === 'admins') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          admins: [
            {
              id: 'admin_owner',
              display_name: 'Owner',
              email: 'owner@example.test',
              role_id: 'owner',
              branch_name: '',
              mfa_enabled: 0,
              status: 'active',
            },
          ],
        }),
      });
      return;
    }
    if (url.searchParams.get('view') === 'sessions') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, sessions: [] }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, audit: [], total: 0, limit: 50, offset: 0 }),
    });
  });
  await page.goto(BASE + '/admin/', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-admin-app]:not([hidden])');
  await page.getByRole('button', { name: 'Settings & Audit' }).click();
  await page.waitForSelector('[data-admin-view="settings"]:not([hidden])');
  return { context, page };
}

test('the owner sees email-first MFA enrollment in the security section', async () => {
  const { context, page } = await openAdmin();
  try {
    const security = page.locator('[data-admin-view="settings"] [data-admin-mfa-status]');
    assert.match((await security.textContent()) ?? '', /Two-step verification is not enabled/i);
    assert.match((await security.textContent()) ?? '', /Email verification is recommended/i);
    const emailButton = security.getByRole('button', { name: 'Set up email verification codes' });
    const authenticatorButton = security.getByRole('button', { name: 'Set up authenticator app' });
    assert.equal(await emailButton.count(), 1);
    assert.equal(await authenticatorButton.count(), 1);
    assert.match(await emailButton.getAttribute('class') ?? '', /btn--primary/);

    page.once('dialog', (dialog) => dialog.accept('SyntheticOwner!2026'));
    await emailButton.click();
    await page.waitForSelector('[data-admin-view="settings"] [data-form="mfa-email-enable"]');
    assert.match(
      (await page.locator('[data-admin-view="settings"] [data-admin-mfa-setup]').textContent()) ?? '',
      /Check the account email/i,
    );
  } finally {
    await context.close();
  }
});
