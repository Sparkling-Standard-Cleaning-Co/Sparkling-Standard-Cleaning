import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4580;
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
    } catch {}
    await delay(500);
  }
  throw new Error('preview server did not become ready');
});
after(async () => {
  await browser?.close();
  server?.kill();
});

test('the employee workspace opens files, training and payroll with permission-safe data', async () => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
  const page = await context.newPage();
  const posts = [];
  await page.route('**/api/admin/auth*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        configured: true,
        setupRequired: false,
        authenticated: true,
        actor: { id: 'admin_owner', name: 'Owner', role: 'owner', branchId: null, permissions: ['*'], mfaEnabled: false },
        csrf: 'csrf-test',
      }),
    }),
  );
  await page.route('**/api/admin/overview*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"counts":{},"recentLeads":[]}' }),
  );
  await page.route('**/api/admin/employees**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"id":"payroll_new"}' });
      return;
    }
    if (url.searchParams.get('view') === 'member') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          onboarding: [{ id: 'onb_1', title: 'Signed handbook', category: 'compliance', status: 'pending', due_date: '2026-12-01' }],
          training: [{ id: 'ta_1', title: 'Bathroom procedure', status: 'assigned', score: null }],
          performance: [{ id: 'p1', kind: 'praise', note: 'Great detail', created_at: '2026-11-20' }],
          expirations: [{ label: 'License', expires: '2027-01-01' }],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        profiles: [
          {
            id: 'team_emp',
            display_name: 'Employee One',
            email: 'employee@example.test',
            status: 'active',
            is_bookable: 1,
            default_rate_type: 'regular',
            pay_rate_regular_cents: 1800,
            pay_rate_lead_cents: 2200,
            pay_rate_solo_cents: 2500,
            pending_onboarding: 1,
            pending_training: 1,
            handbook_acknowledged_at: null,
          },
        ],
        modules: [{ id: 'mod_1', title: 'Bathroom procedure', category: 'procedures', version: '1.0', required: 1, active: 1 }],
        assignments: [{ id: 'ta_1', module_id: 'mod_1', team_member_id: 'team_emp', status: 'assigned' }],
        inspections: [{ id: 'q1', inspected_at: '2026-11-20', first_name: 'Quality', last_name: 'Customer', score: 92, status: 'completed', inspector_name: 'Employee One' }],
        payroll: [{ id: 'pay_1', period_start: '2026-11-09', period_end: '2026-11-22', status: 'calculated', employee_count: 1, gross_cents: 250000 }],
        timeOff: [{ id: 'toff_1', display_name: 'Employee One', start_at: '2026-12-10T14:00:00Z', end_at: '2026-12-11T22:00:00Z', reason: 'Family', status: 'pending' }],
      }),
    });
  });
  page.on('dialog', (dialog) => dialog.accept());
  try {
    await page.goto(BASE + '/admin/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Employees & Payroll' }).click();
    await page.waitForSelector('[data-admin-view="employees"]:not([hidden])');
    assert.match((await page.textContent('[data-employees-workspace]')) ?? '', /Employee One/);
    assert.match((await page.textContent('[data-employees-workspace]')) ?? '', /Quality Customer/);
    await page.click('[data-employee-action="select"]');
    await page.waitForFunction(() => document.querySelector('[data-employee-member]')?.textContent?.includes('Emergency contact'));
    assert.match((await page.textContent('[data-employee-member]')) ?? '', /Signed handbook/);
    assert.match((await page.textContent('[data-employee-member]')) ?? '', /Great detail/);
    await page.click('[data-employee-action="timeoff-approve"]');
    await page.waitForTimeout(300);
    assert.ok(posts.some((body) => body.action === 'time_off_review' && body.status === 'approved'));
    const payrollForm = page.locator('[data-employee-form="payroll-period"]');
    const payrollResponse = page.waitForResponse((response) => response.url().includes('/api/admin/employees') && response.request().method() === 'POST');
    await payrollForm.locator('button[type="submit"]').click();
    await payrollResponse;
    await page.waitForTimeout(200);
    assert.ok(posts.some((body) => body.action === 'payroll_create'));
  } finally {
    await context.close();
  }
});
