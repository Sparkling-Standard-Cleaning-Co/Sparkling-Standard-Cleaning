import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { enrollOwner, type AdminActor } from '../src/lib/admin/operations.ts';
import { countLeads, listLeads } from '../src/lib/admin/crm.ts';

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

test('the active lead scope excludes archived, lost and converted records', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'owner-leads@example.test',
    name: 'Lead Owner',
    password: 'SyntheticOwner!2026',
  });
  const actor: AdminActor = {
    id: owner.id,
    email: owner.email,
    name: owner.name,
    role: 'owner',
    branchId: null,
    csrf: 'test-csrf',
    permissions: ['*'],
    mfaEnabled: false,
  };
  const insert = db.raw.prepare(
    `INSERT INTO leads (id, branch_id, request_type, status, source, payload_json, created_at, updated_at)
     VALUES (?, 'branch_pensacola', 'estimate_request', ?, 'website', '{}', ?, ?)`,
  );
  const statuses = ['new', 'contacted', 'quoted', 'converted', 'lost', 'archived'];
  statuses.forEach((status, index) => {
    const stamp = `2026-11-20T12:0${index}:00.000Z`;
    insert.run(`lead_${status}`, status, stamp, stamp);
  });

  const active = await listLeads(db, actor, { status: 'active', limit: 50 });
  assert.deepEqual(
    active.map((row) => row.status).sort(),
    ['contacted', 'new', 'quoted'],
  );
  assert.equal(await countLeads(db, actor, { status: 'active' }), 3);

  const all = await listLeads(db, actor, { status: '', limit: 50 });
  assert.equal(all.length, 6);
  assert.equal(await countLeads(db, actor, { status: '' }), 6);

  const archived = await listLeads(db, actor, { status: 'archived', limit: 50 });
  assert.deepEqual(archived.map((row) => row.id), ['lead_archived']);
});
