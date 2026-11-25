// @ts-nocheck
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const templateDir = 'docs/legal/templates';
const employeeDir = 'docs/legal/employee';
const registerPath = 'docs/legal/LEGAL-DOCUMENT-REGISTER.md';

const required = [
  ['SS-CORE-2026-11', '00-CORE-SERVICE-TERMS.md'],
  ['SS-CUST-RES-ONE', '01-RESIDENTIAL-ONE-TIME-CLEANING-AGREEMENT.md'],
  ['SS-CUST-RES-REC', '02-RECURRING-RESIDENTIAL-CLEANING-AGREEMENT.md'],
  ['SS-CUST-DEEP', '03-DEEP-CLEANING-SCOPE-AND-TERMS.md'],
  ['SS-CUST-MOVE', '04-MOVE-IN-MOVE-OUT-SERVICE-AGREEMENT.md'],
  ['SS-CUST-STR', '05-VACATION-RENTAL-STR-SERVICE-AGREEMENT.md'],
  ['SS-CUST-COM', '06-COMMERCIAL-CLEANING-SERVICE-AGREEMENT.md'],
  ['SS-CUST-CHURCH', '07-CHURCH-FACILITY-CLEANING-AGREEMENT.md'],
  ['SS-CUST-ACCESS', '08-CUSTOMER-SERVICE-ACCESS-AUTHORIZATION.md'],
  ['SS-CUST-CANCEL', '09-CANCELLATION-AND-RESCHEDULING-TERMS.md'],
  ['SS-CUST-ADDON', '10-ADDITIONAL-SERVICE-ADD-ON-AUTHORIZATION.md'],
  ['SS-CUST-PHOTO', '11-CUSTOMER-PHOTO-AND-MARKETING-CONSENT.md'],
  ['SS-CUST-AUTOPAY', '12-RECURRING-PAYMENT-AUTHORIZATION.md'],
  ['SS-EMP-HANDBOOK', 'EMP-ONBOARD-HANDBOOK-ACKNOWLEDGMENT.md'],
  ['SS-EMP-PRIVACY', 'EMP-ONBOARD-CONFIDENTIALITY-PRIVACY.md'],
  ['SS-EMP-TIME', 'EMP-ONBOARD-TIMEKEEPING-GPS.md'],
];

test('every required legal template exists with its ID, version, draft status and current brand', () => {
  assert.ok(fs.existsSync(registerPath), 'legal register exists');
  const register = fs.readFileSync(registerPath, 'utf8');
  for (const [id, file] of required) {
    const directory = file.startsWith('EMP-') ? employeeDir : templateDir;
    const absolute = path.join(directory, file);
    assert.ok(fs.existsSync(absolute), `${file} exists`);
    const text = fs.readFileSync(absolute, 'utf8');
    assert.match(text, new RegExp(`\\*\\*Document ID:\\*\\*\\s*${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), `${file} carries ${id}`);
    assert.match(text, /\*\*Version:\*\*\s*2026-11-19\.v1/, `${file} is versioned`);
    assert.match(text, /DRAFT|Draft/, `${file} is marked draft`);
    assert.match(register, new RegExp(id), `${id} is in the register`);
  }
  for (const file of fs.readdirSync(templateDir).filter((name) => name.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(templateDir, file), 'utf8');
    assert.match(text, /Sparkling Standard Cleaning Co\./, `${file} uses the current public name`);
    assert.match(text, /Sparkling Standard LLC/, `${file} uses the legal entity`);
    assert.match(text, /Standards That Sparkle/, `${file} uses the approved slogan`);
    assert.match(text, /\(850\) 426-8479/, `${file} carries the approved phone`);
    assert.doesNotMatch(text, /attorney[- ]approved|attorney approved/i, `${file} never claims attorney approval`);
    assert.doesNotMatch(text, /insured for \$|\\\$[0-9,]+ (?:of )?coverage|fully bonded/i, `${file} invents no coverage claim`);
  }
});

test('autopay is explicitly inactive and the approved logo is the only legal-document mark', () => {
  const autopay = fs.readFileSync(path.join(templateDir, '12-RECURRING-PAYMENT-AUTHORIZATION.md'), 'utf8');
  assert.match(autopay, /NOT ACTIVE/);
  assert.match(autopay, /not authorize a charge today/i);
  assert.ok(!fs.existsSync('public/brand/approved-icon-master-1024.png'));
  assert.ok(fs.existsSync('docs/brand/archive/retired-gold-s-monogram-1024.png'));
  assert.ok(fs.existsSync('public/brand/logo-primary.svg'));
  const logoAuthority = fs.readFileSync('docs/brand/LOGO-AUTHORITY.md', 'utf8');
  assert.match(logoAuthority, /Elegant Gold S Floral Emblem\.png/);
  assert.match(logoAuthority, /not[\s\S]{0,80}approved/i);
  for (const file of fs.readdirSync(templateDir).filter((name) => name.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(templateDir, file), 'utf8');
    assert.doesNotMatch(text, /Elegant Gold S Floral Emblem/i);
  }
});

test('the legal renderer emits branded HTML with the approved logo and document metadata', async () => {
  const out = await fsp.mkdtemp(path.join(os.tmpdir(), 'ss-legal-render-'));
  const output = execFileSync(process.execPath, [
    'scripts/render-legal-docs.mjs',
    '--out', out,
    '--only', '01-RESIDENTIAL-ONE-TIME-CLEANING-AGREEMENT',
    '--no-pdf',
  ], { encoding: 'utf8' });
  const report = JSON.parse(output);
  assert.equal(report.rendered.length, 1);
  const html = await fsp.readFile(path.join(out, '01-RESIDENTIAL-ONE-TIME-CLEANING-AGREEMENT.html'), 'utf8');
  assert.match(html, /data:image\/png;base64,/);
  assert.match(html, /Sparkling Standard Cleaning Co\./);
  assert.match(html, /Standards That Sparkle\./);
  assert.match(html, /SS-CUST-RES-ONE/);
  assert.match(html, /2026-11-19\.v1/);
  assert.match(html, /DRAFT FOR OWNER AND QUALIFIED FLORIDA COUNSEL REVIEW/);
  await fsp.rm(out, { recursive: true, force: true });
});
