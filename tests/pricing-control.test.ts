import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import {
  activatePricingConfig,
  buildPricingConfig,
  pricing,
  resetActivePricing,
} from '../src/config/pricing.ts';
import { PRICING_CONFIG_VERSION } from '../src/config/estimators/pricing-version.ts';
import { calculateEstimate, type EstimateContext } from '../src/lib/estimate/calculate.ts';
import { calculateFacilityPrice, calculateFacilityWorkload } from '../src/lib/estimate/commercial.ts';
import {
  getPathValue,
  pricingCatalog,
  setPathValue,
} from '../src/lib/pricing/catalog.ts';
import {
  normalizePricingSnapshot,
  pricingSnapshotVersion,
  sourcePricingSnapshot,
  snapshotSummary,
} from '../src/lib/pricing/snapshot.ts';
import {
  createPricingDraft,
  discardPricingDraft,
  getLatestDraft,
  getPublishedPricing,
  listPricingVersions,
  publishPricingVersion,
  rollbackPricingVersion,
  updatePricingDraft,
} from '../src/lib/pricing/store.ts';
import { requestPricingConfig } from '../src/lib/pricing/server.ts';
import { simulatePricing } from '../src/lib/pricing/simulate.ts';
import { onRequestGet as publicPricingGet } from '../functions/api/pricing.ts';
import { onRequestGet as adminPricingGet } from '../functions/api/admin/pricing.ts';

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
  async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.raw.exec('BEGIN');
    try {
      const results: D1Result<T>[] = [];
      for (const statement of statements) results.push((await statement.run()) as D1Result<T>);
      this.raw.exec('COMMIT');
      return results;
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    }
  }
}

function migratedDb(): TestD1 {
  const db = new TestD1();
  db.raw.exec('PRAGMA foreign_keys = ON');
  const migration = fs.readFileSync(path.join(process.cwd(), 'migrations', '0026_pricing_control.sql'), 'utf8');
  db.raw.exec(migration);
  return db;
}

const actor = { id: 'admin_test_owner', email: 'owner@example.test' };

const baseTravel = {
  includedOneWayMiles: 17.5,
  mpg: 24,
  wearPerMile: 0.12,
  referenceGasPrice: 3.1,
  zoneAdjustments: { core: 0, surrounding: 15 },
  maxInstantDistanceMiles: 45,
  maxDrivingMinutes: 60,
  reviewBandMinutes: 15,
};

function context(miles: number | null = 10, config = buildPricingConfig(sourcePricingSnapshot().owner, sourcePricingSnapshot().travel)): EstimateContext {
  return {
    pricingConfig: config,
    travel: {
      ...baseTravel,
      ...(miles
        ? {
            routed: {
              oneWayMiles: miles,
              durationMinutes: 25,
              gasPrice: null,
              gasPriceSource: 'configured_reference' as const,
              provider: 'test',
              method: 'straight_line_estimate' as const,
              verified: false,
            },
          }
        : {}),
    },
  };
}

const residential = {
  serviceType: 'standard' as const,
  propertyType: 'house' as const,
  squareFeet: 1600,
  bedrooms: 3,
  fullBaths: 2,
  halfBaths: 1,
  frequency: 'one_time' as const,
  condition: 'maintained' as const,
  lastClean: 'within_month' as const,
  addonIds: ['inside_fridge'],
  zip: '32533',
  pets: 'none' as const,
};

function priced(result: ReturnType<typeof calculateEstimate>) {
  return {
    status: result.status,
    low: result.low,
    high: result.high,
    expectedPrice: result.expectedPrice,
    laborHours: result.laborHours,
    ongoing: result.ongoing?.perVisitPrice ?? null,
    subtotal: result.pricing.subtotal,
    basePrice: result.pricing.basePrice,
    extras: result.pricing.extrasSubtotal,
    travel: result.pricing.travelAdjustment,
    discount: result.pricing.discount?.amount ?? null,
    global: result.pricing.globalAdjustment,
  };
}

test('golden master: the source configuration reproduces the pre-control prices for all four engines', () => {
  const source = sourcePricingSnapshot();
  const config = buildPricingConfig(source.owner, source.travel);

  assert.deepEqual(priced(calculateEstimate(residential, context(10, config))), {
    status: 'estimated',
    low: 280,
    high: 340,
    expectedPrice: 305,
    laborHours: 5.66,
    ongoing: null,
    subtotal: 305,
    basePrice: 283.8,
    extras: 23.38,
    travel: 0,
    discount: null,
    global: 0,
  });

  const recurring = priced(calculateEstimate({ ...residential, frequency: 'weekly' }, context(10, config)));
  assert.equal(recurring.expectedPrice, 370);
  assert.equal(recurring.ongoing, 280);
  assert.equal(Math.round(recurring.laborHours * 1000) / 1000, 6.86);

  const deep = priced(
    calculateEstimate(
      { ...residential, serviceType: 'deep', frequency: 'one_time', condition: 'needs_attention' },
      context(10, config),
    ),
  );
  assert.equal(deep.expectedPrice, 460);
  assert.equal(Math.round(deep.laborHours * 1000) / 1000, 8.45);

  const str = priced(
    calculateEstimate(
      {
        serviceType: 'str_turnover',
        propertyType: 'condo',
        squareFeet: 1200,
        bedrooms: 2,
        fullBaths: 2,
        halfBaths: 0,
        beds: 3,
        frequency: 'one_time',
        condition: 'average',
        lastClean: 'within_month',
        addonIds: ['bed_linen_change'],
        zip: '32533',
        pets: 'none',
      },
      context(10, config),
    ),
  );
  assert.equal(str.expectedPrice, 230);
  assert.equal(Math.round(str.laborHours * 1000) / 1000, 4.206);

  const travel = priced(calculateEstimate({ ...residential, addonIds: [] }, context(30, config)));
  assert.equal(travel.expectedPrice, 290);
  assert.equal(travel.travel, 6.23);

  const office = calculateFacilityWorkload(
    {
      cleanableSqft: 2500,
      restroomFixtures: 6,
      breakroom: true,
      facilityType: 'office',
      condition: 'average',
      traffic: 'average',
      flooring: 'mixed',
      firstClean: false,
      specialty: false,
    },
    config,
  );
  const officePrice = calculateFacilityPrice(office, 'weekly', { oneWayMiles: 10, pricingConfig: config });
  assert.deepEqual(
    { labor: office.laborHours, tier: office.tier, cleaning: officePrice.cleaningSubtotal, total: officePrice.total, range: officePrice.range },
    { labor: 1.87, tier: 'A', cleaning: 125, total: 125, range: null },
  );

  const church = calculateFacilityWorkload(
    {
      cleanableSqft: 4000,
      restroomFixtures: 8,
      breakroom: true,
      facilityType: 'church',
      condition: 'average',
      traffic: 'average',
      flooring: 'mixed',
      firstClean: true,
      specialty: false,
    },
    config,
  );
  const churchPrice = calculateFacilityPrice(church, 'weekly', { oneWayMiles: 10, church: true, pricingConfig: config });
  assert.deepEqual(
    {
      labor: church.laborHours,
      tier: church.tier,
      cleaning: churchPrice.cleaningSubtotal,
      perVisit: churchPrice.perVisit,
      total: churchPrice.total,
      discount: churchPrice.discount?.amount,
    },
    { labor: 3.6, tier: 'B', cleaning: 220, perVisit: 198, total: 198, discount: 22 },
  );
});

test('source baseline rebuild is byte-equivalent and keeps the existing configuration fingerprint', () => {
  const source = sourcePricingSnapshot();
  const normalized = normalizePricingSnapshot(source, { strict: true });
  assert.equal(normalized.ok, true);
  assert.deepEqual(normalized.snapshot, source);
  assert.equal(pricingSnapshotVersion(source), PRICING_CONFIG_VERSION);
  assert.equal(snapshotSummary(source).changedValues, 0);
  assert.equal(pricing.instantQuote.configVersion.value, PRICING_CONFIG_VERSION);
  assert.ok(pricingCatalog.length > 60);
});

test('activation changes the live pricing binding and reset restores it', () => {
  const before = pricing.minimumJob.value;
  const changed = sourcePricingSnapshot();
  changed.owner.minimumJob = 175;
  try {
    activatePricingConfig(changed.owner, changed.travel);
    assert.equal(pricing.minimumJob.value, 175);
    const quote = calculateEstimate({ ...residential, addonIds: [] }, context(null));
    assert.equal(quote.status, 'estimated');
    assert.ok((quote.expectedPrice ?? 0) >= 175);
  } finally {
    resetActivePricing();
  }
  assert.equal(pricing.minimumJob.value, before);
});

test('catalog paths resolve against the baseline and unknown keys are ignored', () => {
  const source = sourcePricingSnapshot();
  for (const entry of pricingCatalog) {
    const value = getPathValue(source, entry.path);
    if (entry.allowNull && value === undefined) continue;
    assert.notEqual(value, undefined, entry.path);
    assert.ok(entry.label.length > 0, entry.path);
    assert.ok(entry.description.length > 0, entry.path);
    assert.ok(entry.example.length > 0, entry.path);
  }
  const normalized = normalizePricingSnapshot(
    { owner: { minimumJob: 150, unknownNested: { value: 1 } }, travel: { mpg: 22, unknown: true } },
    { strict: true },
  );
  assert.equal(normalized.ok, true);
  assert.equal(normalized.snapshot.owner.minimumJob, 150);
  assert.equal(normalized.snapshot.travel.mpg, 22);
  assert.equal(getPathValue(normalized.snapshot, 'owner.unknownNested'), undefined);
});

test('pricing validation rejects invalid values, mandates dependency order and preserves structural identity', () => {
  const invalid = normalizePricingSnapshot(
    { owner: { minimumJob: -5, estimatorCalibration: { residential: 2 } }, travel: { mpg: 0 } },
    { strict: true },
  );
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.length >= 3);

  const dependency = normalizePricingSnapshot(
    { owner: { hourlyRates: { ownerLaborTarget: 80, otherServices: 55, recurring: 55 } } },
    { strict: true },
  );
  assert.equal(dependency.ok, false);
  assert.ok(dependency.errors.some((error) => error.includes('owner labor target')));

  const tampered = sourcePricingSnapshot();
  tampered.owner.addons[0]!.label = 'Tampered add-on';
  tampered.owner.promotions.campaign.code = 'FREE99';
  tampered.owner.promotions.campaign.legacy = [];
  const normalized = normalizePricingSnapshot(tampered, { strict: true });
  assert.equal(normalized.ok, true);
  assert.equal(normalized.snapshot.owner.addons[0]!.label, 'Inside refrigerator');
  assert.equal(normalized.snapshot.owner.promotions.campaign.code, 'SPARKLE15');
  assert.ok((normalized.snapshot.owner.promotions.campaign.legacy ?? []).length > 0);

  const nullFixed = sourcePricingSnapshot();
  setPathValue(nullFixed, 'owner.addons.0.fixedPriceUsd', null);
  const withNull = normalizePricingSnapshot(nullFixed, { strict: true });
  assert.equal(withNull.ok, true);
  assert.equal(withNull.snapshot.owner.addons[0]!.fixedPriceUsd, null);
});

test('draft lifecycle publishes atomically, archives the prior version, and rolls back by appending history', async () => {
  const db = migratedDb();
  assert.equal(await getPublishedPricing(db), null);

  const draft = await createPricingDraft(db, { note: 'first draft', actor });
  assert.equal(draft.version, 1);
  assert.equal(draft.status, 'draft');

  const edited = sourcePricingSnapshot();
  edited.owner.minimumJob = 150;
  const saved = await updatePricingDraft(db, {
    id: draft.id,
    snapshot: edited,
    note: 'raise minimum',
    expectedUpdatedAt: draft.updatedAt,
    actor,
  });
  assert.equal(saved.snapshot.owner.minimumJob, 150);

  await assert.rejects(
    () =>
      updatePricingDraft(db, {
        id: draft.id,
        snapshot: edited,
        expectedUpdatedAt: 'stale-timestamp',
        actor,
      }),
    (error: unknown) => (error as { code?: string }).code === 'pricing_draft_conflict',
  );

  const published = await publishPricingVersion(db, { id: draft.id, actor });
  assert.equal(published.status, 'published');
  assert.equal(published.snapshot.owner.minimumJob, 150);
  assert.equal((await getPublishedPricing(db))?.id, draft.id);
  assert.equal(await getLatestDraft(db), null);

  const second = await createPricingDraft(db, { note: 'second', actor });
  assert.equal(second.version, 2);
  const secondSnapshot = sourcePricingSnapshot();
  secondSnapshot.owner.minimumJob = 175;
  await updatePricingDraft(db, {
    id: second.id,
    snapshot: secondSnapshot,
    expectedUpdatedAt: second.updatedAt,
    actor,
  });
  const secondPublished = await publishPricingVersion(db, { id: second.id, actor });
  assert.equal(secondPublished.snapshot.owner.minimumJob, 175);

  const restored = await rollbackPricingVersion(db, { id: published.id, actor });
  assert.equal(restored.status, 'published');
  assert.equal(restored.version, 3);
  assert.equal(restored.snapshot.owner.minimumJob, 150);
  assert.equal(restored.basedOnVersion, 1);

  const history = await listPricingVersions(db);
  assert.equal(history.length, 3);
  assert.equal(history.filter((version) => version.status === 'published').length, 1);
  assert.equal(history.filter((version) => version.status === 'archived').length, 2);

  const disposable = await createPricingDraft(db, { note: 'discard me', actor });
  await discardPricingDraft(db, { id: disposable.id, actor });
  assert.equal((await listPricingVersions(db)).some((version) => version.id === disposable.id), false);
});

test('a published version is used by the server request configuration', async () => {
  const db = migratedDb();
  const draft = await createPricingDraft(db, { actor });
  const snapshot = sourcePricingSnapshot();
  snapshot.owner.minimumJob = 155;
  const saved = await updatePricingDraft(db, { id: draft.id, snapshot, expectedUpdatedAt: draft.updatedAt, actor });
  const published = await publishPricingVersion(db, { id: saved.id, actor });

  const config = await requestPricingConfig(db);
  assert.equal(config.minimumJob.value, 155);
  assert.equal(config.instantQuote.configVersion.value, published.fingerprint);

  const sourceConfig = await requestPricingConfig(null);
  assert.equal(sourceConfig.minimumJob.value, sourcePricingSnapshot().owner.minimumJob);
});

test('the public pricing endpoint returns the source baseline and then the published snapshot', async () => {
  const db = migratedDb();
  const empty = await publicPricingGet({ request: new Request('https://example.test/api/pricing'), env: { DB: db } });
  assert.equal(empty.status, 200);
  const emptyBody = (await empty.json()) as { ok: boolean; source: boolean; snapshot: { owner: { minimumJob: number } } };
  assert.equal(emptyBody.ok, true);
  assert.equal(emptyBody.source, true);
  assert.equal(emptyBody.snapshot.owner.minimumJob, sourcePricingSnapshot().owner.minimumJob);

  const draft = await createPricingDraft(db, { actor });
  const snapshot = sourcePricingSnapshot();
  snapshot.owner.minimumJob = 160;
  const saved = await updatePricingDraft(db, { id: draft.id, snapshot, expectedUpdatedAt: draft.updatedAt, actor });
  await publishPricingVersion(db, { id: saved.id, actor });

  const response = await publicPricingGet({ request: new Request('https://example.test/api/pricing'), env: { DB: db } });
  const body = (await response.json()) as { ok: boolean; source: boolean; version: number; snapshot: { owner: { minimumJob: number } } };
  assert.equal(body.ok, true);
  assert.equal(body.source, false);
  assert.equal(body.version, 1);
  assert.equal(body.snapshot.owner.minimumJob, 160);
});

test('pricing administration is unavailable without an authenticated owner session', async () => {
  const db = migratedDb();
  const response = await adminPricingGet({
    request: new Request('https://example.test/api/admin/pricing'),
    env: { DB: db },
  });
  assert.equal(response.status, 401);
});

test('simulator compares published and draft using the same engine and reports the price effect', () => {
  const source = sourcePricingSnapshot();
  const draft = sourcePricingSnapshot();
  draft.owner.baseLaborHours.standard += 0.5;

  const comparison = simulatePricing(source, draft, {
    engine: 'residential',
    residential: { ...residential, addonIds: [] },
  });
  assert.equal(comparison.published.status, 'priced');
  assert.equal(comparison.draft.status, 'priced');
  assert.ok((comparison.draft.total ?? 0) > (comparison.published.total ?? 0));
  assert.ok((comparison.differenceUsd ?? 0) > 0);
  assert.ok((comparison.laborHoursDifference ?? 0) > 0);

  const same = simulatePricing(source, source, {
    engine: 'residential',
    residential: { ...residential, addonIds: [] },
  });
  assert.equal(same.differenceUsd, 0);

  const facility = simulatePricing(source, draft, {
    engine: 'commercial',
    facility: { cleanableSqft: 2500, restroomFixtures: 6, breakroom: true, facilityType: 'office' },
  });
  assert.equal(facility.published.status, 'priced');
  assert.equal(facility.draft.status, 'priced');
  assert.equal(facility.differenceUsd, 0);
});

test('simulator supports all four engines and rejects incomplete inputs safely', () => {
  const source = sourcePricingSnapshot();
  for (const engine of ['residential', 'str', 'commercial', 'church'] as const) {
    const comparison = simulatePricing(source, source, {
      engine,
      ...(engine === 'commercial' || engine === 'church'
        ? { facility: { cleanableSqft: 2500, restroomFixtures: 6, facilityType: engine === 'church' ? 'church' : 'office' } }
        : { residential: { ...residential, ...(engine === 'str' ? { serviceType: 'str_turnover' as const, frequency: 'one_time' as const } : {}) } }),
    });
    assert.ok(['priced', 'custom_confirmation_required', 'invalid', 'pricing_disabled'].includes(comparison.published.status), engine);
  }

  const invalid = simulatePricing(source, source, {
    engine: 'residential',
    residential: { serviceType: 'standard', zip: '' },
  });
  assert.equal(invalid.published.status, 'invalid');
});
