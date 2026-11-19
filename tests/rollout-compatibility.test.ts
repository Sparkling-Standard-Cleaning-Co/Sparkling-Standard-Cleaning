import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { enrollOwner } from '../src/lib/admin/operations.ts';
import { createCustomer, getCustomer } from '../src/lib/admin/crm.ts';
import {
  addBundleItem,
  approveTemplate,
  createBundle,
  createSigningRequest,
  createTemplate,
  evaluateDocumentGate,
  signSigningRequest,
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

function migratedTo(sqlite: DatabaseSync, last: string): void {
  sqlite.exec('PRAGMA foreign_keys = ON');
  const files = fs.readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort();
  for (const file of files) {
    sqlite.exec(fs.readFileSync(path.join('migrations', file), 'utf8'));
    if (file === last) break;
  }
}

test('the release stays functional before migrations 0038 and 0039 are applied', async () => {
  const db = new TestD1();
  migratedTo(db.raw, '0037_payment_receipts.sql');
  const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => String((row as { name: string }).name));
  assert.equal(tables.includes('quick_estimates'), false);
  const columns = db.raw.prepare('PRAGMA table_info(document_bundles)').all().map((row) => String((row as { name: string }).name));
  assert.equal(columns.includes('purpose'), false);

  const owner = await enrollOwner(db, {
    email: 'owner-rollout@example.test',
    name: 'Synthetic Owner',
    password: 'SyntheticOwner!2026',
  });
  const customer = await createCustomer(db, { id: owner.id, email: owner.email, name: owner.name, role: 'owner', branchId: null, csrf: '', permissions: [], mfaEnabled: false }, {
    firstName: 'Rollout', lastName: 'Customer', email: 'rollout@example.test',
    addressLine1: '1 Rollout Way', city: 'Pensacola', state: 'FL', postalCode: '32502',
  });
  const property = db.raw.prepare('SELECT id FROM properties WHERE customer_id = ? LIMIT 1').get(customer.id) as { id: string };

  const template = await createTemplate(db, owner.id, {
    title: 'Rollout Agreement', category: 'residential', version: '1.0',
    contentText: 'Rollout agreement for {{customer.first_name}}.',
    familyKey: 'rollout-agreement',
  });
  await approveTemplate(db, owner.id, template.id);
  const packet = await createBundle(db, owner.id, {
    code: 'customer.residential', name: 'Rollout packet', subjectType: 'customer',
    purpose: 'customer', packetType: 'residential_one_time', instructions: 'Rollout instructions.',
  });
  await addBundleItem(db, owner.id, {
    bundleId: packet.id, templateId: template.id, required: true, enforcementStage: 'before_confirmation',
  });
  const context = {
    subjectType: 'customer' as const,
    customerId: customer.id,
    propertyId: property.id,
    serviceCode: 'residential-cleaning',
    frequency: 'one_time',
    bookingReference: 'ROLLOUT-1',
  };
  const request = await createSigningRequest(db, context, { createdByAdminUserId: owner.id });
  assert.equal(request.required, true);
  await signSigningRequest(db, request.token!, {
    signerName: 'Rollout Customer',
    signerEmail: 'rollout@example.test',
    consent: true,
    signatures: { [template.id]: { value: 'Rollout Customer' } },
    request: new Request('https://example.test/api/document-sign', {
      method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.77', 'User-Agent': 'rollout-test' },
    }),
  });
  assert.equal((await evaluateDocumentGate(db, context, 'before_confirmation')).satisfied, true);

  const workspace = await getCustomer(db, { id: owner.id, email: owner.email, name: owner.name, role: 'owner', branchId: null, csrf: '', permissions: [], mfaEnabled: false }, customer.id);
  assert.ok(workspace);
  assert.deepEqual(workspace.quickEstimates, []);
  assert.equal((workspace.signingRequests as Array<Record<string, unknown>>).length, 1);
});
