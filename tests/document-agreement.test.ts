import './helpers/enable-signing.ts';
// Dynamic agreement variables, production PDF rendering, pre-payment document
// gate and checkout-resume intent. Synthetic records only; no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { FakeLedger } from './helpers/payment-fakes.ts';
import {
  buildBookingDocumentVariables,
  agreementScopeFor,
} from '../src/lib/documents/agreement-variables.ts';
import { buildExecutedAgreementPdf } from '../src/lib/documents/agreement-pdf.ts';
import {
  createSigningRequest,
  getExecutedAgreementPdf,
  sha256Hex,
  signSigningRequest,
} from '../src/lib/documents/service.ts';
import { readCheckoutIntent } from '../src/lib/documents/checkout-intent.ts';
import { documentGateForCheckout, onRequestPost } from '../functions/api/estimate-checkout.ts';

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

const FIELDS: Record<string, string> = {
  request_type: 'reservation_request',
  service_type: 'standard',
  frequency: 'one_time',
  condition: 'maintained',
  addons: 'Inside oven, Inside refrigerator',
  base_price: '240.00',
  extras_detail: 'Inside oven $20.00; Inside refrigerator $15.00',
  discount_label: 'Community Support',
  discount_amount: '27.50',
  tax_amount: '0.00',
  tax_note: 'Florida residential cleaning is not taxed in this jurisdiction.',
  first_visit_total: '260.00',
  ongoing_price_per_visit: '180.00',
  ongoing_frequency: 'biweekly',
  preferred_date: '2026-12-03',
  preferred_time: 'First Appointment (7:00–8:30 AM)',
  booking_slot_start: '2026-12-03T13:00:00.000Z',
  booking_slot_end: '2026-12-03T15:00:00.000Z',
  name: 'Synthetic Customer',
  email: 'customer@example.test',
  terms_accepted: 'yes',
  terms_version: '2026-10-28.terms.v2',
  quote_reference: 'SS-20261203-ABC123',
};

function sampleTemplate() {
  return [
    'CUSTOMER AGREEMENT',
    '',
    'This agreement is between Sparkling Standard LLC and {{customer.legal_name}} for {{property.address}}.',
    '',
    'SERVICE SCOPE',
    '{{service.scope}}',
    '',
    'ADDITIONS',
    '{{service.additions}}',
    '',
    'EXCLUSIONS',
    '{{service.exclusions}}',
    '',
    'DATE AND ARRIVAL',
    '{{service.date}} — {{service.arrival_window}}',
    '',
    'PRICE',
    '{{price.summary}}',
    '{{price.line_items}}',
    'Tax: {{price.tax}}',
    'Discount: {{price.discount}}',
    '',
    'PAYMENT',
    '{{payment.terms}}',
    '',
    'CANCELLATION',
    '{{cancellation.terms}}',
    '',
    'END-MARKER-2026-11-22',
  ].join('\n');
}

async function fixture() {
  const db = migratedDb();
  const ledger = new FakeLedger();
  const customerId = `cust_${randomUUID()}`;
  const propertyId = `prop_${randomUUID()}`;
  const requestId = `request_${randomUUID()}`;
  const holdId = `2026-12-03__${randomUUID()}`;
  const templateId = `tmpl_${randomUUID()}`;
  const bundleId = `bundle_${randomUUID()}`;
  const content = sampleTemplate();
  const quoteReference = FIELDS.quote_reference;
  db.raw
    .prepare(
      "INSERT INTO customers (id, primary_branch_id, first_name, last_name, status) VALUES (?, 'branch_pensacola', 'Synthetic', 'Customer', 'active')",
    )
    .run(customerId);
  db.raw
    .prepare(
      "INSERT INTO customer_contacts (id, customer_id, kind, value, normalized_value, is_primary) VALUES (?, ?, 'email', 'customer@example.test', 'customer@example.test', 1)",
    )
    .run(`cc_${randomUUID()}`, customerId);
  db.raw
    .prepare(
      "INSERT INTO properties (id, customer_id, branch_id, label, line1, city, state, postal_code, status) VALUES (?, ?, 'branch_pensacola', 'Home', '100 S Baylen St', 'Pensacola', 'FL', '32502', 'active')",
    )
    .run(propertyId, customerId);
  db.raw
    .prepare(
      `INSERT INTO booking_requests
       (id, hold_id, branch_id, customer_id, property_id, status, quote_reference, requested_date,
        start_at, end_at, duration_minutes, payload_json)
       VALUES (?, ?, 'branch_pensacola', ?, ?, 'pending', ?, '2026-12-03', ?, ?, 120, ?)`,
    )
    .run(
      requestId,
      holdId,
      customerId,
      propertyId,
      quoteReference,
      FIELDS.booking_slot_start,
      FIELDS.booking_slot_end,
      JSON.stringify(FIELDS),
    );
  db.raw
    .prepare(
      `INSERT INTO document_templates
       (id, title, category, version, status, source_kind, content_text, content_sha256, signer_party)
       VALUES (?, 'Synthetic Service Agreement', 'residential', '2026-11-22.1', 'approved', 'text', ?, ?, 'customer')`,
    )
    .run(templateId, content, await sha256Hex(content));
  db.raw
    .prepare(
      `INSERT INTO document_bundles
       (id, code, name, description, service_category, subject_type, status, version, is_system)
       VALUES (?, 'customer.residential', 'Residential agreement', '', 'residential', 'customer', 'active', 1, 0)`,
    )
    .run(bundleId);
  db.raw
    .prepare(
      `INSERT INTO document_bundle_items
       (bundle_id, template_id, sort_order, required, enforcement_stage)
       VALUES (?, ?, 0, 1, 'before_payment')`,
    )
    .run(bundleId, templateId);
  return { db, ledger, customerId, propertyId, requestId, holdId, templateId, quoteReference };
}

test('booking variables use the stored verified request and approved scope', () => {
  const variables = buildBookingDocumentVariables({
    fields: FIELDS,
    requestedDate: '2026-12-03',
    startAt: FIELDS.booking_slot_start,
    endAt: FIELDS.booking_slot_end,
  });
  assert.match(variables['price.summary'] ?? '', /260\.00/);
  assert.match(variables['price.line_items'] ?? '', /Inside oven/);
  assert.match(variables['price.line_items'] ?? '', /Discount \(Community Support\): -\$27\.50/);
  assert.match(variables['price.line_items'] ?? '', /Total due: \$260\.00/);
  assert.match(variables['price.line_items'] ?? '', /Ongoing visits \(biweekly\): \$180\.00 per visit/);
  assert.equal(variables['service.date'], '2026-12-03');
  assert.match(variables['service.arrival_window'] ?? '', /7:00|8:30|to/);
  assert.equal(variables['agreement.effective_date'], new Date().toISOString().slice(0, 10));
  assert.match(agreementScopeFor('standard', 'one_time'), /Full standard cleaning scope/);
  assert.match(agreementScopeFor('commercial_cleaning', 'weekly'), /signed scope of work/);
  assert.match(agreementScopeFor('church_cleaning', 'weekly'), /signed scope of work/);
  assert.match(agreementScopeFor('str_turnover'), /guest-ready/);
});

test('agreement PDF is a real multi-section PDF with signature evidence', () => {
  const pdf = buildExecutedAgreementPdf({
    requestId: 'signreq_test',
    bundleName: 'Residential agreement',
    bundleCode: 'customer.residential',
    bundleVersion: 1,
    bookingReference: 'SS-20261203-ABC123',
    serviceCode: 'standard',
    customerName: 'Synthetic Customer',
    propertyAddress: '100 S Baylen St, Pensacola, FL 32502',
    executedAt: '2026-12-01T12:00:00.000Z',
    signatures: [
      {
        title: 'Synthetic Service Agreement',
        version: '2026-11-22.1',
        templateId: 'tmpl_test',
        contentText: 'Line one.\n\nLine two with a long paragraph that should wrap across the page without losing any words or producing an invalid PDF stream.',
        contentSha256: 'a'.repeat(64),
        signerName: 'Synthetic Customer',
        signerEmail: 'customer@example.test',
        signedAt: '2026-12-01T12:00:00.000Z',
        typedSignature: 'Synthetic Customer',
        status: 'signed',
        consentVersion: '2026-11-01.esign-consent.v1',
      },
    ],
  });
  const raw = new TextDecoder('latin1').decode(pdf);
  assert.ok(raw.startsWith('%PDF-1.4'));
  assert.ok(raw.includes('/Count '));
  assert.ok(raw.includes('Executed Agreement and Signature Record'));
  assert.ok(raw.includes('Synthetic Customer'));
  assert.ok(raw.includes('Synthetic Service Agreement'));
  assert.ok(raw.trimEnd().endsWith('%%EOF'));
});

test('pre-payment gate resolves variables, stores a resume intent and unlocks after signature', async () => {
  const f = await fixture();
  const env = { DB: f.db, PAYMENT_LEDGER: f.ledger } as never;
  const gate = await documentGateForCheckout(env, {
    ...FIELDS,
    booking_hold_id: f.holdId,
  }, '/estimate/residential/');
  assert.equal(gate.satisfied, false);
  assert.ok(gate.signingUrl?.startsWith('/document-sign/?token='));
  assert.match(gate.signingUrl ?? '', /resume=/);

  const row = f.db.raw
    .prepare('SELECT * FROM signing_requests WHERE booking_reference = ? ORDER BY created_at DESC LIMIT 1')
    .get(f.quoteReference) as Record<string, unknown>;
  assert.ok(row);
  const snapshot = JSON.parse(String(row.requirement_snapshot_json)) as Array<{
    contentText: string;
    missingVariables?: string[];
  }>;
  assert.equal(snapshot.length, 1);
  const resolved = snapshot[0]?.contentText ?? '';
  assert.match(resolved, /Synthetic Customer/);
  assert.match(resolved, /100 S Baylen St, Pensacola, FL, 32502/);
  assert.match(resolved, /Full standard cleaning scope/);
  assert.match(resolved, /\$260\.00/);
  assert.match(resolved, /Inside oven/);
  assert.match(resolved, /END-MARKER-2026-11-22/);
  assert.doesNotMatch(resolved, /\{\{/);
  assert.equal(snapshot[0]?.missingVariables, undefined);

  const url = new URL(`https://example.test${gate.signingUrl}`);
  const resume = url.searchParams.get('resume') ?? '';
  const intent = await readCheckoutIntent(f.ledger, resume);
  assert.ok(intent);
  assert.equal(intent?.record.fields.quote_reference, f.quoteReference);
  assert.equal(intent?.record.fields.base_price, '240.00');

  const token = url.searchParams.get('token') ?? '';
  const signed = await signSigningRequest(f.db, token, {
    signerName: 'Synthetic Customer',
    signerEmail: 'customer@example.test',
    consent: true,
    signatures: { [f.templateId]: { value: 'Synthetic Customer' } },
    request: new Request('https://example.test/api/document-sign', {
      headers: { 'CF-Connecting-IP': '203.0.113.10', 'User-Agent': 'synthetic-test' },
    }),
  });
  assert.equal(signed.status, 'signed');

  const unlocked = await documentGateForCheckout(env, {
    ...FIELDS,
    booking_hold_id: f.holdId,
  }, '/estimate/residential/');
  assert.equal(unlocked.satisfied, true);

  const artifact = await getExecutedAgreementPdf(f.db, signed.requestId);
  assert.ok(artifact);
  const raw = new TextDecoder('latin1').decode(artifact?.pdf);
  assert.ok(raw.startsWith('%PDF-1.4'));
  assert.ok(raw.includes('Synthetic Customer'));
  assert.ok(raw.includes('END-MARKER-2026-11-22'), 'the executed PDF carries the complete signed text through the final clause');
  assert.ok(raw.includes('Signature: Synthetic Customer'));
  assert.ok(!raw.includes('Consent version:'));
  assert.ok(!/SHA-?256/i.test(raw));
  assert.equal(artifact?.sha256.length, 64);
  const stored = f.db.raw
    .prepare('SELECT signed_content_text, document_sha256, status FROM document_signatures WHERE signing_request_id = ?')
    .get(signed.requestId) as Record<string, unknown>;
  assert.equal(stored.status, 'signed');
  assert.equal(String(stored.document_sha256).length, 64, 'the backend retains the exact signed content hash');
  assert.ok(!raw.includes(String(stored.document_sha256)), 'the hash is not printed in the customer PDF');
  assert.match(String(stored.signed_content_text), /Full standard cleaning scope/);
  assert.equal(String(stored.document_sha256).length, 64);
});

test('draft or retired templates never create a gate', async () => {
  const f = await fixture();
  f.db.raw.prepare("UPDATE document_templates SET status = 'draft'").run();
  const env = { DB: f.db, PAYMENT_LEDGER: f.ledger } as never;
  const gate = await documentGateForCheckout(env, {
    ...FIELDS,
    booking_hold_id: f.holdId,
  });
  assert.equal(gate.satisfied, true);
});

test('createSigningRequest fails closed when a required variable is missing', async () => {
  const f = await fixture();
  const content = 'Agreement for {{customer.legal_name}} and {{signature.name}}.';
  const templateId = `tmpl_${randomUUID()}`;
  await f.db
    .prepare(
      `INSERT INTO document_templates
       (id, title, category, version, status, source_kind, content_text, content_sha256, signer_party)
       VALUES (?, 'Missing Price Agreement', 'residential', '1.0', 'approved', 'text', ?, ?, 'customer')`,
    )
    .bind(templateId, content, await sha256Hex(content))
    .run();
  await f.db
    .prepare(
      `INSERT INTO document_bundle_items (bundle_id, template_id, sort_order, required, enforcement_stage)
       SELECT id, ?, 1, 1, 'before_payment' FROM document_bundles WHERE code = 'customer.residential'`,
    )
    .bind(templateId)
    .run();
  // A template placeholder with no server-populated value must fail closed.
  await assert.rejects(
    () =>
      createSigningRequest(f.db, {
        subjectType: 'customer',
        customerId: f.customerId,
        propertyId: f.propertyId,
        bookingRequestId: f.requestId,
        bookingReference: f.quoteReference,
        serviceCode: 'standard',
      }),
    /document_variables_missing/,
  );
});

test('an invalid or expired resume token is rejected before any payment work', async () => {
  const f = await fixture();
  const env = {
    DB: f.db,
    PAYMENT_LEDGER: f.ledger,
  } as never;
  const response = await onRequestPost({
    request: new Request('https://example.test/api/estimate-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.44' },
      body: JSON.stringify({ resume_token: 'not-a-real-token' }),
    }),
    env,
  } as never);
  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as { error?: string }).error, 'resume_expired');
});

test('checkout intent expires after 60 minutes and cannot be resumed', async () => {
  const f = await fixture();
  const env = { DB: f.db, PAYMENT_LEDGER: f.ledger } as never;
  const gate = await documentGateForCheckout(env, {
    ...FIELDS,
    booking_hold_id: f.holdId,
  }, '/estimate/residential/');
  const url = new URL(`https://example.test${gate.signingUrl}`);
  const resume = url.searchParams.get('resume') ?? '';
  const intent = await readCheckoutIntent(f.ledger, resume);
  assert.ok(intent);
  assert.ok(intent?.record.expiresAt);
  const ttl = Date.parse(intent.record.expiresAt) - Date.parse(intent.record.createdAt);
  assert.ok(ttl >= 59 * 60_000 && ttl <= 61 * 60_000, 'intent lifetime is approximately 60 minutes');
  const key = [...f.ledger.values.keys()].find((entry) => entry.startsWith('documents/checkout-intents/'));
  assert.ok(key);
  const record = JSON.parse(String(f.ledger.values.get(key))) as Record<string, unknown>;
  record.expiresAt = '2020-01-01T00:00:00.000Z';
  f.ledger.values.set(String(key), JSON.stringify(record));
  assert.equal(await readCheckoutIntent(f.ledger, resume), null);
  const response = await onRequestPost({
    request: new Request('https://example.test/api/estimate-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.45' },
      body: JSON.stringify({ resume_token: resume }),
    }),
    env,
  } as never);
  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as { error?: string }).error, 'resume_expired');
});
