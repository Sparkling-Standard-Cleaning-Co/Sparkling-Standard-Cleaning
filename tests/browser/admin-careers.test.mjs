import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4574;
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

const application = {
  id: 'app_1', reference: 'APP-20261120-ABC123', created_at: '2026-11-20T12:00:00.000Z',
  name: 'Synthetic Applicant', email: 'applicant@example.test', phone: '8505550100',
  experience_level: 'entry', desired_role: 'residential', branch_preference: 'pensacola',
  availability: 'Weekdays and Saturday mornings', transportation: 'own_vehicle',
  status: 'new', pipeline_status: 'new', position_code: 'residential', notes: '', resume_key: 'careers/2026/11/app_1/resume.pdf', resume_name: 'resume.pdf',
  hiring_notified_at: '2026-11-20T12:00:00.000Z', applicant_notified_at: '2026-11-20T12:00:00.000Z',
};

test('the owner can review and update a private career application', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const posts = [];
  await page.route('**/api/admin/auth*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, configured: true, setupRequired: false, authenticated: true, actor: { id: 'admin_owner', name: 'Owner', role: 'owner', branchId: null, permissions: ['*'], mfaEnabled: false }, csrf: 'csrf-test' }) });
  });
  await page.route('**/api/admin/overview*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, counts: {}, recentLeads: [] }) });
  });
  await page.route('**/api/admin/careers**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      posts.push(request.postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }
    const url = new URL(request.url());
    if (url.searchParams.get('view') === 'detail') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, application, interviews: [], statuses: [{ value: 'new', label: 'New' }, { value: 'under_review', label: 'Under Review' }, { value: 'selected', label: 'Selected' }, { value: 'archived', label: 'Archived' }] }) });
      return;
    }
    if (url.searchParams.get('view') === 'resume') {
      await route.fulfill({ status: 200, headers: { 'Content-Type': 'application/pdf' }, body: '%PDF-1.4' });
      return;
    }
    if (url.searchParams.get('view') === 'options') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, opportunities: [], settings: [] }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, applications: [application], total: 1, statuses: [{ value: 'new', label: 'New' }, { value: 'under_review', label: 'Under Review' }, { value: 'selected', label: 'Selected' }, { value: 'archived', label: 'Archived' }] }) });
  });
  try {
    await page.goto(BASE + '/admin/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Applicants / Recruitment' }).click();
    await page.waitForSelector('[data-admin-view="careers"]:not([hidden])');
    assert.match(await page.textContent('[data-careers-list]') ?? '', /Synthetic Applicant/);
    await page.getByRole('button', { name: 'Open' }).click();
    await page.waitForSelector('[data-career-update]');
    assert.match(await page.textContent('[data-career-detail]') ?? '', /Weekdays and Saturday mornings/);
    assert.equal(await page.locator('[data-career-detail] a[href*="view=resume"]').count(), 1);
    await page.selectOption('[data-career-update] select[name="status"]', 'under_review');
    await page.fill('[data-career-update] textarea[name="notes"]', 'Synthetic review note');
    await page.click('[data-career-update] button[type="submit"]');
    await page.waitForFunction(() => true);
    assert.ok(posts.some((body) => body.action === 'update_status' && body.status === 'under_review' && body.notes === 'Synthetic review note'));
  } finally { await context.close(); }
});
