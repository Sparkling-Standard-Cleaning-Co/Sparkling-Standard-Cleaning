import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { checkPublicRateLimit, consumePublicRateLimit } from '../src/lib/public-rate-limit.ts';

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

const policy = { limit: 2, windowSeconds: 60, blockSeconds: 120 };

test('a durable public rate limit blocks the third request in a fixed window', async () => {
  const db = migratedDb();
  const now = new Date('2026-11-03T12:00:00.000Z');
  assert.equal((await consumePublicRateLimit(db, 'lead', '203.0.113.10', policy, now)).limited, false);
  assert.equal((await consumePublicRateLimit(db, 'lead', '203.0.113.10', policy, now)).limited, false);
  const blocked = await consumePublicRateLimit(db, 'lead', '203.0.113.10', policy, now);
  assert.equal(blocked.limited, true);
  const status = await checkPublicRateLimit(db, 'lead', '203.0.113.10', policy, now);
  assert.equal(status.limited, true);
  const later = new Date(now.getTime() + 121_000);
  const expired = await checkPublicRateLimit(db, 'lead', '203.0.113.10', policy, later);
  assert.equal(expired.limited, false);
});

test('different identifiers do not share a bucket and a missing database fails open', async () => {
  const db = migratedDb();
  const now = new Date('2026-11-03T12:00:00.000Z');
  await consumePublicRateLimit(db, 'lead', '203.0.113.20', policy, now);
  await consumePublicRateLimit(db, 'lead', '203.0.113.20', policy, now);
  assert.equal((await checkPublicRateLimit(db, 'lead', '203.0.113.21', policy, now)).limited, false);
  assert.equal((await checkPublicRateLimit(null, 'lead', '203.0.113.20', policy, now)).limited, false);
  assert.equal((await consumePublicRateLimit(null, 'lead', '203.0.113.20', policy, now)).limited, false);
});
