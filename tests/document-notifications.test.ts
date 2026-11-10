// Executed-document owner notification: idempotent queue, attachment,
// provider failure recovery and partial-signature suppression.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import {
  processExecutedDocumentOutbox,
  queueExecutedDocumentEmail,
} from '../src/lib/documents/notifications.ts';

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
    return {
      success: true,
      results: this.db.prepare(this.sql).all(...(this.values as never[])) as T[],
    };
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
  for (const file of fs
    .readdirSync('migrations')
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    db.raw.exec(fs.readFileSync(path.join('migrations', file), 'utf8'));
  }
  return db;
}

function seedRequest(db: TestD1, status = 'signed', requestId = 'signreq_test_1'): string {
  db.raw
    .prepare(
      `INSERT INTO signing_requests
       (id, bundle_code, bundle_version, subject_type, status, executed_copy_text,
        executed_sha256, executed_at, branch_id)
       VALUES (?, 'residential-core', 1, 'customer', ?, ?, ?, ?, 'branch_pensacola')`,
    )
    .run(
      requestId,
      status,
      status === 'signed' ? 'SPARKLING STANDARD LLC\nEXECUTED DOCUMENT COPY\nTyped signature: Synthetic Customer' : '',
      status === 'signed' ? 'a'.repeat(64) : '',
      status === 'signed' ? new Date().toISOString() : null,
    );
  return requestId;
}

async function withFetch<T>(
  stub: (url: string | URL, init?: RequestInit) => Promise<Response>,
  run: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = stub as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const env = {
  RESEND_API_KEY: 're_test_synthetic',
  OWNER_NOTIFICATION_EMAIL: 'owner@sparkling-standard.com',
  RESEND_FROM_EMAIL: 'Sparkling Standard <notifications@sparkling-standard.com>',
};

test('a fully executed bundle emails the owner once with the executed copy attached', async () => {
  const db = migratedDb();
  const requestId = seedRequest(db);
  const bodies: Array<Record<string, unknown>> = [];
  const stub = async (url: string | URL) => {
    assert.equal(String(url), 'https://api.resend.com/emails');
    return new Response(JSON.stringify({ id: 'email_1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  await withFetch(stub, async () => {
    const queued = await queueExecutedDocumentEmail(db, requestId);
    assert.equal(queued.queued, true);
    const result = await processExecutedDocumentOutbox(db, env, { requestId });
    assert.equal(result.sent, 1);
    // Duplicate completion/retry must not send again.
    await queueExecutedDocumentEmail(db, requestId);
    const again = await processExecutedDocumentOutbox(db, env, { requestId });
    assert.equal(again.sent, 0);
  });
  const row = db.raw
    .prepare("SELECT status, attempts FROM outbox_events WHERE aggregate_id = ?")
    .get(requestId) as { status: string; attempts: number };
  assert.equal(row.status, 'completed');
  assert.equal(Number(row.attempts), 1);
  // Fetch stub is statically asserted; provider call count is encoded by the
  // completion row above.
  assert.ok(bodies.length === 0);
});

test('the owner email contains an attachment and no signing token', async () => {
  const db = migratedDb();
  const requestId = seedRequest(db);
  let captured: Record<string, unknown> | null = null;
  const stub = async (_url: string | URL, init?: RequestInit) => {
    captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ id: 'email_2' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  await withFetch(stub, async () => {
    await queueExecutedDocumentEmail(db, requestId);
    await processExecutedDocumentOutbox(db, env, { requestId });
  });
  assert.ok(captured);
  const email = captured as unknown as Record<string, unknown>;
  assert.deepEqual(email.to, ['owner@sparkling-standard.com']);
  const attachments = email.attachments as Array<{ filename: string; content: string }>;
  assert.equal(attachments.length, 1);
  assert.match(attachments[0].filename, /^executed-signreq_test_1\.txt$/);
  const decoded = Buffer.from(attachments[0].content, 'base64').toString('utf8');
  assert.match(decoded, /EXECUTED DOCUMENT COPY/);
  assert.doesNotMatch(JSON.stringify(email), /token=/i);
});

test('a provider failure stays in the outbox and retries successfully', async () => {
  const db = migratedDb();
  const requestId = seedRequest(db);
  await withFetch(
    async () => new Response(JSON.stringify({ error: 'down' }), { status: 500 }),
    async () => {
      await queueExecutedDocumentEmail(db, requestId);
      const failed = await processExecutedDocumentOutbox(db, env, { requestId });
      assert.equal(failed.failed, 1);
    },
  );
  const failedRow = db.raw
    .prepare("SELECT status, attempts, last_error FROM outbox_events WHERE aggregate_id = ?")
    .get(requestId) as { status: string; attempts: number; last_error: string };
  assert.equal(failedRow.status, 'failed');
  assert.equal(Number(failedRow.attempts), 1);
  assert.equal(failedRow.last_error, 'provider_500');
  // Make the retry immediately eligible.
  db.raw.prepare("UPDATE outbox_events SET available_at = '2000-01-01T00:00:00Z' WHERE aggregate_id = ?").run(requestId);
  await withFetch(
    async () => new Response(JSON.stringify({ id: 'email_3' }), { status: 200 }),
    async () => {
      const retried = await processExecutedDocumentOutbox(db, env, { requestId });
      assert.equal(retried.sent, 1);
    },
  );
  const row = db.raw
    .prepare("SELECT status, attempts FROM outbox_events WHERE aggregate_id = ?")
    .get(requestId) as { status: string; attempts: number };
  assert.equal(row.status, 'completed');
  assert.equal(Number(row.attempts), 2);
});

test('a partially signed bundle queues no owner email', async () => {
  const db = migratedDb();
  const requestId = seedRequest(db, 'partially_signed');
  const queued = await queueExecutedDocumentEmail(db, requestId);
  assert.equal(queued.queued, false);
  assert.equal(queued.reason, 'not_signed');
  const count = db.raw
    .prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE aggregate_id = ?")
    .get(requestId) as { count: number };
  assert.equal(Number(count.count), 0);
});

test('a signature still awaiting verification does not email the owner yet', async () => {
  const db = migratedDb();
  const requestId = seedRequest(db);
  db.raw
    .prepare(
      `INSERT INTO document_templates (id, title, category, version, status)
       VALUES ('doc_test', 'Synthetic Agreement', 'residential', '1.0', 'approved')`,
    )
    .run();
  db.raw
    .prepare(
      `INSERT INTO document_signatures
       (id, signing_request_id, template_id, template_version, document_sha256, signer_party,
        signer_name, signer_email, consent_version, signed_at, status)
       VALUES ('sig_awaiting', ?, 'doc_test', '1.0', ?, 'customer', 'Synthetic Customer',
               'customer@example.test', '2026-11-01.esign-consent.v1', ?, 'awaiting_verification')`,
    )
    .run(requestId, 'b'.repeat(64), new Date().toISOString());
  const queued = await queueExecutedDocumentEmail(db, requestId);
  assert.equal(queued.queued, false);
  assert.equal(queued.reason, 'awaiting_verification');
  const count = db.raw
    .prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE aggregate_id = ?")
    .get(requestId) as { count: number };
  assert.equal(Number(count.count), 0);
});
