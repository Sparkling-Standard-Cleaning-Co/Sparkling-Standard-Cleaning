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
import {
  approveCommercialSchedule,
  previewCommercialSchedule,
  setCommercialScheduleStatus,
} from '../src/lib/commercial/scheduling.ts';
import { zonedTimeToUtc } from '../src/lib/booking/time.ts';

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
    .prepare('SELECT status, total_cents, commercial_contract_id, issue_date, due_date FROM invoices WHERE id = ?')
    .get(invoice.invoiceId) as {
    status: string;
    total_cents: number;
    commercial_contract_id: string;
    issue_date: string;
    due_date: string;
  };
  assert.equal(row.status, 'open');
  assert.equal(row.commercial_contract_id, contract.id);
  assert.equal(row.total_cents, 317125, 'first invoice must equal the signed first-invoice total');
  assert.equal(
    row.due_date,
    new Date(Date.parse(`${row.issue_date}T12:00:00Z`) + 15 * 86_400_000).toISOString().slice(0, 10),
    'Net 15 due date from the branch-local issue date',
  );
  const lines = database.raw
    .prepare('SELECT kind, total_cents FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order')
    .all(invoice.invoiceId) as Array<{ kind: string; total_cents: number }>;
  assert.ok(lines.some((line) => line.kind === 'extra' && line.total_cents === 40000));
  assert.ok(lines.some((line) => line.kind === 'discount' && line.total_cents === 5000));
  assert.ok(lines.some((line) => line.kind === 'tax' && line.total_cents === 22125));
  const nextPeriod = database.raw
    .prepare('SELECT next_invoice_date FROM commercial_contracts WHERE id = ?')
    .get(contract.id) as { next_invoice_date: string };
  assert.equal(nextPeriod.next_invoice_date, '2027-01-01');
  const second = await generateContractInvoice(database, actor, contract.id);
  assert.equal(second.totalCents, 279500, 'subsequent invoice is recurring service plus tax');
  database.raw
    .prepare("UPDATE commercial_contracts SET next_invoice_date = '2026-12-01' WHERE id = ?")
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

async function acceptedContract(database: TestD1, startDate: string, proposal: Record<string, unknown> = proposalInput()) {
  const created = await createCommercialProposal(database, actor, proposal);
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
  await syncProposalSigningStatus(database, created.id);
  const contract = await createCommercialContract(database, actor, created.id, { startDate });
  return { proposalId: created.id, contractId: contract.id };
}

test('month-end billing anchors and advances without skipping a period', async () => {
  const database = db();
  const { contractId } = await acceptedContract(database, '2026-01-31');
  const first = await generateContractInvoice(database, actor, contractId);
  const firstPeriod = database.raw
    .prepare('SELECT period_start, period_end FROM commercial_contract_invoices WHERE contract_id = ?')
    .get(contractId) as { period_start: string; period_end: string };
  assert.equal(firstPeriod.period_start, '2026-01-31');
  assert.equal(firstPeriod.period_end, '2026-02-28');
  const second = await generateContractInvoice(database, actor, contractId);
  const periods = database.raw
    .prepare('SELECT period_start, period_end FROM commercial_contract_invoices WHERE contract_id = ? ORDER BY period_start')
    .all(contractId) as Array<{ period_start: string; period_end: string }>;
  assert.deepEqual(periods.map((period) => period.period_start), ['2026-01-31', '2026-02-28']);
  assert.equal(periods[1]?.period_end, '2026-03-31');
  assert.ok(second.totalCents > 0);
  assert.ok(first.invoiceId !== second.invoiceId);
});

test('a commercial contract can preview and generate a recurring service schedule', async () => {
  const database = db();
  database.raw.prepare("UPDATE properties SET latitude = 30.4, longitude = -87.2 WHERE id = 'prop_a'").run();
  const { contractId } = await acceptedContract(database, '2026-12-01');
  const availability = (async (_env: unknown, input: { date: string; startTime?: string; durationMinutes: number }) => {
    const start = zonedTimeToUtc(input.date, '08:00', 'America/Chicago').toISOString();
    return {
      ok: true,
      availability: {
        slots: [
          {
            start,
            end: new Date(Date.parse(start) + input.durationMinutes * 60_000).toISOString(),
            resourceIds: ['res_1'],
          },
        ],
      },
    };
  }) as never;
  const deps = {
    availability,
    geocode: (async () => ({ lat: 30.4, lng: -87.2 })) as never,
    findEvent: (async () => null) as never,
    createEvent: (async () => ({ ok: true, eventId: `evt_${crypto.randomUUID()}` })) as never,
    updateEvent: (async () => ({ ok: true })) as never,
    deleteEvent: (async () => ({ ok: true })) as never,
  };
  const input = {
    contractId,
    propertyId: 'prop_a',
    frequency: 'monthly',
    startDate: '2026-12-01',
    window: 'morning',
    startTime: '08:00',
    durationMinutes: 120,
    firstDurationMinutes: 120,
    crewSize: 2,
    scopeNotes: 'Lobby, restrooms, break room',
    accessInstructions: 'Front desk key; alarm code held by facility',
    requiredQualifications: 'Lead cleaner, floor scrubber',
  };
  const preview = await previewCommercialSchedule({ DB: database } as never, database, actor, input, deps);
  assert.equal(preview.ok, true);
  assert.ok(preview.dates.length >= 1);
  const approved = await approveCommercialSchedule({ DB: database } as never, database, actor, input, deps);
  assert.ok(approved.planId);
  assert.equal(approved.sync.created + approved.sync.skipped, preview.dates.length);
  const schedule = database.raw
    .prepare('SELECT id, status, recurring_plan_id, scope_notes, access_instructions, required_qualifications FROM commercial_contract_schedules WHERE contract_id = ?')
    .get(contractId) as {
    id: string;
    status: string;
    recurring_plan_id: string;
    scope_notes: string;
    access_instructions: string;
    required_qualifications: string;
  };
  assert.equal(schedule.status, 'active');
  assert.equal(schedule.recurring_plan_id, approved.planId);
  assert.equal(schedule.scope_notes, 'Lobby, restrooms, break room');
  assert.equal(schedule.access_instructions, 'Front desk key; alarm code held by facility');
  assert.match(schedule.required_qualifications, /floor scrubber/i);
  const plan = database.raw
    .prepare('SELECT status, branch_id, commercial_schedule_id, frequency FROM recurring_plans WHERE id = ?')
    .get(approved.planId) as { status: string; branch_id: string; commercial_schedule_id: string; frequency: string };
  assert.equal(plan.status, 'active');
  assert.equal(plan.branch_id, 'branch_pensacola');
  assert.equal(plan.frequency, 'monthly');
  const appointments = database.raw
    .prepare("SELECT notes, timezone, crew_size FROM appointments WHERE recurring_plan_id = ? ORDER BY start_at")
    .all(approved.planId) as Array<{ notes: string; timezone: string; crew_size: number }>;
  assert.equal(appointments.length, preview.dates.length);
  assert.match(appointments[0]!.notes, /Lobby, restrooms/);
  assert.match(appointments[0]!.notes, /Front desk key/);
  assert.equal(appointments[0]!.timezone, 'America/Chicago');
  assert.equal(appointments[0]!.crew_size, 2);
  await assert.rejects(
    approveCommercialSchedule({ DB: database } as never, database, actor, input, deps),
    /commercial_schedule_exists/,
  );
  const paused = await setCommercialScheduleStatus(
    { DB: database } as never,
    database,
    actor,
    schedule.id,
    'paused',
    deps,
  );
  assert.equal(paused.status, 'paused');
});
