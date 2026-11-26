import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import type { AdminActor } from '../src/lib/admin/operations.ts';
import {
  addPropertyContact,
  addWalkthrough,
  calculateProposalTotals,
  createCommercialContract,
  createCommercialProposal,
  generateContractInvoice,
  getCommercialProposal,
  publishCommercialProposal,
  sendCommercialProposal,
  syncProposalSigningStatus,
  updateCommercialProposal,
} from '../src/lib/commercial/service.ts';

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

const actor: AdminActor = {
  id: 'admin_owner',
  email: 'owner@sparkling-standard.com',
  name: 'Owner',
  role: 'owner',
  branchId: null,
  csrf: '',
  permissions: [],
  mfaEnabled: true,
};

function db(): TestD1 {
  const database = new TestD1();
  database.raw.exec('PRAGMA foreign_keys = ON');
  for (const file of fs.readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
    database.raw.exec(fs.readFileSync(path.join('migrations', file), 'utf8'));
  }
  database.raw.prepare(
    "INSERT INTO admin_users (id, role_id, email, password_hash, display_name, status) VALUES ('admin_owner', 'owner', 'owner@sparkling-standard.com', 'synthetic', 'Owner', 'active')",
  ).run();
  database.raw.prepare(
    "INSERT INTO customers (id, primary_branch_id, company_name, first_name, last_name, status) VALUES ('cust_commercial', 'branch_pensacola', 'Acme Facilities', 'Alex', 'Manager', 'active')",
  ).run();
  database.raw.prepare(
    "INSERT INTO customer_contacts (id, customer_id, kind, value, normalized_value, is_primary) VALUES ('cc_email', 'cust_commercial', 'email', 'billing@acme.test', 'billing@acme.test', 1)",
  ).run();
  database.raw.prepare(
    "INSERT INTO properties (id, customer_id, branch_id, label, line1, city, state, postal_code) VALUES ('prop_a', 'cust_commercial', 'branch_pensacola', 'HQ', '1 Office Way', 'Pensacola', 'FL', '32502')",
  ).run();
  database.raw.prepare(
    "INSERT INTO properties (id, customer_id, branch_id, label, line1, city, state, postal_code) VALUES ('prop_b', 'cust_commercial', 'branch_pensacola', 'Warehouse', '2 Depot Rd', 'Pensacola', 'FL', '32503')",
  ).run();
  return database;
}

function proposalInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    customerId: 'cust_commercial',
    propertyId: 'prop_a',
    title: 'Multi-site janitorial',
    billingFrequency: 'monthly',
    paymentTerms: 'Net 15',
    taxRateBps: 750,
    discountCents: 5000,
    expirationDate: '2026-12-31',
    terms: 'Standard commercial terms apply.',
    scope: {
      locations: [
        {
          propertyId: 'prop_a',
          name: 'HQ',
          address: '1 Office Way',
          notes: '',
          areas: [
            {
              name: 'Offices',
              notes: '',
              tasks: [
                { name: 'Vacuum and dust', frequency: '3x weekly', monthlyCents: 120000 },
                { name: 'Restroom sanitizing', frequency: '5x weekly', monthlyCents: 80000 },
              ],
            },
          ],
        },
        {
          propertyId: 'prop_b',
          name: 'Warehouse',
          address: '2 Depot Rd',
          notes: '',
          areas: [
            {
              name: 'Warehouse floor',
              notes: '',
              tasks: [{ name: 'Auto-scrub floors', frequency: 'weekly', monthlyCents: 50000 }],
            },
          ],
        },
      ],
      oneTimeCharges: [{ label: 'Initial deep clean', amountCents: 40000 }],
      addOns: [{ label: 'Window cleaning', amountCents: 10000, recurring: true }],
      supplies: 'Sparkling Standard provides consumables',
      equipment: 'Facility provides floor scrubber',
      crewRequirements: 'Two cleaners, one lead',
      scheduleNotes: 'After 6pm weekdays',
      exclusions: 'Biohazard cleanup excluded',
    },
    ...overrides,
  };
}

test('sending a published proposal creates an approved agreement and signing request', async () => {
  const database = db();
  const created = await createCommercialProposal(database, actor, proposalInput());
  await publishCommercialProposal(database, actor, created.id);
  const sent = await sendCommercialProposal(database, actor, created.id, {});
  assert.ok(sent.signingRequestId);
  const proposal = await getCommercialProposal(database, actor, created.id);
  assert.equal(String(proposal.status), 'sent');
  const template = database.raw
    .prepare("SELECT id, status, signer_party FROM document_templates WHERE family_key = ?")
    .get(`commercial-proposal-${String(proposal.proposal_number).toLowerCase()}`) as
    | { id: string; status: string; signer_party: string }
    | undefined;
  assert.ok(template);
  assert.equal(template.status, 'approved');
  assert.equal(template.signer_party, 'customer');
  const request = database.raw
    .prepare('SELECT status, customer_id, signer_email FROM signing_requests WHERE id = ?')
    .get(sent.signingRequestId) as
    | { status: string; customer_id: string; signer_email: string }
    | undefined;
  assert.ok(request);
  assert.equal(request.customer_id, 'cust_commercial');
  assert.equal(request.signer_email, 'billing@acme.test');
});

test('commercial proposal totals are server-calculated and scope is structured', async () => {
  const database = db();
  const created = await createCommercialProposal(database, actor, proposalInput());
  const proposal = await getCommercialProposal(database, actor, created.id);
  assert.equal(proposal.recurring_total_cents, 260000);
  assert.equal(proposal.one_time_total_cents, 40000);
  assert.equal(proposal.discount_cents, 5000);
  const tax = Math.round(((260000 + 40000 - 5000) * 750) / 10000);
  assert.equal(proposal.first_invoice_total_cents, 295000 + tax);
  assert.equal((proposal.scope as { locations: unknown[] }).locations.length, 2);
  assert.equal(String(proposal.status), 'draft');
  assert.match(String(proposal.proposal_number), /^CMP-\d{4}-\d{4}$/);
});

test('proposal validation rejects missing scope, prices and invalid tax data', async () => {
  const database = db();
  await assert.rejects(
    createCommercialProposal(database, actor, proposalInput({
      scope: { locations: [], oneTimeCharges: [], addOns: [] },
    })),
    /proposal_scope_required/,
  );
  await assert.rejects(
    createCommercialProposal(database, actor, proposalInput({
      scope: {
        locations: [{ name: 'HQ', areas: [{ name: 'Offices', tasks: [{ name: 'Clean', frequency: 'daily', monthlyCents: 0 }] }] }],
        oneTimeCharges: [],
        addOns: [],
      },
    })),
    /proposal_price_required/,
  );
});

test('publishing freezes a revision snapshot and content hash', async () => {
  const database = db();
  const created = await createCommercialProposal(database, actor, proposalInput());
  await publishCommercialProposal(database, actor, created.id);
  const proposal = await getCommercialProposal(database, actor, created.id);
  assert.equal(String(proposal.status), 'published');
  assert.match(String(proposal.content_sha256), /^[a-f0-9]{64}$/);
  assert.ok(String(proposal.snapshot_json).includes('Multi-site janitorial'));
  const revision = database.raw
    .prepare('SELECT version, note FROM commercial_proposal_revisions WHERE proposal_id = ?')
    .get(created.id) as { version: number; note: string };
  assert.equal(revision.version, 1);
  assert.equal(revision.note, 'Published');
});

test('accepted signing marks the proposal accepted and supports contract billing', async () => {
  const database = db();
  const created = await createCommercialProposal(database, actor, proposalInput());
  await publishCommercialProposal(database, actor, created.id);
  database.raw.prepare(
    "INSERT INTO document_templates (id, title, category, version, status, source_kind, content_text) VALUES ('doc_test', 'Commercial proposal', 'commercial-proposal', '1.0', 'approved', 'text', 'Agreement')",
  ).run();
  database.raw.prepare(
    "INSERT INTO signing_requests (id, bundle_code, bundle_version, subject_type, customer_id, property_id, booking_reference, service_code, status, requirement_snapshot_json, signer_email) VALUES ('sr_commercial', 'commercial-proposal', 1, 'customer', 'cust_commercial', 'prop_a', 'CMP-TEST', 'commercial-cleaning', 'signed', '[]', 'billing@acme.test')",
  ).run();
  database.raw.prepare(
    "INSERT INTO document_signatures (id, signing_request_id, template_id, template_version, document_sha256, signed_content_text, signer_party, signer_name, signer_email, signature_json, consent_version, signed_at) VALUES ('sig_commercial', 'sr_commercial', 'doc_test', '1.0', 'hash', 'content', 'customer', 'Alex Manager', 'billing@acme.test', '{}', 'v1', '2026-11-25T12:00:00.000Z')",
  ).run();
  database.raw
    .prepare("UPDATE commercial_proposals SET signing_request_id = 'sr_commercial', status = 'sent' WHERE id = ?")
    .run(created.id);
  assert.equal(await syncProposalSigningStatus(database, created.id), 'accepted');
  const proposal = await getCommercialProposal(database, actor, created.id);
  assert.equal(String(proposal.status), 'accepted');
  assert.equal(String(proposal.accepted_by_name), 'Alex Manager');

  const contract = await createCommercialContract(database, actor, created.id, { startDate: '2026-12-01' });
  const invoice = await generateContractInvoice(database, actor, contract.id);
  assert.ok(invoice.invoiceId);
  const row = database.raw
    .prepare('SELECT status, total_cents, commercial_contract_id, due_date FROM invoices WHERE id = ?')
    .get(invoice.invoiceId) as { status: string; total_cents: number; commercial_contract_id: string; due_date: string };
  assert.equal(row.status, 'open');
  assert.equal(row.commercial_contract_id, contract.id);
  assert.ok(row.total_cents > 0);
  assert.ok(row.due_date > '2026-12-01');
  const nextPeriod = database.raw
    .prepare('SELECT next_invoice_date FROM commercial_contracts WHERE id = ?')
    .get(contract.id) as { next_invoice_date: string };
  assert.equal(nextPeriod.next_invoice_date, '2027-03-01');
  database.raw
    .prepare("UPDATE commercial_contracts SET next_invoice_date = '2027-01-01' WHERE id = ?")
    .run(contract.id);
  await assert.rejects(generateContractInvoice(database, actor, contract.id), /contract_period_already_invoiced/);
});

test('facility contacts and walkthroughs are recorded against the facility', async () => {
  const database = db();
  await addPropertyContact(database, actor, {
    propertyId: 'prop_b',
    name: 'Billing Contact',
    role: 'billing',
    email: 'ap@acme.test',
    phone: '8505550100',
    isPrimary: true,
  });
  await addWalkthrough(database, actor, {
    propertyId: 'prop_b',
    walkedAt: '2026-11-20',
    attendees: 'Owner, facility manager',
    findings: 'Loading dock needs daily attention.',
    scopeNotes: 'Add dock sweep.',
  });
  const contact = database.raw
    .prepare("SELECT role, email FROM property_contacts WHERE property_id = 'prop_b'")
    .get() as { role: string; email: string };
  assert.equal(contact.role, 'billing');
  assert.equal(contact.email, 'ap@acme.test');
  const walk = database.raw
    .prepare("SELECT findings FROM commercial_walkthroughs WHERE property_id = 'prop_b'")
    .get() as { findings: string };
  assert.match(walk.findings, /dock/);
});

test('pure totals never trust client-submitted amounts and clamp discounts', () => {
  const scope = {
    locations: [{ propertyId: '', name: 'A', address: '', notes: '', areas: [{ name: 'Area', notes: '', tasks: [{ name: 'Task', frequency: 'daily', monthlyCents: 10000 }] }] }],
    oneTimeCharges: [{ label: 'Setup', amountCents: 5000 }],
    addOns: [],
    supplies: '',
    equipment: '',
    crewRequirements: '',
    scheduleNotes: '',
    exclusions: '',
  };
  const totals = calculateProposalTotals({ scope, taxRateBps: 1000, discountCents: 999999 });
  assert.equal(totals.discountCents, 15000);
  assert.equal(totals.firstInvoiceTotalCents, 0);
});
