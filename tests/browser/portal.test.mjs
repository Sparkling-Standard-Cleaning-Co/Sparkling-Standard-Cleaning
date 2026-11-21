import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4578;
const BASE = 'http://localhost:' + PORT;
let server; let browser;
before(async () => {
  server = spawn(process.execPath, ['node_modules/astro/astro.js', 'preview', '--port', String(PORT)], { stdio: 'ignore', windowsHide: true });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(BASE + '/')).ok) { browser = await chromium.launch(); return; } } catch {}
    await delay(500);
  }
  throw new Error('preview server did not become ready');
});
after(async () => { await browser?.close(); server?.kill(); });

test('the customer portal requests a passwordless link without disclosing account existence', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const page = await context.newPage();
  const posts = [];
  await page.route('**/api/portal/auth', async (route) => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, message: 'If that email belongs to an active Sparkling Standard customer, a secure sign-in link is on its way.' }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, authenticated: false }) });
  });
  try {
    await page.goto(BASE + '/portal/', { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-portal-login]:not([hidden])');
    await page.fill('[data-portal-login-form] input[name="email"]', 'unknown@example.test');
    await page.click('[data-portal-login-form] button[type="submit"]');
    await page.waitForFunction(() => (document.querySelector('[data-portal-login-status]')?.textContent ?? '').includes('secure sign-in link'));
    assert.ok(posts.some((body) => body.action === 'request_access' && body.email === 'unknown@example.test'));
    assert.equal(await page.locator('[data-portal-dashboard]').isVisible(), false);
  } finally { await context.close(); }
});

test('a verified portal session renders only the customer appointments, invoices and documents', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  await page.route('**/api/portal/auth*', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, authenticated: true, csrf: 'csrf-portal', name: 'Jordan Customer' }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, authenticated: false }) });
  });
  await page.route('**/api/portal/data', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, requestId: 'preq_1', message: 'Your request was received.' }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, csrf: 'csrf-portal',
      customer: { id: 'cust_1', first_name: 'Jordan', last_name: 'Customer', company_name: '', branch_name: 'Pensacola' },
      contacts: [{ kind: 'email', value: 'jordan@example.test', is_primary: 1 }],
      properties: [{ id: 'prop_1', label: 'Home', line1: '100 Synthetic Street', line2: '', city: 'Pensacola', state: 'FL', postal_code: '32502' }],
      appointments: [{ id: 'appt_1', reference: 'SS-1001', status: 'confirmed', start_at: '2026-12-01T15:00:00.000Z', end_at: '2026-12-01T17:00:00.000Z', duration_minutes: 120 }],
      recurring: [{ id: 'rp_1', frequency: 'biweekly', status: 'active', next_visit_date: '2026-12-15', ongoing_price_cents: 14500 }],
      invoices: [{ id: 'inv_1', number: 'INV-1001', status: 'open', total_cents: 14500, balance_cents: 14500, due_date: '2026-12-05', payment_url: null }],
      documents: { executed: [{ id: 'sr_1', bundle_code: 'packet.residential', packet_name: 'Residential packet', executed_at: '2026-11-20T12:00:00.000Z', executed_sha256: 'a'.repeat(64) }], signatures: [] },
      requests: [{ id: 'preq_0', kind: 'question', status: 'received', created_at: '2026-11-20T12:00:00.000Z' }],
      billingPortalEnabled: false,
    }) });
  });
  try {
    await page.goto(BASE + '/portal/?token=synthetic-token', { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-portal-dashboard]:not([hidden])');
    assert.match(await page.textContent('[data-portal-appointments]') ?? '', /SS-1001/);
    assert.match(await page.textContent('[data-portal-invoices]') ?? '', /INV-1001/);
    assert.match(await page.textContent('[data-portal-documents]') ?? '', /Residential packet/);
    assert.match(await page.textContent('[data-portal-recurring]') ?? '', /Biweekly/);
    assert.equal(await page.locator('[data-portal-action="billing"]').isDisabled(), true);
    await page.fill('[data-portal-request-form] textarea[name="message"]', 'Please confirm the arrival window.');
    await page.click('[data-portal-request-form] button[type="submit"]');
    await page.waitForFunction(() => (document.querySelector('[data-portal-request-status]')?.textContent ?? '').includes('received'));
  } finally { await context.close(); }
});
