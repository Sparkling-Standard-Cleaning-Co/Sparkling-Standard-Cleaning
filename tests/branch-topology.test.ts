import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import {
  assertBookableBranch,
  effectiveBranch,
  effectiveBranches,
  resolveServiceBranch,
} from '../src/lib/branches/registry.ts';
import {
  BranchSettingsError,
  listBranchSettings,
  saveBranchSettings,
} from '../src/lib/branches/settings.ts';
import {
  createPricingDraft,
  getLatestDraft,
  getPublishedPricing,
  listPricingVersions,
  publishPricingVersion,
} from '../src/lib/pricing/store.ts';
import { requestPricingConfig } from '../src/lib/pricing/server.ts';
import { normalizePricingSnapshot } from '../src/lib/pricing/snapshot.ts';
import { setPathValue } from '../src/lib/pricing/catalog.ts';
import { onRequestGet as publicPricingGet } from '../functions/api/pricing.ts';
import { BRANCH_PENSACOLA, BRANCH_TAMPA } from '../src/config/branches.ts';
import { persistLeadSubmission } from '../src/lib/admin/lead-persistence.ts';

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

function freshDb(): TestD1 {
  const db = new TestD1();
  for (const file of [
    '0001_operational_foundation.sql',
    '0002_admin_security_and_seeds.sql',
    '0026_pricing_control.sql',
    '0040_branch_topology.sql',
  ]) {
    db.raw.exec(fs.readFileSync(path.join(process.cwd(), 'migrations', file), 'utf8'));
  }
  return db;
}

const actor = { id: 'admin_test_owner', email: 'owner@example.test' };

test('branch migration creates the two canonical branches and lifecycle gates', async () => {
  const db = freshDb();
  const rows = db.raw.prepare('SELECT id, lifecycle_status, public_slug, status FROM branches ORDER BY id').all() as Array<{
    id: string;
    lifecycle_status: string;
    public_slug: string;
    status: string;
  }>;
  assert.equal(
    JSON.stringify(rows),
    JSON.stringify([
      { id: BRANCH_PENSACOLA, lifecycle_status: 'live', public_slug: 'pensacola', status: 'active' },
      { id: BRANCH_TAMPA, lifecycle_status: 'setup', public_slug: 'tampa-bay', status: 'inactive' },
    ]),
  );
  const columns = db.raw.prepare('PRAGMA table_info(pricing_versions)').all().map((column) => column.name);
  assert.ok(columns.includes('branch_id'));
  const indexes = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='pricing_versions'").all().map((row) => row.name);
  assert.ok(indexes.includes('idx_pricing_one_published_per_branch'));
  assert.equal(indexes.includes('idx_pricing_one_published'), false);
});

test('pricing versions are isolated per branch and Tampa cannot serve public pricing', async () => {
  const db = freshDb();
  const snapshot = normalizePricingSnapshot({}).snapshot;
  setPathValue(snapshot, 'owner.hourlyRates.ownerLaborTarget', 41.25);
  const draft = await createPricingDraft(db, { branchId: BRANCH_TAMPA, snapshot, note: 'Tampa draft test', actor });
  assert.equal(draft.branchId, BRANCH_TAMPA);
  assert.equal(await getPublishedPricing(db, BRANCH_PENSACOLA), null);
  assert.equal(await getPublishedPricing(db, BRANCH_TAMPA), null);
  assert.equal((await getLatestDraft(db, BRANCH_TAMPA))?.id, draft.id);
  assert.equal(await getLatestDraft(db, BRANCH_PENSACOLA), null);
  await publishPricingVersion(db, { id: draft.id, branchId: BRANCH_TAMPA, actor });

  const pensacolaDraft = await createPricingDraft(db, { branchId: BRANCH_PENSACOLA, note: 'Pensacola test', actor });
  const published = await publishPricingVersion(db, { id: pensacolaDraft.id, branchId: BRANCH_PENSACOLA, actor });
  assert.equal(published.branchId, BRANCH_PENSACOLA);
  assert.equal((await getPublishedPricing(db, BRANCH_PENSACOLA))?.id, published.id);
  assert.equal((await getPublishedPricing(db, BRANCH_TAMPA))?.branchId, BRANCH_TAMPA);
  assert.equal((await listPricingVersions(db, BRANCH_TAMPA)).length, 1);
  assert.equal((await requestPricingConfig(db, BRANCH_TAMPA)).laborEconomics.ownerLaborTargetPerHour.value, 41.25);

  const publicResponse = await publicPricingGet({
    request: new Request(`https://sparkling-standard.com/api/pricing?branch=${BRANCH_TAMPA}`),
    env: { DB: db },
  });
  assert.equal(publicResponse.status, 404);
});

test('service branch resolution is server-owned and Tampa is not bookable', async () => {
  const db = freshDb();
  const fromZip = await resolveServiceBranch(db, { zip: '32503', state: 'FL' });
  assert.equal(fromZip.id, BRANCH_PENSACOLA);
  assert.equal(fromZip.bookable, true);
  const requestedTampa = await resolveServiceBranch(db, { requestedBranchId: BRANCH_TAMPA, zip: '33602', state: 'FL' });
  assert.equal(requestedTampa.id, BRANCH_TAMPA);
  assert.equal(requestedTampa.bookable, false);
  await assert.rejects(() => assertBookableBranch(db, BRANCH_TAMPA), /branch_not_bookable/);
  const branches = await effectiveBranches(db);
  assert.equal(branches.length, 2);
  assert.equal((await effectiveBranch(db, 'branch_unknown')), null);
});

test('branch setup cannot go live without launch prerequisites and preserves versions', async () => {
  const db = freshDb();
  const loaded = await listBranchSettings(db);
  assert.equal(loaded.length, 2);
  const tampa = loaded.find((branch) => branch.id === BRANCH_TAMPA);
  assert.ok(tampa);
  await assert.rejects(
    () =>
      saveBranchSettings(db, actor, BRANCH_TAMPA, {
        ...tampa,
        publicName: 'Tampa Bay',
        publicSlug: 'tampa-bay',
        lifecycle: 'live',
        publicPhone: '(813) 555-0100',
        publicEmail: 'owner@sparkling-standard.com',
        serviceAreaZips: [],
      }),
    (error: unknown) => error instanceof BranchSettingsError && error.code === 'launch_service_area_required',
  );

  const saved = await saveBranchSettings(db, actor, BRANCH_TAMPA, {
    ...tampa,
    publicName: 'Tampa Bay',
    publicSlug: 'tampa-bay',
    lifecycle: 'setup',
    publicPhone: '(813) 555-0100',
    publicEmail: 'owner@sparkling-standard.com',
    serviceAreaZips: ['33602', '33606'],
    serviceStates: ['FL'],
    services: { ...tampa.services, commercial: 'request_only' },
  });
  assert.equal(saved.lifecycle, 'setup');
  assert.deepEqual(saved.serviceAreaZips, ['33602', '33606']);
  const versions = db.raw.prepare('SELECT status, count(*) AS count FROM branch_config_versions WHERE branch_id = ? GROUP BY status').all(BRANCH_TAMPA);
  assert.equal(JSON.stringify(versions), JSON.stringify([{ status: 'published', count: 1 }]));
  await assert.rejects(
    () =>
      saveBranchSettings(db, actor, BRANCH_PENSACOLA, {
        ...loaded[0]!,
        publicSlug: 'tampa-bay',
      }),
    (error: unknown) => error instanceof BranchSettingsError && error.code === 'public_slug_in_use',
  );
});


test('a Tampa inquiry is persisted to Tampa without creating a booking', async () => {
  const db = freshDb();
  const result = await persistLeadSubmission(db, {
    name: 'Tampa Test',
    email: 'tampa-test@example.test',
    phone: '8135550100',
    request_type: 'contact',
    inquiry_type: 'commercial_account',
    service_address: '100 Test Street',
    address_city: 'Tampa',
    address_state: 'FL',
    zip: '33602',
    branch_id: BRANCH_TAMPA,
  });
  assert.ok(result);
  const lead = db.raw.prepare('SELECT branch_id FROM leads WHERE id = ?').get(result!.leadId) as { branch_id: string };
  assert.equal(lead.branch_id, BRANCH_TAMPA);
  const customer = db.raw.prepare('SELECT primary_branch_id FROM customers WHERE id = ?').get(result!.customerId) as { primary_branch_id: string };
  assert.equal(customer.primary_branch_id, BRANCH_TAMPA);
  const property = db.raw.prepare('SELECT branch_id FROM properties WHERE id = ?').get(result!.propertyId) as { branch_id: string };
  assert.equal(property.branch_id, BRANCH_TAMPA);
  const requests = db.raw.prepare('SELECT COUNT(*) AS count FROM booking_requests').get() as { count: number };
  assert.equal(requests.count, 0, 'Tampa inquiry creates no booking request');
  const tampa = await effectiveBranch(db, BRANCH_TAMPA);
  assert.equal(tampa?.capabilities.inquiries, true);
  assert.equal(tampa?.capabilities.publicEstimates, false);
  assert.equal(tampa?.capabilities.fulfillmentVerified, false);
});
