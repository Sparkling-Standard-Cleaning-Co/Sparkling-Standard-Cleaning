// Employee portal browser acceptance: sign-in gate, branded phone layout,
// clock actions, honest location handling, two-day schedule visibility and the
// home-screen instructions. All APIs are mocked; no employee data is real.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4431;
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

const JOB = {
  id: 'appt_1',
  status: 'confirmed',
  startAt: new Date(Date.now() + 3 * 3_600_000).toISOString(),
  endAt: new Date(Date.now() + 5 * 3_600_000).toISOString(),
  durationMinutes: 120,
  crewSize: 1,
  reference: 'APT-TEST',
  service: 'Residential cleaning',
  address: '100 S Baylen St, Pensacola, FL 32502',
  customerFirstName: 'Test',
  instructions: 'Gate code 1234 · Dog is friendly',
  crew: ['Hayli'],
  checklist: { id: 'cl_1', status: 'pending', items: [{ id: 'i1', label: 'Clean bathrooms', completed: false }] },
};

function mePayload(state = 'out') {
  return {
    ok: true,
    actor: { name: 'Test Cleaner', role: 'cleaner', id: 'admin_test' },
    profile: { displayName: 'Test Cleaner', defaultRateType: 'regular', rates: { regular: 1800, lead: 2200, solo: 2500 } },
    clock: state === 'out' ? { state: 'out', since: null, appointmentId: null, rateType: null } : { state, since: new Date().toISOString(), appointmentId: 'appt_1', rateType: 'regular' },
    today: { workMinutes: 0, breakMinutes: 0, mealMinutes: 0, paidMinutes: 0, grossCents: 0, overtimeMinutes: 0, workLabel: '0h 00m', grossLabel: '$0.00' },
    week: { workMinutes: 0, breakMinutes: 0, mealMinutes: 0, paidMinutes: 0, grossCents: 0, overtimeMinutes: 0, workLabel: '0h 00m', overtimeLabel: '0h 00m', grossLabel: '$0.00', preliminary: true },
    missingClockOut: false,
    jobs: [JOB],
    windowDays: [],
  };
}

async function openPortal({ authenticated = true, denyLocation = false, state = 'out' } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(denyLocation ? {} : { geolocation: { latitude: 30.4, longitude: -87.2 }, permissions: ['geolocation'] }),
  });
  const page = await context.newPage();
  let currentState = state;
  const clockPosts = [];
  if (denyLocation) {
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (_success, error) => {
        error({ code: 1, message: 'Permission denied' });
      };
    });
  }
  await page.route('**/api/admin/auth', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(authenticated
          ? { ok: true, configured: true, setupRequired: false, authenticated: true, actor: { id: 'admin_test', name: 'Test Cleaner', role: 'cleaner', permissions: ['job.read'] }, csrf: 'csrf-test' }
          : { ok: true, configured: true, setupRequired: false, authenticated: false, actor: null, csrf: null }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.route('**/api/employee/me', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mePayload(currentState)) });
  });
  await page.route('**/api/employee/time', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, intervals: [], corrections: [] }) });
  });
  await page.route('**/api/employee/clock', async (route) => {
    clockPosts.push(JSON.parse(route.request().postData() ?? '{}'));
    currentState = 'work';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, clock: { state: 'work' }, today: {}, week: {} }),
    });
  });
  await page.goto(BASE + '/employee/', { waitUntil: 'load' });
  return { context, page, clockPosts };
}

test('an unauthenticated employee sees the branded sign-in gate with Forgot Password', async () => {
  const { context, page } = await openPortal({ authenticated: false });
  try {
    await page.locator('[data-employee-login]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.employee-brand').isVisible(), true);
    const forgot = page.locator('[data-employee-show-forgot]');
    assert.equal(await forgot.isVisible(), true);
    await forgot.click();
    await page.locator('[data-employee-forgot]').waitFor({ state: 'visible' });
    assert.match(await page.locator('[data-employee-forgot]').innerText(), /single-use link/i);
  } finally {
    await context.close();
  }
});

test('the phone portal shows only the assigned three-day job and the timeclock', async () => {
  const { context, page } = await openPortal();
  try {
    await page.locator('[data-employee-app]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.employee-clock').isVisible(), true);
    assert.match(await page.locator('[data-employee-jobs]').innerText(), /100 S Baylen St/);
    assert.match(await page.locator('[data-employee-jobs]').innerText(), /Residential cleaning/);
    assert.match(await page.locator('[data-employee-jobs]').innerText(), /Gate code 1234/);
    assert.match(await page.locator('[data-employee-jobs]').innerText(), /Clean bathrooms/);
    assert.equal(await page.locator('.admin-shell').count(), 0, 'the owner console is not present');
    assert.equal(await page.getByRole('button', { name: 'Clock In' }).isEnabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Start Break' }).isDisabled(), true);
  } finally {
    await context.close();
  }
});

test('clocking in records the action and captured location', async () => {
  const { context, page, clockPosts } = await openPortal();
  try {
    await page.locator('[data-employee-app]').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Clock In' }).click();
    await page.waitForFunction(() => document.querySelector('[data-employee-clock-state]')?.textContent === 'Clocked in');
    assert.equal(clockPosts.length, 1);
    assert.equal(clockPosts[0].action, 'clock_in');
    assert.equal(clockPosts[0].location.status, 'captured');
    assert.match(await page.locator('[data-employee-clock-status]').innerText(), /Clocked in/i);
  } finally {
    await context.close();
  }
});

test('denied location is disclosed and never blocks the clock', async () => {
  const { context, page, clockPosts } = await openPortal({ denyLocation: true });
  try {
    await page.locator('[data-employee-app]').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Clock In' }).click();
    await page.waitForFunction(() => document.querySelector('[data-employee-clock-state]')?.textContent === 'Clocked in');
    assert.equal(clockPosts[0].location.status, 'denied');
    const note = page.locator('[data-employee-location-note]');
    await note.waitFor({ state: 'visible' });
    assert.match(await note.innerText(), /Location permission was denied/i);
    assert.match(await note.innerText(), /time is still recorded/i);
  } finally {
    await context.close();
  }
});

test('the install page explains iPhone and Android home-screen steps', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await page.goto(BASE + '/employee/install/', { waitUntil: 'load' });
    const text = await page.locator('main').innerText();
    assert.match(text, /iPhone or iPad/i);
    assert.match(text, /Add to Home Screen/i);
    assert.match(text, /Android/i);
    assert.match(text, /no App Store or Google Play/i);
    assert.equal(await page.locator('link[rel="manifest"]').count(), 0);
    assert.match(await page.locator('a[href="/employee/"]').first().innerText(), /Open the team portal/i);
  } finally {
    await context.close();
  }
});
