import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import type { AdminActor } from '../src/lib/admin/operations.ts';
import {
  addPayrollAdjustment,
  approvePayrollPeriod,
  calculatePayrollEntries,
  calculatePayrollPeriod,
  createPayrollPeriod,
  getPayrollPeriod,
  payrollCsv,
  type PayrollInterval,
} from '../src/lib/employee/payroll.ts';

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
  db.raw.prepare(
    "INSERT INTO team_members (id, branch_id, admin_user_id, display_name, email, status, is_bookable, pay_rate_regular_cents, pay_rate_lead_cents, pay_rate_solo_cents) VALUES ('team_pay', 'branch_pensacola', 'admin_owner', 'Pay Tester', 'pay@example.test', 'active', 1, 1800, 2200, 2500)",
  ).run();
  return db;
}

function interval(
  id: string,
  start: string,
  end: string,
  rateType: 'regular' | 'lead' | 'solo',
  rateCents: number,
): PayrollInterval {
  return {
    id,
    team_member_id: 'team_pay',
    kind: 'work',
    rate_type: rateType,
    rate_cents: rateCents,
    paid: 1,
    started_at: start,
    ended_at: end,
    status: 'closed',
  };
}

test('overtime is calculated after 40 hours in the workweek at 1.5x', () => {
  const entries = calculatePayrollEntries(
    [
      interval('i1', '2026-12-07T14:00:00.000Z', '2026-12-07T22:00:00.000Z', 'regular', 1800),
      interval('i2', '2026-12-08T14:00:00.000Z', '2026-12-08T22:00:00.000Z', 'regular', 1800),
      interval('i3', '2026-12-09T14:00:00.000Z', '2026-12-09T22:00:00.000Z', 'lead', 2200),
      interval('i4', '2026-12-10T14:00:00.000Z', '2026-12-10T22:00:00.000Z', 'lead', 2200),
      interval('i5', '2026-12-11T14:00:00.000Z', '2026-12-11T22:00:00.000Z', 'lead', 2200),
      interval('i6', '2026-12-12T14:00:00.000Z', '2026-12-12T19:00:00.000Z', 'solo', 2500),
    ],
    [{ team_member_id: 'team_pay', amount_cents: 5000 }],
  );
  const entry = entries.get('team_pay');
  assert.ok(entry);
  assert.equal(entry.regularMinutes, 2400);
  assert.equal(entry.overtimeMinutes, 300);
  assert.equal(entry.adjustmentsCents, 5000);
  assert.ok(entry.regularCents > 0);
  assert.ok(entry.overtimeCents > 0);
  assert.equal(entry.grossCents, entry.regularCents + entry.overtimeCents + 5000);
});

test('unpaid, break and open intervals are excluded from payroll', () => {
  const entries = calculatePayrollEntries(
    [
      interval('i1', '2026-12-07T14:00:00.000Z', '2026-12-07T18:00:00.000Z', 'regular', 1800),
      { ...interval('i2', '2026-12-07T18:00:00.000Z', '2026-12-07T19:00:00.000Z', 'regular', 1800), kind: 'break', paid: 0 },
      { ...interval('i3', '2026-12-07T19:00:00.000Z', null as unknown as string, 'regular', 1800), ended_at: null, status: 'open' },
    ],
    [],
  );
  const entry = entries.get('team_pay');
  assert.equal(entry?.regularMinutes, 240);
  assert.equal(entry?.overtimeMinutes, 0);
});

test('payroll period calculation, approval locking and CSV export', async () => {
  const db = database();
  const period = await createPayrollPeriod(db, owner, {
    periodStart: '2026-12-07',
    periodEnd: '2026-12-13',
  });
  const insert = db.raw.prepare(
    `INSERT INTO time_intervals
     (id, admin_user_id, team_member_id, kind, rate_type, rate_cents, paid, started_at, ended_at, status)
     VALUES (?, 'admin_owner', 'team_pay', 'work', ?, ?, 1, ?, ?, 'closed')`,
  );
  insert.run('t1', 'regular', 1800, '2026-12-07T14:00:00.000Z', '2026-12-07T22:00:00.000Z');
  insert.run('t2', 'lead', 2200, '2026-12-08T14:00:00.000Z', '2026-12-08T22:00:00.000Z');
  await addPayrollAdjustment(db, owner, {
    periodId: period.id,
    teamMemberId: 'team_pay',
    kind: 'travel',
    label: 'Compensable travel',
    amountCents: 2500,
  });
  const calculated = await calculatePayrollPeriod(db, owner, period.id);
  assert.equal(calculated.entries, 1);
  const detail = await getPayrollPeriod(db, period.id);
  assert.equal(detail.entries.length, 1);
  assert.equal(Number(detail.entries[0]!.adjustments_cents), 2500);
  assert.equal(detail.adjustments.length, 1);
  assert.match(payrollCsv(detail.period, detail.entries), /Pay Tester/);
  await approvePayrollPeriod(db, owner, period.id);
  await assert.rejects(calculatePayrollPeriod(db, owner, period.id), /payroll_period_approved/);
  await assert.rejects(
    addPayrollAdjustment(db, owner, {
      periodId: period.id,
      teamMemberId: 'team_pay',
      kind: 'bonus',
      label: 'Late',
      amountCents: 1000,
    }),
    /payroll_period_approved/,
  );
});

test('only the owner can approve payroll', async () => {
  const db = database();
  const period = await createPayrollPeriod(db, owner, {
    periodStart: '2026-12-14',
    periodEnd: '2026-12-20',
  });
  await calculatePayrollPeriod(db, owner, period.id);
  const admin = { ...owner, id: 'admin_other', role: 'manager' as const };
  db.raw.prepare(
    "INSERT INTO admin_users (id, role_id, email, password_hash, display_name, status) VALUES ('admin_other', 'manager', 'admin@example.test', 'x', 'Admin', 'active')",
  ).run();
  await assert.rejects(approvePayrollPeriod(db, admin, period.id), /owner_required/);
});

test('mixed rates use the weighted-average regular rate for overtime', () => {
  const entries = calculatePayrollEntries(
    [
      interval('r1', '2026-12-07T14:00:00.000Z', '2026-12-07T22:00:00.000Z', 'regular', 1800),
      interval('r2', '2026-12-08T14:00:00.000Z', '2026-12-08T22:00:00.000Z', 'regular', 1800),
      interval('r3', '2026-12-09T14:00:00.000Z', '2026-12-09T22:00:00.000Z', 'regular', 1800),
      interval('s1', '2026-12-10T14:00:00.000Z', '2026-12-10T22:00:00.000Z', 'solo', 2500),
      interval('s2', '2026-12-11T14:00:00.000Z', '2026-12-11T22:00:00.000Z', 'solo', 2500),
      interval('s3', '2026-12-12T14:00:00.000Z', '2026-12-12T19:00:00.000Z', 'solo', 2500),
    ],
    [],
  );
  const entry = entries.get('team_pay');
  assert.ok(entry);
  assert.equal(entry.regularMinutes, 2400);
  assert.equal(entry.overtimeMinutes, 300);
  assert.equal(entry.regularCents, 95700, 'all 45 hours at their actual straight-time rates');
  assert.equal(entry.overtimeCents, 5317, 'half-time premium at the weighted regular rate');
  assert.equal(entry.grossCents, 101017);
});

test('paid breaks and travel count as hours worked for overtime', () => {
  const entries = calculatePayrollEntries(
    [
      interval('w1', '2026-12-07T13:00:00.000Z', '2026-12-08T05:00:00.000Z', 'regular', 1800),
      { ...interval('b1', '2026-12-08T05:00:00.000Z', '2026-12-08T06:00:00.000Z', 'regular', 1800), kind: 'break', paid: 1 },
      { ...interval('tr1', '2026-12-08T06:00:00.000Z', '2026-12-08T08:00:00.000Z', 'regular', 1800), is_travel: 1 },
      interval('w2', '2026-12-08T13:00:00.000Z', '2026-12-09T05:00:00.000Z', 'regular', 1800),
      interval('w3', '2026-12-09T13:00:00.000Z', '2026-12-10T01:00:00.000Z', 'regular', 1800),
      { ...interval('m1', '2026-12-10T01:00:00.000Z', '2026-12-10T02:00:00.000Z', 'regular', 1800), kind: 'meal', paid: 0 },
      interval('w4', '2026-12-10T02:00:00.000Z', '2026-12-10T06:00:00.000Z', 'regular', 1800),
    ],
    [],
  );
  const entry = entries.get('team_pay');
  assert.ok(entry);
  assert.equal(entry.regularMinutes, 2400);
  assert.equal(entry.overtimeMinutes, 660, '16h+1h paid break+2h travel+16h+12h+4h = 51 paid hours');
  assert.equal(entry.regularCents, 51 * 1800);
});

test('partial pay periods consider the complete workweek but pay only in-period hours', () => {
  const entries = calculatePayrollEntries(
    [
      interval('p1', '2026-12-07T14:00:00.000Z', '2026-12-07T22:00:00.000Z', 'regular', 1800),
      interval('p2', '2026-12-08T14:00:00.000Z', '2026-12-08T22:00:00.000Z', 'regular', 1800),
      interval('p3', '2026-12-09T14:00:00.000Z', '2026-12-09T22:00:00.000Z', 'regular', 1800),
      interval('p4', '2026-12-10T14:00:00.000Z', '2026-12-10T22:00:00.000Z', 'regular', 1800),
      interval('p5', '2026-12-11T14:00:00.000Z', '2026-12-11T22:00:00.000Z', 'regular', 1800),
      interval('p6', '2026-12-12T14:00:00.000Z', '2026-12-12T22:00:00.000Z', 'regular', 1800),
    ],
    [],
    { periodStart: '2026-12-12', periodEnd: '2026-12-12' },
  );
  const entry = entries.get('team_pay');
  assert.ok(entry);
  assert.equal(entry.regularMinutes, 0);
  assert.equal(entry.overtimeMinutes, 480, 'Saturday sits beyond the 40-hour threshold');
  assert.equal(entry.regularCents, 8 * 1800);
  assert.equal(entry.overtimeCents, 8 * 900);
});

test('an interval crossing the workweek boundary is split correctly', () => {
  const entries = calculatePayrollEntries(
    [
      interval('c1', '2026-12-14T04:00:00.000Z', '2026-12-14T08:00:00.000Z', 'regular', 1800),
    ],
    [],
  );
  const entry = entries.get('team_pay');
  assert.ok(entry);
  assert.equal(entry.regularMinutes, 240);
  assert.deepEqual(Object.keys(entry.weeks).sort(), ['2026-12-07', '2026-12-14']);
  assert.equal(entry.weeks['2026-12-07']?.regularMinutes, 120);
  assert.equal(entry.weeks['2026-12-14']?.regularMinutes, 120);
});

test('multiple adjustments are preserved for an employee without intervals', () => {
  const entries = calculatePayrollEntries([], [
    { id: 'a1', team_member_id: 'team_pay', kind: 'bonus', amount_cents: 1000 },
    { id: 'a2', team_member_id: 'team_pay', kind: 'travel', amount_cents: 2500 },
  ]);
  const entry = entries.get('team_pay');
  assert.ok(entry);
  assert.equal(entry.adjustmentsCents, 3500);
  assert.equal(entry.grossCents, 3500);
});

test('overlapping payroll periods are rejected and recalculation clears stale entries', async () => {
  const db = database();
  const period = await createPayrollPeriod(db, owner, {
    periodStart: '2026-12-07',
    periodEnd: '2026-12-13',
  });
  await assert.rejects(
    createPayrollPeriod(db, owner, { periodStart: '2026-12-10', periodEnd: '2026-12-17' }),
    /payroll_period_overlap/,
  );
  db.raw.prepare(
    `INSERT INTO time_intervals
     (id, admin_user_id, team_member_id, kind, rate_type, rate_cents, paid, started_at, ended_at, status)
     VALUES ('t1', 'admin_owner', 'team_pay', 'work', 'regular', 1800, 1,
             '2026-12-07T14:00:00.000Z', '2026-12-07T22:00:00.000Z', 'closed')`,
  ).run();
  await calculatePayrollPeriod(db, owner, period.id);
  assert.equal(
    (db.raw.prepare('SELECT COUNT(*) AS count FROM payroll_entries').get() as { count: number }).count,
    1,
  );
  await addPayrollAdjustment(db, owner, {
    periodId: period.id,
    teamMemberId: 'team_pay',
    kind: 'bonus',
    label: 'Safety bonus',
    amountCents: 1000,
  });
  const status = db.raw.prepare('SELECT status FROM payroll_periods WHERE id = ?').get(period.id) as {
    status: string;
  };
  assert.equal(status.status, 'open');
  assert.equal(
    (db.raw.prepare('SELECT COUNT(*) AS count FROM payroll_entries').get() as { count: number }).count,
    0,
  );
  await assert.rejects(approvePayrollPeriod(db, owner, period.id), /payroll_period_not_calculated/);
  await calculatePayrollPeriod(db, owner, period.id);
  db.raw
    .prepare("UPDATE time_intervals SET ended_at = '2026-12-07T23:00:00.000Z' WHERE id = 't1'")
    .run();
  await assert.rejects(approvePayrollPeriod(db, owner, period.id), /payroll_recalculation_required/);
});


test('branch time zones control the workweek boundary', () => {
  const base = interval('tz1', '2026-12-14T04:30:00.000Z', '2026-12-14T05:30:00.000Z', 'regular', 1800);
  const tampa = calculatePayrollEntries([{ ...base, time_zone: 'America/New_York' }], []);
  assert.deepEqual(Object.keys(tampa.get('team_pay')!.weeks).sort(), ['2026-12-07', '2026-12-14']);
  const pensacola = calculatePayrollEntries([{ ...base, time_zone: 'America/Chicago' }], []);
  assert.deepEqual(Object.keys(pensacola.get('team_pay')!.weeks), ['2026-12-07']);
});
