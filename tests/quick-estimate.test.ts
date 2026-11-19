import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { enrollOwner, type AdminActor } from '../src/lib/admin/operations.ts';
import { createCustomer } from '../src/lib/admin/crm.ts';
import { createTeamMember } from '../src/lib/admin/scheduling.ts';
import { quoteManualBooking } from '../src/lib/admin/manual-booking.ts';
import {
  assignQuickEstimate,
  calculateQuickEstimate,
  convertQuickEstimate,
  discardQuickEstimate,
  getQuickEstimate,
  listQuickEstimates,
  saveQuickEstimate,
} from '../src/lib/admin/quick-estimate.ts';
import { buildQuickEstimatePdf, buildQuickEstimateText } from '../src/lib/admin/quick-estimate-document.ts';
import { applyCustomerEntitlement } from '../src/lib/promotions/entitlements.ts';

class SqlStatement implements D1PreparedStatement {
  private values: unknown[] = [];
  private readonly db: DatabaseSync;
  private readonly sql: string;
  constructor(db: DatabaseSync, sql: string) { this.db = db; this.sql = sql; }
  bind(...values: unknown[]): D1PreparedStatement { this.values = values; return this; }
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
  prepare(query: string): D1PreparedStatement { return new SqlStatement(this.raw, query); }
}

function migratedDb(): TestD1 {
  const db = new TestD1();
  db.raw.exec('PRAGMA foreign_keys = ON');
  for (const file of fs.readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
    db.raw.exec(fs.readFileSync(path.join('migrations', file), 'utf8'));
  }
  return db;
}

async function fixture() {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'owner-quick@example.test',
    name: 'Synthetic Owner',
    password: 'SyntheticOwner!2026',
  });
  const actor: AdminActor = {
    id: owner.id,
    email: owner.email,
    name: owner.name,
    role: 'owner',
    branchId: null,
    csrf: '',
    permissions: [],
    mfaEnabled: false,
  };
  const customer = await createCustomer(db, actor, {
    firstName: 'Quick', lastName: 'Customer', email: 'quick@example.test',
    addressLine1: '1 Test Way', city: 'Pensacola', state: 'FL', postalCode: '32502',
  });
  const property = db.raw.prepare('SELECT id FROM properties WHERE customer_id = ? LIMIT 1').get(customer.id) as { id: string };
  db.raw.prepare('UPDATE properties SET latitude = 30.42, longitude = -87.22 WHERE id = ?').run(property.id);
  return { db, owner, actor, customerId: customer.id, propertyId: property.id };
}

const residentialInput = {
  engine: 'residential',
  serviceType: 'standard',
  propertyType: 'house',
  squareFeet: '1800',
  bedrooms: '3',
  fullBaths: '2',
  halfBaths: '0',
  frequency: 'one_time',
  condition: 'maintained',
  lastClean: 'within_month',
  pets: 'none',
  addressLine1: '1 Test Way',
  city: 'Pensacola',
  state: 'FL',
  postalCode: '32502',
  latitude: 30.42,
  longitude: -87.22,
  branchId: 'branch_pensacola',
};

test('Quick Estimate uses the same authoritative server price as a manual booking', async () => {
  const f = await fixture();
  const manual = await quoteManualBooking({ DB: f.db } as never, f.db, f.actor, {
    ...residentialInput,
    customerId: f.customerId,
    propertyId: f.propertyId,
  });
  const quick = await calculateQuickEstimate({ DB: f.db } as never, f.db, f.actor, residentialInput);
  assert.equal(quick.quote.status, 'priced');
  assert.equal(quick.quote.totalCents, manual.totalCents);
  assert.equal(quick.quote.pricingVersion, manual.pricingVersion);
  assert.equal(quick.quote.serviceCode, manual.serviceCode);
  assert.equal(quick.addressText, '1 Test Way, Pensacola, FL 32502');
  assert.equal((f.db.raw.prepare('SELECT COUNT(*) AS n FROM quick_estimates').get() as { n: number }).n, 0);
  assert.equal((f.db.raw.prepare('SELECT COUNT(*) AS n FROM booking_requests').get() as { n: number }).n, 0);

  const pdf = buildQuickEstimatePdf(quick.input, quick.quote, quick.addressText);
  const pdfText = new TextDecoder('latin1').decode(pdf);
  assert.match(pdfText, /^%PDF-1\.4/);
  assert.match(pdfText, /QUICK ESTIMATE/);
  assert.match(pdfText, /1 Test Way, Pensacola, FL 32502/);
  assert.match(pdfText, /\$\d+\.\d{2}/);
  const message = buildQuickEstimateText(quick.input, quick.quote, quick.addressText);
  assert.match(message.subject, /estimate/i);
  assert.match(message.html, /Sparkling Standard Cleaning Co\./);
  assert.match(message.html, /Standards That Sparkle\./);
});

test('FRIENDS15 applies to an assigned customer and an unknown promotion fails closed', async () => {
  const f = await fixture();
  f.db.raw.prepare(
    `INSERT INTO promotions
     (id, name, code, kind, percent, services_json, branches_json, status, terms_version)
     VALUES ('promo_friends15_quick', 'Friends', 'FRIENDS15', 'percent', 15, '["standard","deep"]',
             '["branch_pensacola"]', 'active', '2026-11-19.friends15.v1')`,
  ).run();
  await applyCustomerEntitlement(f.db, f.actor, {
    customerId: f.customerId,
    code: 'FRIENDS15',
    previewToken: 'confirmed',
  });
  const withBenefit = await calculateQuickEstimate({ DB: f.db } as never, f.db, f.actor, {
    ...residentialInput,
    customerId: f.customerId,
    propertyId: f.propertyId,
  });
  assert.equal(withBenefit.quote.entitlement?.code, 'FRIENDS15');
  assert.ok((withBenefit.quote.discountAmountCents ?? 0) > 0);
  const without = await calculateQuickEstimate({ DB: f.db } as never, f.db, f.actor, residentialInput);
  assert.ok((withBenefit.quote.totalCents ?? 0) < (without.quote.totalCents ?? 0));

  await assert.rejects(
    () => calculateQuickEstimate({ DB: f.db } as never, f.db, f.actor, {
      ...residentialInput,
      promotionCode: 'NOT-A-REAL-CODE',
    }),
    /promotion_(ineligible|not_found)/,
  );
});

test('Quick Estimates save, list, assign, discard and enforce branch scope', async () => {
  const f = await fixture();
  const saved = await saveQuickEstimate({ DB: f.db } as never, f.db, f.actor, residentialInput);
  const record = await getQuickEstimate(f.db, f.actor, saved.id);
  assert.ok(record);
  assert.equal(record?.status, 'saved');
  assert.equal(record?.total_cents, saved.quote.totalCents);
  assert.equal(record?.pricing_version, saved.quote.pricingVersion);
  assert.match(record?.quote_json ?? '', /"pricingVersion"/);
  const listed = await listQuickEstimates(f.db, f.actor, { q: '1 Test Way' });
  assert.equal(listed.length, 1);

  const manager: AdminActor = { ...f.actor, id: 'manager-quick', role: 'manager', branchId: 'branch_pensacola' };
  f.db.raw
    .prepare("INSERT INTO admin_users (id, role_id, branch_id, email, password_hash, display_name, status) VALUES ('manager-quick', 'manager', 'branch_pensacola', 'manager-quick@example.test', 'unused', 'Manager', 'active')")
    .run();
  await assignQuickEstimate(f.db, manager, saved.id, {
    customerId: f.customerId,
    propertyId: f.propertyId,
  });
  assert.equal((await getQuickEstimate(f.db, manager, saved.id))?.customer_id, f.customerId);

  const tampa: AdminActor = { ...f.actor, id: 'finance-tampa-quick', role: 'finance', branchId: 'branch_tampa' };
  assert.equal(await getQuickEstimate(f.db, tampa, saved.id), null);
  assert.equal((await listQuickEstimates(f.db, tampa)).length, 0);

  await discardQuickEstimate(f.db, f.actor, saved.id);
  assert.equal((await getQuickEstimate(f.db, f.actor, saved.id))?.status, 'discarded');
  assert.equal((f.db.raw.prepare('SELECT COUNT(*) AS n FROM quick_estimates').get() as { n: number }).n, 1);
});

test('a saved Quick Estimate converts into a real pending booking only after revalidation', async () => {
  const f = await fixture();
  const team = await createTeamMember(f.db, f.actor, {
    displayName: 'Synthetic Solo', isSolo: true, isBookable: true,
  });
  const saved = await saveQuickEstimate({ DB: f.db } as never, f.db, f.actor, residentialInput);
  await assignQuickEstimate(f.db, f.actor, saved.id, { customerId: f.customerId, propertyId: f.propertyId });
  const start = new Date(Date.now() + 14 * 86_400_000);
  start.setUTCHours(14, 0, 0, 0);
  const date = start.toISOString().slice(0, 10);
  let calendarCreated = false;
  const converted = await convertQuickEstimate(
    { DB: f.db } as never,
    f.db,
    f.actor,
    saved.id,
    { date, start: start.toISOString(), crewSize: 1, teamMemberIds: [team.id] },
    {
      availability: (async (_env: unknown, input: { date: string; durationMinutes: number }) => ({
        ok: true,
        date: input.date,
        durationMinutes: input.durationMinutes,
        crewSize: 1,
        availability: {
          slots: [{
            start: start.toISOString(),
            end: new Date(start.getTime() + input.durationMinutes * 60_000).toISOString(),
            resourceIds: [team.bookingResourceId],
          }],
        },
      })) as never,
      findEvent: (async () => null) as never,
      getEvent: (async () => null) as never,
      createEvent: (async () => { calendarCreated = true; return { ok: true, eventId: 'evt_quick' }; }) as never,
      updateEvent: (async () => ({ ok: true })) as never,
      deleteEvent: (async () => ({ ok: true })) as never,
    },
  );
  assert.match(converted.reference, /^MB-/);
  assert.equal(calendarCreated, false, 'a pending conversion does not create a calendar event');
  const updated = await getQuickEstimate(f.db, f.actor, saved.id);
  assert.equal(updated?.status, 'converted');
  assert.equal(updated?.converted_request_id, converted.requestId);
  const request = f.db.raw.prepare('SELECT status, customer_id FROM booking_requests WHERE id = ?').get(converted.requestId) as { status: string; customer_id: string };
  assert.equal(request.status, 'pending');
  assert.equal(request.customer_id, f.customerId);
  const estimate = f.db.raw.prepare('SELECT source, pricing_version, total_cents FROM estimates WHERE quote_reference = ?').get(converted.reference) as { source: string; pricing_version: string; total_cents: number };
  assert.equal(estimate.source, 'admin_manual');
  assert.equal(estimate.pricing_version, saved.quote.pricingVersion);
  assert.equal(estimate.total_cents, converted.quote.totalCents);
  await assert.rejects(
    () => convertQuickEstimate({ DB: f.db } as never, f.db, f.actor, saved.id, { date, start: start.toISOString() }),
    /quick_estimate_converted/,
  );
});
