import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4550;
const BASE = 'http://localhost:' + PORT;

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

const dashboard = {
  ok: true,
  branchId: 'branch_pensacola',
  timezone: 'America/Chicago',
  settings: {
    mode: 'analysis_only',
    autoAssignEnabled: false,
    reassignmentRecommendations: true,
    customerReschedulingRecommendations: false,
    paused: true,
    minSavingsCents: 1500,
    maxCandidates: 8,
    vehicleCostCentsPerMile: 0,
    travelPayPercent: 0,
    weights: { travel: 1, miles: 0.2, labor: 0.1, workload: 0.5, continuity: 12, shared: 0 },
  },
  counts: { unassigned: 1, assignedToday: 2, autoAssignedToday: 0, pendingRecommendations: 1, coverageExceptions: 1, team: 2, dispatchReady: 1 },
  unassigned: [{ id: 'appt_unassigned', reference: 'DSP-100', startAt: '2026-12-02T14:00:00.000Z', endAt: '2026-12-02T16:00:00.000Z', customer: 'Test Customer', location: '200 Service Lane, Pensacola, FL', serviceCode: 'standard', crewSize: 1 }],
  recommendations: [{ id: 'dec_rec', appointment_id: 'appt_assigned', reference: 'DSP-101', reason: 'Avery saves 20 minutes of travel.', currentTeam: ['team_b'], chosenTeam: ['team_a'], status: 'proposed' }],
  exceptions: [{ id: 'dec_exc', appointment_id: 'appt_exception', reference: 'DSP-102', reason: 'No feasible eligible crew can cover this unassigned job.' }],
  decisions: [{ id: 'dec_rec', appointmentId: 'appt_assigned', reference: 'DSP-101', kind: 'recommendation', status: 'proposed', reason: 'Travel improvement', calendarStatus: 'not_requested', createdAt: '2026-11-20T12:00:00.000Z' }],
  lanes: [
    { id: 'unassigned', name: 'Unassigned', jobs: [{ id: 'appt_unassigned', reference: 'DSP-100', startAt: '2026-12-02T14:00:00.000Z', customer: 'Test Customer', location: '200 Service Lane' }] },
    { id: 'team_a', name: 'Avery', jobs: [] },
    { id: 'team_b', name: 'Blake', jobs: [{ id: 'appt_assigned', reference: 'DSP-101', startAt: '2026-12-03T14:00:00.000Z', customer: 'Other Customer', location: '300 Service Lane' }] },
  ],
  team: [
    { id: 'team_a', name: 'Avery', status: 'active', bookable: true, role: 'solo', services: ['standard'], equipment: ['standard-kit'], transportMode: 'independent', canDrive: true, seats: 2, canTransportEquipment: true, maxWeeklyHours: 40, overtimeApproved: false, originConfigured: true, originAddress: '100 Private Way', originLat: 30.42, originLng: -87.22, altOriginAddress: '', altOriginLat: null, altOriginLng: null, notes: '' },
    { id: 'team_b', name: 'Blake', status: 'active', bookable: true, role: 'helper', services: ['standard'], equipment: ['standard-kit'], transportMode: 'shared', canDrive: false, seats: 0, canTransportEquipment: false, maxWeeklyHours: 40, overtimeApproved: false, originConfigured: false, originAddress: '', originLat: null, originLng: null, altOriginAddress: '', altOriginLat: null, altOriginLng: null, notes: '' },
  ],
  metadata: {
    services: [{ code: 'standard', label: 'Residential cleaning' }],
    equipment: [{ code: 'standard-kit', label: 'Standard residential kit' }],
    branches: [{ id: 'branch_pensacola', name: 'Pensacola', timezone: 'America/Chicago' }],
  },
};

async function openAdmin() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const posts = [];
  page.on('pageerror', (error) => console.log('PAGEERROR', error.stack));
  await page.route('**/api/admin/auth*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        configured: true,
        setupRequired: false,
        authenticated: true,
        actor: { id: 'admin_owner', name: 'Owner', role: 'owner', branchId: null, permissions: ['job.read', 'job.write'], mfaEnabled: false },
        csrf: 'csrf-test',
      }),
    });
  });
  await page.route('**/api/admin/overview*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, counts: { customers: 1, leads: 1, requests: 1, todayJobs: 0, tomorrowJobs: 0, unassignedJobs: 1 }, recentLeads: [] }),
    });
  });
  await page.route('**/api/admin/operations?view=jobs', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, jobs: [], team: [{ id: 'team_a', display_name: 'Avery', email: 'a@example.test', is_solo: 1, is_lead: 1, is_bookable: 1, status: 'active' }, { id: 'team_b', display_name: 'Blake', email: 'b@example.test', is_solo: 0, is_lead: 0, is_bookable: 1, status: 'active' }] }),
    });
  });
  await page.route('**/api/admin/dispatch**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dashboard) });
      return;
    }
    const body = route.request().postDataJSON();
    posts.push(body);
    if (body.action === 'run_analysis' || body.action === 'run_automatic') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, summary: { scanned: 1, assigned: body.action === 'run_automatic' ? 1 : 0, exceptions: 0, recommendations: 0 } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, settings: dashboard.settings }) });
  });
  await page.goto(BASE + '/admin/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Jobs & Team' }).click();
  await page.waitForSelector('.admin-dispatch');
  await page.waitForSelector('[data-admin-dispatch-unassigned] table');
  return { context, page, posts };
}

test('the dispatch dashboard shows unassigned work, recommendations and employee lanes', async () => {
  const { context, page } = await openAdmin();
  try {
    const kpis = await page.textContent('[data-dispatch-kpis]');
    assert.match(kpis ?? '', /Unassigned/);
    assert.match(kpis ?? '', /1\/2/);
    assert.match(await page.textContent('[data-admin-dispatch-unassigned]') ?? '', /DSP-100/);
    assert.match(await page.textContent('[data-admin-dispatch-recommendations]') ?? '', /Avery/);
    assert.match(await page.textContent('[data-admin-dispatch-exceptions]') ?? '', /No feasible eligible crew/);
    assert.match(await page.textContent('[data-admin-dispatch-lanes]') ?? '', /DSP-101/);
  } finally {
    await context.close();
  }
});

test('selecting an employee loads the private dispatch profile for the owner', async () => {
  const { context, page } = await openAdmin();
  try {
    await page.locator('[data-dispatch-tab="team"]').click();
    await page.selectOption('[data-dispatch-profile-select]', 'team_a');
    assert.equal(await page.inputValue('[data-dispatch-profile] input[name="addressLine1"]'), '100 Private Way');
    assert.equal(await page.inputValue('[data-dispatch-profile] input[name="latitude"]'), '30.42');
    assert.equal(await page.isChecked('[data-dispatch-profile] input[name="canDrive"]'), true);
  } finally {
    await context.close();
  }
});

test('the owner can save dispatch controls and run automatic assignment', async () => {
  const { context, page, posts } = await openAdmin();
  try {
    await page.locator('[data-dispatch-tab="settings"]').click();
    await page.check('[data-dispatch-settings] input[name="autoAssignEnabled"]');
    await page.uncheck('[data-dispatch-settings] input[name="paused"]');
    await page.selectOption('[data-dispatch-settings] select[name="mode"]', 'automatic_unassigned');
    await page.click('[data-dispatch-settings] button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('[data-dispatch-result]')?.textContent === 'Dispatch updated.');
    assert.ok(posts.some((entry) => entry.action === 'update_settings' && entry.autoAssignEnabled === true && entry.paused === false));
    page.once('dialog', (dialog) => void dialog.accept());
    await page.click('[data-admin-action="dispatch-run-auto"]');
    await page.waitForFunction(() => /assigned 1/.test(document.querySelector('[data-dispatch-result]')?.textContent ?? ''));
    assert.ok(posts.some((entry) => entry.action === 'run_automatic'));
  } finally {
    await context.close();
  }
});

test('the owner can save an employee dispatch profile with services and transport', async () => {
  const { context, page, posts } = await openAdmin();
  try {
    await page.locator('[data-dispatch-tab="team"]').click();
    await page.selectOption('[data-dispatch-profile-select]', 'team_a');
    assert.equal(await page.isChecked('[data-dispatch-profile] input[name="services"][value="standard"]'), true, 'standard qualification loaded');
    await page.check('[data-dispatch-profile] input[name="services"][value="deep"]');
    await page.selectOption('[data-dispatch-profile] select[name="transportMode"]', 'independent');
    await page.click('[data-dispatch-profile] button[type="submit"]');
    await page.waitForFunction(() => true);
    const saved = posts.find((entry) => entry.action === 'update_profile');
    assert.ok(saved);
    assert.deepEqual(saved.services.sort(), ['deep', 'standard']);
    assert.equal(saved.transportMode, 'independent');
    assert.equal(saved.originAddress, '100 Private Way');
  } finally {
    await context.close();
  }
});
