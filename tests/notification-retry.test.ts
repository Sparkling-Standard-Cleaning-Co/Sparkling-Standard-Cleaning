import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import type { AdminActor } from '../src/lib/admin/operations.ts';
import {
  listNotificationRetries,
  retryNotification,
  sendOperationalNotification,
} from '../src/lib/admin/communications.ts';

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

const owner: AdminActor = {
  id: 'admin_owner',
  email: 'owner@sparkling-standard.com',
  name: 'Owner',
  role: 'owner',
  branchId: null,
  csrf: '',
  permissions: [],
  mfaEnabled: true,
};

function database(): TestD1 {
  const db = new TestD1();
  db.raw.exec('PRAGMA foreign_keys = ON');
  for (const file of fs.readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
    db.raw.exec(fs.readFileSync(path.join('migrations', file), 'utf8'));
  }
  db.raw.prepare(
    "INSERT INTO admin_users (id, role_id, email, password_hash, display_name, status) VALUES ('admin_owner', 'owner', 'owner@sparkling-standard.com', 'synthetic', 'Owner', 'active')",
  ).run();
  return db;
}

test('a provider failure queues the exact notice and an owner retry records acceptance', async () => {
  const db = database();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('network_unavailable');
  }) as typeof fetch;
  try {
    const first = await sendOperationalNotification(db, { RESEND_API_KEY: 're_synthetic' }, {
      eventKey: 'owner_escalation',
      subject: 'Critical test notice',
      text: 'Please review the failed operational notice.',
      idempotencyKey: 'retry-test-1',
      relatedType: 'test',
      relatedId: 'test_retry',
    });
    assert.equal(first.failed, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const rows = await listNotificationRetries(db);
  assert.ok(rows.length >= 2);
  assert.equal(rows[0]!.status, 'pending');
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ id: 'email_retry' }), { status: 200 })) as typeof fetch;
  try {
    const retried = await retryNotification(db, owner, { RESEND_API_KEY: 're_synthetic' }, String(rows[0]!.id));
    assert.equal(retried.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const after = await listNotificationRetries(db);
  const sent = after.find((row) => row.id === rows[0]!.id);
  assert.equal(sent?.status, 'sent');
  assert.equal(Number(sent?.attempts), 1);
});
