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
import {
  activeRequirements,
  addBundleItem,
  approveTemplate,
  createBundle,
  createSigningRequest,
  createTemplate,
  employeeOnboardingStatus,
  evaluateDocumentGate,
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
