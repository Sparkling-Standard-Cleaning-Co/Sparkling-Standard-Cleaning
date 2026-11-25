import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function runAudit(files: Array<{ bucket: string; key: string }>, includeReferences = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-r2-audit-'));
  const d1 = path.join(dir, 'd1.sql');
  const manifest = path.join(dir, 'manifest.json');
  fs.writeFileSync(
    d1,
    [
      'CREATE TABLE document_templates (id TEXT PRIMARY KEY, r2_key TEXT NOT NULL DEFAULT \'\');',
      'CREATE TABLE document_signatures (id TEXT PRIMARY KEY, r2_key TEXT NOT NULL DEFAULT \'\');',
      'CREATE TABLE job_media (id TEXT PRIMARY KEY, r2_key TEXT NOT NULL DEFAULT \'\');',
      'CREATE TABLE leads (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL DEFAULT \'{}\');',
      'CREATE TABLE booking_requests (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL DEFAULT \'{}\');',
      "INSERT INTO document_templates VALUES ('doc_1', 'documents/templates/doc_1.pdf');",
      includeReferences
        ? "INSERT INTO document_signatures VALUES ('sig_1', 'documents/executed/req_1.pdf');"
        : '',
      "INSERT INTO leads VALUES ('lead_1', '{\"photo_keys\":\"photos/a.jpg,photos/b.jpg\"}');",
    ].join('\n'),
  );
  fs.writeFileSync(
    manifest,
    JSON.stringify({
      files: files.map((file) => ({ ...file, bytes: 10, sha256: 'x', path: file.key })),
    }),
  );
  const output = execFileSync(
    process.execPath,
    ['scripts/backup/verify-r2-references.mjs', '--d1', d1, '--r2-manifest', manifest],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return JSON.parse(output);
}

test('every database object reference must exist in the staged backup', () => {
  const report = runAudit([
    { bucket: 'sparkling-standard-documents', key: 'documents/templates/doc_1.pdf' },
    { bucket: 'sparkling-standard-documents', key: 'documents/executed/req_1.pdf' },
    { bucket: 'sparkling-standard-lead-photos', key: 'photos/a.jpg' },
    { bucket: 'sparkling-standard-lead-photos', key: 'photos/b.jpg' },
  ]);
  assert.equal(report.ok, true);
  assert.equal(report.missingCount, 0);
});

test('a referenced object missing from the staged backup fails the audit', () => {
  assert.throws(() =>
    runAudit([
      { bucket: 'sparkling-standard-documents', key: 'documents/templates/doc_1.pdf' },
      { bucket: 'sparkling-standard-lead-photos', key: 'photos/a.jpg' },
    ]),
  );
});
