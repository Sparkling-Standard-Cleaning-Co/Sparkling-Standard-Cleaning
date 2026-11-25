// Regression: the signing page must forward the resume capability to the
// signing API. Without it the server cannot offer "Continue to secure payment"
// after every required document is signed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4531;
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

test('the signing page forwards token, return and resume and then transitions to payment', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const requested = [];
  await page.route('**/api/document-sign?**', async (route) => {
    requested.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        request: {
          id: 'signreq_test',
          bundleCode: 'customer.deep',
          bundleName: 'Residential Deep / One-Time Packet',
          bundleVersion: 1,
          subjectType: 'customer',
          status: 'signed',
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
        documents: [],
        signedTemplateIds: [],
        consentVersion: 'test-consent',
        resumeCheckoutUrl: '/estimate/payment-resume/?token=test-resume',
      }),
    });
  });
  try {
    await page.goto(
      BASE +
        '/document-sign/?token=test-token&return=%2Festimate%2Fresidential%2F&resume=test-resume',
      { waitUntil: 'load' },
    );
    await page.waitForURL(/\/estimate\/payment-resume\//);
    const url = new URL(requested[0]);
    assert.equal(url.searchParams.get('token'), 'test-token');
    assert.equal(url.searchParams.get('return'), '/estimate/residential/');
    assert.equal(url.searchParams.get('resume'), 'test-resume');
    const destination = new URL(page.url());
    assert.equal(destination.pathname, '/estimate/payment-resume/');
    assert.equal(destination.searchParams.get('token'), 'test-resume');
    assert.equal(destination.searchParams.get('signing_token'), 'test-token');
    assert.equal(
      await page.getByRole('button', { name: /Continue to secure payment/i }).isVisible(),
      true,
    );
  } finally {
    await context.close();
  }
});
