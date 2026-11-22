// Import owner-approved templates into an isolated staging D1/SQLite database
// and verify every service packet plus a complete signing/executed-PDF path.
//
// Usage:
//   node scripts/legal/import-approved-staging.mjs <staging-import.json> <db> <out-dir>
//
// This script never connects to production D1 or R2.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { normalizeImport } from './packet-policy.mjs';

const ROOT = process.cwd();
const manifestPath = process.argv[2];
const dbPath = process.argv[3];
const outDir = process.argv[4];
if (!manifestPath || !dbPath || !outDir) {
  throw new Error('usage: node scripts/legal/import-approved-staging.mjs <staging-import.json> <db> <out-dir>');
}
fs.mkdirSync(outDir, { recursive: true });
const data = normalizeImport(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
// Staging verification previews every approved packet, including services that
// remain inactive in production until their own acceptance run. Activation is
// a production release decision and is applied by the production import.
for (const packet of data.packets) packet.status = 'active';

class Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }
  bind(...values) {
    this.values = values;
    return this;
  }
  async first() {
    return this.db.prepare(this.sql).get(...this.values) ?? null;
  }
  async all() {
    return { success: true, results: this.db.prepare(this.sql).all(...this.values) };
  }
  async run() {
    this.db.prepare(this.sql).run(...this.values);
    return { success: true };
  }
}
class StagingD1 {
  constructor(file) {
    this.raw = new DatabaseSync(file);
  }
  prepare(sql) {
    return new Statement(this.raw, sql);
  }
}

const db = new StagingD1(dbPath);
for (const file of fs.readdirSync(path.join(ROOT, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
  db.raw.exec(fs.readFileSync(path.join(ROOT, 'migrations', file), 'utf8'));
}
db.raw.exec("INSERT OR IGNORE INTO branches (id, name, state, status) VALUES ('branch_pensacola','Pensacola','FL','active')");
db.raw.exec("INSERT OR IGNORE INTO admin_roles (id,name,description) VALUES ('role_staging','Staging Import','Staging-only role')");
db.raw.exec("INSERT OR IGNORE INTO admin_users (id,role_id,email,password_hash,display_name,status) VALUES ('admin_staging','role_staging','staging@sparkling-standard.test','staging-not-a-login','Staging Import','active')");

const now = new Date().toISOString();
for (const doc of data.documents) {
  db.raw.prepare(`INSERT INTO document_templates
    (id,title,category,version,status,source_kind,content_text,content_sha256,r2_key,signer_party,
     requires_countersignature,requires_verification,approved_by_admin_user_id,approved_at,created_by_admin_user_id,
     family_key,effective_date,legal_review_status,packet_notes)
    VALUES (?,?,?,?, 'approved','text',?,?,'', ?,0,0,'admin_staging',?,'admin_staging',?,?, 'owner_approved',?)`)
    .run(doc.id, doc.title, doc.category, doc.version, doc.contentText, doc.contentSha256, doc.signerParty,
      now, doc.familyKey || doc.id.toLowerCase(), now.slice(0, 10), doc.packetNotes || '');
}
for (const packet of data.packets) {
  const bundleId = `bundle_${packet.code.replace(/[^a-z0-9]+/gi, '_')}`;
  db.raw.prepare(`INSERT INTO document_bundles
    (id,code,name,description,service_category,subject_type,status,version,purpose,packet_type,instructions,is_system)
    VALUES (?,?,?,?,?,?, ?,1,?,?,?,0)`)
    .run(bundleId, packet.code, packet.name, packet.instructions || '', packet.serviceCategory, packet.subjectType,
      packet.status, packet.purpose, packet.packetType, packet.instructions || '');
  packet.items.forEach((item, order) => {
    db.raw.prepare(`INSERT INTO document_bundle_items
      (bundle_id,template_id,sort_order,required,enforcement_stage,condition_key,condition_value,per_booking)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(bundleId, item.id, order, item.required, item.stage, item.conditionKey || '', item.conditionValue || '', item.perBooking || 0);
  });
}

const policy = await import(pathToFileURL(path.join(ROOT, 'src/config/legal-policy.ts')).href);
policy.legalPolicyConfig.activation.electronicSigning = true;
const service = await import(pathToFileURL(path.join(ROOT, 'src/lib/documents/service.ts')).href);
const agreementPdf = await import(pathToFileURL(path.join(ROOT, 'src/lib/documents/agreement-pdf.ts')).href);

const customerId = 'cust_staging';
const propertyId = 'prop_staging';
db.raw.prepare("INSERT INTO customers (id,primary_branch_id,first_name,last_name,company_name,status) VALUES (?, 'branch_pensacola','Jordan','Sample','Sample Customer LLC','active')").run(customerId);
db.raw.prepare("INSERT INTO customer_contacts (id,customer_id,kind,value,normalized_value,is_primary) VALUES ('cc_staging',?,'email','sample.customer@example.test','sample.customer@example.test',1)").run(customerId);
db.raw.prepare("INSERT INTO properties (id,customer_id,branch_id,label,line1,city,state,postal_code,status) VALUES (?, ?, 'branch_pensacola','Home','100 Sample Street','Pensacola','FL','32502','active')").run(propertyId, customerId);

const variables = {
  'customer.legal_name': 'Sample Customer LLC',
  'property.address': '100 Sample Street, Pensacola, FL 32502',
  'service.scope': 'Approved service scope for staging verification.',
  'service.additions': 'None selected.',
  'service.exclusions': 'Work outside the signed schedule.',
  'service.date': '2026-12-03',
  'service.arrival_window': '8:00 a.m. to 10:00 a.m.',
  'price.summary': '$260.00',
  'price.line_items': 'Cleaning service $260.00',
  'price.tax': '$0.00',
  'price.discount': '$0.00',
  'payment.terms': 'Due upon completion unless prepaid.',
  'cancellation.terms': '48 hours or more: no fee; 24-48 hours: up to $20; less than 24 hours: up to $40; failed access: up to $40.',
  'agreement.version': '2026-11-22.remediation.v1',
  'agreement.effective_date': '2026-11-22',
};

const contexts = [
  ['customer.deep', 'residential-deep', '', 'residential'],
  ['customer.residential', 'residential-cleaning', '', 'residential'],
  ['customer.recurring', 'recurring-residential', 'biweekly', 'recurring'],
  ['customer.move_in_out', 'move-in-move-out', '', 'residential'],
  ['customer.str', 'str-turnover', '', 'residential'],
  ['customer.commercial', 'commercial-cleaning', '', 'commercial'],
  ['customer.church', 'church-cleaning', '', 'church'],
  ['customer.property_management', 'property-management', '', 'property_management'],
  ['customer.specialty_addons', 'specialty-addons', 'specialty', 'specialty'],
];
const report = {
  format: 'sparkling-standard-staging-report',
  version: 1,
  generatedAt: now,
  templates: data.documents.length,
  packets: data.packets.length,
  services: [],
  signing: null,
  errors: [],
};

for (const [bundleCode, serviceCode, frequency, bundleHint] of contexts) {
  const context = { subjectType: 'customer', customerId, propertyId, serviceCode, frequency, bookingReference: 'SS-STAGING-2026-11-22' };
  const selectedPacket = data.packets.find((packet) => packet.code === bundleCode);
  const bundleId = bundleCode === 'customer.specialty_addons' && selectedPacket
    ? `bundle_${selectedPacket.code.replace(/[^a-z0-9]+/gi, '_')}`
    : undefined;
  const preview = await service.previewPacket(db, context, { ...(bundleId ? { bundleId } : {}), variables });
  if (!preview) {
    report.errors.push(`no packet: ${bundleCode}`);
    continue;
  }
  if (preview.missingVariables.length) report.errors.push(`${bundleCode}: missing ${preview.missingVariables.join(',')}`);
  const signatures = preview.requirements.filter((item) => item.required).map((item) => ({
    title: item.title,
    version: item.version,
    templateId: item.templateId,
    contentText: item.contentText,
    contentSha256: item.contentSha256,
    signerName: 'Jordan A. Sample',
    signerEmail: 'sample.customer@example.test',
    signedAt: now,
    typedSignature: 'Jordan A. Sample',
    status: 'signed',
    consentVersion: '2026-11-01.esign-consent.v1',
    sourceKind: 'text',
  }));
  const completed = agreementPdf.buildExecutedAgreementPdf({
    requestId: `stage_${bundleCode.replace(/\./g, '_')}`,
    bundleName: preview.bundleName,
    bundleCode: preview.bundleCode,
    bundleVersion: preview.bundleVersion,
    bookingReference: 'SS-STAGING-2026-11-22',
    serviceCode,
    customerName: 'Sample Customer LLC',
    propertyAddress: '100 Sample Street, Pensacola, FL 32502',
    executedAt: now,
    countersignatureName: 'Hayli, Owner',
    signatures,
  });
  const pdfName = `${bundleCode.replace(/\./g, '-')}-completed.pdf`;
  fs.writeFileSync(path.join(outDir, pdfName), Buffer.from(completed));
  report.services.push({
    bundleCode: preview.bundleCode,
    bundleName: preview.bundleName,
    bundleVersion: preview.bundleVersion,
    documents: preview.requirements.length,
    required: preview.requirements.filter((item) => item.required).length,
    missingVariables: preview.missingVariables,
    completedPdf: pdfName,
  });
}

// Employee onboarding packet verification.
const teamMemberId = 'team_staging';
db.raw.prepare("INSERT INTO team_members (id,branch_id,display_name,email,status) VALUES (?, 'branch_pensacola','Sample Employee','sample.employee@example.test','active')").run(teamMemberId);
const employeePreview = await service.previewPacket(db, { subjectType: 'employee', teamMemberId, role: 'cleaner' }, { variables });
if (!employeePreview) {
  report.errors.push('no packet: employee.onboarding');
} else {
  if (employeePreview.missingVariables.length) report.errors.push(`employee.onboarding: missing ${employeePreview.missingVariables.join(',')}`);
  const employeeSignatures = employeePreview.requirements.filter((item) => item.required).map((item) => ({
    title: item.title,
    version: item.version,
    templateId: item.templateId,
    contentText: item.contentText,
    contentSha256: item.contentSha256,
    signerName: 'Sample Employee',
    signerEmail: 'sample.employee@example.test',
    signedAt: now,
    typedSignature: 'Sample Employee',
    status: 'signed',
    consentVersion: '2026-11-01.esign-consent.v1',
    sourceKind: 'text',
  }));
  const employeePdf = agreementPdf.buildExecutedAgreementPdf({
    requestId: 'stage_employee_onboarding',
    bundleName: employeePreview.bundleName,
    bundleCode: employeePreview.bundleCode,
    bundleVersion: employeePreview.bundleVersion,
    bookingReference: '',
    serviceCode: 'employee-onboarding',
    customerName: 'Sample Employee',
    propertyAddress: '',
    executedAt: now,
    countersignatureName: 'Hayli, Owner',
    signatures: employeeSignatures,
  });
  fs.writeFileSync(path.join(outDir, 'employee-onboarding-completed.pdf'), Buffer.from(employeePdf));
  report.services.push({
    bundleCode: employeePreview.bundleCode,
    bundleName: employeePreview.bundleName,
    bundleVersion: employeePreview.bundleVersion,
    documents: employeePreview.requirements.length,
    required: employeePreview.requirements.filter((item) => item.required).length,
    missingVariables: employeePreview.missingVariables,
    completedPdf: 'employee-onboarding-completed.pdf',
  });
}

const deepContext = { subjectType: 'customer', customerId, propertyId, serviceCode: 'residential-deep', frequency: '', bookingReference: 'SS-STAGING-DEEP' };
const created = await service.createSigningRequest(db, deepContext, { createdByAdminUserId: 'admin_staging', variables });
if (created.required && created.token) {
  const signatures = {};
  for (const requirement of created.requirements.filter((item) => item.required)) {
    signatures[requirement.templateId] = { value: 'Jordan A. Sample' };
  }
  const signed = await service.signSigningRequest(db, created.token, {
    signerName: 'Jordan A. Sample',
    signerEmail: 'sample.customer@example.test',
    consent: true,
    signatures,
    request: new Request('https://sparkling-standard.test/document-sign/'),
  });
  const executed = await service.getExecutedAgreementPdf(db, created.requestId);
  if (executed) fs.writeFileSync(path.join(outDir, 'deep-executed-signed.pdf'), Buffer.from(executed.pdf));
  report.signing = {
    requestId: created.requestId,
    status: signed.status,
    executedPdf: executed ? 'deep-executed-signed.pdf' : null,
    executedSha256: executed?.sha256 ?? null,
    requirements: created.requirements.length,
  };
} else {
  report.errors.push('deep signing request not created');
}

const templateCount = db.raw.prepare("SELECT COUNT(*) AS n FROM document_templates WHERE status='approved'").get().n;
const bundleCount = db.raw.prepare("SELECT COUNT(*) AS n FROM document_bundles WHERE status='active' AND is_system=0").get().n;
const archiveCount = db.raw.prepare("SELECT COUNT(*) AS n FROM document_templates WHERE id IN ('LEG-C2979A8B','LEG-2577DCE6','SS-EMP-CONF-2026-11')").get().n;
report.database = { path: dbPath, templates: templateCount, bundles: bundleCount, archived: archiveCount };
fs.writeFileSync(path.join(outDir, 'STAGING-REPORT.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
