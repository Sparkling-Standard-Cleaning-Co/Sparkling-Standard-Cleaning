import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { enrollOwner, type AdminActor } from '../src/lib/admin/operations.ts';
import { createCustomer, getCustomer } from '../src/lib/admin/crm.ts';
import { createTeamMember } from '../src/lib/admin/scheduling.ts';
import {
  approveTemplate,
  addBundleItem,
  createBundle,
  createSigningRequest,
  createTemplate,
  getExecutedCopy,
  signSigningRequest,
} from '../src/lib/documents/service.ts';
import {
  assignQuickEstimate,
  calculateQuickEstimate,
  convertQuickEstimate,
  getQuickEstimate,
  saveQuickEstimate,
} from '../src/lib/admin/quick-estimate.ts';
import { confirmManualBooking } from '../src/lib/admin/manual-booking.ts';
import { createInvoice, recordPayment, getInvoice } from '../src/lib/admin/billing.ts';
import { deliverInvoiceReceipt } from '../src/lib/invoicing/invoice-receipt.ts';
import { operationsReport } from '../src/lib/admin/reporting.ts';

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

test('synthetic end-to-end: inquiry, packet signature, quick estimate, booking, invoice, receipt and reporting', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'owner-acceptance@example.test',
    name: 'Synthetic Owner',
    password: 'SyntheticOwner!2026',
  });
  const actor: AdminActor = {
    id: owner.id, email: owner.email, name: owner.name, role: 'owner',
    branchId: null, csrf: '', permissions: [], mfaEnabled: false,
  };
  const customer = await createCustomer(db, actor, {
    firstName: 'Acceptance', lastName: 'Customer', email: 'acceptance@example.test',
    addressLine1: '1 Acceptance Way', city: 'Pensacola', state: 'FL', postalCode: '32502',
  });
  const property = db.raw.prepare('SELECT id FROM properties WHERE customer_id = ? LIMIT 1').get(customer.id) as { id: string };
  db.raw.prepare('UPDATE properties SET latitude = 30.42, longitude = -87.22 WHERE id = ?').run(property.id);
  const team = await createTeamMember(db, actor, { displayName: 'Acceptance Cleaner', isSolo: true, isBookable: true });

  db.raw.prepare(
    `INSERT INTO promotions
     (id, name, code, kind, percent, services_json, branches_json, status, terms_version)
     VALUES ('promo_acceptance_friends', 'Friends', 'FRIENDS15', 'percent', 15, '["standard","deep"]',
             '["branch_pensacola"]', 'active', '2026-11-19.friends15.v1')`,
  ).run();
  await import('../src/lib/promotions/entitlements.ts').then(({ applyCustomerEntitlement }) =>
    applyCustomerEntitlement(db, actor, { customerId: customer.id, code: 'FRIENDS15', previewToken: 'confirmed' }),
  );

  const template = await createTemplate(db, actor.id, {
    title: 'Acceptance Customer Agreement',
    category: 'residential',
    version: '1.0',
    signerParty: 'customer',
    contentText: 'Acceptance customer {{customer.first_name}} accepts service at {{property.address}}.',
  });
  await approveTemplate(db, actor.id, template.id);
  const packet = await createBundle(db, actor.id, {
    code: 'customer.residential',
    name: 'Acceptance Residential Packet',
    serviceCategory: 'residential',
    subjectType: 'customer',
    purpose: 'customer',
    packetType: 'residential_one_time',
    instructions: 'Sign before confirmation.',
  });
  await addBundleItem(db, actor.id, {
    bundleId: packet.id, templateId: template.id, required: true, enforcementStage: 'before_confirmation',
  });
  const signing = await createSigningRequest(db, {
    subjectType: 'customer', customerId: customer.id, propertyId: property.id,
    serviceCode: 'residential-cleaning', frequency: 'one_time', bookingReference: 'ACCEPTANCE-1',
  }, { createdByAdminUserId: actor.id, bundleId: packet.id });
  assert.equal(signing.required, true);
  await signSigningRequest(db, signing.token!, {
    signerName: 'Acceptance Customer',
    signerEmail: 'acceptance@example.test',
    consent: true,
    signatures: { [template.id]: { value: 'Acceptance Customer' } },
    request: new Request('https://example.test/api/document-sign', {
      method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.55', 'User-Agent': 'acceptance-test' },
    }),
  });
  const executed = await getExecutedCopy(db, String(signing.requestId));
  assert.ok(executed);
  assert.match(executed.text, /EXECUTED DOCUMENT COPY/);

  const quickInput = {
    engine: 'residential', serviceType: 'standard', propertyType: 'house',
    squareFeet: '1800', bedrooms: '3', fullBaths: '2', halfBaths: '0',
    frequency: 'one_time', condition: 'maintained', lastClean: 'within_month', pets: 'none',
    addressLine1: '1 Acceptance Way', city: 'Pensacola', state: 'FL', postalCode: '32502',
    latitude: 30.42, longitude: -87.22, branchId: 'branch_pensacola',
    customerId: customer.id, propertyId: property.id, customerName: 'Acceptance Customer',
    customerEmail: 'acceptance@example.test', customerPhone: '(850) 555-0100',
  };
  const quick = await calculateQuickEstimate({ DB: db } as never, db, actor, quickInput);
  assert.equal(quick.quote.status, 'priced');
  assert.equal(quick.quote.entitlement?.code, 'FRIENDS15');
  assert.ok((quick.quote.totalCents ?? 0) > 0);
  const saved = await saveQuickEstimate({ DB: db } as never, db, actor, quickInput);
  await assignQuickEstimate(db, actor, saved.id, { customerId: customer.id, propertyId: property.id });

  const start = new Date(Date.now() + 21 * 86_400_000);
  start.setUTCHours(14, 0, 0, 0);
  const date = start.toISOString().slice(0, 10);
  const converted = await convertQuickEstimate(
    { DB: db } as never, db, actor, saved.id,
    { date, start: start.toISOString(), crewSize: 1, teamMemberIds: [team.id], notes: 'Acceptance run' },
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
      createEvent: (async () => ({ ok: true, eventId: 'evt_acceptance' })) as never,
      updateEvent: (async () => ({ ok: true })) as never,
      deleteEvent: (async () => ({ ok: true })) as never,
    },
  );
  const confirmed = await confirmManualBooking(
    { DB: db } as never, db, actor, converted.requestId, [team.id],
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
      createEvent: (async () => ({ ok: true, eventId: 'evt_acceptance_confirmed' })) as never,
      updateEvent: (async () => ({ ok: true })) as never,
      deleteEvent: (async () => ({ ok: true })) as never,
    },
  );
  assert.match(confirmed.reference, /^(MB|APT)-/);
  const appointment = db.raw.prepare('SELECT status, customer_id FROM appointments WHERE id = ?').get(confirmed.appointmentId) as { status: string; customer_id: string };
  assert.equal(appointment.status, 'confirmed');
  assert.equal(appointment.customer_id, customer.id);

  const invoice = await createInvoice(db, actor, {
    customerId: customer.id,
    propertyId: property.id,
    appointmentId: confirmed.appointmentId,
    serviceCode: 'residential-cleaning',
    issueDate: date,
    lines: [{ kind: 'service', description: 'Residential cleaning acceptance', quantity: 1, unitAmountCents: 20000, totalCents: 20000 }],
  });
  await recordPayment(db, actor, {
    invoiceId: invoice.id, provider: 'cash', amount: 200, idempotencyKey: 'acceptance-payment-1',
  });
  const paidInvoice = await getInvoice(db, actor, invoice.id);
  assert.equal((paidInvoice?.invoice as Record<string, unknown>).balance_cents, 0);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ id: 'email_acceptance_receipt' }), { status: 200 })) as typeof fetch;
  try {
    const receipt = await deliverInvoiceReceipt(db, { RESEND_API_KEY: 'test', RESEND_FROM_EMAIL: 'owner@example.test' }, {
      invoiceId: invoice.id, actorUserId: actor.id, force: true,
    });
    assert.equal(receipt.status, 'sent');
  } finally {
    globalThis.fetch = originalFetch;
  }
  const receiptRow = db.raw.prepare('SELECT status, provider_message_id FROM payment_receipts WHERE invoice_id = ?').get(invoice.id) as { status: string; provider_message_id: string };
  assert.equal(receiptRow.status, 'sent');
  assert.equal(receiptRow.provider_message_id, 'email_acceptance_receipt');

  const openInvoice = await createInvoice(db, actor, {
    customerId: customer.id,
    serviceCode: 'residential-cleaning',
    lines: [
      { kind: 'service', description: 'Open reporting invoice', quantity: 1, unitAmountCents: 10000, totalCents: 10000 },
      { kind: 'discount', description: 'Reporting discount', quantity: 1, unitAmountCents: 1000, totalCents: 1000 },
    ],
  });
  assert.ok(openInvoice.id);

  const workspace = await getCustomer(db, actor, customer.id);
  assert.ok(workspace);
  assert.equal((workspace.quickEstimates as Array<Record<string, unknown>>).length, 1);
  assert.equal(((workspace.quickEstimates as Array<Record<string, unknown>>)[0]).status, 'converted');
  assert.equal((workspace.signingRequests as Array<Record<string, unknown>>).length, 1);
  assert.ok((workspace.invoices as Array<Record<string, unknown>>).some((row) => row.id === invoice.id));
  assert.equal((workspace.gifts as Array<Record<string, unknown>>).length, 0);

  const report = await operationsReport(db, actor);
  const financial = report.financial as Record<string, number>;
  assert.ok(financial.collectedCents >= 20000);
  assert.ok(financial.invoicedCents >= 20000);
  assert.ok(financial.outstandingCents >= 9000, 'open balances are included in reporting');
  assert.ok(financial.discountCents >= 1000, 'invoice discounts are included in reporting');
  assert.ok(Array.isArray(report.estimates));
  assert.ok((db.raw.prepare('SELECT COUNT(*) AS n FROM booking_requests WHERE status = ?').get('confirmed') as { n: number }).n >= 1);
  assert.equal((await getQuickEstimate(db, actor, saved.id))?.status, 'converted');
});
