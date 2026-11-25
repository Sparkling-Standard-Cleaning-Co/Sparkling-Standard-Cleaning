import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { createOpsSession, enrollOwner, readOpsActor } from '../src/lib/admin/operations.ts';
import {
  cancelManualBooking,
  confirmManualBooking,
  createCompletedService,
  createManualBooking,
  manualAvailability,
  quoteManualBooking,
} from '../src/lib/admin/manual-booking.ts';
import type { AvailabilityInput, AvailabilityServiceResult } from '../src/lib/booking/service.ts';
import { onRequestGet as bookingsGet, onRequestPost as bookingsPost } from '../functions/api/admin/bookings.ts';
import { createInvoice, getInvoice } from '../src/lib/admin/billing.ts';
import {
  activeEntitlementForCustomer,
  applyCustomerEntitlement,
  removeCustomerEntitlement,
} from '../src/lib/promotions/entitlements.ts';

class SqlStatement implements D1PreparedStatement {
  private values: unknown[] = [];
  private readonly db: DatabaseSync;
  private readonly sql: string;
  constructor(db: DatabaseSync, sql: string) {
    this.db = db;
    this.sql = sql;
  }
  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values;
    return this;
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...(this.values as never[])) as T | undefined) ?? null;
  }
  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return { success: true, results: this.db.prepare(this.sql).all(...(this.values as never[])) as T[] };
  }
  async run(): Promise<D1Result> {
    this.db.prepare(this.sql).run(...(this.values as never[]));
    return { success: true };
  }
}

class TestD1 implements D1Database {
  readonly raw = new DatabaseSync(':memory:');
  prepare(query: string): D1PreparedStatement {
    return new SqlStatement(this.raw, query);
  }
}

function migratedDb(): TestD1 {
  const db = new TestD1();
  db.raw.exec('PRAGMA foreign_keys = ON');
  for (const file of fs.readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
    db.raw.exec(fs.readFileSync(path.join('migrations', file), 'utf8'));
  }
  return db;
}

function request(cookie = ''): Request {
  return new Request('https://example.test/api/admin/bookings', {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

const START = '2026-12-15T15:00:00.000Z';

function slotAvailability(
  calls: AvailabilityInput[],
): (env: unknown, input: AvailabilityInput) => Promise<AvailabilityServiceResult> {
  return async (_env, input) => {
    calls.push(input);
    return {
      ok: true,
      enabled: true,
      date: input.date,
      durationMinutes: input.durationMinutes,
      crewSize: input.crewSize ?? 1,
      origin: { lat: 30.4, lng: -87.2 },
      destination: input.destination,
      availability: {
        available: true,
        enabled: true,
        slots: [
          {
            start: START,
            end: new Date(Date.parse(START) + input.durationMinutes * 60_000).toISOString(),
            startLabel: '9:00 AM',
            endLabel: '11:00 AM',
            resourceIds: ['hayli'],
          },
        ],
      },
    };
  };
}

async function fixture() {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'owner@example.test',
    name: 'Synthetic Owner',
    password: 'SyntheticOwner!2026',
  });
  const session = await createOpsSession(db, owner.id, request());
  const actor = await readOpsActor(db, request(`ss_ops=${session.token}`));
  assert.ok(actor);
  db.raw
    .prepare(
      `INSERT INTO customers (id, primary_branch_id, first_name, last_name, status, source)
       VALUES ('cust_manual', 'branch_pensacola', 'Manual', 'Customer', 'active', 'admin')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO properties
       (id, customer_id, branch_id, label, line1, city, state, postal_code, latitude, longitude,
        property_type, square_feet, bedrooms, full_baths, half_baths, stories, beds, pets, is_primary, status)
       VALUES ('prop_manual', 'cust_manual', 'branch_pensacola', 'Home', '100 Test Street', 'Cantonment',
               'FL', '32533', 30.55, -87.35, 'house', 1800, 3, 2, 1, 1, 0, 'none', 1, 'active')`,
    )
    .run();
  const env = { DB: db };
  const quoteInput = {
    engine: 'residential',
    customerId: 'cust_manual',
    propertyId: 'prop_manual',
    serviceType: 'standard',
    propertyType: 'house',
    squareFeet: 1800,
    bedrooms: 3,
    fullBaths: 2,
    halfBaths: 1,
    frequency: 'one_time',
    condition: 'average',
    lastClean: 'within_month',
    addonIds: [],
    pets: 'none',
  };
  return { db, actor, env, quoteInput, session };
}

test('manual quote uses the authoritative residential calculator and pricing version', async () => {
  const { db, actor, env, quoteInput } = await fixture();
  const quote = await quoteManualBooking(env, db, actor, quoteInput);
  assert.equal(quote.status, 'priced');
  assert.ok((quote.totalCents ?? 0) > 0);
  assert.equal(quote.serviceCode, 'standard');
  assert.ok((quote.durationMinutes ?? 0) >= 60);
  assert.equal(quote.fields.quote_config_version, quote.pricingVersion);
  assert.equal(quote.fields.admin_engine, 'residential');
  assert.equal(quote.fields.square_feet, '1800');
});

test('manual quote rejects an incomplete facility scope instead of inventing a price', async () => {
  const { db, actor, env, quoteInput } = await fixture();
  await assert.rejects(
    () => quoteManualBooking(env, db, actor, { ...quoteInput, engine: 'commercial', facility: {} }),
    /manual_cleanable_sqft_required/,
  );
});

test('creating a manual booking persists a pending request, estimate, hold and commitment', async () => {
  const { db, actor, env, quoteInput } = await fixture();
  const quote = await quoteManualBooking(env, db, actor, quoteInput);
  const calls: AvailabilityInput[] = [];
  const created = await createManualBooking(
    env,
    db,
    actor,
    {
      ...quoteInput,
      date: '2026-12-15',
      start: START,
      crewSize: 1,
      notes: 'Key under the mat.',
    },
    { availability: slotAvailability(calls) },
  );
  assert.match(created.reference, /^MB-20261215-/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.date, '2026-12-15');
  assert.equal(calls[0]?.durationMinutes, quote.durationMinutes);
  const row = db.raw
    .prepare('SELECT * FROM booking_requests WHERE id = ?')
    .get(created.requestId) as Record<string, unknown>;
  assert.equal(row.status, 'pending');
  assert.equal(row.quote_reference, created.reference);
  assert.equal(row.start_at, START);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS count FROM estimates').get() && (db.raw.prepare('SELECT COUNT(*) AS count FROM estimates').get() as { count: number }).count, 1);
  assert.equal((db.raw.prepare('SELECT COUNT(*) AS count FROM booking_holds').get() as { count: number }).count, 1);
  assert.equal((db.raw.prepare('SELECT COUNT(*) AS count FROM booking_commitments').get() as { count: number }).count, 1);
  const fields = JSON.parse(String(row.payload_json)) as Record<string, string>;
  assert.equal(fields.preferred_date, '2026-12-15');
  assert.equal(fields.admin_notes, 'Key under the mat.');
  assert.equal(fields.quote_reference, created.reference);
});

test('repeating a manual booking submission is idempotent', async () => {
  const { db, actor, env, quoteInput } = await fixture();
  const input = { ...quoteInput, date: '2026-12-15', start: START, crewSize: 1 };
  const first = await createManualBooking(env, db, actor, input, {
    availability: slotAvailability([]),
  });
  const second = await createManualBooking(env, db, actor, input, {
    availability: slotAvailability([]),
  });
  assert.equal(second.requestId, first.requestId, 'a repeat returns the existing pending booking');
  assert.equal(second.reference, first.reference);
  const count = db.raw
    .prepare("SELECT COUNT(*) AS count FROM booking_requests WHERE hold_id LIKE 'manual_%'")
    .get() as { count: number };
  assert.equal(count.count, 1, 'no duplicate booking request is created');
});

test('confirming a manual booking writes appointment, crew, calendar link and commitment', async () => {
  const { db, actor, env, quoteInput } = await fixture();
  const events: Array<Record<string, unknown>> = [];
  const created = await createManualBooking(
    env,
    db,
    actor,
    { ...quoteInput, date: '2026-12-15', start: START, crewSize: 1 },
    { availability: slotAvailability([]) },
  );
  const confirmed = await confirmManualBooking(
    env,
    db,
    actor,
    created.requestId,
    ['team_hayli'],
    {
      availability: slotAvailability([]),
      findEvent: async () => null,
      getEvent: async () => null,
      createEvent: async (_env, job) => {
        events.push(job as unknown as Record<string, unknown>);
        return { ok: true, eventId: 'event_manual_1' };
      },
      updateEvent: async () => ({ ok: true }),
      deleteEvent: async () => ({ ok: true }),
    },
  );
  assert.equal(events.length, 1);
  assert.equal(confirmed.eventId, 'event_manual_1');
  const appointment = db.raw
    .prepare('SELECT * FROM appointments WHERE reference = ?')
    .get(created.reference) as Record<string, unknown>;
  assert.equal(appointment.status, 'confirmed');
  assert.equal(appointment.source, 'admin_manual');
  const resources = db.raw
    .prepare('SELECT team_member_id, role FROM appointment_resources WHERE appointment_id = ?')
    .all(appointment.id) as Array<{ team_member_id: string; role: string }>;
  assert.equal(resources.length, 1);
  assert.equal(resources[0]?.team_member_id, 'team_hayli');
  assert.equal(resources[0]?.role, 'solo');
  const link = db.raw
    .prepare('SELECT provider_event_id FROM calendar_links WHERE appointment_id = ?')
    .get(appointment.id) as { provider_event_id: string };
  assert.equal(link.provider_event_id, 'event_manual_1');
  const commitment = db.raw
    .prepare('SELECT state, appointment_id FROM booking_commitments WHERE reference = ?')
    .get(created.reference) as { state: string; appointment_id: string };
  assert.equal(commitment.state, 'confirmed');
  assert.equal(commitment.appointment_id, appointment.id);
  const requestRow = db.raw
    .prepare('SELECT status FROM booking_requests WHERE id = ?')
    .get(created.requestId) as { status: string };
  assert.equal(requestRow.status, 'confirmed');
});

test('an active approved document requirement blocks confirmation until signed', async () => {
  const { db, actor, env, quoteInput } = await fixture();
  db.raw
    .prepare(
      `INSERT INTO document_templates
       (id, title, category, version, status, source_kind, content_text, content_sha256, signer_party, requires_verification)
       VALUES ('tpl_service', 'Service agreement', 'residential', '1.0', 'approved', 'text', 'Test agreement text.', 'hash', 'customer', 0)`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO document_bundles (id, code, name, service_category, subject_type, status)
       VALUES ('bundle_res', 'customer.residential', 'Residential documents', 'residential', 'customer', 'active')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO document_bundle_items (bundle_id, template_id, required, enforcement_stage)
       VALUES ('bundle_res', 'tpl_service', 1, 'before_confirmation')`,
    )
    .run();
  const created = await createManualBooking(
    env,
    db,
    actor,
    { ...quoteInput, date: '2026-12-15', start: START, crewSize: 1 },
    { availability: slotAvailability([]) },
  );
  await assert.rejects(
    () =>
      confirmManualBooking(env, db, actor, created.requestId, ['team_hayli'], {
        availability: slotAvailability([]),
        createEvent: async () => ({ ok: true, eventId: 'should_not_exist' }),
      }),
    /documents_required/,
  );
  assert.equal(
    (db.raw.prepare('SELECT COUNT(*) AS count FROM appointments').get() as { count: number }).count,
    0,
  );
});

test('inactive staff cannot be assigned to a manual booking', async () => {
  const { db, actor, env, quoteInput } = await fixture();
  db.raw.prepare("UPDATE team_members SET status = 'inactive' WHERE id = 'team_hayli'").run();
  await assert.rejects(
    () =>
      createManualBooking(
        env,
        db,
        actor,
        { ...quoteInput, date: '2026-12-15', start: START, crewSize: 1, teamMemberIds: ['team_hayli'] },
        { availability: slotAvailability([]) },
      ),
    /team_member_inactive/,
  );
});

test('cancelling a confirmed manual booking removes the calendar event before local state', async () => {
  const { db, actor, env, quoteInput } = await fixture();
  const deleted: string[] = [];
  const created = await createManualBooking(
    env,
    db,
    actor,
    { ...quoteInput, date: '2026-12-15', start: START, crewSize: 1 },
    { availability: slotAvailability([]) },
  );
  await confirmManualBooking(env, db, actor, created.requestId, ['team_hayli'], {
    availability: slotAvailability([]),
    findEvent: async () => null,
    getEvent: async () => null,
    createEvent: async () => ({ ok: true, eventId: 'event_cancel' }),
    deleteEvent: async () => ({ ok: true }),
    updateEvent: async () => ({ ok: true }),
  });
  const cancelled = await cancelManualBooking(env, db, actor, created.requestId, 'Customer request', {
    deleteEvent: async (_env, eventId) => {
      deleted.push(eventId);
      return { ok: true };
    },
  });
  assert.deepEqual(deleted, ['event_cancel']);
  assert.equal(cancelled.calendarEventId, 'event_cancel');
  assert.equal(
    (db.raw.prepare('SELECT status FROM booking_requests WHERE id = ?').get(created.requestId) as { status: string }).status,
    'released',
  );
  assert.equal(
    (db.raw.prepare('SELECT status FROM appointments WHERE reference = ?').get(created.reference) as { status: string }).status,
    'cancelled',
  );
});

test('admin availability exposes real slots and staff without creating records', async () => {  const { db, actor, env } = await fixture();
  const calls: AvailabilityInput[] = [];
  const availability = await manualAvailability(
    env,
    db,
    actor,
    {
      customerId: 'cust_manual',
      propertyId: 'prop_manual',
      date: '2026-12-15',
      durationMinutes: 120,
      crewSize: 1,
    },
    { availability: slotAvailability(calls) },
  );
  assert.equal(availability.ok, true);
  assert.equal(availability.slots.length, 1);
  assert.ok(availability.staff.some((member) => member.name === 'Hayli'));
  assert.equal((db.raw.prepare('SELECT COUNT(*) AS count FROM appointments').get() as { count: number }).count, 0);
});

test('the bookings API quotes through the shared calculator and enforces CSRF', async () => {
  const { db, actor, quoteInput } = await fixture();
  const session = await createOpsSession(db, actor.id, request());
  const body = JSON.stringify({ action: 'quote', ...quoteInput });
  const denied = await bookingsPost({
    request: new Request('https://example.test/api/admin/bookings', {
      method: 'POST',
      headers: { Cookie: `ss_ops=${session.token}`, 'Content-Type': 'application/json' },
      body,
    }),
    env: { DB: db },
  } as never);
  assert.equal(denied.status, 403);
  const allowed = await bookingsPost({
    request: new Request('https://example.test/api/admin/bookings', {
      method: 'POST',
      headers: {
        Cookie: `ss_ops=${session.token}`,
        'Content-Type': 'application/json',
        'X-CSRF-Token': session.csrf,
      },
      body,
    }),
    env: { DB: db },
  } as never);
  assert.equal(allowed.status, 200);
  const data = (await allowed.json()) as { quote: { status: string; totalCents: number | null } };
  assert.equal(data.quote.status, 'priced');
  assert.ok((data.quote.totalCents ?? 0) > 0);
});

test('the bookings API rejects an unpriced or incomplete manual estimate', async () => {
  const { db, actor, quoteInput } = await fixture();
  const session = await createOpsSession(db, actor.id, request());
  const response = await bookingsPost({
    request: new Request('https://example.test/api/admin/bookings', {
      method: 'POST',
      headers: {
        Cookie: `ss_ops=${session.token}`,
        'Content-Type': 'application/json',
        'X-CSRF-Token': session.csrf,
      },
      body: JSON.stringify({ action: 'create', ...quoteInput, date: '2026-12-15', start: START }),
    }),
    env: { DB: db },
  } as never);
  assert.notEqual(response.status, 201);
});


test('null and 0,0 saved coordinates are geocoded, never routed from 0,0', async () => {
  const { db, actor, env, quoteInput } = await fixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/geocode')) {
      return new Response(JSON.stringify({
        features: [{
          geometry: { coordinates: [-87.2169, 30.4213] },
          properties: {
            housenumber: '100', street: 'Test Street', city: 'Cantonment',
            state: 'FL', postcode: '32533', label: '100 Test Street, Cantonment, FL 32533',
          },
        }],
      }), { status: 200 });
    }
    if (url.includes('/route/v1/')) {
      return new Response(JSON.stringify({ routes: [{ distance: 26400, duration: 1440 }] }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  const routingEnv = {
    ...env,
    TRAVEL_ORIGIN: '30.4213,-87.2169',
    ROUTES_PROVIDER: 'mapmap',
    ROUTES_API_KEY: 'test',
    MAPMAP_BASE: 'https://example.invalid',
  };
  try {
    for (const [lat, lng] of [[null, null], [0, 0]] as const) {
      db.raw.prepare('UPDATE properties SET latitude = ?, longitude = ? WHERE id = ?').run(lat, lng, 'prop_manual');
      const quote = await quoteManualBooking(routingEnv, db, actor, quoteInput);
      assert.equal(quote.travel.destinationSource, 'address_geocode');
      assert.equal(quote.travel.verified, true);
      assert.equal(quote.travel.oneWayMiles, 16.4);
      assert.notEqual(quote.travel.oneWayMiles, 7151);
    }
    const calls: AvailabilityInput[] = [];
    const available = await manualAvailability(
      routingEnv,
      db,
      actor,
      { customerId: 'cust_manual', propertyId: 'prop_manual', date: '2026-12-15', durationMinutes: 120, crewSize: 1 },
      { availability: slotAvailability(calls) },
    );
    assert.equal(available.ok, true);
    assert.equal(calls[0]?.destination.lat, 30.4213);
    assert.equal(calls[0]?.destination.lng, -87.2169);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('a routing-provider failure never becomes a fabricated mileage', async () => {
  const { db, actor, env, quoteInput } = await fixture();
  db.raw.prepare('UPDATE properties SET latitude = NULL, longitude = NULL WHERE id = ?').run('prop_manual');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/geocode')) {
      return new Response(JSON.stringify({
        features: [{
          geometry: { coordinates: [-87.2169, 30.4213] },
          properties: {
            housenumber: '100', street: 'Test Street', city: 'Cantonment',
            state: 'FL', postcode: '32533', label: '100 Test Street, Cantonment, FL 32533',
          },
        }],
      }), { status: 200 });
    }
    return new Response('{}', { status: 503 });
  }) as typeof fetch;
  try {
    const quote = await quoteManualBooking({
      ...env,
      TRAVEL_ORIGIN: '30.4213,-87.2169',
      ROUTES_PROVIDER: 'mapmap',
      ROUTES_API_KEY: 'test',
      MAPMAP_BASE: 'https://example.invalid',
    }, db, actor, quoteInput);
    assert.equal(quote.travel.destinationSource, 'address_geocode');
    assert.equal(quote.travel.oneWayMiles, null);
    assert.equal(quote.travel.verified, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


async function seedFriends15(db: TestD1): Promise<void> {
  db.raw.prepare(
    `INSERT INTO promotions
     (id, name, code, kind, percent, services_json, branches_json, status, terms_version)
     VALUES ('promo_friends15', 'Friends', 'FRIENDS15', 'percent', 15, '["standard","deep"]',
             '["branch_pensacola"]', 'active', '2026-11-19.friends15.v1')`,
  ).run();
}

test('FRIENDS15 persistent benefit applies once, survives reapply and restores plan price on removal', async () => {
  const { db, actor } = await fixture();
  await seedFriends15(db);
  db.raw.prepare(
    `INSERT INTO recurring_plans
     (id, customer_id, property_id, branch_id, service_code, frequency, status, ongoing_price_cents,
      start_date, next_visit_date, window, start_time, duration_minutes, crew_size, first_duration_minutes)
     VALUES ('rec_benefit', 'cust_manual', 'prop_manual', 'branch_pensacola', 'residential-cleaning',
             'biweekly', 'active', 12000, '2026-12-01', '2026-12-01', 'morning', '08:00', 270, 1, 270)`,
  ).run();
  const applied = await applyCustomerEntitlement(db, actor, {
    customerId: 'cust_manual',
    code: 'FRIENDS15',
    previewToken: 'confirmed',
  });
  assert.equal(applied.entitlement.status, 'active');
  assert.equal(applied.appliedPlans, 1);
  const plan = db.raw.prepare('SELECT ongoing_price_cents, base_ongoing_price_cents, entitlement_id FROM recurring_plans WHERE id = ?').get('rec_benefit') as Record<string, unknown>;
  assert.equal(plan.ongoing_price_cents, 10200);
  assert.equal(plan.base_ongoing_price_cents, 12000);
  assert.equal(Boolean(plan.entitlement_id), true);
  const again = await applyCustomerEntitlement(db, actor, {
    customerId: 'cust_manual',
    code: 'FRIENDS15',
    previewToken: 'confirmed',
  });
  assert.equal((db.raw.prepare('SELECT COUNT(*) AS count FROM customer_promotion_entitlements').get() as { count: number }).count, 1);
  assert.equal(again.appliedPlans, 0);
  assert.equal((await activeEntitlementForCustomer(db, 'cust_manual', 'FRIENDS15'))?.status, 'active');
  const removed = await removeCustomerEntitlement(db, actor, {
    customerId: 'cust_manual',
    entitlementId: applied.entitlement.id,
  });
  assert.equal(removed.removed, true);
  assert.equal(removed.restoredPlans, 1);
  const restored = db.raw.prepare('SELECT ongoing_price_cents, entitlement_id FROM recurring_plans WHERE id = ?').get('rec_benefit') as Record<string, unknown>;
  assert.equal(restored.ongoing_price_cents, 12000);
  assert.equal(restored.entitlement_id, null);
});

test('FRIENDS15 applies to the manual residential quote without stacking an existing discount', async () => {
  const { db, actor, env, quoteInput } = await fixture();
  await seedFriends15(db);
  const before = await quoteManualBooking(env, db, actor, quoteInput);
  await applyCustomerEntitlement(db, actor, {
    customerId: 'cust_manual',
    code: 'FRIENDS15',
    previewToken: 'confirmed',
  });
  const after = await quoteManualBooking(env, db, actor, quoteInput);
  assert.equal(after.entitlement?.code, 'FRIENDS15');
  assert.ok((after.entitlement?.discountCents ?? 0) > 0);
  assert.ok((after.totalCents ?? 0) < (before.totalCents ?? 0));
  assert.equal(after.discountLabel, 'FRIENDS15');
});


test('a selected database promotion carries through the manual quote', async () => {
  const { db, actor, env, quoteInput } = await fixture();
  db.raw.prepare(
    `UPDATE promotions SET name = 'Thanksgiving Special', kind = 'fixed', value_cents = 7500,
       services_json = '["deep"]', branches_json = '["branch_pensacola"]', min_purchase_cents = 20000,
       first_visit_only = 1, status = 'active', terms_version = '2026-11-10.thanks75.v1',
       booking_deadline_at = NULL, service_deadline_at = NULL, expires_at = '2099-12-31T23:59:59Z'
     WHERE code = 'THANKS75'`,
  ).run();
  const quote = await quoteManualBooking(env, db, actor, {
    ...quoteInput,
    serviceType: 'deep',
    date: '2026-11-20',
    promotionCode: 'THANKS75',
  });
  assert.equal(quote.status, 'priced');
  assert.equal(quote.discountLabel, 'Promotion - Thanksgiving Special');
  assert.equal(quote.discountAmountCents, 7500);
});

test('a custom agreed price and discount are server-authoritative and persisted', async () => {
  const { db, actor, env, quoteInput } = await fixture();
  const quote = await quoteManualBooking(env, db, actor, {
    ...quoteInput,
    pricingMethod: 'custom',
    customPrice: 275,
    discountType: 'percent',
    discountValue: 10,
    discountReason: 'Owner-approved adjustment',
  });
  assert.equal(quote.status, 'priced');
  assert.equal(quote.totalCents, 24750);
  assert.equal(quote.discountAmountCents, 2750);
  assert.equal(quote.fields.pricing_method, 'custom');
  assert.equal(quote.fields.custom_price, '275.00');
  assert.equal(quote.fields.admin_agreed_price, '247.50');
  assert.equal(quote.fields.admin_discount_reason, 'Owner-approved adjustment');
  const fixed = await quoteManualBooking(env, db, actor, {
    ...quoteInput,
    pricingMethod: 'custom',
    customPrice: 275,
    discountType: 'fixed',
    discountValue: 25,
  });
  assert.equal(fixed.totalCents, 25000);
  await assert.rejects(
    () => quoteManualBooking(env, db, actor, {
      ...quoteInput,
      pricingMethod: 'custom',
      customPrice: -10,
    }),
    /custom_price_invalid/,
  );
  await assert.rejects(
    () => quoteManualBooking(env, db, actor, {
      ...quoteInput,
      pricingMethod: 'custom',
      customPrice: 100,
      discountType: 'percent',
      discountValue: 150,
    }),
    /discount_percent_invalid/,
  );
});

test('completed service today persists without availability or a calendar event and invoices at the agreed price', async () => {
  const { db, actor, env, quoteInput, session } = await fixture();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const headers = {
    Cookie: `ss_ops=${session.token}`,
    'Content-Type': 'application/json',
    'X-CSRF-Token': session.csrf,
  };
  const createdResponse = await bookingsPost({
    request: new Request('https://example.test/api/admin/bookings', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'create_completed',
        ...quoteInput,
        serviceType: 'move_out',
        serviceLabel: 'Move-Out Cleaning',
        completedDate: today,
        teamMemberIds: ['team_hayli'],
        pricingMethod: 'custom',
        customPrice: 275,
        discountType: 'none',
        notes: 'Cleaned while moving out.',
      }),
    }),
    env,
  } as never);
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()) as {
    appointmentId: string;
    reference: string;
    totalCents: number;
    serviceDate: string;
  };
  assert.equal(created.totalCents, 27500);
  assert.equal(created.serviceDate, today);
  const appointment = db.raw.prepare('SELECT * FROM appointments WHERE id = ?').get(created.appointmentId) as Record<string, unknown>;
  assert.equal(appointment.status, 'completed');
  assert.equal(appointment.source, 'admin_completed');
  assert.equal(appointment.booking_request_id, null);
  assert.equal((db.raw.prepare('SELECT COUNT(*) AS n FROM calendar_links WHERE appointment_id = ?').get(created.appointmentId) as { n: number }).n, 0);
  const estimate = db.raw.prepare('SELECT * FROM estimates WHERE id = ?').get(String(appointment.estimate_id)) as Record<string, unknown>;
  assert.equal(estimate.total_cents, 27500);
  assert.equal(estimate.service_code, 'move_in_out');
  assert.equal((db.raw.prepare('SELECT COUNT(*) AS n FROM appointment_resources WHERE appointment_id = ?').get(created.appointmentId) as { n: number }).n, 1);
  const fields = JSON.parse(String(estimate.input_snapshot_json)) as Record<string, string>;
  assert.equal(fields.service_label, 'Move-Out Cleaning');
  assert.equal(fields.completed_service_date, today);
  assert.equal(fields.admin_agreed_price, '275.00');

  const invoiceResponse = await bookingsPost({
    request: new Request('https://example.test/api/admin/bookings', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'invoice_job', appointmentId: created.appointmentId, paymentLink: false }),
    }),
    env,
  } as never);
  if (invoiceResponse.status !== 200) {
    assert.fail(`invoice_job failed: ${await invoiceResponse.text()}`);
  }
  const invoiceBody = (await invoiceResponse.json()) as { invoice: { id: string; number: string; totalCents: number } };
  assert.equal(invoiceBody.invoice.totalCents, 27500);
  const invoice = db.raw.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceBody.invoice.id) as Record<string, unknown>;
  assert.equal(invoice.total_cents, 27500);
  assert.equal(invoice.service_code, 'move_in_out');
  assert.equal(invoice.service_label, 'Move-Out Cleaning');
  assert.equal(invoice.service_date, today);
  const retry = await bookingsPost({
    request: new Request('https://example.test/api/admin/bookings', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'invoice_job', appointmentId: created.appointmentId }),
    }),
    env,
  } as never);
  assert.equal(retry.status, 200);
  const retryBody = (await retry.json()) as { invoice: { id: string } };
  assert.equal(retryBody.invoice.id, invoiceBody.invoice.id, 'invoice creation is idempotent per completed job');
  assert.equal((db.raw.prepare('SELECT COUNT(*) AS n FROM invoices WHERE appointment_id = ?').get(created.appointmentId) as { n: number }).n, 1);
});

test('historical completed service accepts a past date, links executed evidence and rejects a future date', async () => {
  const { db, actor, env, quoteInput, session } = await fixture();
  db.raw
    .prepare(
      `INSERT INTO signing_requests
       (id, subject_type, customer_id, property_id, status, booking_reference, service_code, requirement_snapshot_json)
       VALUES ('sign_completed', 'customer', 'cust_manual', 'prop_manual', 'signed', 'OLD-REF', 'move_in_out', '[]')`,
    )
    .run();
  const headers = {
    Cookie: `ss_ops=${session.token}`,
    'Content-Type': 'application/json',
    'X-CSRF-Token': session.csrf,
  };
  const past = await createCompletedService(env, db, actor, {
    ...quoteInput,
    serviceType: 'move_out',
    serviceLabel: 'Move-Out Cleaning',
    completedDate: '2026-11-23',
    teamMemberIds: ['team_hayli'],
    pricingMethod: 'custom',
    customPrice: 275,
    signingRequestId: 'sign_completed',
  });
  assert.equal(past.serviceDate, '2026-11-23');
  const linked = db.raw.prepare('SELECT appointment_id FROM signing_requests WHERE id = ?').get('sign_completed') as { appointment_id: string };
  assert.equal(linked.appointment_id, past.appointmentId);
  const signatureEvidence = db.raw.prepare('SELECT COUNT(*) AS n FROM document_signatures WHERE signing_request_id = ?').get('sign_completed') as { n: number };
  assert.equal(signatureEvidence.n, 0, 'linking does not create or alter signature evidence');
  await assert.rejects(
    () => createCompletedService(env, db, actor, {
      ...quoteInput,
      serviceType: 'move_out',
      completedDate: '2099-01-01',
      teamMemberIds: ['team_hayli'],
      pricingMethod: 'custom',
      customPrice: 275,
    }),
    /completed_date_in_future/,
  );
});

test('manual invoices retain the selected canonical service, service label and performed date', async () => {
  const { db, actor } = await fixture();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const invoice = await createInvoice(db, actor, {
    customerId: 'cust_manual',
    serviceCode: 'move_in_out',
    serviceLabel: 'Move-Out Cleaning',
    serviceDate: today,
    lines: [
      { kind: 'service', description: 'Move-Out Cleaning', quantity: 1, unitAmountCents: 27500, totalCents: 27500 },
    ],
  });
  const detail = await getInvoice(db, actor, invoice.id);
  const row = detail?.invoice as Record<string, unknown>;
  assert.equal(row.service_code, 'move_in_out');
  assert.equal(row.service_name, 'Move-Out Cleaning');
  assert.equal(row.service_date, today);
  assert.equal(row.total_cents, 27500);
  await assert.rejects(
    () => createInvoice(db, actor, {
      customerId: 'cust_manual',
      serviceCode: 'not-a-real-service',
      lines: [{ kind: 'service', description: 'Invalid', quantity: 1, unitAmountCents: 100, totalCents: 100 }],
    }),
    /invoice_service_invalid/,
  );
  await assert.rejects(
    () => createInvoice(db, actor, {
      customerId: 'cust_manual',
      serviceCode: 'move_in_out',
      serviceDate: '2099-01-01',
      lines: [{ kind: 'service', description: 'Future date', quantity: 1, unitAmountCents: 100, totalCents: 100 }],
    }),
    /invoice_service_date_future/,
  );
});

test('a scheduled booking honors the custom price and discount in its persisted estimate', async () => {
  const { db, actor, env, quoteInput } = await fixture();
  const created = await createManualBooking(
    env,
    db,
    actor,
    {
      ...quoteInput,
      date: '2026-12-15',
      start: START,
      crewSize: 1,
      pricingMethod: 'custom',
      customPrice: 275,
      discountType: 'fixed',
      discountValue: 25,
      discountReason: 'Returning customer',
    },
    { availability: slotAvailability([]) },
  );
  assert.equal(created.quote.totalCents, 25000);
  const estimate = db.raw.prepare('SELECT * FROM estimates WHERE quote_reference = ?').get(created.reference) as Record<string, unknown>;
  assert.equal(estimate.total_cents, 25000);
  assert.equal(estimate.discount_cents, 2500);
  const fields = JSON.parse(String(estimate.input_snapshot_json)) as Record<string, string>;
  assert.equal(fields.pricing_method, 'custom');
  assert.equal(fields.custom_price, '275.00');
  assert.equal(fields.admin_agreed_price, '250.00');
  assert.equal(fields.admin_discount_reason, 'Returning customer');
});

test('a repeated completed-service submission reuses the job and its job invoice view exposes the linked invoice', async () => {
  const { db, actor, env, quoteInput, session } = await fixture();
  const input = {
    ...quoteInput,
    serviceType: 'move_out',
    serviceLabel: 'Move-Out Cleaning',
    completedDate: '2026-11-23',
    teamMemberIds: ['team_hayli'],
    pricingMethod: 'custom',
    customPrice: 275,
  };
  const first = await createCompletedService(env, db, actor, input);
  const second = await createCompletedService(env, db, actor, input);
  assert.equal(second.existing, true);
  assert.equal(second.appointmentId, first.appointmentId);
  assert.equal(
    (db.raw.prepare("SELECT COUNT(*) AS n FROM appointments WHERE source = 'admin_completed'").get() as { n: number }).n,
    1,
    'a retry never creates a second completed job',
  );
  const headers = { Cookie: `ss_ops=${session.token}` };
  const before = await bookingsGet({
    request: new Request(`https://example.test/api/admin/bookings?view=job&appointmentId=${encodeURIComponent(first.appointmentId)}`, { headers }),
    env,
  } as never);
  assert.equal(before.status, 200);
  const beforeBody = (await before.json()) as { invoice: unknown; job: Record<string, unknown> };
  assert.equal(beforeBody.invoice, null);
  assert.equal(beforeBody.job.total_cents, 27500);
  const invoiceResponse = await bookingsPost({
    request: new Request('https://example.test/api/admin/bookings', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf },
      body: JSON.stringify({ action: 'invoice_job', appointmentId: first.appointmentId, paymentLink: false }),
    }),
    env,
  } as never);
  assert.equal(invoiceResponse.status, 200);
  const invoiceBody = (await invoiceResponse.json()) as { invoice: { id: string; number: string } };
  const after = await bookingsGet({
    request: new Request(`https://example.test/api/admin/bookings?view=job&appointmentId=${encodeURIComponent(first.appointmentId)}`, { headers }),
    env,
  } as never);
  assert.equal(after.status, 200);
  const afterBody = (await after.json()) as { invoice: Record<string, unknown> };
  assert.equal(afterBody.invoice.id, invoiceBody.invoice.id);
  assert.equal(afterBody.invoice.balanceCents, 27500);
  const retryService = await createCompletedService(env, db, actor, input);
  assert.equal(retryService.appointmentId, first.appointmentId);
  const retryInvoice = await bookingsPost({
    request: new Request('https://example.test/api/admin/bookings', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf },
      body: JSON.stringify({ action: 'invoice_job', appointmentId: retryService.appointmentId }),
    }),
    env,
  } as never);
  assert.equal(retryInvoice.status, 200);
  const retryBody = (await retryInvoice.json()) as { invoice: { id: string } };
  assert.equal(retryBody.invoice.id, invoiceBody.invoice.id);
});
