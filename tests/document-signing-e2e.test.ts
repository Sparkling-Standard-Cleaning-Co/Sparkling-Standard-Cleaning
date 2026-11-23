import './helpers/enable-signing.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { enrollOwner } from '../src/lib/admin/operations.ts';
import {
  addBundleItem,
  approveTemplate,
  createBundle,
  createSigningRequest,
  createTemplate,
  getExecutedCopy,
} from '../src/lib/documents/service.ts';
import {
  hashPortalToken,
  portalSnapshot,
  type PortalSession,
} from '../src/lib/portal/service.ts';
import { onRequestGet as documentSignGet, onRequestPost as documentSignPost } from '../functions/api/document-sign.ts';
import { onRequestGet as portalDocumentGet } from '../functions/api/portal/document.ts';

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

function fakeDocumentsBucket() {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async put(key: string, value: Uint8Array) {
      objects.set(key, value);
    },
    async get(key: string) {
      const value = objects.get(key);
      if (!value) return null;
      return {
        arrayBuffer: async () => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
        httpMetadata: { contentType: 'application/pdf' },
      };
    },
  };
}

function request(url: string, init: RequestInit = {}): Request {
  return new Request(url, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      'CF-Connecting-IP': '203.0.113.50',
      'User-Agent': 'synthetic-signing-e2e',
    },
  });
}

test('single-signature signing persists access fields, produces a PDF and retrieves the history in the portal', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'owner-signing-e2e@example.test',
    name: 'Synthetic Owner',
    password: 'SyntheticOwner!2026',
  });
  const customerId = `cust_${crypto.randomUUID()}`;
  const propertyId = `prop_${crypto.randomUUID()}`;
  db.raw
    .prepare("INSERT INTO customers (id, primary_branch_id, first_name, last_name, company_name, status) VALUES (?, 'branch_pensacola', 'Jordan', 'Example', 'Example Household', 'active')")
    .run(customerId);
  db.raw
    .prepare("INSERT INTO customer_contacts (id, customer_id, kind, value, normalized_value, is_primary) VALUES ('ct_signing_e2e', ?, 'email', 'jordan.example@example.test', 'jordan.example@example.test', 1)")
    .run(customerId);
  db.raw
    .prepare("INSERT INTO properties (id, customer_id, branch_id, label, line1, city, state, postal_code, status) VALUES (?, ?, 'branch_pensacola', 'Home', '100 Example Street', 'Pensacola', 'FL', '32502', 'active')")
    .run(propertyId, customerId);

  const templateOne = await createTemplate(db, owner.id, {
    title: 'Residential Access Authorization',
    category: 'residential',
    version: '2026-11-22',
    contentText: 'ACCESS AUTHORIZATION\n\nProperty: {{property.address}}\nCustomer: {{customer.legal_name}}',
  });
  await approveTemplate(db, owner.id, templateOne.id);
  const templateTwo = await createTemplate(db, owner.id, {
    title: 'Residential Deep Cleaning Agreement',
    category: 'residential',
    version: '2026-11-22',
    contentText: 'DEEP CLEANING AGREEMENT\n\nCustomer: {{customer.legal_name}}\nProperty: {{property.address}}',
  });
  await approveTemplate(db, owner.id, templateTwo.id);
  const bundle = await createBundle(db, owner.id, {
    code: 'customer.deep',
    name: 'Residential Deep Cleaning Packet',
    serviceCategory: 'residential',
    subjectType: 'customer',
    purpose: 'customer',
    packetType: 'deep',
    instructions: 'Review every document before signing.',
  });
  for (const [index, template] of [templateOne, templateTwo].entries()) {
    await addBundleItem(db, owner.id, {
      bundleId: bundle.id,
      templateId: template.id,
      sortOrder: index,
      required: true,
      enforcementStage: 'before_payment',
    });
  }

  const context = {
    subjectType: 'customer' as const,
    customerId,
    propertyId,
    serviceCode: 'residential-deep',
    frequency: 'one_time',
    bookingReference: 'SS-20261205-E2E',
  };
  const created = await createSigningRequest(db, context, {
    createdByAdminUserId: owner.id,
    bundleId: bundle.id,
  });
  assert.equal(created.required, true);
  assert.ok(created.token);

  const bucket = fakeDocumentsBucket();
  const env = { DB: db, DOCUMENTS_BUCKET: bucket } as never;
  const post = await documentSignPost({
    request: request('https://example.test/api/document-sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: created.token,
        signerName: 'Jordan Example',
        signerEmail: 'jordan.example@example.test',
        consent: true,
        signatures: {
          [templateOne.id]: { value: 'Jordan Example', type: 'typed' },
          [templateTwo.id]: { value: 'Jordan Example', type: 'typed' },
        },
        customerFields: {
          access_method: 'customer_present',
          access_instructions: 'Park in the driveway. The front door will be unlocked.',
          pets_present: true,
          pets_details: 'One friendly dog will be in the back room.',
          restricted_areas: 'Do not enter the upstairs office.',
        },
      }),
    }),
    env,
  });
  const posted = (await post.json()) as {
    ok?: boolean;
    status?: string;
    executedPdf?: string | false;
    error?: string;
  };
  assert.equal(post.status, 200, JSON.stringify(posted));
  assert.equal(posted.ok, true);
  assert.equal(posted.status, 'signed');
  assert.match(String(posted.executedPdf), /^documents\/executed\//);

  const stored = db.raw
    .prepare('SELECT customer_fields_json, executed_sha256, executed_copy_text FROM signing_requests WHERE id = ?')
    .get(String(created.requestId)) as { customer_fields_json: string; executed_sha256: string; executed_copy_text: string };
  assert.match(stored.customer_fields_json, /customer_present/);
  assert.match(stored.customer_fields_json, /Park in the driveway/);
  assert.match(stored.executed_copy_text, /CUSTOMER INSTRUCTIONS AND ACCESS SCHEDULE/);
  assert.match(stored.executed_copy_text, /Access method: I will be present/);
  assert.match(stored.executed_copy_text, /Pets: Yes/);
  assert.match(stored.executed_copy_text, /Signature method: typed electronic signature/);
  assert.equal(stored.executed_sha256.length, 64);

  const executed = await getExecutedCopy(db, String(created.requestId));
  assert.ok(executed);
  assert.equal(executed.sha256, stored.executed_sha256);

  const get = await documentSignGet({
    request: request(`https://example.test/api/document-sign?token=${encodeURIComponent(created.token!)}`),
    env,
  });
  const loaded = (await get.json()) as {
    ok?: boolean;
    context?: Record<string, string>;
    customerFields?: { values?: Record<string, string> };
    documents?: Array<{ signed: boolean }>;
    executedDownloadUrl?: string;
    error?: string;
  };
  assert.equal(get.status, 200, JSON.stringify(loaded));
  assert.equal(loaded.ok, true);
  assert.equal(loaded.context?.customerName, 'Example Household');
  assert.equal(loaded.context?.propertyAddress, '100 Example Street, Pensacola, FL, 32502');
  assert.equal(loaded.customerFields?.values?.access_method, 'customer_present');
  assert.ok((loaded.documents ?? []).every((document) => document.signed));
  assert.match(loaded.executedDownloadUrl ?? '', /download=executed/);

  const download = await documentSignGet({
    request: request(`https://example.test/api/document-sign?token=${encodeURIComponent(created.token!)}&download=executed`),
    env,
  });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('Content-Type'), 'application/pdf');
  const pdfBytes = new Uint8Array(await download.arrayBuffer());
  assert.ok(pdfBytes.byteLength > 1000);
  assert.equal(new TextDecoder('latin1').decode(pdfBytes.slice(0, 5)), '%PDF-');
  const pdfText = new TextDecoder('latin1').decode(pdfBytes);
  assert.match(pdfText, /Customer Instructions and Access Schedule/);
  assert.match(pdfText, /Access method/);
  const executedRow = db.raw
    .prepare('SELECT r2_key FROM document_signatures WHERE signing_request_id = ? LIMIT 1')
    .get(String(created.requestId)) as { r2_key: string };
  assert.ok(executedRow.r2_key);

  const portalToken = 'portal-e2e-token';
  const tokenHash = await hashPortalToken(portalToken);
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  db.raw
    .prepare(
      `INSERT INTO customer_portal_sessions
       (id, customer_id, token_hash, csrf_token, verified_email, expires_at, last_seen_at)
       VALUES ('psess_signing_e2e', ?, ?, 'csrf-portal', 'jordan.example@example.test', ?, ?)`,
    )
    .run(customerId, tokenHash, expiresAt, new Date().toISOString());

  const portalSession: PortalSession = {
    sessionId: 'psess_signing_e2e',
    customerId,
    csrf: 'csrf-portal',
    email: 'jordan.example@example.test',
    name: 'Jordan Example',
  };
  const snapshot = await portalSnapshot(db, portalSession);
  const documents = snapshot.documents as {
    executed: Array<Record<string, unknown>>;
  };
  assert.equal(documents.executed.length, 1);
  assert.equal(documents.executed[0]?.id, created.requestId);
  assert.match(String(documents.executed[0]?.packet_name ?? ''), /Residential Deep Cleaning Packet/);

  const portalDownload = await portalDocumentGet({
    request: request(
      `https://example.test/api/portal/document?kind=executed&id=${encodeURIComponent(String(created.requestId))}`,
      { headers: { Cookie: `__Host-ss_portal=${portalToken}` } },
    ),
    env: env as never,
  });
  assert.equal(portalDownload.status, 200);
  assert.equal(portalDownload.headers.get('X-Executed-SHA256'), stored.executed_sha256);
  const portalText = await portalDownload.text();
  assert.match(portalText, /CUSTOMER INSTRUCTIONS AND ACCESS SCHEDULE/);
  assert.match(portalText, /Type my name|typed electronic signature/i);
  const audit = db.raw
    .prepare("SELECT COUNT(*) AS n FROM customer_portal_audit WHERE customer_id = ? AND action = 'portal.document_downloaded'")
    .get(customerId) as { n: number };
  assert.equal(Number(audit.n), 1);
});
