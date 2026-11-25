import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function migratedTo(last: string): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const file of fs.readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join('migrations', file), 'utf8'));
    if (file === last) break;
  }
  return db;
}

test('migration 0059 enforces one primary invoice per appointment and allows supplements', () => {
  const migration = fs.readFileSync('migrations/0059_invoice_primary_role.sql', 'utf8');
  assert.match(migration, /ALTER TABLE invoices ADD COLUMN invoice_role/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_primary_per_appointment/);
  assert.doesNotMatch(migration, /\bDROP\b|\bTRUNCATE\b|DELETE\s+FROM/i);

  const db = migratedTo('0058_document_library_review_state.sql');
  db.exec(
    `INSERT INTO customers (id, primary_branch_id, first_name, last_name, status, source)
     VALUES ('cust_invoice_role', 'branch_pensacola', 'Invoice', 'Customer', 'active', 'website')`,
  );
  db.exec(
    `INSERT INTO properties (id, customer_id, branch_id, label, line1, city, state, postal_code, status)
     VALUES ('prop_invoice_role', 'cust_invoice_role', 'branch_pensacola', 'Home', '3 Invoice Way', 'Pensacola', 'FL', '32502', 'active')`,
  );
  db.exec(
    `INSERT INTO appointments
       (id, branch_id, customer_id, property_id, status, start_at, end_at, duration_minutes, reference, source)
     VALUES ('appt_invoice_role', 'branch_pensacola', 'cust_invoice_role', 'prop_invoice_role', 'completed',
             '2026-11-24T18:00:00.000Z', '2026-11-24T20:00:00.000Z', 120, 'HC-INVOICE-ROLE', 'website')`,
  );
  db.exec(migration);

  const insert = db.prepare(
    `INSERT INTO invoices
       (id, branch_id, customer_id, property_id, appointment_id, number, status, issue_date, due_date,
        subtotal_cents, total_cents, balance_cents, invoice_role, related_invoice_id)
     VALUES (?, 'branch_pensacola', 'cust_invoice_role', 'prop_invoice_role', 'appt_invoice_role', ?, 'open',
             '2026-11-24', '2026-11-24', 10000, 10000, 10000, ?, ?)`,
  );
  insert.run('inv_primary', 'INV-PRIMARY', 'primary', null);
  assert.throws(
    () => insert.run('inv_primary_duplicate', 'INV-PRIMARY-2', 'primary', null),
    /UNIQUE|constraint/i,
  );
  insert.run('inv_supplemental', 'INV-SUPPLEMENTAL', 'supplemental', 'inv_primary');
  const rows = (db
    .prepare('SELECT id, invoice_role, related_invoice_id FROM invoices WHERE appointment_id = ? ORDER BY id')
    .all('appt_invoice_role') as Array<{ id: string; invoice_role: string; related_invoice_id: string | null }>).map((row) => ({ ...row }));
  assert.deepEqual(rows, [
    { id: 'inv_primary', invoice_role: 'primary', related_invoice_id: null },
    { id: 'inv_supplemental', invoice_role: 'supplemental', related_invoice_id: 'inv_primary' },
  ]);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.close();
});
