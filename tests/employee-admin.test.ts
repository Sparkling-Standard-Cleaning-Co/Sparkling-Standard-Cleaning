import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import type { AdminActor } from '../src/lib/admin/operations.ts';
import {
  acknowledgeHandbook,
  addOnboardingTask,
  addPerformanceNote,
  assignTraining,
  completeTraining,
  createQualityInspection,
  createTrainingModule,
  listEmployeeProfiles,
  listOnboarding,
  listPerformanceNotes,
  reviewTimeOffRequest,
  setOnboardingStatus,
  updateEmployeeProfile,
} from '../src/lib/employee/admin.ts';

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
    "INSERT INTO team_members (id, branch_id, admin_user_id, display_name, email, status, is_bookable, booking_resource_id) VALUES ('team_emp', 'branch_pensacola', 'admin_owner', 'Employee One', 'employee@example.test', 'active', 1, 'emp-1')",
  ).run();
  return db;
}

test('employee profile, rates and emergency contact are saved with audit', async () => {
  const db = database();
  await updateEmployeeProfile(db, owner, 'team_emp', {
    displayName: 'Employee Updated',
    email: 'updated@example.test',
    phone: '8505550000',
    status: 'active',
    isBookable: true,
    emergencyContactName: 'Parent',
    emergencyContactPhone: '8505550001',
    hireDate: '2026-01-05',
    licenseExpiresOn: '2027-01-05',
    payRateRegular: 1900,
    payRateLead: 2300,
    payRateSolo: 2600,
    defaultRateType: 'lead',
  });
  const row = db.raw
    .prepare('SELECT * FROM team_members WHERE id = ?')
    .get('team_emp') as Record<string, unknown>;
  assert.equal(row.display_name, 'Employee Updated');
  assert.equal(row.emergency_contact_name, 'Parent');
  assert.equal(row.pay_rate_regular_cents, 1900);
  assert.equal(row.default_rate_type, 'lead');
  const profiles = await listEmployeeProfiles(db, owner);
  assert.ok(profiles.some((profile) => profile.id === 'team_emp'));
  await acknowledgeHandbook(db, owner, 'team_emp');
  const acknowledged = db.raw
    .prepare('SELECT handbook_acknowledged_at FROM team_members WHERE id = ?')
    .get('team_emp') as { handbook_acknowledged_at: string };
  assert.ok(acknowledged.handbook_acknowledged_at);
});

test('onboarding tasks and training assignments are tracked to completion', async () => {
  const db = database();
  const task = await addOnboardingTask(db, owner, {
    teamMemberId: 'team_emp',
    title: 'Signed handbook',
    category: 'compliance',
    required: true,
    dueDate: '2026-12-01',
  });
  await setOnboardingStatus(db, owner, task.id, 'completed');
  const onboarding = await listOnboarding(db, 'team_emp');
  assert.equal(onboarding.length, 1);
  assert.equal(onboarding[0]!.status, 'completed');

  const module = await createTrainingModule(db, owner, {
    title: 'Bathroom procedure',
    category: 'procedures',
    contentText: 'Clean top to bottom.',
    required: true,
  });
  const assignment = await assignTraining(db, owner, {
    moduleId: module.id,
    teamMemberId: 'team_emp',
  });
  await completeTraining(db, owner, assignment.id, { score: 95 });
  const assignmentRow = db.raw
    .prepare('SELECT status, score FROM training_assignments WHERE id = ?')
    .get(assignment.id) as { status: string; score: number };
  assert.equal(assignmentRow.status, 'completed');
  assert.equal(assignmentRow.score, 95);
});

test('quality inspections and performance notes are stored against the employee/job', async () => {
  const db = database();
  db.raw.prepare(
    "INSERT INTO customers (id, first_name, last_name, status) VALUES ('cust_q', 'Quality', 'Customer', 'active')",
  ).run();
  db.raw.prepare(
    "INSERT INTO properties (id, customer_id, label, line1, city, state, postal_code) VALUES ('prop_q', 'cust_q', 'HQ', '1 Test', 'Pensacola', 'FL', '32502')",
  ).run();
  db.raw.prepare(
    "INSERT INTO appointments (id, branch_id, customer_id, property_id, status, start_at, end_at, duration_minutes, crew_size, reference) VALUES ('appt_q', 'branch_pensacola', 'cust_q', 'prop_q', 'completed', '2026-11-20T15:00:00.000Z', '2026-11-20T18:00:00.000Z', 180, 1, 'SS-Q')",
  ).run();
  const inspection = await createQualityInspection(db, owner, {
    appointmentId: 'appt_q',
    inspectedAt: '2026-11-21',
    score: 92,
    findings: 'Excellent detail.',
    correctiveActions: '',
    status: 'completed',
    inspectorTeamMemberId: 'team_emp',
  });
  const row = db.raw
    .prepare('SELECT customer_id, property_id, score FROM quality_inspections WHERE id = ?')
    .get(inspection.id) as { customer_id: string; property_id: string; score: number };
  assert.equal(row.customer_id, 'cust_q');
  assert.equal(row.property_id, 'prop_q');
  assert.equal(row.score, 92);
  await addPerformanceNote(db, owner, {
    teamMemberId: 'team_emp',
    kind: 'praise',
    note: 'Customer complimented the crew.',
    appointmentId: 'appt_q',
  });
  const notes = await listPerformanceNotes(db, 'team_emp');
  assert.equal(notes.length, 1);
  assert.match(String(notes[0]!.note), /complimented/);
});

test('approved time off creates a scheduling block; declined does not', async () => {
  const db = database();
  db.raw.prepare(
    "INSERT INTO time_off_requests (id, team_member_id, start_at, end_at, reason) VALUES ('toff_a', 'team_emp', '2026-12-10T14:00:00.000Z', '2026-12-11T22:00:00.000Z', 'Family')",
  ).run();
  db.raw.prepare(
    "INSERT INTO time_off_requests (id, team_member_id, start_at, end_at, reason) VALUES ('toff_b', 'team_emp', '2026-12-20T14:00:00.000Z', '2026-12-21T22:00:00.000Z', 'Other')",
  ).run();
  await reviewTimeOffRequest(db, owner, 'toff_a', 'approved');
  await reviewTimeOffRequest(db, owner, 'toff_b', 'declined');
  const blocks = db.raw
    .prepare("SELECT COUNT(*) AS count FROM team_time_off WHERE team_member_id = 'team_emp'")
    .get() as { count: number };
  assert.equal(blocks.count, 1);
  const statuses = db.raw
    .prepare("SELECT status FROM time_off_requests WHERE team_member_id = 'team_emp' ORDER BY id")
    .all() as Array<{ status: string }>;
  assert.deepEqual(statuses.map((row) => row.status), ['approved', 'declined']);
});
