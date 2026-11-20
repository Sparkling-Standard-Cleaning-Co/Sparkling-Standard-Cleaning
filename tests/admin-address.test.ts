import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { createOpsSession, enrollOwner } from '../src/lib/admin/operations.ts';
import { onRequestPost as addressPost } from '../functions/api/admin/address-autocomplete.ts';

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

function request(body: Record<string, unknown>, cookie: string, csrf: string): Request {
  return new Request('https://example.test/api/admin/address-autocomplete', {
    method: 'POST',
    headers: { Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('admin autocomplete uses Google Places, applies branch bias and never returns the key', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'owner-address@example.test', name: 'Synthetic Owner', password: 'SyntheticOwner!2026',
  });
  const session = await createOpsSession(db, owner.id, new Request('https://example.test/'));
  const cookie = `ss_ops=${session.token}`;
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('places:autocomplete')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      calls.push({ url, body });
      return new Response(JSON.stringify({
        suggestions: [
          {
            placePrediction: {
              placeId: 'place_123',
              text: { text: '1000 Bayou Blvd, Pensacola, FL 32503, USA' },
              structuredFormat: { mainText: { text: '1000 Bayou Blvd' }, secondaryText: { text: 'Pensacola, FL 32503, USA' } },
            },
          },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  try {
    const response = await addressPost({
      request: request({ action: 'suggest', query: '1000 Bayou', branchId: 'branch_tampa' }, cookie, session.csrf),
      env: { DB: db, GOOGLE_MAPS_SERVER_API_KEY: 'synthetic-key' } as never,
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      ok: boolean; provider: string; suggestions: Array<Record<string, unknown>>; attribution: string;
    };
    assert.equal(payload.ok, true);
    assert.equal(payload.provider, 'google');
    assert.equal(payload.attribution, 'Google');
    assert.equal(payload.suggestions.length, 1);
    assert.equal(payload.suggestions[0]?.id, 'place_123');
    assert.equal(payload.suggestions[0]?.mainText, '1000 Bayou Blvd');
    assert.equal(JSON.stringify(payload).includes('synthetic-key'), false);
    assert.equal(calls.length, 1);
    assert.deepEqual((calls[0]?.body.locationBias as Record<string, any>).circle.center, { latitude: 27.9506, longitude: -82.4572 });
    assert.deepEqual(calls[0]?.body.includedPrimaryTypes, ['street_address', 'premise', 'subpremise', 'route']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a manager cannot widen address suggestions to another branch', async () => {
  const db = migratedDb();
  const managerHash = 'unused';
  db.raw.prepare(
    `INSERT INTO admin_users (id, role_id, branch_id, email, password_hash, display_name, status)
     VALUES ('manager_address', 'manager', 'branch_pensacola', 'manager-address@example.test', ?, 'Manager', 'active')`,
  ).run(managerHash);
  const session = await createOpsSession(db, 'manager_address', new Request('https://example.test/'));
  const originalFetch = globalThis.fetch;
  let bias: Record<string, number> | null = null;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, any>;
    bias = body.locationBias?.circle?.center ?? null;
    return new Response(JSON.stringify({ suggestions: [] }), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await addressPost({
      request: request(
        { action: 'suggest', query: '1000 Bayou', branchId: 'branch_tampa' },
        `ss_ops=${session.token}`,
        session.csrf,
      ),
      env: { DB: db, GOOGLE_MAPS_SERVER_API_KEY: 'synthetic-key' } as never,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(bias, { latitude: 30.4213, longitude: -87.2169 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('place details populate street, unit, city, county, state, ZIP and coordinates', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'owner-details@example.test', name: 'Synthetic Owner', password: 'SyntheticOwner!2026',
  });
  const session = await createOpsSession(db, owner.id, new Request('https://example.test/'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    id: 'place_123',
    formattedAddress: '1000 Bayou Blvd Apt 4, Pensacola, FL 32503, USA',
    addressComponents: [
      { longText: '1000', shortText: '1000', types: ['street_number'] },
      { longText: 'Bayou Boulevard', shortText: 'Bayou Blvd', types: ['route'] },
      { longText: 'Apt 4', shortText: 'Apt 4', types: ['subpremise'] },
      { longText: 'Pensacola', shortText: 'Pensacola', types: ['locality'] },
      { longText: 'Escambia County', shortText: 'Escambia County', types: ['administrative_area_level_2'] },
      { longText: 'Florida', shortText: 'FL', types: ['administrative_area_level_1'] },
      { longText: '32503', shortText: '32503', types: ['postal_code'] },
    ],
    location: { latitude: 30.4213, longitude: -87.2169 },
  }), { status: 200 })) as typeof fetch;
  try {
    const response = await addressPost({
      request: request({ action: 'details', placeId: 'place_123' }, `ss_ops=${session.token}`, session.csrf),
      env: { DB: db, GOOGLE_MAPS_SERVER_API_KEY: 'synthetic-key' } as never,
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { ok: boolean; details: Record<string, unknown> };
    assert.equal(payload.ok, true);
    assert.equal(payload.details.line1, '1000 Bayou Boulevard');
    assert.equal(payload.details.unit, 'Apt 4');
    assert.equal(payload.details.city, 'Pensacola');
    assert.equal(payload.details.county, 'Escambia County');
    assert.equal(payload.details.state, 'FL');
    assert.equal(payload.details.postalCode, '32503');
    assert.equal(payload.details.latitude, 30.4213);
    assert.equal(payload.details.longitude, -87.2169);
    assert.equal(payload.details.precise, true);
    assert.equal(payload.details.supportedState, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('admin autocomplete fails closed without Google configuration or a valid place id', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'owner-fail@example.test', name: 'Synthetic Owner', password: 'SyntheticOwner!2026',
  });
  const session = await createOpsSession(db, owner.id, new Request('https://example.test/'));
  const cookie = `ss_ops=${session.token}`;
  const withoutKey = await addressPost({
    request: request({ action: 'suggest', query: '1000 Bayou' }, cookie, session.csrf),
    env: { DB: db } as never,
  });
  assert.equal(withoutKey.status, 503);
  const invalidPlace = await addressPost({
    request: request({ action: 'details', placeId: 'bad id!' }, cookie, session.csrf),
    env: { DB: db, GOOGLE_MAPS_SERVER_API_KEY: 'synthetic-key' } as never,
  });
  assert.equal(invalidPlace.status, 400);
});
