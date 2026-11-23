import './helpers/enable-signing.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { createOpsSession, enrollOwner, type AdminActor } from '../src/lib/admin/operations.ts';
import { onRequestGet as documentsAdminGet, onRequestPost as documentsAdminPost } from '../functions/api/admin/documents.ts';
import { confirmRequest, createTeamMember } from '../src/lib/admin/scheduling.ts';
import { commitConfirmedBooking } from '../src/lib/booking/commitment.ts';
import { autoConfirmPaidBooking } from '../src/lib/booking/auto-confirm.ts';
import { FakeLedger } from './helpers/payment-fakes.ts';
import {
  acknowledgeDocumentUpdate,
  activeRequirements,
  addBundleItem,
  approveTemplate,
  createBundle,
  createSigningRequest,
  createTemplate,
  countersignSigningRequest,
  findReusableSigningRequest,
  getExecutedCopy,
  employeeOnboardingStatus,
  evaluateDocumentGate,
  listDocumentUpdates,
  listSigningRequests,
  removeBundleItem,
  signSigningRequest,
  verifySignature,
} from '../src/lib/documents/service.ts';

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

function signingRequest(): Request {
  return new Request('https://example.test/api/document-sign', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': '203.0.113.10', 'User-Agent': 'synthetic-test' },
  });
}

async function fixture() {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'owner-docs@example.test',
    name: 'Synthetic Owner',
    password: 'SyntheticOwner!2026',
  });
  const customerId = `cust_${crypto.randomUUID()}`;
  const propertyId = `prop_${crypto.randomUUID()}`;
  db.raw.prepare("INSERT INTO customers (id, primary_branch_id, first_name, last_name, status) VALUES (?, 'branch_pensacola', 'Synthetic', 'Customer', 'active')").run(customerId);
  db.raw.prepare("INSERT INTO properties (id, customer_id, branch_id, label, line1, city, state, postal_code, status) VALUES (?, ?, 'branch_pensacola', 'Home', '1 Test Way', 'Pensacola', 'FL', '32502', 'active')").run(propertyId, customerId);
  const teamMemberId = `team_${crypto.randomUUID()}`;
  db.raw.prepare("INSERT INTO team_members (id, branch_id, display_name, email, status, is_bookable, booking_resource_id, is_solo, is_lead) VALUES (?, 'branch_pensacola', 'Synthetic Employee', 'employee-docs@example.test', 'active', 1, ?, 1, 0)").run(teamMemberId, teamMemberId);
  return { db, owner, customerId, propertyId, teamMemberId };
}

async function approvedTemplate(
  db: TestD1,
  ownerId: string,
  title: string,
  options: { requiresVerification?: boolean; category?: string } = {},
): Promise<string> {
  const created = await createTemplate(db, ownerId, {
    title,
    category: options.category ?? 'residential',
    version: '1.0',
    contentText: `${title}\n\nSynthetic approved wording for integration testing only.`,
    ...(options.requiresVerification ? { requiresVerification: true } : {}),
  });
  await approveTemplate(db, ownerId, created.id);
  return created.id;
}

test('an owner-configured residential bundle gates exactly its approved documents', async () => {
  const f = await fixture();
  const t1 = await approvedTemplate(f.db, f.owner.id, 'Residential Intake');
  const t2 = await approvedTemplate(f.db, f.owner.id, 'Residential Service Agreement');
  const t3 = await approvedTemplate(f.db, f.owner.id, 'Cleaning Preferences');
  const bundle = await createBundle(f.db, f.owner.id, {
    code: 'customer.residential',
    name: 'Residential documents',
    serviceCategory: 'residential',
    subjectType: 'customer',
  });
  for (const [index, templateId] of [t1, t2, t3].entries()) {
    await addBundleItem(f.db, f.owner.id, {
      bundleId: bundle.id,
      templateId,
      sortOrder: index,
      required: true,
      enforcementStage: 'before_confirmation',
    });
  }
  const context = {
    subjectType: 'customer' as const,
    customerId: f.customerId,
    propertyId: f.propertyId,
    serviceCode: 'residential-cleaning',
    frequency: 'one_time',
    bookingReference: 'SS-20261101-ABC123',
  };
  const resolved = await activeRequirements(f.db, context);
  assert.deepEqual(resolved.requirements.map((item) => item.templateId), [t1, t2, t3]);
  const blocked = await evaluateDocumentGate(f.db, context, 'before_confirmation');
  assert.equal(blocked.satisfied, false);
  assert.equal(blocked.missing.length, 3);

  const request = await createSigningRequest(f.db, context, { createdByAdminUserId: f.owner.id });
  assert.equal(request.required, true);
  assert.ok(request.token);
  const partial = await signSigningRequest(f.db, request.token!, {
    signerName: 'Synthetic Customer',
    signerEmail: 'customer@example.test',
    consent: true,
    signatures: { [t1]: { value: 'Synthetic Customer' } },
    request: signingRequest(),
  });
  assert.equal(partial.status, 'partially_signed');
  assert.equal((await evaluateDocumentGate(f.db, context, 'before_confirmation')).satisfied, false);

  const completed = await signSigningRequest(f.db, request.token!, {
    signerName: 'Synthetic Customer',
    signerEmail: 'customer@example.test',
    consent: true,
    signatures: {
      [t2]: { value: 'Synthetic Customer' },
      [t3]: { value: 'Synthetic Customer' },
    },
    request: signingRequest(),
  });
  assert.equal(completed.status, 'signed');
  assert.equal((await evaluateDocumentGate(f.db, context, 'before_confirmation')).satisfied, true);

  const duplicate = await signSigningRequest(f.db, request.token!, {
    signerName: 'Synthetic Customer',
    signerEmail: 'customer@example.test',
    consent: true,
    signatures: { [t1]: { value: 'Different Name' }, [t2]: { value: 'Synthetic Customer' }, [t3]: { value: 'Synthetic Customer' } },
    request: signingRequest(),
  });
  assert.equal(duplicate.status, 'signed');
  const signatures = f.db.raw
    .prepare('SELECT template_id, signature_json FROM document_signatures WHERE signing_request_id = ?')
    .all(String(request.requestId)) as Array<{ template_id: string; signature_json: string }>;
  assert.equal(signatures.length, 3);
  assert.match(signatures.find((row) => row.template_id === t1)!.signature_json, /Synthetic Customer/);
  assert.doesNotMatch(signatures.find((row) => row.template_id === t1)!.signature_json, /Different Name/);

  const t4 = await approvedTemplate(f.db, f.owner.id, 'New Policy Document');
  await addBundleItem(f.db, f.owner.id, {
    bundleId: bundle.id, templateId: t4, sortOrder: 3, required: true, enforcementStage: 'before_confirmation',
  });
  const newPolicy = await evaluateDocumentGate(f.db, context, 'before_confirmation');
  assert.equal(newPolicy.satisfied, false);
  assert.deepEqual(newPolicy.missing.map((item) => item.templateId), [t4]);
  assert.equal((await listSigningRequests(f.db, { customerId: f.customerId })).length, 1);

  await removeBundleItem(f.db, f.owner.id, bundle.id, t4);
  assert.equal((await evaluateDocumentGate(f.db, context, 'before_confirmation')).satisfied, true);

  const otherCustomer = `cust_${crypto.randomUUID()}`;
  f.db.raw.prepare("INSERT INTO customers (id, primary_branch_id, first_name, last_name, status) VALUES (?, 'branch_pensacola', 'Other', 'Customer', 'active')").run(otherCustomer);
  const cross = await evaluateDocumentGate(
    f.db,
    { ...context, customerId: otherCustomer, bookingReference: 'SS-20261101-OTHER1' },
    'before_confirmation',
  );
  assert.equal(cross.satisfied, false);
});

test('a rejected signature never counts as signed and can be signed again', async () => {
  const f = await fixture();
  const templateId = await approvedTemplate(f.db, f.owner.id, 'Residential Agreement');
  const bundle = await createBundle(f.db, f.owner.id, {
    code: 'customer.residential',
    name: 'Residential documents',
    serviceCategory: 'residential',
    subjectType: 'customer',
  });
  await addBundleItem(f.db, f.owner.id, {
    bundleId: bundle.id,
    templateId,
    required: true,
    enforcementStage: 'before_confirmation',
  });
  const context = {
    subjectType: 'customer' as const,
    customerId: f.customerId,
    propertyId: f.propertyId,
    serviceCode: 'residential-cleaning',
    frequency: 'one_time',
    bookingReference: 'SS-20261101-REJECT1',
  };
  const request = await createSigningRequest(f.db, context, { createdByAdminUserId: f.owner.id });
  await signSigningRequest(f.db, request.token!, {
    signerName: 'Synthetic Customer',
    signerEmail: 'customer@example.test',
    consent: true,
    signatures: { [templateId]: { value: 'Synthetic Customer' } },
    request: signingRequest(),
  });
  const first = f.db.raw
    .prepare('SELECT id, status, attempt FROM document_signatures WHERE signing_request_id = ?')
    .get(String(request.requestId)) as { id: string; status: string; attempt: number };
  assert.equal(first.attempt, 1);
  await verifySignature(f.db, f.owner.id, first.id, false, 'Synthetic rejection');
  const rejected = await evaluateDocumentGate(f.db, context, 'before_confirmation');
  assert.equal(rejected.satisfied, false);
  assert.deepEqual(rejected.missing.map((item) => item.templateId), [templateId]);
  const storedRequest = f.db.raw
    .prepare('SELECT status FROM signing_requests WHERE id = ?')
    .get(String(request.requestId)) as { status: string };
  assert.equal(storedRequest.status, 'partially_signed');

  const resigned = await signSigningRequest(f.db, request.token!, {
    signerName: 'Synthetic Customer',
    signerEmail: 'customer@example.test',
    consent: true,
    signatures: { [templateId]: { value: 'Synthetic Customer' } },
    request: signingRequest(),
  });
  assert.equal(resigned.status, 'signed');
  const rows = f.db.raw
    .prepare('SELECT status, attempt FROM document_signatures WHERE signing_request_id = ? ORDER BY attempt')
    .all(String(request.requestId)) as Array<{ status: string; attempt: number }>;
  assert.deepEqual(
    rows.map((row) => ({ status: row.status, attempt: row.attempt })),
    [
      { status: 'rejected', attempt: 1 },
      { status: 'signed', attempt: 2 },
    ],
  );
  assert.equal((await evaluateDocumentGate(f.db, context, 'before_confirmation')).satisfied, true);
});

test('employee onboarding stays unverified until the owner verifies the signature', async () => {
  const f = await fixture();
  const onboarding = await approvedTemplate(f.db, f.owner.id, 'Employee Handbook Acknowledgement', {
    requiresVerification: true,
    category: 'employee',
  });
  const bundle = await createBundle(f.db, f.owner.id, {
    code: 'employee.onboarding',
    name: 'Employee onboarding',
    serviceCategory: 'employee',
    subjectType: 'employee',
  });
  await addBundleItem(f.db, f.owner.id, {
    bundleId: bundle.id,
    templateId: onboarding,
    required: true,
    enforcementStage: 'before_employee_activation',
  });
  const before = await employeeOnboardingStatus(f.db, f.teamMemberId);
  assert.equal(before.satisfied, false);
  const request = await createSigningRequest(f.db, {
    subjectType: 'employee',
    teamMemberId: f.teamMemberId,
    role: 'solo',
  }, { createdByAdminUserId: f.owner.id });
  assert.equal(request.required, true);
  const signed = await signSigningRequest(f.db, request.token!, {
    signerName: 'Synthetic Employee',
    signerEmail: 'employee-docs@example.test',
    consent: true,
    signatures: { [onboarding]: { value: 'Synthetic Employee' } },
    request: signingRequest(),
  });
  assert.equal(signed.status, 'signed');
  assert.equal((await employeeOnboardingStatus(f.db, f.teamMemberId)).satisfied, false);
  const row = f.db.raw.prepare('SELECT id, status FROM document_signatures WHERE signing_request_id = ?').get(String(request.requestId)) as { id: string; status: string };
  assert.equal(row.status, 'awaiting_verification');
  await verifySignature(f.db, f.owner.id, row.id, true);
  assert.equal((await employeeOnboardingStatus(f.db, f.teamMemberId)).satisfied, true);
  const files = await listSigningRequests(f.db, { teamMemberId: f.teamMemberId });
  assert.equal(files.length, 1);
  assert.equal(files[0]?.subject_type, 'employee');
});

test('commercial and church services resolve their own bundles, not the residential one', async () => {
  const f = await fixture();
  const commercialDoc = await approvedTemplate(f.db, f.owner.id, 'Commercial Service Agreement', { category: 'commercial' });
  const commercial = await createBundle(f.db, f.owner.id, {
    code: 'customer.commercial',
    name: 'Commercial documents',
    serviceCategory: 'commercial',
    subjectType: 'customer',
  });
  await addBundleItem(f.db, f.owner.id, {
    bundleId: commercial.id, templateId: commercialDoc, required: true, enforcementStage: 'before_confirmation',
  });
  const resolved = await activeRequirements(f.db, {
    subjectType: 'customer',
    customerId: f.customerId,
    serviceCode: 'commercial-cleaning',
    frequency: 'one_time',
  });
  assert.equal(resolved.bundle?.code, 'customer.commercial');
  assert.deepEqual(resolved.requirements.map((item) => item.templateId), [commercialDoc]);
  const weeklyCommercial = await activeRequirements(f.db, {
    subjectType: 'customer',
    customerId: f.customerId,
    serviceCode: 'commercial-cleaning',
    frequency: 'weekly',
  });
  assert.equal(weeklyCommercial.bundle?.code, 'customer.commercial', 'a weekly commercial job is not residential recurring');
  const church = await activeRequirements(f.db, {
    subjectType: 'customer',
    customerId: f.customerId,
    serviceCode: 'church-cleaning',
    frequency: 'one_time',
  });
  assert.equal(church.bundle, null);
});

test('recurring-only requirements apply only to recurring arrangements', async () => {
  const f = await fixture();
  const recurringDoc = await approvedTemplate(f.db, f.owner.id, 'Recurring Service Agreement');
  const bundle = await createBundle(f.db, f.owner.id, {
    code: 'customer.residential',
    name: 'Residential documents',
    serviceCategory: 'residential',
    subjectType: 'customer',
  });
  await addBundleItem(f.db, f.owner.id, {
    bundleId: bundle.id,
    templateId: recurringDoc,
    required: true,
    enforcementStage: 'before_confirmation',
    conditionKey: 'frequency',
    conditionValue: 'weekly,biweekly,monthly',
  });
  const oneTime = await activeRequirements(f.db, {
    subjectType: 'customer', customerId: f.customerId, serviceCode: 'residential-cleaning', frequency: 'one_time',
  });
  assert.equal(oneTime.requirements.length, 0);
  const recurring = await activeRequirements(f.db, {
    subjectType: 'customer', customerId: f.customerId, serviceCode: 'residential-cleaning', frequency: 'biweekly',
  });
  assert.deepEqual(recurring.requirements.map((item) => item.templateId), [recurringDoc]);
});

test('a signed Pay Later request remains pending until admin confirmation, and unsigned confirmation is refused', async () => {
  const f = await fixture();
  const documentId = await approvedTemplate(f.db, f.owner.id, 'Residential Service Agreement');
  const bundle = await createBundle(f.db, f.owner.id, {
    code: 'customer.residential',
    name: 'Residential documents',
    serviceCategory: 'residential',
    subjectType: 'customer',
  });
  await addBundleItem(f.db, f.owner.id, {
    bundleId: bundle.id, templateId: documentId, required: true, enforcementStage: 'before_confirmation',
  });
  const ownerActor: AdminActor = {
    id: f.owner.id,
    email: f.owner.email,
    name: f.owner.name,
    role: 'owner',
    branchId: null,
    csrf: '',
    permissions: [],
    mfaEnabled: false,
  };
  const team = await createTeamMember(f.db, ownerActor, { displayName: 'Synthetic Solo', isSolo: true });
  const start = new Date(Date.now() + 10 * 86_400_000).toISOString();
  const end = new Date(Date.parse(start) + 2 * 60 * 60 * 1000).toISOString();
  const reference = 'SS-20261111-PAYLAT';
  f.db.raw.prepare(
    `INSERT INTO booking_requests
     (id, hold_id, branch_id, customer_id, property_id, status, quote_reference, requested_date,
      start_at, end_at, duration_minutes, payload_json)
     VALUES ('req_paylater', 'hold_paylater', 'branch_pensacola', ?, ?, 'pending', ?, ?, ?, ?, 120, ?)`,
  ).run(
    f.customerId,
    f.propertyId,
    reference,
    start.slice(0, 10),
    start,
    end,
    JSON.stringify({ service_type: 'residential-cleaning', frequency: 'one_time', email: 'customer@example.test' }),
  );
  await assert.rejects(
    () => confirmRequest(f.db, ownerActor, 'req_paylater', [team.id]),
    /documents_required/,
  );
  const request = await createSigningRequest(f.db, {
    subjectType: 'customer',
    customerId: f.customerId,
    propertyId: f.propertyId,
    serviceCode: 'residential-cleaning',
    frequency: 'one_time',
    bookingReference: reference,
    bookingRequestId: 'req_paylater',
  }, { createdByAdminUserId: f.owner.id });
  await signSigningRequest(f.db, request.token!, {
    signerName: 'Synthetic Customer',
    signerEmail: 'customer@example.test',
    consent: true,
    signatures: { [documentId]: { value: 'Synthetic Customer' } },
    request: signingRequest(),
  });
  assert.equal((await evaluateDocumentGate(f.db, {
    subjectType: 'customer',
    customerId: f.customerId,
    propertyId: f.propertyId,
    serviceCode: 'residential-cleaning',
    frequency: 'one_time',
    bookingReference: reference,
  }, 'before_confirmation')).satisfied, true);
  const pending = f.db.raw.prepare("SELECT status FROM booking_requests WHERE id = 'req_paylater'").get() as { status: string };
  assert.equal(pending.status, 'pending');
  const confirmed = await confirmRequest(f.db, ownerActor, 'req_paylater', [team.id]);
  assert.match(confirmed.reference, /^APT-/);
  const appointment = f.db.raw.prepare('SELECT status FROM appointments WHERE booking_request_id = ?').get('req_paylater') as { status: string };
  assert.equal(appointment.status, 'confirmed');
});


test('an unsigned paid commitment cannot create a calendar event', async () => {
  const f = await fixture();
  const documentId = await approvedTemplate(f.db, f.owner.id, 'Paid Booking Agreement');
  const bundle = await createBundle(f.db, f.owner.id, {
    code: 'customer.residential',
    name: 'Residential documents',
    serviceCategory: 'residential',
    subjectType: 'customer',
  });
  await addBundleItem(f.db, f.owner.id, {
    bundleId: bundle.id, templateId: documentId, required: true, enforcementStage: 'before_confirmation',
  });
  let calendarCalled = false;
  const committed = await commitConfirmedBooking(
    { DB: f.db } as never,
    f.db,
    {
      reference: 'SS-20261112-NOSIGN',
      customerId: f.customerId,
      propertyId: f.propertyId,
      serviceCode: 'residential-cleaning',
    },
    {
      availability: (async () => { calendarCalled = true; throw new Error('availability_must_not_run'); }) as never,
    },
  );
  assert.equal(committed.ok, false);
  assert.equal(committed.reason, 'documents_required');
  assert.equal(calendarCalled, false);
  assert.equal((f.db.raw.prepare('SELECT COUNT(*) AS n FROM appointments').get() as { n: number }).n, 0);
});


test('paid confirmation creates a post-payment signing link when documents are outstanding', async () => {
  const f = await fixture();
  const templateId = await approvedTemplate(f.db, f.owner.id, 'Paid Booking Agreement');
  const bundle = await createBundle(f.db, f.owner.id, {
    code: 'customer.residential',
    name: 'Residential documents',
    serviceCategory: 'residential',
    subjectType: 'customer',
  });
  await addBundleItem(f.db, f.owner.id, {
    bundleId: bundle.id,
    templateId,
    required: true,
    enforcementStage: 'before_confirmation',
  });
  const ledger = new FakeLedger();
  const holdId = '2026-11-20__33333333-3333-4333-8333-333333333333';
  const start = '2026-11-20T14:00:00.000Z';
  const end = '2026-11-20T16:00:00.000Z';
  ledger.values.set(`booking/holds/${holdId}.json`, JSON.stringify({
    version: 1,
    id: holdId,
    date: '2026-11-20',
    start,
    end,
    durationMinutes: 120,
    destination: { lat: 30.42, lng: -87.22 },
    locationText: '1 Test Way, Pensacola, FL',
    reference: 'SS-20261120-DOC001',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    status: 'held',
    resourceIds: ['synthetic'],
    crewSize: 1,
  }));
  const result = await autoConfirmPaidBooking(
    { DB: f.db, PAYMENT_LEDGER: ledger } as never,
    holdId,
    'SS-20261120-DOC001',
    {
      customerId: f.customerId,
      propertyId: f.propertyId,
      serviceCode: 'residential-cleaning',
      frequency: 'one_time',
      customerEmail: 'customer@example.test',
    },
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'documents_required');
    assert.ok(result.documentRequest?.token);
    assert.equal(result.documentRequest?.email, 'customer@example.test');
  }
  assert.equal((f.db.raw.prepare('SELECT COUNT(*) AS n FROM signing_requests').get() as { n: number }).n, 1);
});

test('an owner can upload a PDF template and configure it without a deployment', async () => {
  const f = await fixture();
  const session = await createOpsSession(f.db, f.owner.id, signingRequest());
  const objects = new Map<string, { bytes: Uint8Array; type: string }>();
  const bucket = {
    put: async (key: string, value: Uint8Array) => {
      objects.set(key, { bytes: new Uint8Array(value), type: 'application/pdf' });
    },
    get: async (key: string) => {
      const object = objects.get(key);
      return object
        ? { body: object.bytes, httpMetadata: { contentType: object.type } }
        : null;
    },
  };
  const pdf = new TextEncoder().encode('%PDF-1.4\n% synthetic test document\n%%EOF');
  const form = new FormData();
  form.set('action', 'upload_template');
  form.set('title', 'Uploaded Synthetic Agreement');
  form.set('category', 'residential');
  form.set('version', '2.0');
  form.set('signerParty', 'customer');
  form.set('file', new File([pdf], 'synthetic.pdf', { type: 'application/pdf' }));
  const upload = await documentsAdminPost({
    request: new Request('https://example.test/api/admin/documents', {
      method: 'POST',
      headers: { Cookie: `ss_ops=${session.token}`, 'X-CSRF-Token': session.csrf },
      body: form,
    }),
    env: { DB: f.db, DOCUMENTS_BUCKET: bucket } as never,
  });
  const uploaded = (await upload.json()) as { ok: boolean; id?: string; error?: string };
  assert.equal(uploaded.ok, true, uploaded.error);
  assert.ok(uploaded.id);
  assert.equal(objects.size, 1);
  const listed = await documentsAdminGet({
    request: new Request('https://example.test/api/admin/documents?view=templates', {
      headers: { Cookie: `ss_ops=${session.token}` },
    }),
    env: { DB: f.db } as never,
  });
  const templates = (await listed.json()) as { templates: Array<Record<string, unknown>> };
  assert.ok(templates.templates.some((template) => template.title === 'Uploaded Synthetic Agreement'));

  const approve = await documentsAdminPost({
    request: new Request('https://example.test/api/admin/documents', {
      method: 'POST',
      headers: {
        Cookie: `ss_ops=${session.token}`,
        'X-CSRF-Token': session.csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'approve_template', templateId: uploaded.id }),
    }),
    env: { DB: f.db } as never,
  });
  assert.equal(((await approve.json()) as { ok: boolean }).ok, true);
  const approved = f.db.raw.prepare('SELECT status FROM document_templates WHERE id = ?').get(uploaded.id!) as { status: string };
  assert.equal(approved.status, 'approved');
});
test('signing requests bind the signer identity, carry branch ownership and produce an executed copy', async () => {
  const f = await fixture();
  f.db.raw
    .prepare("INSERT INTO customer_contacts (id, customer_id, kind, value, normalized_value, is_primary) VALUES ('ct_bound', ?, 'email', 'bound@example.test', 'bound@example.test', 1)")
    .run(f.customerId);
  const templateId = await approvedTemplate(f.db, f.owner.id, 'Countersigned Agreement', { requiresVerification: true });
  const bundle = await createBundle(f.db, f.owner.id, {
    code: 'customer.residential',
    name: 'Residential documents',
    serviceCategory: 'residential',
    subjectType: 'customer',
  });
  await addBundleItem(f.db, f.owner.id, {
    bundleId: bundle.id,
    templateId,
    sortOrder: 0,
    required: true,
    enforcementStage: 'before_confirmation',
  });
  const context = {
    subjectType: 'customer' as const,
    customerId: f.customerId,
    propertyId: f.propertyId,
    serviceCode: 'residential-cleaning',
    frequency: 'one_time',
    bookingReference: 'SS-20261215-BOUND1',
  };
  const request = await createSigningRequest(f.db, context, { createdByAdminUserId: f.owner.id });
  const row = f.db.raw
    .prepare('SELECT branch_id, signer_email FROM signing_requests WHERE id = ?')
    .get(String(request.requestId)) as { branch_id: string; signer_email: string };
  assert.equal(row.branch_id, 'branch_pensacola');
  assert.equal(row.signer_email, 'bound@example.test');
  await assert.rejects(
    () =>
      signSigningRequest(f.db, request.token!, {
        signerName: 'Impostor',
        signerEmail: 'impostor@example.test',
        consent: true,
        signatures: { [templateId]: { value: 'Impostor' } },
        request: signingRequest(),
      }),
    /signer_email_mismatch/,
  );
  const signed = await signSigningRequest(f.db, request.token!, {
    signerName: 'Synthetic Customer',
    signerEmail: 'bound@example.test',
    consent: true,
    signatures: { [templateId]: { value: 'Synthetic Customer' } },
    request: signingRequest(),
  });
  assert.equal(signed.status, 'signed');
  const executed = await getExecutedCopy(f.db, String(request.requestId));
  assert.ok(executed);
  assert.match(executed.text, /EXECUTED DOCUMENT COPY/);
  assert.match(executed.text, /Synthetic Customer/);
  assert.equal(executed.sha256.length, 64);
  const countersigned = await countersignSigningRequest(f.db, f.owner.id, String(request.requestId), 'Synthetic Owner');
  assert.equal(countersigned.status, 'signed');
  const status = f.db.raw
    .prepare("SELECT status FROM document_signatures WHERE signing_request_id = ?")
    .get(String(request.requestId)) as { status: string };
  assert.equal(status.status, 'verified');
  const finalCopy = await getExecutedCopy(f.db, String(request.requestId));
  assert.match(finalCopy?.text ?? '', /Synthetic Owner/);
});

import {
  duplicateBundle,
  duplicateTemplate,
  getTemplate,
  listBundles,
  previewPacket,
  restoreTemplate,
  retireTemplate,
  templateHistory,
  updateDraftTemplate,
} from '../src/lib/documents/service.ts';

test('a packet resolves supported variables, stores instructions and keeps the issued snapshot immutable', async () => {
  const f = await fixture();
  f.db.raw
    .prepare("INSERT INTO customer_contacts (id, customer_id, kind, value, normalized_value, is_primary) VALUES ('ct_packet', ?, 'email', 'packet@example.test', 'packet@example.test', 1)")
    .run(f.customerId);
  const created = await createTemplate(f.db, f.owner.id, {
    title: 'Packet Variable Agreement',
    category: 'residential',
    version: '1.0',
    contentText:
      'Customer: {{customer.first_name}} {{customer.last_name}}\nProperty: {{property.address}}\nBooking: {{booking.reference}}\nCompany: {{company.name}}',
    familyKey: 'packet-variable-agreement',
  });
  await approveTemplate(f.db, f.owner.id, created.id);
  const bundle = await createBundle(f.db, f.owner.id, {
    code: 'packet.variable_test',
    name: 'Residential one-time packet',
    serviceCategory: 'residential',
    subjectType: 'customer',
    purpose: 'customer',
    packetType: 'residential_one_time',
    instructions: 'Please review every document before signing.',
  });
  await addBundleItem(f.db, f.owner.id, {
    bundleId: bundle.id,
    templateId: created.id,
    sortOrder: 0,
    required: true,
    enforcementStage: 'before_confirmation',
  });
  const context = {
    subjectType: 'customer' as const,
    customerId: f.customerId,
    propertyId: f.propertyId,
    serviceCode: 'residential-cleaning',
    frequency: 'one_time',
    bookingReference: 'SS-20261201-PACKET',
  };
  const preview = await previewPacket(f.db, context, { bundleId: bundle.id });
  assert.ok(preview);
  assert.equal(preview.missingVariables.length, 0);
  assert.equal(preview.instructions, 'Please review every document before signing.');
  assert.equal(preview.requiredDocuments, 1);
  const previewText = preview.requirements[0]?.contentText ?? '';
  assert.match(previewText, /Customer: Synthetic Customer/);
  assert.match(previewText, /1 Test Way, Pensacola, FL, 32502/);
  assert.match(previewText, /Booking: SS-20261201-PACKET/);
  assert.match(previewText, /Company: Sparkling Standard Cleaning Co\./);
  assert.notEqual(preview.requirements[0]?.contentSha256, preview.requirements[0]?.templateSha256);

  const request = await createSigningRequest(f.db, context, {
    createdByAdminUserId: f.owner.id,
    bundleId: bundle.id,
    instructions: 'Bring access details to the appointment.',
  });
  assert.equal(request.required, true);
  assert.equal(request.bundleName, 'Residential one-time packet');
  assert.equal(request.instructions, 'Bring access details to the appointment.');
  const stored = f.db.raw
    .prepare('SELECT packet_instructions, packet_name, requirement_snapshot_json FROM signing_requests WHERE id = ?')
    .get(String(request.requestId)) as { packet_instructions: string; packet_name: string; requirement_snapshot_json: string };
  assert.equal(stored.packet_instructions, 'Bring access details to the appointment.');
  assert.equal(stored.packet_name, 'Residential one-time packet');
  const snapshot = JSON.parse(stored.requirement_snapshot_json) as Array<Record<string, unknown>>;
  assert.match(String(snapshot[0]?.contentText), /Customer: Synthetic Customer/);
  assert.match(String(snapshot[0]?.contentText), /SS-20261201-PACKET/);

  await signSigningRequest(f.db, request.token!, {
    signerName: 'Synthetic Customer',
    signerEmail: 'packet@example.test',
    consent: true,
    signatures: { [created.id]: { value: 'Synthetic Customer' } },
    request: signingRequest(),
  });
  assert.equal((await evaluateDocumentGate(f.db, context, 'before_confirmation')).satisfied, true);

  const nextVersion = await createTemplate(f.db, f.owner.id, {
    title: 'Packet Variable Agreement',
    category: 'residential',
    version: '1.1',
    contentText: 'Revised customer agreement for {{customer.first_name}}.',
    familyKey: 'packet-variable-agreement',
    supersedesTemplateId: created.id,
  });
  await approveTemplate(f.db, f.owner.id, nextVersion.id);
  await addBundleItem(f.db, f.owner.id, {
    bundleId: bundle.id,
    templateId: nextVersion.id,
    sortOrder: 0,
    required: true,
    enforcementStage: 'before_confirmation',
  });
  await removeBundleItem(f.db, f.owner.id, bundle.id, created.id);
  const afterRevision = await evaluateDocumentGate(f.db, context, 'before_confirmation');
  assert.equal(afterRevision.satisfied, false);
  assert.deepEqual(afterRevision.missing.map((item) => item.templateId), [nextVersion.id]);
  const oldSignature = f.db.raw
    .prepare('SELECT signed_content_text FROM document_signatures WHERE signing_request_id = ?')
    .get(String(request.requestId)) as { signed_content_text: string };
  assert.match(oldSignature.signed_content_text, /SS-20261201-PACKET/);
});

test('unresolved packet variables block sending and remain visible in preview', async () => {
  const f = await fixture();
  const created = await createTemplate(f.db, f.owner.id, {
    title: 'Unknown Variable Agreement',
    category: 'residential',
    version: '1.0',
    contentText: 'Hello {{customer.first_name}} {{customer.unknown_value}}.',
  });
  await approveTemplate(f.db, f.owner.id, created.id);
  const bundle = await createBundle(f.db, f.owner.id, {
    code: 'packet.unknown_variable',
    name: 'Unknown variable packet',
    subjectType: 'customer',
  });
  await addBundleItem(f.db, f.owner.id, {
    bundleId: bundle.id, templateId: created.id, required: true, enforcementStage: 'before_confirmation',
  });
  const context = { subjectType: 'customer' as const, customerId: f.customerId, bookingReference: 'SS-20261202-UNKNOWN' };
  const preview = await previewPacket(f.db, context, { bundleId: bundle.id });
  assert.deepEqual(preview?.missingVariables, ['customer.unknown_value']);
  await assert.rejects(
    () => createSigningRequest(f.db, context, { createdByAdminUserId: f.owner.id, bundleId: bundle.id }),
    /document_variables_missing:customer\.unknown_value/,
  );
  assert.equal((f.db.raw.prepare('SELECT COUNT(*) AS n FROM signing_requests').get() as { n: number }).n, 0);
});

test('an empty active packet is never routed, previewed as ready or sent explicitly', async () => {
  const f = await fixture();
  const empty = await createBundle(f.db, f.owner.id, {
    code: 'customer.move_in_out',
    name: 'Move-In / Move-Out Packet',
    serviceCategory: 'move_in_out',
    subjectType: 'customer',
  });
  const templateId = await approvedTemplate(f.db, f.owner.id, 'Move-Out Agreement');
  const ready = await createBundle(f.db, f.owner.id, {
    code: 'customer.move_in_out_ready',
    name: 'Move-In / Move-Out Approved Packet',
    serviceCategory: 'move_in_out',
    subjectType: 'customer',
  });
  await addBundleItem(f.db, f.owner.id, {
    bundleId: ready.id,
    templateId,
    required: true,
    enforcementStage: 'before_payment',
  });
  const context = {
    subjectType: 'customer' as const,
    customerId: f.customerId,
    propertyId: f.propertyId,
    serviceCode: 'move-in-move-out',
    bookingReference: 'SS-20261203-MOVE',
  };

  const routed = await activeRequirements(f.db, context);
  assert.equal(routed.bundle?.code, 'customer.move_in_out_ready');
  assert.deepEqual(routed.requirements.map((item) => item.templateId), [templateId]);

  const emptyPreview = await previewPacket(f.db, context, { bundleId: empty.id });
  assert.equal(emptyPreview?.ready, false);
  assert.equal(emptyPreview?.approvedDocumentCount, 0);
  assert.equal(emptyPreview?.totalDocuments, 0);

  await assert.rejects(
    () =>
      createSigningRequest(f.db, context, {
        createdByAdminUserId: f.owner.id,
        bundleId: empty.id,
      }),
    /packet_has_no_documents/,
  );
  const request = await createSigningRequest(f.db, context, {
    createdByAdminUserId: f.owner.id,
    bundleId: ready.id,
  });
  assert.equal(request.required, true);

  const listed = await listBundles(f.db);
  const emptyRow = listed.find((bundle) => bundle.id === empty.id);
  const readyRow = listed.find((bundle) => bundle.id === ready.id);
  assert.equal(Number(emptyRow?.approved_document_count), 0);
  assert.equal(Number(readyRow?.approved_document_count), 1);
  assert.equal(Number(readyRow?.required_document_count), 1);
});

test('customer access instructions are stored once and included in executed evidence', async () => {
  const f = await fixture();
  const templateId = await approvedTemplate(f.db, f.owner.id, 'Residential Access Authorization');
  const bundle = await createBundle(f.db, f.owner.id, {
    code: 'customer.residential',
    name: 'Residential documents',
    serviceCategory: 'residential',
    subjectType: 'customer',
  });
  await addBundleItem(f.db, f.owner.id, {
    bundleId: bundle.id,
    templateId,
    required: true,
    enforcementStage: 'before_payment',
  });
  const context = {
    subjectType: 'customer' as const,
    customerId: f.customerId,
    propertyId: f.propertyId,
    serviceCode: 'residential-cleaning',
    bookingReference: 'SS-20261204-ACCESS',
  };
  const request = await createSigningRequest(f.db, context, { createdByAdminUserId: f.owner.id });
  assert.equal(request.required, true);
  const signed = await signSigningRequest(f.db, request.token!, {
    signerName: 'Synthetic Customer',
    signerEmail: 'customer@example.test',
    consent: true,
    signatures: { [templateId]: { value: 'Synthetic Customer', type: 'typed' } },
    customerFields: {
      access_method: 'customer_present',
      access_instructions: 'Park in the driveway. The front door will be unlocked.',
      pets_present: true,
      pets_details: 'One friendly dog will be in the back room.',
    },
    request: signingRequest(),
  });
  assert.equal(signed.status, 'signed');

  const stored = f.db.raw
    .prepare('SELECT customer_fields_json FROM signing_requests WHERE id = ?')
    .get(String(request.requestId)) as { customer_fields_json: string };
  assert.match(stored.customer_fields_json, /customer_present/);
  assert.match(stored.customer_fields_json, /Park in the driveway/);
  const executed = await getExecutedCopy(f.db, String(request.requestId));
  assert.match(executed?.text ?? '', /CUSTOMER INSTRUCTIONS AND ACCESS SCHEDULE/);
  assert.match(executed?.text ?? '', /Access method: I will be present/);
  assert.match(executed?.text ?? '', /Access and parking instructions: Park in the driveway/);
  assert.match(executed?.text ?? '', /Pets: Yes/);
  assert.match(executed?.text ?? '', /Signature: Synthetic Customer/);
});

test('draft templates can be edited, duplicated and restored without changing approved content', async () => {
  const f = await fixture();
  const draft = await createTemplate(f.db, f.owner.id, {
    title: 'Editable Draft', category: 'residential', version: '1.0', contentText: 'Original draft text.',
  });
  await updateDraftTemplate(f.db, f.owner.id, draft.id, {
    title: 'Editable Draft', category: 'residential', version: '1.0',
    contentText: 'Updated draft text for {{customer.first_name}}.', legalReviewStatus: 'owner_review_required',
  });
  const updated = await getTemplate(f.db, draft.id);
  assert.equal(updated?.content_text, 'Updated draft text for {{customer.first_name}}.');
  assert.equal(updated?.legal_review_status, 'owner_review_required');
  await approveTemplate(f.db, f.owner.id, draft.id);
  await assert.rejects(
    () => updateDraftTemplate(f.db, f.owner.id, draft.id, { title: 'Changed', contentText: 'Changed.' }),
    /template_not_editable/,
  );
  const copy = await duplicateTemplate(f.db, f.owner.id, draft.id, { title: 'Editable Draft', version: '1.1' });
  const copied = await getTemplate(f.db, copy.id);
  assert.equal(copied?.status, 'draft');
  assert.equal(copied?.version, '1.1');
  assert.match(String(copied?.content_text), /Updated draft text/);
  await retireTemplate(f.db, f.owner.id, draft.id);
  assert.equal((await getTemplate(f.db, draft.id))?.status, 'retired');
  await restoreTemplate(f.db, f.owner.id, draft.id);
  assert.equal((await getTemplate(f.db, draft.id))?.status, 'draft');
  const history = await templateHistory(f.db, draft.id);
  assert.ok(history.some((entry) => entry.action === 'documents.template_restored'));
  assert.ok(history.some((entry) => entry.action === 'documents.template_draft_updated'));
});

test('a reusable packet can be duplicated with its documents and archived without deleting history', async () => {
  const f = await fixture();
  const t1 = await approvedTemplate(f.db, f.owner.id, 'Packet Document One');
  const bundle = await createBundle(f.db, f.owner.id, {
    code: 'packet.copy_source', name: 'Copy source packet', subjectType: 'customer', instructions: 'Original instructions.',
  });
  await addBundleItem(f.db, f.owner.id, {
    bundleId: bundle.id, templateId: t1, sortOrder: 2, required: true, enforcementStage: 'before_confirmation',
  });
  const copy = await duplicateBundle(f.db, f.owner.id, bundle.id, { name: 'Copied packet' });
  const copiedBundle = f.db.raw.prepare('SELECT * FROM document_bundles WHERE id = ?').get(copy.id) as Record<string, unknown>;
  assert.equal(copiedBundle.name, 'Copied packet');
  assert.match(String(copiedBundle.code), /^packet\.copy_source\.copy/);
  assert.equal(copiedBundle.instructions, 'Original instructions.');
  const copiedItems = f.db.raw.prepare('SELECT template_id, sort_order FROM document_bundle_items WHERE bundle_id = ?').all(copy.id) as Array<Record<string, unknown>>;
  assert.deepEqual(copiedItems.map((item) => ({ templateId: item.template_id, order: item.sort_order })), [{ templateId: t1, order: 2 }]);
  const { updateBundle } = await import('../src/lib/documents/service.ts');
  await updateBundle(f.db, f.owner.id, copy.id, { status: 'inactive' });
  assert.equal((f.db.raw.prepare('SELECT status FROM document_bundles WHERE id = ?').get(copy.id) as { status: string }).status, 'inactive');
  assert.equal((f.db.raw.prepare('SELECT COUNT(*) AS n FROM document_bundle_items WHERE bundle_id = ?').get(copy.id) as { n: number }).n, 1);
});

test('required customer agreements are enforced before payment even when stored as before_confirmation', async () => {
  const f = await fixture();
  const templateId = await approvedTemplate(f.db, f.owner.id, 'Residential Booking Agreement');
  const bundle = await createBundle(f.db, f.owner.id, {
    code: 'customer.residential',
    name: 'Residential documents',
    serviceCategory: 'residential',
    subjectType: 'customer',
  });
  await addBundleItem(f.db, f.owner.id, {
    bundleId: bundle.id,
    templateId,
    required: true,
    enforcementStage: 'before_confirmation',
  });
  const context = {
    subjectType: 'customer' as const,
    customerId: f.customerId,
    propertyId: f.propertyId,
    serviceCode: 'residential-cleaning',
    frequency: 'one_time',
    bookingReference: 'SS-BEFORE-PAYMENT-1',
  };
  const requirements = await activeRequirements(f.db, context);
  assert.equal(requirements.requirements[0]?.stage, 'before_payment');
  const blocked = await evaluateDocumentGate(f.db, context, 'before_payment');
  assert.equal(blocked.satisfied, false);
  assert.deepEqual(blocked.missing.map((item) => item.templateId), [templateId]);
});

test('a per-booking signature cannot satisfy a different booking and only a matching request is reusable', async () => {
  const f = await fixture();
  const templateId = await approvedTemplate(f.db, f.owner.id, 'Booking-Specific Scope');
  const bundle = await createBundle(f.db, f.owner.id, {
    code: 'customer.deep',
    name: 'Deep cleaning documents',
    serviceCategory: 'deep',
    subjectType: 'customer',
  });
  await addBundleItem(f.db, f.owner.id, {
    bundleId: bundle.id,
    templateId,
    required: true,
    enforcementStage: 'before_payment',
    perBooking: true,
  });
  const firstBooking = {
    subjectType: 'customer' as const,
    customerId: f.customerId,
    propertyId: f.propertyId,
    serviceCode: 'deep-cleaning',
    bookingReference: 'SS-BOOKING-A',
  };
  const first = await createSigningRequest(f.db, firstBooking, { createdByAdminUserId: f.owner.id });
  await signSigningRequest(f.db, first.token!, {
    signerName: 'Synthetic Customer',
    signerEmail: 'customer@example.test',
    consent: true,
    signatures: { [templateId]: { value: 'Synthetic Customer' } },
    request: signingRequest(),
  });
  assert.equal((await evaluateDocumentGate(f.db, firstBooking, 'before_payment')).satisfied, true);

  const secondBooking = { ...firstBooking, bookingReference: 'SS-BOOKING-B' };
  const secondGate = await evaluateDocumentGate(f.db, secondBooking, 'before_payment');
  assert.equal(secondGate.satisfied, false);
  assert.equal(await findReusableSigningRequest(f.db, secondBooking, secondGate), null);

  const second = await createSigningRequest(f.db, secondBooking, { createdByAdminUserId: f.owner.id });
  const secondGateAfterCreation = await evaluateDocumentGate(f.db, secondBooking, 'before_payment');
  const reusable = await findReusableSigningRequest(f.db, secondBooking, secondGateAfterCreation);
  assert.equal(reusable?.id, second.requestId);

  const stale = await createSigningRequest(f.db, firstBooking, { createdByAdminUserId: f.owner.id });
  const firstGate = await evaluateDocumentGate(f.db, firstBooking, 'before_payment');
  const reusableFirst = await findReusableSigningRequest(f.db, firstBooking, firstGate);
  assert.equal(reusableFirst?.id, stale.requestId);
});

test('document revisions surface owner review, affected packets and a re-signing queue', async () => {
  const f = await fixture();
  const old = await createTemplate(f.db, f.owner.id, {
    title: 'Revision Test Agreement',
    category: 'residential',
    version: '1.0',
    contentText: 'Original agreement for {{customer.legal_name}}.',
    familyKey: 'revision-test',
  });
  await approveTemplate(f.db, f.owner.id, old.id);
  const bundle = await createBundle(f.db, f.owner.id, {
    code: 'customer.residential',
    name: 'Residential documents',
    serviceCategory: 'residential',
    subjectType: 'customer',
  });
  await addBundleItem(f.db, f.owner.id, {
    bundleId: bundle.id,
    templateId: old.id,
    required: true,
    enforcementStage: 'before_payment',
    perBooking: true,
  });
  const context = {
    subjectType: 'customer' as const,
    customerId: f.customerId,
    propertyId: f.propertyId,
    serviceCode: 'residential-cleaning',
    bookingReference: 'SS-REVISION-1',
  };
  const request = await createSigningRequest(f.db, context, { createdByAdminUserId: f.owner.id });
  await signSigningRequest(f.db, request.token!, {
    signerName: 'Synthetic Customer',
    signerEmail: 'customer@example.test',
    consent: true,
    signatures: { [old.id]: { value: 'Synthetic Customer' } },
    request: signingRequest(),
  });

  const revision = await createTemplate(f.db, f.owner.id, {
    title: 'Revision Test Agreement',
    category: 'residential',
    version: '1.1',
    contentText: 'Revised agreement for {{customer.legal_name}}.',
    familyKey: 'revision-test',
    supersedesTemplateId: old.id,
  });
  await addBundleItem(f.db, f.owner.id, {
    bundleId: bundle.id,
    templateId: revision.id,
    required: true,
    enforcementStage: 'before_payment',
    perBooking: true,
  });
  const pending = await listDocumentUpdates(f.db);
  const pendingUpdate = pending.find((entry) => entry.templateId === revision.id);
  assert.equal(pendingUpdate?.status, 'pending_approval');
  assert.equal(pendingUpdate?.affectedPackets.length, 1);
  assert.equal(pendingUpdate?.affectedCustomers.length, 1);
  assert.equal(pendingUpdate?.affectedCustomers[0]?.needsResigning, true);

  await approveTemplate(f.db, f.owner.id, revision.id);
  const review = (await listDocumentUpdates(f.db)).find((entry) => entry.templateId === revision.id);
  assert.equal(review?.status, 'owner_review_required');

  await acknowledgeDocumentUpdate(f.db, f.owner.id, revision.id, {
    materialChange: true,
    note: 'Synthetic material revision review.',
  });
  const material = (await listDocumentUpdates(f.db)).find((entry) => entry.templateId === revision.id);
  assert.equal(material?.status, 'resigning_recommended');
  assert.equal(material?.review.materialChange, true);
  assert.equal(material?.review.note, 'Synthetic material revision review.');
});
