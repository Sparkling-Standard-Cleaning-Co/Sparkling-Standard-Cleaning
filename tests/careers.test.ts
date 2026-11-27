import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { resumeFormat, sanitizeResumeName, careerValue, CAREER_ROLES } from '../src/lib/careers.ts';
import { onRequestPost } from '../functions/api/careers-application.ts';
import { onRequestGet as onCareersOptionsGet } from '../functions/api/careers-options.ts';

class SqlStatement implements D1PreparedStatement {
  private values: unknown[] = [];
  private readonly db: DatabaseSync;
  private readonly sql: string;
  constructor(db: DatabaseSync, sql: string) { this.db = db; this.sql = sql; }
  bind(...values: unknown[]): D1PreparedStatement { this.values = values; return this; }
  async first<T = Record<string, unknown>>(): Promise<T | null> { return (this.db.prepare(this.sql).get(...(this.values as never[])) as T | undefined) ?? null; }
  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> { return { success: true, results: this.db.prepare(this.sql).all(...(this.values as never[])) as T[] }; }
  async run(): Promise<D1Result> { const result = this.db.prepare(this.sql).run(...(this.values as never[])); return { success: true, meta: { changes: Number(result.changes) } } as D1Result; }
}
class TestD1 implements D1Database {
  readonly raw = new DatabaseSync(':memory:');
  prepare(query: string): D1PreparedStatement { return new SqlStatement(this.raw, query); }
  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> { const results: D1Result[] = []; for (const statement of statements) results.push(await statement.run()); return results; }
}
function db(): TestD1 {
  const database = new TestD1();
  const directory = path.join(process.cwd(), 'migrations');
  for (const file of fs.readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) database.raw.exec(fs.readFileSync(path.join(directory, file), 'utf8'));
  return database;
}
function applicationForm(resume?: File, branch = 'pensacola'): FormData {
  const form = new FormData();
  form.set('first_name', 'Synthetic');
  form.set('last_name', 'Applicant');
  form.set('name', 'Synthetic Applicant');
  form.set('email', 'applicant@example.test');
  form.set('phone', '8505550100');
  form.set('city', 'Pensacola');
  form.set('postal_code', '32502');
  form.set('experience_level', 'entry');
  form.set('desired_role', 'residential');
  form.set('branch_preference', branch);
  form.set('availability', 'Weekdays and Saturday mornings');
  form.append('available_days', 'mon');
  form.append('available_days', 'wed');
  form.set('availability_morning', 'yes');
  form.set('desired_weekly_hours', '30');
  form.set('employment_type', 'part_time');
  form.set('transportation', 'own_vehicle');
  form.set('driver_license', 'yes');
  form.set('essential_duties_ack', 'yes');
  form.set('privacy_ack', 'yes');
  form.set('consent', 'yes');
  form.set('accuracy_ack', 'yes');
  if (resume) form.set('resume', resume);
  return form;
}

test('career resume validation accepts only PDF or DOCX', () => {
  const pdf = new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31]);
  const docx = new Uint8Array([0x50,0x4b,0x03,0x04,0x00]);
  assert.equal(resumeFormat(pdf, 'resume.pdf')?.ext, 'pdf');
  assert.equal(resumeFormat(docx, 'resume.docx')?.ext, 'docx');
  assert.equal(resumeFormat(new Uint8Array([0x4d,0x5a]), 'resume.exe'), null);
  assert.equal(sanitizeResumeName('../my resume.pdf'), 'my resume.pdf');
  assert.equal(careerValue(CAREER_ROLES, 'commercial'), 'commercial');
  assert.equal(careerValue(CAREER_ROLES, 'invented'), '');
});

test('a valid application is stored privately with an optional resume and no live email configuration', async () => {
  const database = db(); const puts: string[] = [];
  const bucket = { async put(key: string) { puts.push(key); } };
  const request = new Request('https://sparkling-standard.test/api/careers-application', { method: 'POST', headers: { Origin: 'https://sparkling-standard.test' }, body: applicationForm(new File([new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31])], 'resume.pdf', { type: 'application/pdf' })) });
  const response = await onRequestPost({ request, env: { DB: database, PHOTOS_BUCKET: bucket } });
  const body = await response.json() as { ok?: boolean; reference?: string; resumeStored?: boolean };
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.match(body.reference ?? '', /^APP-\d{8}-[A-Z0-9]{6}$/);
  assert.equal(body.resumeStored, true);
  assert.equal(puts.length, 1);
  const row = database.raw.prepare('SELECT name, first_name, last_name, email, pipeline_status, branch_id, position_code, available_days_json, privacy_ack_at, resume_key FROM career_applications LIMIT 1').get() as Record<string, unknown>;
  assert.equal(row.name, 'Synthetic Applicant');
  assert.equal(row.first_name, 'Synthetic');
  assert.equal(row.last_name, 'Applicant');
  assert.equal(row.email, 'applicant@example.test');
  assert.equal(row.pipeline_status, 'new');
  assert.equal(row.branch_id, 'branch_pensacola');
  assert.equal(row.position_code, 'residential');
  assert.equal(row.available_days_json, '["mon","wed"]');
  assert.ok(row.privacy_ack_at);
  assert.match(String(row.resume_key), /^careers\//);
});

test('Tampa applications are rejected until the branch is publicly live', async () => {
  const database = db();
  const request = new Request('https://sparkling-standard.test/api/careers-application', {
    method: 'POST',
    headers: { Origin: 'https://sparkling-standard.test', 'CF-Connecting-IP': '203.0.113.10' },
    body: applicationForm(undefined, 'tampa'),
  });
  const response = await onRequestPost({ request, env: { DB: database } });
  const body = await response.json() as { error?: string };
  assert.equal(response.status, 409);
  assert.equal(body.error, 'branch_unavailable');
  const before = database.raw.prepare('SELECT COUNT(*) AS count FROM career_applications').get() as { count: number };
  assert.equal(Number(before.count), 0);

  database.raw.exec("UPDATE branches SET lifecycle_status = 'live', status = 'active' WHERE id = 'branch_tampa'");
  const acceptedRequest = new Request('https://sparkling-standard.test/api/careers-application', {
    method: 'POST',
    headers: { Origin: 'https://sparkling-standard.test', 'CF-Connecting-IP': '203.0.113.11' },
    body: applicationForm(undefined, 'tampa'),
  });
  const accepted = await onRequestPost({ request: acceptedRequest, env: { DB: database } });
  assert.equal(accepted.status, 201);
  const row = database.raw.prepare('SELECT branch_id, branch_preference FROM career_applications LIMIT 1').get() as Record<string, unknown>;
  assert.equal(row.branch_id, 'branch_tampa');
  assert.equal(row.branch_preference, 'tampa');
});

test('public careers options withhold Tampa data until the branch is live', async () => {
  const database = db();
  const inactive = await onCareersOptionsGet({
    request: new Request('https://sparkling-standard.test/api/careers-options'),
    env: { DB: database },
  });
  const inactiveBody = await inactive.json() as {
    branches?: Record<string, boolean>;
    payByBranch?: Record<string, Record<string, number>>;
    opportunities?: Array<Record<string, unknown>>;
  };
  assert.equal(inactiveBody.branches?.tampa, false);
  assert.ok(inactiveBody.payByBranch?.branch_pensacola);
  assert.equal(inactiveBody.payByBranch?.branch_tampa, undefined);
  assert.ok((inactiveBody.opportunities ?? []).every((entry) => entry.branch_id === 'branch_pensacola'));

  database.raw.exec("UPDATE branches SET lifecycle_status = 'live', status = 'active' WHERE id = 'branch_tampa'");
  const active = await onCareersOptionsGet({
    request: new Request('https://sparkling-standard.test/api/careers-options'),
    env: { DB: database },
  });
  const activeBody = await active.json() as {
    branches?: Record<string, boolean>;
    payByBranch?: Record<string, Record<string, number>>;
    opportunities?: Array<Record<string, unknown>>;
  };
  assert.equal(activeBody.branches?.tampa, true);
  assert.ok(activeBody.payByBranch?.branch_tampa);
  assert.ok((activeBody.opportunities ?? []).some((entry) => entry.branch_id === 'branch_tampa'));
});

test('an invalid resume is rejected before any application record is stored', async () => {
  const database = db();
  const request = new Request('https://sparkling-standard.test/api/careers-application', { method: 'POST', headers: { Origin: 'https://sparkling-standard.test' }, body: applicationForm(new File([new Uint8Array([0x4d,0x5a])], 'resume.exe', { type: 'application/octet-stream' })) });
  const response = await onRequestPost({ request, env: { DB: database } });
  assert.equal(response.status, 415);
  const count = database.raw.prepare('SELECT COUNT(*) AS count FROM career_applications').get() as { count: number };
  assert.equal(Number(count.count), 0);
});


test('an authorized owner can convert an applicant into an employee profile with onboarding', async () => {
  const { createOpsSession, enrollOwner, readOpsActor } = await import('../src/lib/admin/operations.ts');
  const adminCareers = await import('../functions/api/admin/careers.ts');
  const database = db();
  const owner = await enrollOwner(database, {
    email: 'owner-careers@example.test',
    name: 'Owner',
    password: 'SyntheticOwner!2026',
  });
  const session = await createOpsSession(database, owner.id, new Request('https://sparkling-standard.test/admin'));
  const actor = await readOpsActor(database, new Request('https://sparkling-standard.test/api/admin/careers', {
    headers: { Cookie: `ss_ops=${session.token}` },
  }));
  assert.ok(actor);
  const applicationResponse = await onRequestPost({
    request: new Request('https://sparkling-standard.test/api/careers-application', {
      method: 'POST',
      headers: { Origin: 'https://sparkling-standard.test' },
      body: applicationForm(),
    }),
    env: { DB: database },
  });
  assert.equal(applicationResponse.status, 201);
  const application = database.raw.prepare('SELECT id, reference FROM career_applications LIMIT 1').get() as { id: string; reference: string };
  const listed = await adminCareers.onRequestGet({
    request: new Request('https://sparkling-standard.test/api/admin/careers', {
      headers: { Cookie: `ss_ops=${session.token}` },
    }),
    env: { DB: database },
  });
  assert.equal(listed.status, 200);
  const listBody = await listed.json() as { applications?: Array<Record<string, unknown>> };
  assert.ok(listBody.applications?.some((entry) => entry.reference === application.reference));
  const converted = await adminCareers.onRequestPost({
    request: new Request('https://sparkling-standard.test/api/admin/careers', {
      method: 'POST',
      headers: {
        Cookie: `ss_ops=${session.token}`,
        'X-CSRF-Token': actor!.csrf,
        'Content-Type': 'application/json',
        Origin: 'https://sparkling-standard.test',
      },
      body: JSON.stringify({ action: 'convert_to_employee', applicationId: application.id }),
    }),
    env: { DB: database },
  });
  assert.equal(converted.status, 200);
  const convertedBody = await converted.json() as { teamMemberId?: string };
  assert.ok(convertedBody.teamMemberId);
  const employee = database.raw.prepare('SELECT display_name, branch_id, status, is_bookable FROM team_members WHERE id = ?').get(convertedBody.teamMemberId!) as Record<string, unknown>;
  assert.equal(employee.display_name, 'Synthetic Applicant');
  assert.equal(employee.branch_id, 'branch_pensacola');
  assert.equal(employee.status, 'active');
  assert.equal(employee.is_bookable, 0);
  const onboarding = database.raw.prepare('SELECT COUNT(*) AS count FROM employee_onboarding_tasks WHERE team_member_id = ?').get(convertedBody.teamMemberId!) as { count: number };
  assert.equal(onboarding.count, 4);
  const updated = database.raw.prepare('SELECT pipeline_status, converted_team_member_id FROM career_applications WHERE id = ?').get(application.id) as Record<string, unknown>;
  assert.equal(updated.pipeline_status, 'onboarding');
  assert.equal(updated.converted_team_member_id, convertedBody.teamMemberId);
  const duplicate = await adminCareers.onRequestPost({
    request: new Request('https://sparkling-standard.test/api/admin/careers', {
      method: 'POST',
      headers: {
        Cookie: `ss_ops=${session.token}`,
        'X-CSRF-Token': actor!.csrf,
        'Content-Type': 'application/json',
        Origin: 'https://sparkling-standard.test',
      },
      body: JSON.stringify({ action: 'convert_to_employee', applicationId: application.id }),
    }),
    env: { DB: database },
  });
  assert.equal(duplicate.status, 409);
});

