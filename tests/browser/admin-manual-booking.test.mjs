import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4436;
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

const quote = {
  engine: 'residential',
  status: 'priced',
  totalCents: 14900,
  range: { low: 139, high: 159 },
  laborHours: 3.5,
  durationMinutes: 210,
  cleaningSubtotalCents: 13500,
  extrasSubtotalCents: 0,
  discountAmountCents: null,
  discountLabel: null,
  travelAdjustmentCents: 1400,
  ongoingPerVisitCents: null,
  ongoingFrequency: null,
  tier: null,
  pricingVersion: 'price-test',
  serviceCode: 'standard',
  message: null,
  travel: { oneWayMiles: 12.5, durationMinutes: 20, verified: true, method: 'route' },
  fields: { frequency: 'one_time', quote_config_version: 'price-test' },
  documentsRequired: [],
  breakdown: {
    basePrice: 135,
    extrasSubtotal: 0,
    travelAdjustment: 14,
    discount: null,
    globalFactor: 1,
    globalAdjustment: 0,
    roundingAdjustment: 0,
    totalLaborHours: 3.5,
  },
};

async function openAdmin() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
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
        actor: {
          id: 'admin_owner',
          name: 'Owner',
          role: 'owner',
          branchId: null,
          permissions: ['booking.read', 'booking.write', 'customer.read', 'finance.read', 'finance.write'],
          mfaEnabled: false,
        },
        csrf: 'csrf-test',
      }),
    });
  });
  await page.route('**/api/admin/overview*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        counts: { customers: 1, leads: 0, requests: 0, upcomingAppointments: 0, activeGifts: 0, failedLeadDeliveries: 0 },
        recentLeads: [],
      }),
    });
  });
  await page.route('**/api/admin/customers*', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      posts.push({ route: 'customers', ...body });
      if (body.action === 'create') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, id: 'cust_new' }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        customers: [{ id: 'cust_1', first_name: 'Test', last_name: 'Customer', email: 'test@example.com' }],
      }),
    });
  });
  await page.route('**/api/admin/operations?view=team', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        team: [{ id: 'team_hayli', display_name: 'Hayli', status: 'active' }],
      }),
    });
  });
  await page.route('**/api/admin/documents*', async (route) => {
    const body = route.request().postDataJSON();
    posts.push({ route: 'documents', ...body });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        required: true,
        requestId: 'sign_1',
        signingUrl: '/document-sign/?token=synthetic',
        emailSent: true,
        bundleCode: 'customer.residential',
      }),
    });
  });
  await page.route('**/api/admin/bookings*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.searchParams.get('view') === 'commitments') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, commitments: [] }) });
    }
    if (request.method() === 'GET' && url.searchParams.get('view') === 'context') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          customer: { id: 'cust_1', first_name: 'Test', last_name: 'Customer', email: 'test@example.com' },
          properties: [
            {
              id: 'prop_1',
              label: 'Home',
              line1: '100 Test Street',
              city: 'Cantonment',
              state: 'FL',
              postal_code: '32533',
              property_type: 'house',
              square_feet: 1800,
              bedrooms: 3,
              full_baths: 2,
              half_baths: 1,
              beds: 0,
              pets: 'none',
            },
          ],
        }),
      });
    }
    if (request.method() === 'GET' && url.searchParams.get('view') === 'availability') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          availability: {
            ok: true,
            date: '2026-12-15',
            durationMinutes: 210,
            crewSize: 1,
            slots: [{ start: '2026-12-15T15:00:00.000Z', end: '2026-12-15T18:30:00.000Z', label: '9:00 AM', resourceIds: ['hayli'] }],
            staff: [{ id: 'team_hayli', name: 'Hayli', resourceId: 'hayli', isSolo: true, isLead: true }],
          },
        }),
      });
    }
    const body = request.postDataJSON();
    posts.push({ route: 'bookings', ...body });
    if (body.action === 'quote') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, quote }) });
    }
    if (body.action === 'create') {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, requestId: 'req_manual_1', reference: 'MB-20261215-ABC123', quote }),
      });
    }
    if (body.action === 'create_completed') {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          appointmentId: 'appt_completed_1',
          estimateId: 'est_completed_1',
          reference: 'HC-20261123-COMPLETE',
          serviceDate: body.completedDate,
          totalCents: 27500,
        }),
      });
    }
    if (body.action === 'invoice_job') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, invoice: { id: 'inv_completed_1', number: 'INV-COMPLETED' } }),
      });
    }
    if (body.action === 'invoice') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, invoice: { id: 'inv_1', number: 'INV-1001' } }),
      });
    }
    if (body.action === 'confirm') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, appointmentId: 'appt_manual_1', eventId: 'event_manual_1', reference: 'MB-20261215-ABC123' }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.goto(BASE + '/admin/', { waitUntil: 'networkidle' });
  return { context, page, posts };
}

test('an owner can create, quote and confirm a manual booking from the admin console', async () => {
  const { context, page } = await openAdmin();
  try {
    await page.getByRole('button', { name: 'New Booking' }).click();
    await page.waitForFunction(() => {
      const select = document.querySelector('[data-manual-customer]');
      return select instanceof HTMLSelectElement && select.options.length > 1;
    });
    await page.selectOption('[data-manual-customer]', 'cust_1');
    await page.waitForFunction(() => {
      const select = document.querySelector('[data-manual-property]');
      return select instanceof HTMLSelectElement && select.options.length > 1;
    });
    assert.equal(await page.inputValue('[name="squareFeet"]'), '1800');
    await page.fill('[data-manual-date]', '2026-12-15');
    await page.getByRole('button', { name: 'Generate Estimate and Check Times' }).click();
    await page.waitForSelector('[data-manual-quote-result] table', { timeout: 5000 });
    assert.match(await page.textContent('[data-manual-quote-result]'), /\$149\.00/);
    await page.waitForFunction(() => {
      const select = document.querySelector('[data-manual-slots]');
      return select instanceof HTMLSelectElement && select.options.length === 1 && select.options[0]?.value !== '';
    });
    await page.getByRole('button', { name: 'Save Booking' }).click();
    await page.waitForSelector('[data-manual-booking-result] h3', { timeout: 5000 });
    assert.match(await page.textContent('[data-manual-booking-result]'), /Pending booking MB-20261215-ABC123/);
    await page.getByRole('button', { name: 'Confirm Booking' }).click();
    await page.waitForSelector('[data-manual-booking-followup]', { timeout: 5000 });
    assert.match(await page.textContent('[data-manual-booking-followup]'), /Confirmed MB-20261215-ABC123/);
  } finally {
    await context.close();
  }
});

test('an owner can create a customer inline, then book, send agreements and prepare an invoice', async () => {
  const { context, page, posts } = await openAdmin();
  try {
    await page.getByRole('button', { name: 'New Booking' }).click();
    await page.waitForFunction(() => {
      const select = document.querySelector('[data-manual-customer]');
      return select instanceof HTMLSelectElement && select.options.length > 1;
    });
    await page.locator('[data-manual-new-customer] summary').click();
    await page.fill('[name="newFirstName"]', 'New');
    await page.fill('[name="newLastName"]', 'Customer');
    await page.fill('[name="newEmail"]', 'new@example.test');
    await page.fill('[name="newAddressLine1"]', '500 New Street');
    await page.fill('[name="newCity"]', 'Cantonment');
    await page.fill('[name="newPostalCode"]', '32533');
    await page.getByRole('button', { name: 'Create customer and continue' }).click();
    await page.waitForFunction(() => {
      const select = document.querySelector('[data-manual-customer]');
      return select instanceof HTMLSelectElement && select.value === 'cust_new';
    });
    const created = posts.find((entry) => entry.route === 'customers' && entry.action === 'create');
    assert.ok(created, 'inline customer creation reaches the CRM API');
    assert.equal(created.email, 'new@example.test');
    assert.equal(created.addressLine1, '500 New Street');

    await page.fill('[data-manual-date]', '2026-12-15');
    await page.getByRole('button', { name: 'Generate Estimate and Check Times' }).click();
    await page.waitForSelector('[data-manual-quote-result] table', { timeout: 5000 });
    await page.waitForFunction(() => {
      const select = document.querySelector('[data-manual-slots]');
      return select instanceof HTMLSelectElement && select.options.length === 1 && select.options[0]?.value !== '';
    });
    await page.getByRole('button', { name: 'Book, Send Agreements & Invoice' }).click();
    const confirmation = page.locator('[data-admin-dialog][open]');
    await confirmation.waitFor({ state: 'visible' });
    const confirmationText = (await page.locator('[data-admin-dialog-body]').textContent()) ?? '';
    assert.match(confirmationText, /Test Customer/);
    assert.match(confirmationText, /test@example.com/);
    assert.match(confirmationText, /invoice/);
    assert.match(confirmationText, /will not be emailed/);
    await page.locator('[data-admin-dialog-confirm]').click();
    await page.waitForSelector('[data-manual-booking-result] h3', { timeout: 5000 });
    await page.waitForFunction(() =>
      document.querySelector('[data-admin-success]')?.textContent?.includes('invoice draft created'),
    );
    const documents = posts.find((entry) => entry.route === 'documents' && entry.action === 'send_request');
    assert.ok(documents, 'agreement invitation was sent through the document service');
    assert.equal(documents.bookingReference, 'MB-20261215-ABC123');
    const invoice = posts.find((entry) => entry.route === 'bookings' && entry.action === 'invoice');
    assert.ok(invoice, 'invoice draft was requested once');
    assert.equal(invoice.paymentLink, false, 'no payment link, email or charge is created automatically');
  } finally {
    await context.close();
  }
});

test('the manual booking form stays usable at phone width without horizontal overflow', async () => {  const { context, page } = await openAdmin();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'New Booking' }).click();
    await page.waitForFunction(() => {
      const select = document.querySelector('[data-manual-customer]');
      return select instanceof HTMLSelectElement && select.options.length > 1;
    });
    await page.selectOption('[data-manual-customer]', 'cust_1');
    await page.waitForFunction(() => {
      const select = document.querySelector('[data-manual-property]');
      return select instanceof HTMLSelectElement && select.options.length > 1;
    });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `manual booking view overflows by ${overflow}px`);
  } finally {
    await context.close();
  }
});

test('the admin explains that recurring scheduling is temporarily disabled', async () => {
  const { context, page } = await openAdmin();
  try {
    await page.route('**/api/admin/operations*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, recurring: [], recurringEnabled: false }),
      });
    });
    await page.getByRole('button', { name: 'Recurring Plans' }).click();
    await page.waitForSelector('[data-admin-recurring-notice]');
    assert.match(
      (await page.textContent('[data-admin-recurring-notice]')) ?? '',
      /Recurring scheduling is temporarily disabled/i,
    );
    assert.equal(await page.locator('[data-admin-recurring-create]').isHidden(), true);
  } finally {
    await context.close();
  }
});
test('an unresolved recurring sync is shown as a readable conflict with its date', async () => {
  const { context, page } = await openAdmin();
  try {
    await page.route('**/api/admin/operations*', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            recurringEnabled: true,
            recurring: [
              {
                id: 'rec_test',
                first_name: 'Christina',
                last_name: 'Sherwin',
                line1: '228 Promenade Lane',
                city: 'Cantonment',
                frequency: 'biweekly',
                window: 'morning',
                start_time: '08:30',
                duration_minutes: 270,
                ongoing_price_cents: 12000,
                next_visit_date: '2026-11-10',
                sync_status: 'conflict',
                sync_error: '2026-11-10:travel_unavailable',
                status: 'active',
              },
            ],
          }),
        });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      }
    });
    await page.getByRole('button', { name: 'Recurring Plans' }).click();
    await page.waitForSelector('[data-admin-recurring] table');
    const text = (await page.textContent('[data-admin-recurring]')) ?? '';
    assert.match(text, /Conflict/);
    assert.match(text, /2026-11-10: Travel route could not be established/i);
  } finally {
    await context.close();
  }
});

test('the completed-service mode records a custom $275 historical job and creates one invoice', async () => {
  const { context, page, posts } = await openAdmin();
  try {
    await page.getByRole('button', { name: 'New Booking' }).click();
    await page.waitForFunction(() => {
      const select = document.querySelector('[data-manual-customer]');
      return select instanceof HTMLSelectElement && select.options.length > 1;
    });
    await page.selectOption('[data-manual-customer]', 'cust_1');
    await page.waitForFunction(() => {
      const select = document.querySelector('[data-manual-property]');
      return select instanceof HTMLSelectElement && select.options.length > 1;
    });
    await page.selectOption('[data-manual-appointment-type]', 'completed');
    await page.fill('[data-manual-completed-date]', '2026-11-23');
    await page.fill('[data-manual-custom-price]', '275');
    await page.selectOption('[data-manual-service]', 'move_out');
    await page.waitForSelector('[data-manual-completed-crew]', { timeout: 5000 });
    await page.check('[data-manual-completed-crew]');
    assert.match((await page.textContent('[data-manual-pricing-summary]')) ?? '', /\$275\.00/);
    assert.equal(await page.locator('[data-manual-scheduled-actions]').isHidden(), true);
    assert.equal(await page.locator('[data-manual-completed-actions]').isVisible(), true);
    await page.getByRole('button', { name: 'Save & Create Invoice' }).click();
    const dialog = page.locator('[data-admin-dialog][open]');
    await dialog.waitFor({ state: 'visible' });
    assert.match((await page.locator('[data-admin-dialog-body]').textContent()) ?? '', /Move-Out Cleaning/);
    assert.match((await page.locator('[data-admin-dialog-body]').textContent()) ?? '', /\$275\.00/);
    await page.locator('[data-admin-dialog-confirm]').click();
    await page.waitForFunction(() =>
      document.querySelector('[data-admin-success]')?.textContent?.includes('Completed service and invoice created'),
    );
    const created = posts.find((entry) => entry.route === 'bookings' && entry.action === 'create_completed');
    assert.ok(created, 'the completed-service API was called');
    assert.equal(created.completedDate, '2026-11-23');
    assert.equal(created.pricingMethod, 'custom');
    assert.equal(created.customPrice, 275);
    assert.deepEqual(created.teamMemberIds, ['team_hayli']);
    const invoice = posts.find((entry) => entry.route === 'bookings' && entry.action === 'invoice_job');
    assert.ok(invoice);
    assert.equal(invoice.appointmentId, 'appt_completed_1');
    assert.match((await page.textContent('[data-manual-booking-result]')) ?? '', /INV-COMPLETED/);
  } finally {
    await context.close();
  }
});
