// Legal document quality guard.
// Catches the obsolete logo, the old insurance-target wording and internal
// drafting notes being reintroduced into the customer/employee master set.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  findInternalContentProblems,
  prepareTemplateRevisionContent,
} from '../src/lib/documents/rich-text.ts';

const ROOT = process.cwd();
const LOGO = path.join(ROOT, 'public', 'brand', 'sparkling-standard-circular-logo-1024.png');
const OLD_LOGO = path.join(ROOT, 'public', 'brand', 'approved-icon-master-1024.png');
const MASTER_DIRS = [
  path.join(ROOT, 'docs', 'legal', 'templates-v3'),
  path.join(ROOT, 'docs', 'legal', 'employee-v3'),
];

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function masterFiles() {
  const files = [];
  for (const directory of MASTER_DIRS) {
    if (!fs.existsSync(directory)) continue;
    for (const name of fs.readdirSync(directory)) {
      if (name.endsWith('.md')) files.push(path.join(directory, name));
    }
  }
  return files;
}

test('the correct circular logo is installed and the obsolete S mark is not used', () => {
  assert.ok(fs.existsSync(LOGO), 'correct circular logo is missing');
  assert.ok(fs.existsSync(OLD_LOGO), 'old logo should be retained only as history');
  assert.equal(hash(LOGO), '0253b65fba7a90e63325b00bda5dfb15fb6d08f049e3f680c0a75895518ba237');
  assert.notEqual(hash(OLD_LOGO), hash(LOGO));
  const renderer = fs.readFileSync(path.join(ROOT, 'scripts', 'render-legal-docs.mjs'), 'utf8');
  assert.ok(renderer.includes('sparkling-standard-circular-logo-1024.png'));
  assert.ok(!renderer.includes('approved-icon-master-1024.png'));
});

test('customer and employee masters do not contain obsolete or internal drafting language', () => {
  const banned = [
    /FRIENDS15/i,
    /owner@sparkling-standard\.com/i,
    /insurance target/i,
    /pending owner verification/i,
    /before any public representation/i,
    /this document does not approve an incomplete/i,
    /owner decision required/i,
    /counsel review required before customer sees this/i,
    /\[OWNER DECISION/i,
    /DRAFT FOR OWNER/i,
    /not legal advice/i,
  ];
  const files = masterFiles();
  assert.ok(files.length >= 20, 'expected the corrected master set');
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of banned) {
      assert.ok(!pattern.test(text), `${path.basename(file)} contains banned phrase ${pattern}`);
    }
    assert.ok(!text.includes('{{UNRECOGNIZED'), `${path.basename(file)} contains an unresolved placeholder`);
  }
});

test('the Core Terms use the owner-confirmed insurance representation', () => {
  const core = fs.readFileSync(path.join(ROOT, 'docs', 'legal', 'templates-v3', 'LEG-AB060020.md'), 'utf8');
  assert.match(
    core,
    /maintains commercial general liability insurance with limits of \$1,000,000 per occurrence and \$2,000,000 general aggregate/,
  );
  const insurance = core.slice(core.indexOf('## 22. Insurance'), core.indexOf('## 23. Suspension'));
  assert.ok(insurance.length > 0);
  assert.doesNotMatch(insurance, /target|goal|estimate|pending/i);
});

test('travel between job sites is stated as compensable and no clock-out instruction hides it', () => {
  const handbook = fs.readFileSync(path.join(ROOT, 'docs', 'legal', 'employee-v3', 'LEG-2E96A176.md'), 'utf8');
  assert.match(handbook, /Travel from one job site to another during the workday is compensable working time/);
  assert.match(handbook, /must not clock out to make work-related travel disappear/);
  assert.doesNotMatch(handbook, /clock out.{0,80}on the way/i);
});

test('the corrected packet preserves the key owner policies', () => {
  const all = masterFiles().map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.match(all, /does not retain residential customers' physical house keys/i);
  assert.match(all, /initial Deep Cleaning/i);
  assert.match(all, /10% discount/i);
  assert.match(all, /30 calendar days/i);
  assert.match(all, /15% per year/i);
  assert.match(all, /no compounding/i);
  assert.match(all, /electronic records and electronic signatures/i);
  assert.match(all, /Form I-9/i);
});

test('owner-requested wording removals stay removed', () => {
  const all = masterFiles().map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(all, /honest duration/i);
  assert.doesNotMatch(all, /\$25\b/i);
  assert.doesNotMatch(all, /\$50\b/i);
  assert.doesNotMatch(all, /24 hours[^.\n]{0,40}no fee/i);

  const core = fs.readFileSync(path.join(ROOT, 'docs', 'legal', 'templates-v3', 'LEG-AB060020.md'), 'utf8');
  const cancellation = core.slice(core.indexOf('## 19. Cancellation'), core.indexOf('## 20.'));
  assert.match(cancellation, /48 hours or more before the appointment: no fee/i);
  assert.match(cancellation, /24 hours but less than 48 hours before the appointment: up to \$20/i);
  assert.match(cancellation, /Less than 24 hours before the appointment: up to \$40/i);
  assert.match(cancellation, /Failed access after arrival: up to \$40/i);
  assert.match(cancellation, /will not charge both a cancellation fee and a failed-access fee/i);
});

test('the production legal import fails closed on internal review notices', () => {
  const importer = fs.readFileSync(
    path.join(ROOT, 'scripts', 'legal', 'prepare-production-import.mjs'),
    'utf8',
  );
  assert.match(importer, /OWNER REVIEW DRAFT/);
  assert.match(importer, /customer-facing content contains an internal review notice/);
});

test('the 27 active masters are complete, versioned and identify the approved brand', () => {
  const active = masterFiles();
  assert.equal(active.length, 27, 'expected 17 customer and 10 employee active masters');
  for (const file of active) {
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /\*\*Version:\*\*\s*2026-11-22\.remediation\.v1/, `${path.basename(file)} version`);
    assert.match(text, /Sparkling Standard/, `${path.basename(file)} brand`);
    const prepared = prepareTemplateRevisionContent(text, '2026-11-23.customer-release.v1');
    assert.equal(
      findInternalContentProblems(prepared.content).length,
      0,
      `${path.basename(file)} must render without internal review notices`,
    );
    assert.match(prepared.content, /Version 2026-11-23\.customer-release\.v1/);
    assert.doesNotMatch(prepared.content, /OWNER REVIEW DRAFT|not effective until approved/i);
  }
  for (const file of [
    'LEG-AB060020.md',
    'LEG-4A9FC934.md',
    'LEG-8EFF2E52.md',
    'LEG-6C749FA3.md',
    'LEG-B329F61E.md',
    'LEG-D25F29B4.md',
    'LEG-9F30E030.md',
    'LEG-PM-2026-11.md',
  ]) {
    const text = fs.readFileSync(path.join(ROOT, 'docs', 'legal', 'templates-v3', file), 'utf8');
    assert.match(text, /Sparkling Standard LLC/, `${file} legal entity`);
    assert.match(text, /Sparkling Standard Cleaning Co\./, `${file} public brand`);
  }
});
