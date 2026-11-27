import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { createOpsSession, enrollOwner } from '../src/lib/admin/operations.ts';
import { onRequestGet as overviewGet } from '../functions/api/admin/overview.ts';
import { onRequestGet as requestsGet } from '../functions/api/admin/requests.ts';

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

test('overview excludes test inquiries, resolves only the matching checkout and keeps reservations visible', async () => {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'overview-metrics@example.test',
    name: 'Overview Owner',
    password: 'SyntheticOwner!2026',
  });
  const session = await createOpsSession(db, owner.id, new Request('https://example.test/api/admin/overview'));
  db.raw.prepare("INSERT INTO customers (id, primary_branch_id, first_name, last_name, status) VALUES ('cust_o','branch_pensacola','Overview','Customer','active')").run();
  db.raw.prepare("INSERT INTO properties (id, customer_id, branch_id, label, line1, city, state, postal_code, status) VALUES ('prop_o','cust_o','branch_pensacola','Home','1 Overview Way','Pensacola','FL','32502','active')").run();

  const lead = db.raw.prepare("INSERT INTO leads (id, branch_id, customer_id, request_type, status, quote_reference, payload_json, is_test, is_duplicate) VALUES (?, 'branch_pensacola', 'cust_o', ?, 'new', ?, '{}', ?, ?)");
  lead.run('lead_actionable', 'residential_estimate', 'SS-A', 0, 0);
  lead.run('lead_reservation', 'reservation_request', 'SS-R', 0, 0);
  lead.run('lead_test', 'residential_estimate', 'SS-T', 1, 0);
  lead.run('lead_duplicate', 'residential_estimate', 'SS-D', 0, 1);

  db.raw.prepare("INSERT INTO booking_requests (id, hold_id, branch_id, customer_id, status, quote_reference, requested_date, start_at, end_at, duration_minutes, payload_json) VALUES ('req_pending','hold_pending','branch_pensacola','cust_o','pending','SS-R','2026-12-10','2026-12-10T15:00:00.000Z','2026-12-10T18:00:00.000Z',180,'{}')").run();
  db.raw.prepare("INSERT INTO checkout_sessions (id, booking_hold_id, quote_reference, attempt, status, amount_cents, created_at, updated_at, expires_at) VALUES ('chk_old','hold_old','OLD',1,'failed',1000,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','2026-01-01T00:30:00.000Z')").run();
  db.raw.prepare("INSERT INTO checkout_sessions (id, booking_hold_id, quote_reference, attempt, status, amount_cents, created_at, updated_at, expires_at) VALUES ('chk_resolved','hold_resolved','RESOLVED',1,'failed',1000,'2026-01-02T00:00:00.000Z','2026-01-02T00:00:00.000Z','2026-01-02T00:30:00.000Z')").run();
  db.raw.prepare("INSERT INTO checkout_sessions (id, booking_hold_id, quote_reference, attempt, status, amount_cents, created_at, updated_at, expires_at) VALUES ('chk_success','hold_success','RESOLVED',2,'completed',1000,'2026-01-02T00:05:00.000Z','2026-01-02T00:05:00.000Z','2026-01-02T00:35:00.000Z')").run();
  db.raw.prepare("INSERT INTO payments (id, branch_id, customer_id, provider, status, amount_cents, currency, idempotency_key, received_at, created_at) VALUES ('pay_ok','branch_pensacola','cust_o','stripe','succeeded',1000,'USD','idem_pay_ok','2026-06-01T00:00:00.000Z','2026-06-01T00:00:00.000Z')").run();

  db.raw.prepare("INSERT INTO recurring_plans (id, customer_id, property_id, branch_id, frequency, status, start_date, duration_minutes, sync_status) VALUES ('rec_q','cust_o','prop_o','branch_pensacola','weekly','active','2026-01-01',120,'fully_scheduled')").run();
  db.raw.prepare("INSERT INTO recurring_worker_runs (id, run_key, status, started_at, finished_at, plans_scanned, plans_synced, errors, detail_json) VALUES ('run_q','2026-06-02','failed','2026-06-02T09:00:00.000Z','2026-06-02T09:01:00.000Z',1,0,1,?)")
    .run(JSON.stringify([{ planId: 'rec_q', status: 'partially_scheduled', conflicts: 1, conflictDetails: [{ date: '2026-06-09', reason: 'auth_failed' }] }]));

  const response = await overviewGet({
    request: new Request('https://example.test/api/admin/overview', {
      headers: { Cookie: `ss_ops=${session.token}` },
    }),
    env: { DB: db },
  } as never);
  assert.equal(response.status, 200);
  const data = (await response.json()) as { counts: Record<string, number>; alerts: Array<Record<string, unknown>> };
  assert.equal(data.counts.leads, 1);
  assert.equal(data.counts.requests, 1);
  assert.equal(data.counts.failedCheckouts, 1);
  assert.equal(data.counts.failedWorkerRuns, 0);
  assert.equal(data.alerts.some((alert) => alert.key === 'checkout.sessions'), true);
  assert.equal(data.alerts.some((alert) => alert.key === 'recurring.worker_failures'), false);

  const reservationResponse = await requestsGet({
    request: new Request('https://example.test/api/admin/requests?view=actionable', {
      headers: { Cookie: `ss_ops=${session.token}` },
    }),
    env: { DB: db },
  } as never);
  assert.equal(reservationResponse.status, 200);
  const reservationData = (await reservationResponse.json()) as { requests: Array<Record<string, unknown>> };
  assert.ok(reservationData.requests.some((request) => request.id === 'req_pending'));
});
