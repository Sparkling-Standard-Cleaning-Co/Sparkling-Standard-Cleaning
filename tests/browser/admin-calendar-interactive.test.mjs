// Interactive seven-day operations calendar: persistent Morning/Afternoon
// sections, multiple appointments, branch-local time, drag-and-drop proposals,
// recurring scope changes and cancellation from the calendar.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4594;
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
      // not ready
    }
    await delay(500);
  }
  throw new Error('preview server did not become ready');
});

after(async () => {
  await browser?.close();
  server?.kill();
});

const appointments = [
  {
    id: 'appt_morning_1',
    booking_request_id: 'req_alpha',
    status: 'confirmed',
    start_at: '2026-11-24T14:00:00.000Z',
    end_at: '2026-11-24T17:00:00.000Z',
    duration_minutes: 180,
    reference: 'SS-ALPHA',
    customer_id: 'cust_alpha',
    first_name: 'Alpha',
    last_name: 'Customer',
    line1: '100 Example Street',
    city: 'Pensacola',
    assigned_names: 'Hayli',
    branch_id: 'branch_pensacola',
    crew_size: 1,
    request_payload: JSON.stringify({ service_type: 'standard' }),
  },
  {
    id: 'appt_morning_2',
    booking_request_id: null,
    status: 'confirmed',
    start_at: '2026-11-24T16:00:00.000Z',
    end_at: '2026-11-24T18:00:00.000Z',
    duration_minutes: 120,
    reference: 'RECURRING-rec_123',
    customer_id: 'cust_beta',
    first_name: 'Beta',
    last_name: 'Customer',
    line1: '200 Example Street',
    city: 'Pensacola',
    assigned_names: 'Hayli, Blake',
    branch_id: 'branch_pensacola',
    recurring_plan_id: 'rec_123',
    recurring_occurrence_id: 'occ_rec_123_2026-11-24',
    recurring_occurrence_date: '2026-11-24',
    crew_size: 2,
    request_payload: JSON.stringify({ service_type: 'recurring-residential' }),
  },
  {
    id: 'appt_afternoon_tampa',
    booking_request_id: 'req_gamma',
    status: 'confirmed',
    start_at: '2026-11-24T19:00:00.000Z',
    end_at: '2026-11-24T21:00:00.000Z',
    duration_minutes: 120,
    reference: 'SS-GAMMA',
    customer_id: 'cust_gamma',
    first_name: 'Gamma',
    last_name: 'Customer',
    line1: '300 Example Street',
    city: 'Tampa',
    assigned_names: 'Tampa Cleaner',
    branch_id: 'branch_tampa',
    crew_size: 1,
    request_payload: JSON.stringify({ service_type: 'standard' }),
  },
];

async function openAdmin() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
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
        actor: {
          id: 'admin_owner',
          name: 'Owner',
          role: 'owner',
          branchId: null,
          permissions: ['*'],
          mfaEnabled: false,
        },
        csrf: 'csrf-test',
      }),
    }),
  );
  await page.route('**/api/admin/overview*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        counts: { requests: 3, unsignedAgreements: 0, outstandingInvoices: 0, failedWorkerRuns: 0, failedCheckouts: 0 },
        alerts: [],
        recentLeads: [],
      }),
    }),
  );
  await page.route('**/api/admin/requests?**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, requests: [], appointments, reservationLeads: [] }),
    }),
  );
  await page.route('**/api/admin/requests', async (route) => {
    const body = route.request().postDataJSON();
    posts.push(body);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.route('**/api/admin/operations', async (route) => {
    const body = route.request().postDataJSON();
    posts.push(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, created: 1, cancelled: 0, errors: [] }),
    });
  });
  await page.goto(BASE + '/admin/', { waitUntil: 'load' });
  await page.locator('[data-admin-nav="calendar"]').click();
  await page.locator('.admin-week-grid').waitFor({ state: 'visible' });
  return { context, page, posts };
}

test('the calendar keeps Morning and Afternoon sections, cycles appointments and uses branch time', async () => {
  const { context, page } = await openAdmin();
  try {
    assert.equal(await page.locator('.admin-week-day').count(), 7);
    assert.equal(await page.locator('.admin-week-section').count(), 14, 'every day always shows both sections');
    const tuesday = page.locator('.admin-week-day').filter({ hasText: 'Nov 24' });
    const morning = tuesday.locator('.admin-week-section').filter({ hasText: 'Morning' });
    const afternoon = tuesday.locator('.admin-week-section').filter({ hasText: 'Afternoon' });
    assert.match((await morning.textContent()) ?? '', /2/, 'morning count is shown');
    assert.match((await afternoon.textContent()) ?? '', /1/, 'afternoon count is shown');

    assert.ok(await morning.locator('[data-week-appointment="appt_morning_1"]').isVisible(), 'earliest morning appointment is shown first');
    assert.ok(await morning.locator('[data-week-appointment="appt_morning_2"]').isHidden(), 'later appointment starts hidden');
    const more = morning.locator('[data-week-expand]');
    assert.match((await more.textContent()) ?? '', /\+1/);
    await more.click();
    assert.ok(await morning.locator('[data-week-appointment="appt_morning_2"]').isVisible(), 'cycling reveals the next appointment');
    assert.equal(await more.getAttribute('aria-expanded'), 'true');

    assert.match(
      (await morning.locator('[data-week-appointment="appt_morning_2"]').textContent()) ?? '',
      /10:00 AM.*CT/,
    );
    assert.match(
      (await morning.locator('[data-week-appointment="appt_morning_2"]').textContent()) ?? '',
      /Recurring/,
    );
    const tampaCard = afternoon.locator('.admin-appointment-card');
    const tampaText = (await tampaCard.textContent()) ?? '';
    assert.match(tampaText, /2:00 PM.*ET/, 'Tampa appointment uses Eastern time, never Pensacola time');
  } finally {
    await context.close();
  }
});

test('a recurring occurrence can be rescheduled for this appointment only', async () => {
  const { context, page, posts } = await openAdmin();
  try {
    const tuesday = page.locator('.admin-week-day').filter({ hasText: 'Nov 24' });
    const morning = tuesday.locator('.admin-week-section').filter({ hasText: 'Morning' });
    await morning.locator('[data-week-expand]').click();
    await morning
      .locator('[data-week-appointment="appt_morning_2"]')
      .locator('[data-admin-appointment-action="reschedule"]')
      .click();
    const dialog = page.locator('[data-admin-calendar-dialog] .admin-calendar-dialog-card');
    await dialog.waitFor({ state: 'visible' });
    assert.match((await dialog.textContent()) ?? '', /This appointment only/);
    assert.match((await dialog.textContent()) ?? '', /future cleanings/);
    await dialog.locator('input[name="date"]').fill('2026-11-25');
    await dialog.locator('input[name="time"]').fill('09:30');
    await dialog.getByRole('button', { name: 'Review and move appointment' }).click();
    await page.locator('[data-admin-dialog][open]').waitFor({ state: 'visible' });
    await page.locator('[data-admin-dialog-confirm]').click();
    await page.waitForFunction(() => !document.querySelector('[data-admin-calendar-dialog]')?.textContent?.trim());
    const post = posts.find((entry) => entry.action === 'update_occurrence');
    assert.ok(post, 'occurrence reschedule reached the server');
    assert.equal(post.planId, 'rec_123');
    assert.equal(post.occurrenceId, 'occ_rec_123_2026-11-24');
    assert.equal(post.occurrenceAction, 'reschedule');
    assert.equal(post.date, '2026-11-25');
    assert.equal(post.startTime, '09:30');
  } finally {
    await context.close();
  }
});

test('a recurring future-series change reports the affected schedule', async () => {
  const { context, page, posts } = await openAdmin();
  try {
    const tuesday = page.locator('.admin-week-day').filter({ hasText: 'Nov 24' });
    const morning = tuesday.locator('.admin-week-section').filter({ hasText: 'Morning' });
    await morning.locator('[data-week-expand]').click();
    await morning
      .locator('[data-week-appointment="appt_morning_2"]')
      .locator('[data-admin-appointment-action="reschedule"]')
      .click();
    const dialog = page.locator('[data-admin-calendar-dialog] .admin-calendar-dialog-card');
    await dialog.waitFor({ state: 'visible' });
    await dialog.locator('input[name="calendar-recurring-scope"][value="future"]').check();
    await dialog.locator('input[name="date"]').fill('2026-11-26');
    await dialog.locator('input[name="time"]').fill('10:15');
    await dialog.getByRole('button', { name: 'Review and move appointment' }).click();
    const confirmation = page.locator('[data-admin-dialog][open]');
    await confirmation.waitFor({ state: 'visible' });
    assert.match((await page.locator('[data-admin-dialog-body]').textContent()) ?? '', /future occurrences are regenerated/i);
    await page.locator('[data-admin-dialog-confirm]').click();
    await page.waitForFunction(() =>
      document.querySelector('[data-admin-success]')?.textContent?.includes('Recurring schedule updated'),
    );
    const post = posts.find((entry) => entry.action === 'update_recurring');
    assert.ok(post);
    assert.equal(post.planId, 'rec_123');
    assert.equal(post.startDate, '2026-11-26');
    assert.equal(post.startTime, '10:15');
  } finally {
    await context.close();
  }
});

test('dropping an appointment on another day proposes the new date and cancellation is scoped', async () => {
  const { context, page, posts } = await openAdmin();
  try {
    const proposedDate = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-week-appointment]')];
      const card = cards.find((entry) => entry.getAttribute('aria-label')?.includes('Gamma Customer'));
      const zones = [...document.querySelectorAll('[data-week-drop]')];
      const zone = zones[zones.length - 1];
      if (!card || !zone) return '';
      const dataTransfer = new DataTransfer();
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
      zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
      zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
      return zone.getAttribute('data-week-drop') ?? '';
    });
    const dialog = page.locator('[data-admin-calendar-dialog] .admin-calendar-dialog-card');
    await dialog.waitFor({ state: 'visible' });
    assert.equal(await dialog.locator('input[name="date"]').inputValue(), proposedDate);
    await page.locator('[data-calendar-close]').first().click();

    await page
      .locator('[data-week-appointment="appt_afternoon_tampa"]')
      .locator('[data-admin-appointment-action="cancel"]')
      .click();
    const cancelDialog = page.locator('[data-admin-calendar-dialog] .admin-calendar-dialog-card');
    await cancelDialog.waitFor({ state: 'visible' });
    assert.match((await cancelDialog.textContent()) ?? '', /Cancel appointment/);
    await cancelDialog.locator('input[name="reason"]').fill('Customer request');
    await cancelDialog.getByRole('button', { name: 'Review and cancel' }).click();
    await page.locator('[data-admin-dialog][open]').waitFor({ state: 'visible' });
    await page.locator('[data-admin-dialog-confirm]').click();
    await page.waitForFunction(() => !document.querySelector('[data-admin-calendar-dialog]')?.textContent?.trim());
    const post = posts.find((entry) => entry.action === 'cancel');
    assert.ok(post, 'calendar cancellation reached the server');
    assert.equal(post.requestId, 'req_gamma');
    assert.equal(post.reason, 'Customer request');
    assert.equal(post.notify, false, 'no customer email is sent unless explicitly chosen');
  } finally {
    await context.close();
  }
});

test('the interactive calendar remains usable without page-level overflow at phone width', async () => {
  const { context, page } = await openAdmin();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.admin-week-mobile-days').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.admin-week-mobile-days button').count(), 7);
    assert.equal(await page.locator('.admin-week-section').count(), 2);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(overflow <= 1, `calendar has no page-level horizontal overflow at 390px (got ${overflow})`);
    await page.locator('.admin-week-mobile-days button').filter({ hasText: 'Nov 24' }).click();
    const reschedule = page.locator('[data-admin-appointment-action="reschedule"]').first();
    assert.ok(await reschedule.isVisible(), 'keyboard/touch reschedule control is available');
  } finally {
    await context.close();
  }
});
