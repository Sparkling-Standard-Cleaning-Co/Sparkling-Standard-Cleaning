// Request-delivery regression tests:
//  - the runtime readiness contract used by every estimate/contact form;
//  - a complete submission through D1 persistence and the server-side owner
//    notification path, with the provider stubbed (no real email or network).
//
// These tests exist because the static build previously inferred delivery
// readiness from public build-time variables, which produced a false
// "request delivery is not connected" warning on the live production site.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { onRequestGet as leadGet, onRequestPost as leadPost } from '../functions/api/lead.ts';
import {
  buildLeadReadiness,
  directFallbackAvailable,
  resolveDeliveryStatus,
} from '../src/lib/forms/delivery-readiness.ts';

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
  const files = fs
    .readdirSync(path.join('migrations'))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    db.raw.exec(fs.readFileSync(path.join('migrations', file), 'utf8'));
  }
  return db;
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

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function contactRequest(ip = '10.90.0.1'): Request {
  return new Request('https://example.test/api/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({
      subject: 'Cleaning request — Residential Cleaning',
      fields: {
        request_type: 'residential_estimate',
        name: 'Synthetic Delivery Customer',
        phone: '(850) 555-0199',
        email: 'delivery-test@example.test',
        message: 'Synthetic readiness regression request.',
        service_address: '100 S Baylen St',
        address_city: 'Pensacola',
        address_state: 'FL',
        zip: '32502',
        preferred_date: '2026-12-01',
        quote_reference: 'SS-READINESS-E2E',
        terms_accepted: 'yes',
        terms_version: '2026-10-28.terms.v2',
      },
    }),
  });
}

test('readiness treats owner delivery as authoritative and optional services as non-blocking', () => {
  const ready = buildLeadReadiness({
    owner_email: true,
    database: false,
    customer_email: false,
    turnstile: false,
    photo_storage: false,
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.version, 2);
  assert.equal(resolveDeliveryStatus({ serverReady: true, direct: false }), 'ready');
  assert.equal(resolveDeliveryStatus({ serverReady: false, direct: true }), 'direct');
  assert.equal(resolveDeliveryStatus({ serverReady: false, direct: false }), 'unavailable');
  assert.equal(resolveDeliveryStatus({ serverReady: null, direct: false, probeFailed: true }), 'unknown');
  assert.equal(directFallbackAvailable(''), false);
  assert.equal(directFallbackAvailable(' public-key '), true);
});

test('GET /api/lead reports readiness without exposing server secrets', async () => {
  const response = await leadGet({
    request: new Request('https://example.test/api/lead'),
    env: {
      WEB3FORMS_ACCESS_KEY: 'do-not-expose',
      RESEND_API_KEY: 'do-not-expose-either',
      DB: {},
      PHOTOS_BUCKET: {},
      TURNSTILE_SECRET_KEY: 'also-private',
    },
  } as never);
  assert.equal(response.status, 200);
  const body = (await response.json()) as { ready?: boolean; checks?: Record<string, boolean> };
  assert.equal(body.ready, true);
  assert.deepEqual(body.checks, {
    owner_email: true,
    database: true,
    customer_email: true,
    turnstile: true,
    photo_storage: true,
  });
  assert.doesNotMatch(JSON.stringify(body), /do-not-expose|also-private/);
});

test('a complete non-priced request persists through D1 and reaches the owner email path', async () => {
  const db = migratedDb();
  let providerPayload: Record<string, unknown> | null = null;
  const response = await withFetch(
    async (url, init) => {
      assert.equal(String(url), 'https://notify.test/submit');
      providerPayload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ success: true });
    },
    () =>
      leadPost({
        request: contactRequest(),
        env: {
          DB: db,
          WEB3FORMS_ACCESS_KEY: 'synthetic-server-key',
          WEB3FORMS_ENDPOINT: 'https://notify.test/submit',
        },
      } as never),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.ok(providerPayload);
  const payload = providerPayload as unknown as Record<string, unknown>;
  assert.equal(payload.access_key, 'synthetic-server-key');
  assert.equal(payload.replyto, 'delivery-test@example.test');
  assert.match(String(payload.subject), /Cleaning request/);
  assert.ok(
    Object.entries(payload).some(
      ([key, value]) => /email/i.test(key) && value === 'delivery-test@example.test',
    ),
    'the owner notification carries the customer email',
  );

  const lead = db.raw
    .prepare(
      "SELECT id, customer_id, delivery_status, delivery_attempts, quote_reference FROM leads WHERE quote_reference = 'SS-READINESS-E2E'",
    )
    .get() as {
    id: string;
    customer_id: string;
    delivery_status: string;
    delivery_attempts: number;
    quote_reference: string;
  } | undefined;
  const contact = db.raw
    .prepare(
      "SELECT customer_id, value FROM customer_contacts WHERE kind = 'email' AND normalized_value = 'delivery-test@example.test' LIMIT 1",
    )
    .get() as { customer_id: string; value: string } | undefined;
  assert.ok(contact, 'the customer contact was persisted');
  assert.equal(contact.value, 'delivery-test@example.test');
  assert.ok(lead, 'the lead was persisted under its quote reference');
  assert.equal(lead.customer_id, contact.customer_id);
  assert.ok(lead.customer_id.startsWith('cust_'));
  assert.equal(lead.delivery_status, 'sent');
  assert.equal(Number(lead.delivery_attempts), 1);
  const property = db.raw
    .prepare('SELECT line1, postal_code FROM properties WHERE customer_id = ? LIMIT 1')
    .get(lead.customer_id) as { line1: string; postal_code: string } | undefined;
  assert.ok(property, 'the service property was persisted');
  assert.equal(property.line1, '100 S Baylen St');
  assert.equal(property.postal_code, '32502');
});

test('a provider failure is honest and leaves the D1 lead available for retry', async () => {
  const db = migratedDb();
  const response = await withFetch(
    async () => jsonResponse({ success: false }, 500),
    () =>
      leadPost({
        request: contactRequest('10.90.0.2'),
        env: {
          DB: db,
          WEB3FORMS_ACCESS_KEY: 'synthetic-server-key',
          WEB3FORMS_ENDPOINT: 'https://notify.test/submit',
        },
      } as never),
  );
  assert.equal(response.status, 502);
  const lead = db.raw.prepare('SELECT id, delivery_status, last_delivery_error FROM leads').get() as {
    id: string;
    delivery_status: string;
    last_delivery_error: string;
  };
  assert.equal(lead.delivery_status, 'failed');
  assert.equal(lead.last_delivery_error, 'provider_failed');
});
