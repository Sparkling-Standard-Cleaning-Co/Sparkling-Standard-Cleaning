import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { acceptInvite, inviteAdmin } from '../src/lib/admin/accounts.ts';
import { createOpsSession, enrollOwner, readOpsActor } from '../src/lib/admin/operations.ts';
import { createChecklist, createTeamMember, setAppointmentTeam } from '../src/lib/admin/scheduling.ts';
import { onRequestGet } from '../functions/api/employee/me.ts';
import { centralDateKey, centralMidnightUtc } from '../src/lib/employee/timekeeping.ts';

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
function request(cookie = ''): Request {
  return new Request('https://example.test/api/employee/me', { headers: cookie ? { Cookie: cookie } : {} });
}
function addDays(date: string, days: number): string {
  return new Date(Date.parse(date + 'T12:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);
}
function at(date: string, time: string): string {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return new Date(centralMidnightUtc(date).getTime() + (hour * 60 + minute) * 60_000).toISOString();
}

async function fixture() {
  const db = migratedDb();
  const owner = await enrollOwner(db, {
    email: 'owner-employee@example.test',
    name: 'Synthetic Owner',
    password: 'SyntheticOwner!2026',
  });
  const ownerSession = await createOpsSession(db, owner.id, request());
  const ownerActor = await readOpsActor(db, request(`ss_ops=${ownerSession.token}`));
  assert.ok(ownerActor);

  const soloMember = await createTeamMember(db, ownerActor!, {
    displayName: 'Solo Cleaner', email: 'solo-employee@example.test', isSolo: true, isLead: false, isBookable: true,
  });
  const helperMember = await createTeamMember(db, ownerActor!, {
    displayName: 'Helper Cleaner', email: 'helper-employee@example.test', isSolo: false, isLead: false, isBookable: true,
  });
  for (const [member, email] of [
    [soloMember, 'solo-employee@example.test'],
    [helperMember, 'helper-employee@example.test'],
  ] as const) {
    const invite = await inviteAdmin(db, ownerActor!, { email, role: 'cleaner', teamMemberId: member.id });
    await acceptInvite(db, { token: invite.token, password: 'EmployeePass!2026', name: member.id });
  }
  const soloUser = db.raw.prepare('SELECT id, admin_user_id FROM team_members WHERE id = ?').get(soloMember.id) as { id: string; admin_user_id: string };
  const helperUser = db.raw.prepare('SELECT id, admin_user_id FROM team_members WHERE id = ?').get(helperMember.id) as { id: string; admin_user_id: string };
  assert.ok(soloUser.admin_user_id);
  assert.ok(helperUser.admin_user_id);
  assert.notEqual(soloUser.admin_user_id, helperUser.admin_user_id);

  const customerId = `cust_${crypto.randomUUID()}`;
  const propertyId = `prop_${crypto.randomUUID()}`;
  db.raw.prepare("INSERT INTO customers (id, primary_branch_id, first_name, last_name, status) VALUES (?, 'branch_pensacola', 'Private', 'Customer', 'active')").run(customerId);
  db.raw.prepare("INSERT INTO properties (id, customer_id, branch_id, label, line1, city, state, postal_code, access_notes, parking_notes, status) VALUES (?, ?, 'branch_pensacola', 'Home', '42 Private Lane', 'Pensacola', 'FL', '32502', 'Garage code 1234', 'Driveway only', 'active')").run(propertyId, customerId);

  const today = centralDateKey(new Date());
  const tomorrow = addDays(today, 1);
  const far = addDays(today, 3);
  const appointments: Record<string, string> = {};
  for (const [key, date, reference] of [
    ['solo', today, 'APT-SOLO-1'],
    ['helper', tomorrow, 'APT-HELPER-1'],
    ['far', far, 'APT-FAR-1'],
  ] as const) {
    const requestId = `req_${crypto.randomUUID()}`;
    db.raw.prepare(
      `INSERT INTO booking_requests (id, hold_id, branch_id, customer_id, property_id, status, quote_reference, requested_date, start_at, end_at, duration_minutes, payload_json)
       VALUES (?, ?, 'branch_pensacola', ?, ?, 'confirmed', ?, ?, ?, ?, 120, ?)`,
    ).run(
      requestId,
      `hold_${crypto.randomUUID()}`,
      customerId,
      propertyId,
      `SS-${date.replaceAll('-', '')}-ABC123`,
      date,
      at(date, '10:00'),
      at(date, '12:00'),
      JSON.stringify({
        service_type: 'residential-cleaning',
        special_instructions: 'Use fragrance-free products and avoid the nursery.',
        access_notes: 'Garage code 1234',
        name: 'Private Customer',
      }),
    );
    const appointmentId = `appt_${crypto.randomUUID()}`;
    appointments[key] = appointmentId;
    db.raw.prepare(
      `INSERT INTO appointments
       (id, branch_id, customer_id, property_id, booking_request_id, status, start_at, end_at,
        timezone, duration_minutes, crew_size, source, reference, notes)
       VALUES (?, 'branch_pensacola', ?, ?, ?, 'confirmed', ?, ?, 'America/Chicago', 120, 1, 'admin', ?, 'Gate code and alarm notes')`,
    ).run(appointmentId, customerId, propertyId, requestId, at(date, '10:00'), at(date, '12:00'), reference);
  }
  await setAppointmentTeam(db, ownerActor!, appointments.solo!, [soloMember.id]);
  await setAppointmentTeam(db, ownerActor!, appointments.helper!, [soloMember.id, helperMember.id]);
  await setAppointmentTeam(db, ownerActor!, appointments.far!, [soloMember.id]);
  await createChecklist(db, ownerActor!, appointments.solo!);
  const soloSession = await createOpsSession(db, soloUser.admin_user_id, request());
  const helperSession = await createOpsSession(db, helperUser.admin_user_id, request());
  return {
    db,
    ownerActor: ownerActor!,
    appointments,
    soloCookie: `ss_ops=${soloSession.token}`,
    helperCookie: `ss_ops=${helperSession.token}`,
  };
}

test('lead/solo employees see authorized property instructions for today and tomorrow only', async () => {
  const f = await fixture();
  const response = await onRequestGet({ request: request(f.soloCookie), env: { DB: f.db } });
  const body = (await response.json()) as { ok: boolean; jobs: Array<Record<string, unknown>> };
  assert.equal(body.ok, true);
  assert.equal(body.jobs.length, 2);
  const todayJob = body.jobs.find((job) => job.reference === 'APT-SOLO-1');
  assert.ok(todayJob);
  assert.equal(todayJob.detailLevel, 'lead');
  assert.match(String(todayJob.instructions), /fragrance-free/);
  assert.equal(todayJob.customerFirstName, 'Private');
  assert.ok(todayJob.checklist);
  assert.equal(body.jobs.some((job) => job.reference === 'APT-FAR-1'), false);
});

test('helpers receive only operational basics from the server response', async () => {
  const f = await fixture();
  const response = await onRequestGet({ request: request(f.helperCookie), env: { DB: f.db } });
  const body = (await response.json()) as { ok: boolean; jobs: Array<Record<string, unknown>> };
  assert.equal(body.ok, true);
  assert.equal(body.jobs.length, 1);
  const job = body.jobs[0]!;
  assert.equal(job.reference, 'APT-HELPER-1');
  assert.equal(job.detailLevel, 'helper');
  assert.equal(job.address, '42 Private Lane, Pensacola, FL, 32502');
  assert.equal('instructions' in job, false);
  assert.equal('customerFirstName' in job, false);
  assert.equal('checklist' in job, false);
  assert.equal('service' in job, false);
});

test('an inactive employee profile is rejected by the employee portal', async () => {
  const f = await fixture();
  f.db.raw
    .prepare("UPDATE team_members SET status = 'inactive' WHERE lower(email) = ?")
    .run('solo-employee@example.test');
  const response = await onRequestGet({ request: request(f.soloCookie), env: { DB: f.db } });
  assert.equal(response.status, 403);
  assert.equal(((await response.json()) as { error?: string }).error, 'employee_profile_inactive');
});
test('employee invitations automatically link the new account to the roster profile', async () => {
  const f = await fixture();
  const linked = f.db.raw
    .prepare('SELECT tm.admin_user_id, u.email FROM team_members tm JOIN admin_users u ON u.id = tm.admin_user_id WHERE u.email = ?')
    .get('helper-employee@example.test') as { admin_user_id: string; email: string } | undefined;
  assert.ok(linked);
  assert.equal(linked?.email, 'helper-employee@example.test');
  const invitation = f.db.raw
    .prepare('SELECT team_member_id, accepted_at FROM admin_invitations WHERE email = ? ORDER BY created_at DESC LIMIT 1')
    .get('helper-employee@example.test') as { team_member_id: string; accepted_at: string } | undefined;
  assert.ok(invitation?.team_member_id);
  assert.ok(invitation?.accepted_at);
});
