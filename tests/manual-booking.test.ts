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
  createManualBooking,
  manualAvailability,
  quoteManualBooking,
} from '../src/lib/admin/manual-booking.ts';
import type { AvailabilityInput, AvailabilityServiceResult } from '../src/lib/booking/service.ts';
import { onRequestPost as bookingsPost } from '../functions/api/admin/bookings.ts';

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
  return { db, actor, env, quoteInput };
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
