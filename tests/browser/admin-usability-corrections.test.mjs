// Focused administrative usability checks: notification bell, mobile drawer,
// job views, recurring duration/crew display and the mobile calendar agenda.
// All APIs are mocked; no production record is touched.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4611;
const BASE = `http://localhost:${PORT}`;
let server;
let browser;

const jobs = [
  {
    id: 'appt_upcoming',
    status: 'confirmed',
    start_at: '2026-12-02T15:00:00.000Z',
    end_at: '2026-12-02T19:30:00.000Z',
    branch_id: 'branch_pensacola',
    duration_minutes: 270,
    crew_size: 1,
    crew: 'Hayli',
    crew_ids: 'team_hayli',
    reference: 'SS-UPCOMING-1',
    customer_id: 'cust_1',
    booking_request_id: 'req_1',
    first_name: 'Upcoming',
    last_name: 'Customer',
    line1: '100 Test Way',
    city: 'Pensacola',
    state: 'FL',
    postal_code: '32502',
    service_name: 'Deep Cleaning',
    source: 'website',
    calendar_event_id: 'evt_1',
  },
  {
    id: 'appt_completed',
    status: 'completed',
    start_at: '2026-11-25T15:00:00.000Z',
    end_at: '2026-11-25T18:00:00.000Z',
    branch_id: 'branch_pensacola',
    duration_minutes: 180,
    crew_size: 1,
    crew: 'Hayli',
    crew_ids: 'team_hayli',
    reference: 'SS-COMPLETED-1',
    customer_id: 'cust_2',
    first_name: 'Completed',
    last_name: 'Customer',
    line1: '200 Test Way',
    city: 'Pensacola',
    state: 'FL',
    postal_code: '32502',
    service_name: 'Residential Cleaning',
    source: 'website',
    calendar_event_id: 'evt_2',
  },
];

const recurringPlan = {
  id: 'rec_demo',
  customer_id: 'cust_1',
  status: 'active',
  frequency: 'biweekly',
  window: 'morning',
  start_time: '07:30',
  duration_minutes: 270,
  crew_size: 1,
  ongoing_price_cents: 22000,
  next_visit_date: '2026-12-09',
  sync_status: 'fully_scheduled',
  sync_error: '',
  assigned_names: 'Hayli',
  first_name: 'Recurring',
  last_name: 'Customer',
  line1: '100 Test Way',
  city: 'Pensacola',
  service_code: 'residential-cleaning',
  updated_at: '2026-11-26T18:14:40.000Z',
};

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

async function openAdmin(viewport = { width: 1366, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const posts = [];
  await page.route('**/api/admin/auth*', async (route) => {
    await route.fulfill({
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
    });
  });
  await page.route('**/api/admin/overview*', async (route) => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        counts: {
          customers: 2,
          leads: 0,
          requests: 1,
          upcomingAppointments: 1,
          activeGifts: 0,
          todayJobs: 1,
          tomorrowJobs: 0,
          unassignedJobs: 0,
          outstandingInvoices: 0,
          unsignedAgreements: 1,
          staffingPending: 0,
          failedCommunications: 0,
          failedPaymentEvents: 0,
          failedCommitments: 0,
          financialIssues: 0,
          failedWorkerRuns: 0,
          failedWorkerRunsHistory: 13,
          failedCheckouts: 0,
          failedCheckoutsHistory: 3,
          abandonedCheckouts: 9,
          failedLeadDeliveries: 0,
        },
        alerts: [
          {
            key: 'requests.pending',
            kind: 'pending_requests',
            severity: 'medium',
            status: 'new',
            title: 'Pending reservation requests',
            message: '1 pending reservation request needs a decision.',
            explanation: 'Review the reservation request.',
            lastSeen: '2026-11-26T20:00:00.000Z',
            view: 'calendar',
            filter: 'pending',
            branchId: 'branch_pensacola',
            records: [],
          },
        ],
        alertHistory: [],
        recentLeads: [],
      }),
    });
  });
  await page.route('**/api/admin/operations**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('view') === 'recurring') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          recurring: [recurringPlan],
          recurringEnabled: true,
          workerRuns: [{ run_key: '2026-11-26', status: 'failed', started_at: '2026-11-26T09:00:00.000Z', errors: 1, detail_json: '[]' }],
        }),
      });
      return;
    }
    if (url.searchParams.get('view') === 'occurrences') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"occurrences":[]}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        jobs,
        team: [{ id: 'team_hayli', display_name: 'Hayli', email: '', is_solo: 1, is_lead: 1, status: 'active', is_bookable: 1 }],
      }),
    });
  });
  await page.route('**/api/admin/dispatch**', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false,"error":"mock"}' }),
  );
  await page.route('**/api/admin/requests**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        requests: [],
        appointments: [],
        weekAppointments: (() => {
          const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
          return [
            { ...jobs[0], id: 'appt_morning_a', first_name: 'Morning', last_name: 'First', start_at: `${today}T15:00:00.000Z`, end_at: `${today}T19:30:00.000Z` },
            { ...jobs[0], id: 'appt_morning_b', first_name: 'Morning', last_name: 'Second', start_at: `${today}T16:00:00.000Z`, end_at: `${today}T20:00:00.000Z` },
          ];
        })(),
        reservationLeads: [],
      }),
    }),
  );
  await page.route('**/api/admin/customers**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"customers":[],"properties":[]}' }),
  );
  await page.route('**/api/admin/leads**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('view') === 'test_preview') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, suspects: [{ id: 'lead_test', reference: 'SS-TEST', customerName: 'Your Name Here', status: 'new', reasons: ['Placeholder customer name'] }] }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"leads":[],"total":0}' });
  });
  await page.route('**/api/admin/commercial**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        customers: [{ id: 'cust_acme', company_name: 'Acme Facilities', first_name: 'Acme', last_name: 'Manager' }],
        properties: [{ id: 'prop_hq', customer_id: 'cust_acme', label: 'HQ', line1: '1 Office Way', city: 'Pensacola', state: 'FL', access_notes: 'Badge' }],
        facilities: [{ id: 'prop_hq', customer_id: 'cust_acme', label: 'HQ', line1: '1 Office Way', city: 'Pensacola', state: 'FL', access_notes: 'Badge', proposal_count: 0, contract_count: 0, contact_count: 0, walkthrough_count: 0, job_count: 1, usage_type: 'facility' }],
        proposals: [],
        contracts: [],
      }),
    }),
  );
  await page.route('**/api/admin/branches**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        branches: [
          {
            id: 'branch_pensacola',
            name: 'Pensacola',
            lifecycle: 'live',
            publicName: 'Pensacola',
            publicSlug: 'pensacola',
            regionLabel: 'Pensacola',
            timezone: 'America/Chicago',
            publicPhone: '(850) 426-8479',
            publicEmail: 'customer-service@sparkling-standard.com',
            hoursLabel: '7am-7pm',
            serviceAreaZips: ['32501', '32530', '32561', '36502', '36507'],
            serviceStates: ['FL', 'AL'],
            services: { residential: 'bookable', str: 'estimate_enabled', commercial: 'estimate_enabled', church: 'estimate_enabled' },
            gbpStatus: 'verified',
            gbpUrl: '',
            reviewUrl: '',
            reviewRequestsEnabled: false,
            reviewRequestDelayHours: 24,
            reviewRequestMaxPerCustomer: 1,
            calendarId: '',
            calendarName: '',
            launchNote: '',
            originAddress: '1 Private Way',
            originCity: 'Cantonment',
            originState: 'FL',
            originPostalCode: '32533',
            originLat: 30.6,
            originLng: -87.3,
            originPlaceId: 'place',
            travelLimitMiles: 30,
            calendarBinding: { configured: true, source: 'environment', environmentVariable: 'GOOGLE_CALENDAR_ID_PENSACOLA', savedName: '', effectiveHint: 'abcd…@group.calendar.google.com', savedValueMatchesEnvironment: false },
            readiness: { ready: true, blockers: [], warnings: [] },
          },
        ],
      }),
    }),
  );
  await page.goto(BASE + '/admin/', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-admin-app]').waitFor({ state: 'visible' });
  return { context, page, posts };
}

test('notification bell, jobs views and recurring presentation are usable', async () => {
  const { context, page, posts } = await openAdmin();
  try {
    const summary = await page.textContent('[data-admin-kpis]');
    assert.match(summary ?? '', /Today's jobs/);
    assert.match(summary ?? '', /Open leads/);
    assert.equal(await page.locator('[data-admin-bell-count]').textContent(), '1');

    await page.click('[data-admin-bell]');
    await page.locator('[data-admin-notification-panel]').waitFor({ state: 'visible' });
    assert.match((await page.textContent('[data-admin-notification-list]')) ?? '', /Pending reservation requests/);
    await page.click('[data-admin-notification-mark-all]');
    await page.waitForFunction(() => Boolean(document.querySelector('[data-admin-bell-count]')?.hidden));
    assert.ok(posts.some((post) => post.action === 'acknowledge_all'));

    await page.click('[data-admin-nav="jobs"]');
    await page.locator('[data-admin-view="jobs"]:not([hidden])').waitFor();
    assert.match((await page.textContent('[data-admin-jobs]')) ?? '', /Upcoming Customer/);
    assert.doesNotMatch((await page.textContent('[data-admin-jobs]')) ?? '', /Completed Customer/);
    await page.click('[data-job-view="completed"]');
    assert.match((await page.textContent('[data-admin-jobs]')) ?? '', /Completed Customer/);

    await page.click('[data-admin-nav="recurring"]');
    await page.locator('[data-admin-view="recurring"]:not([hidden])').waitFor();
    const plan = (await page.textContent('[data-admin-recurring]')) ?? '';
    assert.match(plan, /4 hr 30 min/);
    assert.match(plan, /Assigned crew/);
    assert.match(plan, /Hayli/);
    assert.match(plan, /Fully scheduled/);

    await page.click('[data-admin-nav="commercial"]');
    await page.locator('[data-admin-view="commercial"]:not([hidden])').waitFor();
    const commercial = (await page.textContent('[data-commercial-workspace]')) ?? '';
    assert.match(commercial, /Acme Facilities/);
    assert.match(commercial, /Facility accounts/);

    await page.click('[data-admin-nav="leads"]');
    await page.locator('[data-admin-view="leads"]:not([hidden])').waitFor();
    await page.locator('[data-admin-test-preview-wrap] summary').click();
    await page.click('[data-admin-action="lead-test-preview"]');
    await page.locator('[data-admin-test-preview-result]').getByText('Your Name Here').waitFor({ state: 'visible' });
    assert.match((await page.textContent('[data-admin-test-preview-result]')) ?? '', /Placeholder customer name/);

    await page.click('[data-admin-nav="branches"]');
    await page.locator('[data-admin-view="branches"]:not([hidden])').waitFor();
    const branch = (await page.textContent('[data-admin-view="branches"]')) ?? '';
    assert.match(branch, /Cross-county ZIP codes/);
    assert.match(branch, /GOOGLE_CALENDAR_ID_PENSACOLA/);
    assert.match(branch, /Server environment variable/);
  } finally {
    await context.close();
  }
});

test('mobile navigation drawer and compact calendar agenda are usable', async () => {
  const { context, page } = await openAdmin({ width: 390, height: 844 });
  try {
    await page.click('[data-admin-menu-toggle]');
    await page.locator('.admin-sidebar.is-open').waitFor({ state: 'visible' });
    await page.click('[data-admin-nav="calendar"]');
    await page.locator('.admin-week-mobile-days').waitFor({ state: 'visible' });
    assert.ok((await page.locator('.admin-week-mobile-days button').count()) === 7);
    assert.match((await page.textContent('.admin-week-mobile-agenda')) ?? '', /Morning First|Morning Second/);
    assert.equal(await page.locator('.admin-sidebar.is-open').count(), 0);
  } finally {
    await context.close();
  }
});
