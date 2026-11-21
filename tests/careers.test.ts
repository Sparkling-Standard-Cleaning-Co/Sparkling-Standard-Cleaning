import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/admin/d1.ts';
import { resumeFormat, sanitizeResumeName, careerValue, CAREER_ROLES } from '../src/lib/careers.ts';
import { onRequestPost } from '../functions/api/careers-application.ts';

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
function applicationForm(resume?: File): FormData {
  const form = new FormData();
  form.set('name', 'Synthetic Applicant');
  form.set('email', 'applicant@example.test');
  form.set('phone', '8505550100');
  form.set('experience_level', 'entry');
  form.set('desired_role', 'residential');
  form.set('branch_preference', 'pensacola');
  form.set('availability', 'Weekdays and Saturday mornings');
  form.set('transportation', 'own_vehicle');
  form.set('driver_license', 'yes');
  form.set('consent', 'yes');
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
  const row = database.raw.prepare('SELECT name, email, status, resume_key FROM career_applications LIMIT 1').get() as Record<string, unknown>;
  assert.equal(row.name, 'Synthetic Applicant');
  assert.equal(row.email, 'applicant@example.test');
  assert.equal(row.status, 'new');
  assert.match(String(row.resume_key), /^careers\//);
});

test('an invalid resume is rejected before any application record is stored', async () => {
  const database = db();
  const request = new Request('https://sparkling-standard.test/api/careers-application', { method: 'POST', headers: { Origin: 'https://sparkling-standard.test' }, body: applicationForm(new File([new Uint8Array([0x4d,0x5a])], 'resume.exe', { type: 'application/octet-stream' })) });
  const response = await onRequestPost({ request, env: { DB: database } });
  assert.equal(response.status, 415);
  const count = database.raw.prepare('SELECT COUNT(*) AS count FROM career_applications').get() as { count: number };
  assert.equal(Number(count.count), 0);
});
