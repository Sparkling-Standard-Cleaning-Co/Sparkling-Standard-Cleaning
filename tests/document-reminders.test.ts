import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import {
  processSigningReminders,
  readReminderSettings,
  saveReminderSettings,
} from '../src/lib/documents/reminders.ts';
import { SIGNING_TOKEN_TTL_MS } from '../src/lib/documents/service.ts';

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
  const directory = path.join(process.cwd(), 'migrations');
  for (const file of fs.readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) {
    db.raw.exec(fs.readFileSync(path.join(directory, file), 'utf8'));
  }
  db.raw.prepare(
    "INSERT INTO admin_users (id, role_id, email, password_hash, display_name, status) VALUES ('admin_owner', 'owner', 'owner@sparkling-standard.com', 'synthetic', 'Owner', 'active')",
  ).run();
  db.raw.prepare(
    "INSERT INTO customers (id, first_name, last_name, status) VALUES ('cust_doc', 'Jordan', 'Customer', 'active')",
  ).run();
  db.raw.prepare(
    "INSERT INTO customer_contacts (id, customer_id, kind, value, normalized_value, is_primary) VALUES ('contact_doc', 'cust_doc', 'email', 'client@example.test', 'client@example.test', 1)",
  ).run();
  return db;
}

function seedRequest(db: TestD1, input: { id: string; status: string; createdAt: string; expiresAt: string; tokenHash?: string }): void {
  db.raw.prepare(
    `INSERT INTO signing_requests
     (id, bundle_code, bundle_version, subject_type, customer_id, status, requirement_snapshot_json,
      token_hash, token_expires_at, signer_email, created_at, updated_at)
     VALUES (?, 'packet.residential', 1, 'customer', 'cust_doc', ?, '[]', ?, ?, 'client@example.test', ?, ?)`,
  ).run(input.id, input.status, input.tokenHash ?? `hash_${input.id}`, input.expiresAt, input.createdAt, input.createdAt);
}

test('the signing link lifetime is seven days', () => {
  assert.equal(SIGNING_TOKEN_TTL_MS, 7 * 24 * 60 * 60 * 1000);
});

test('reminders send once at 24h and once at 72h, then stop on completion', async () => {
  const db = migratedDb();
  const now = new Date('2026-11-20T12:00:00.000Z');
  const created = new Date(now.getTime() - 25 * 3_600_000).toISOString();
  const expires = new Date(now.getTime() + 3 * 86_400_000).toISOString();
  seedRequest(db, { id: 'sr_1', status: 'pending', createdAt: created, expiresAt: expires });
  const originalFetch = globalThis.fetch;
  const sent: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input, init) => {
    sent.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return new Response(JSON.stringify({ id: 'email_reminder' }), { status: 200 });
  }) as typeof fetch;
  try {
    const first = await processSigningReminders(db, { RESEND_API_KEY: 're_test' }, now);
    assert.equal(first.sent, 1);
    assert.equal(first.details[0]?.reminder, '24h');
    assert.equal(sent.length, 1);
    assert.equal(String(sent[0]?.to), 'client@example.test');

    const duplicate = await processSigningReminders(db, { RESEND_API_KEY: 're_test' }, now);
    assert.equal(duplicate.sent, 0);
    assert.equal(sent.length, 1);

    const later = new Date(now.getTime() + 48 * 3_600_000);
    const second = await processSigningReminders(db, { RESEND_API_KEY: 're_test' }, later);
    assert.equal(second.sent, 1);
    assert.equal(second.details[0]?.reminder, '72h');
    assert.equal(sent.length, 2);

    db.raw.prepare("UPDATE signing_requests SET status = 'signed' WHERE id = 'sr_1'").run();
    const completed = await processSigningReminders(db, { RESEND_API_KEY: 're_test' }, new Date(later.getTime() + 24 * 3_600_000));
    assert.equal(completed.sent, 0);
    const rows = db.raw.prepare('SELECT reminder_key, status FROM document_signing_reminders ORDER BY reminder_key').all() as Array<{ reminder_key: string; status: string }>;
    assert.deepEqual(rows.map((row) => row.reminder_key), ['24h', '72h']);
    assert.ok(rows.every((row) => row.status === 'sent'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an expired signing link is replaced only when a reminder can be delivered', async () => {
  const db = migratedDb();
  const now = new Date('2026-11-20T12:00:00.000Z');
  const created = new Date(now.getTime() - 25 * 3_600_000).toISOString();
  const expired = new Date(now.getTime() - 3_600_000).toISOString();
  seedRequest(db, { id: 'sr_expired', status: 'pending', createdAt: created, expiresAt: expired, tokenHash: 'original-hash' });
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response('{}', { status: 500 })) as typeof fetch;
    const failed = await processSigningReminders(db, {}, now);
    assert.equal(failed.failed, 1);
    const unchanged = db.raw.prepare("SELECT token_hash FROM signing_requests WHERE id = 'sr_expired'").get() as { token_hash: string };
    assert.equal(unchanged.token_hash, 'original-hash');

    db.raw.prepare("DELETE FROM document_signing_reminders").run();
    globalThis.fetch = (async () => new Response(JSON.stringify({ id: 'email' }), { status: 200 })) as typeof fetch;
    const delivered = await processSigningReminders(db, { RESEND_API_KEY: 're_test' }, now);
    assert.equal(delivered.sent, 1);
    const rotated = db.raw.prepare("SELECT token_hash, token_expires_at FROM signing_requests WHERE id = 'sr_expired'").get() as { token_hash: string; token_expires_at: string };
    assert.notEqual(rotated.token_hash, 'original-hash');
    assert.ok(new Date(rotated.token_expires_at).getTime() > now.getTime());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reminder settings are owner-bounded and can be disabled', async () => {
  const db = migratedDb();
  const settings = await saveReminderSettings(db, 'admin_owner', { enabled: false, firstHours: 2, secondHours: 1 });
  assert.equal(settings.enabled, false);
  assert.equal(settings.firstHours, 2);
  assert.equal(settings.secondHours, 3);
  assert.deepEqual(await readReminderSettings(db), settings);
  const result = await processSigningReminders(db, { RESEND_API_KEY: 're_test' });
  assert.equal(result.enabled, false);
  assert.equal(result.sent, 0);
});
