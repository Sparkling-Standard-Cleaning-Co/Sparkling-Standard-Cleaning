/**
 * Owner-controlled document management, bundle policy and electronic signing.
 *
 * Templates become enforceable only after an owner approves them. Draft
 * templates are stored but never satisfy or create a gate. Every signing
 * request snapshots the exact requirement set, version and content hash so a
 * later policy change cannot rewrite what a customer or employee signed.
 */
import type { D1Database } from '../admin/d1.ts';
import { hashToken, randomToken } from '../admin/auth.ts';
import { AdminAuthError, audit } from '../admin/operations.ts';
import { EMAIL_ROUTING } from '../../config/email-routing.ts';
import { legalPolicyConfig } from '../../config/legal-policy.ts';
import { buildBookingDocumentVariables } from './agreement-variables.ts';
import { buildExecutedAgreementPdf } from './agreement-pdf.ts';

export const SIGNING_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ESIGN_CONSENT_VERSION = '2026-11-01.esign-consent.v1';

export type EnforcementStage =
  | 'before_payment'
  | 'before_confirmation'
  | 'before_employee_activation'
  | 'optional';

export type SubjectType = 'customer' | 'employee';

export interface DocumentSubjectContext {
  subjectType: SubjectType;
  serviceCode?: string;
  frequency?: string;
  accessAuthorization?: boolean;
  customerProducts?: boolean;
  role?: string;
  customerId?: string;
  teamMemberId?: string;
  propertyId?: string;
  bookingRequestId?: string;
  appointmentId?: string;
  recurringPlanId?: string;
  bookingReference?: string;
  email?: string;
  customerLegalName?: string;
  serviceScope?: string;
  serviceAdditions?: string;
  serviceExclusions?: string;
  serviceDate?: string;
  arrivalWindow?: string;
  priceSummary?: string;
  lineItems?: string;
  taxSummary?: string;
  discountSummary?: string;
  paymentTerms?: string;
  cancellationTerms?: string;
  agreementVersion?: string;
  effectiveDate?: string;
  signatureName?: string;
}

export interface TemplateRow extends Record<string, unknown> {
  id: string;
  title: string;
  category: string;
  version: string;
  status: 'draft' | 'approved' | 'retired';
  source_kind: 'text' | 'pdf';
  content_text: string;
  content_sha256: string;
  r2_key: string;
  signer_party: 'customer' | 'employee' | 'both';
  requires_countersignature: number;
  requires_verification: number;
}

export interface Requirement {
  templateId: string;
  title: string;
  version: string;
  contentText: string;
  contentSha256: string;
  templateSha256?: string;
  missingVariables?: string[];
  r2Key: string;
  signerParty: 'customer' | 'employee' | 'both';
  requiresCountersignature: boolean;
  requiresVerification: boolean;
  required: boolean;
  perBooking: boolean;
  stage: EnforcementStage;
  sortOrder: number;
}

export interface RequirementSnapshot extends Requirement {
  bundleCode: string;
  bundleVersion: number;
}

export interface DocumentGateResult {
  satisfied: boolean;
  bundleCode: string;
  stage: EnforcementStage;
  requirements: Requirement[];
  missing: Array<{ templateId: string; title: string; stage: EnforcementStage }>;
}

function text(value: unknown, max = 4000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function now(): string {
  return new Date().toISOString();
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function splitValues(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function normalizedService(serviceCode: string, frequency = ''): string {
  const raw = serviceCode.toLowerCase();
  const rhythm = frequency.toLowerCase();
  // Explicit service codes win over a schedule rhythm. A weekly commercial or
  // church job must not be reclassified as residential recurring.
  if (raw.includes('church')) return 'church';
  if (raw.includes('commercial') || raw.includes('office') || raw.includes('facility')) return 'commercial';
  if (raw.includes('property') || raw.includes('real estate') || raw.includes('real-estate') || raw.includes('hoa')) return 'property_management';
  if (raw.includes('str') || raw.includes('turnover') || raw.includes('rental')) return 'str';
  if (raw.includes('move')) return 'move_in_out';
  if (raw.includes('deep')) return 'deep';
  if (raw.includes('recurring')) return 'recurring';
  if (['weekly', 'biweekly', 'monthly'].includes(rhythm)) return 'recurring';
  return 'residential';
}

/**
 * Server-safe company facts used in resolved legal documents. These mirror the
 * owner-confirmed public facts in `src/config/business.ts`; they are repeated
 * here because that module reads `import.meta.env` and is browser/build-only.
 */
export const DOCUMENT_COMPANY = {
  name: 'Sparkling Standard Cleaning Co.',
  legalName: 'Sparkling Standard LLC',
  slogan: 'Standards That Sparkle.',
  phone: '(850) 426-8479',
  email: EMAIL_ROUTING.customerService,
  website: 'https://sparkling-standard.com',
} as const;

export const DOCUMENT_VARIABLE_KEYS = [
  'company.name',
  'company.legal_name',
  'company.slogan',
  'company.phone',
  'company.email',
  'company.website',
  'customer.first_name',
  'customer.last_name',
  'customer.company_name',
  'customer.email',
  'customer.phone',
  'employee.name',
  'employee.email',
  'property.label',
  'property.address',
  'booking.reference',
  'service.code',
  'service.frequency',
  'document.version',
  'document.date',
  'customer.legal_name',
  'service.scope',
  'service.additions',
  'service.exclusions',
  'service.date',
  'service.arrival_window',
  'price.summary',
  'price.line_items',
  'price.tax',
  'price.discount',
  'payment.terms',
  'cancellation.terms',
  'agreement.version',
  'agreement.effective_date',
  'signature.name',
] as const;

export type DocumentVariableValues = Record<string, string>;

const VARIABLE_PATTERN = /\{\{\s*([a-z0-9_.]+)\s*\}\}/gi;

/** Replaces supported packet variables. Unknown or empty values are reported. */
export function resolveDocumentVariables(
  content: string,
  values: DocumentVariableValues,
): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const text = content.replace(VARIABLE_PATTERN, (match, rawKey: string) => {
    const key = rawKey.toLowerCase();
    const value = values[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    missing.add(key);
    return match;
  });
  return { text, missing: [...missing].sort() };
}

export async function loadDocumentVariables(
  db: D1Database,
  context: DocumentSubjectContext,
): Promise<DocumentVariableValues> {
  const values: DocumentVariableValues = {
    'company.name': DOCUMENT_COMPANY.name,
    'company.legal_name': DOCUMENT_COMPANY.legalName,
    'company.slogan': DOCUMENT_COMPANY.slogan,
    'company.phone': DOCUMENT_COMPANY.phone,
    'company.email': DOCUMENT_COMPANY.email,
    'company.website': DOCUMENT_COMPANY.website,
    'booking.reference': text(context.bookingReference, 120),
    'service.code': text(context.serviceCode, 80),
    'service.frequency': text(context.frequency, 40),
    'document.date': new Date().toISOString().slice(0, 10),
    'customer.legal_name': text(context.customerLegalName, 200),
    'service.scope': text(context.serviceScope, 8000),
    'service.additions': text(context.serviceAdditions, 4000),
    'service.exclusions': text(context.serviceExclusions, 4000),
    'service.date': text(context.serviceDate, 40),
    'service.arrival_window': text(context.arrivalWindow, 120),
    'price.summary': text(context.priceSummary, 2000),
    'price.line_items': text(context.lineItems, 8000),
    'price.tax': text(context.taxSummary, 1000),
    'price.discount': text(context.discountSummary, 1000),
    'payment.terms': text(context.paymentTerms, 4000),
    'cancellation.terms': text(context.cancellationTerms, 4000),
    'agreement.version': text(context.agreementVersion, 80),
    'agreement.effective_date': text(context.effectiveDate, 40),
    'signature.name': text(context.signatureName, 160),
  };
  if (context.subjectType === 'customer' && context.customerId) {
    const row = await db
      .prepare(
        `SELECT c.first_name, c.last_name, c.company_name,
                (SELECT value FROM customer_contacts cc WHERE cc.customer_id = c.id AND cc.kind = 'email'
                  ORDER BY cc.is_primary DESC, cc.created_at ASC LIMIT 1) AS email,
                (SELECT value FROM customer_contacts cc WHERE cc.customer_id = c.id AND cc.kind = 'phone'
                  ORDER BY cc.is_primary DESC, cc.created_at ASC LIMIT 1) AS phone
         FROM customers c WHERE c.id = ? LIMIT 1`,
      )
      .bind(context.customerId)
      .first<Record<string, unknown>>();
    if (row) {
      values['customer.first_name'] = text(row.first_name, 120);
      values['customer.last_name'] = text(row.last_name, 120);
      values['customer.company_name'] = text(row.company_name, 200);
      values['customer.email'] = text(row.email, 200);
      values['customer.phone'] = text(row.phone, 40);
      values['customer.legal_name'] = text(row.company_name, 200) || [text(row.first_name, 120), text(row.last_name, 120)].filter(Boolean).join(' ');
    }
  }
  if (context.subjectType === 'employee' && context.teamMemberId) {
    const row = await db
      .prepare('SELECT display_name, email FROM team_members WHERE id = ? LIMIT 1')
      .bind(context.teamMemberId)
      .first<Record<string, unknown>>();
    if (row) {
      values['employee.name'] = text(row.display_name, 160);
      values['employee.email'] = text(row.email, 200);
    }
  }
  if (context.propertyId) {
    const row = await db
      .prepare(
        'SELECT label, line1, line2, city, state, postal_code FROM properties WHERE id = ? LIMIT 1',
      )
      .bind(context.propertyId)
      .first<Record<string, unknown>>();
    if (row) {
      values['property.label'] = text(row.label, 120);
      values['property.address'] = [
        row.line1,
        row.line2,
        row.city,
        row.state,
        row.postal_code,
      ]
        .map((part) => text(part, 160))
        .filter(Boolean)
        .join(', ');
    }
  }
  if (context.bookingRequestId) {
    const request = await db
      .prepare(
        `SELECT payload_json, requested_date, start_at, end_at, quote_reference
         FROM booking_requests WHERE id = ? LIMIT 1`,
      )
      .bind(context.bookingRequestId)
      .first<Record<string, unknown>>()
      .catch(() => null);
    if (request) {
      let fields: Record<string, string> = {};
      try {
        const parsed = JSON.parse(String(request.payload_json || '{}')) as Record<string, unknown>;
        fields = Object.fromEntries(
          Object.entries(parsed).filter(([, value]) => typeof value === 'string'),
        ) as Record<string, string>;
      } catch {
        fields = {};
      }
      const derived = buildBookingDocumentVariables({
        fields,
        requestedDate: text(request.requested_date, 40),
        startAt: text(request.start_at, 40),
        endAt: text(request.end_at, 40),
        agreementVersion: context.agreementVersion || legalPolicyConfig.version,
      });
      for (const [key, value] of Object.entries(derived)) {
        if (value && !values[key]) values[key] = value;
      }
    }
  }
  return values;
}

async function resolveRequirementVariables(
  requirements: Requirement[],
  values: DocumentVariableValues,
): Promise<{ requirements: Requirement[]; missing: string[] }> {
  const allMissing = new Set<string>();
  const resolved: Requirement[] = [];
  for (const requirement of requirements) {
    const outcome = resolveDocumentVariables(requirement.contentText, {
      ...values,
      'document.version': requirement.version,
    });
    for (const key of outcome.missing) allMissing.add(key);
    resolved.push({
      ...requirement,
      templateSha256: requirement.contentSha256,
      contentText: requirement.contentText ? outcome.text : '',
      contentSha256: requirement.contentText
        ? await sha256Hex(outcome.text)
        : requirement.contentSha256,
      ...(outcome.missing.length ? { missingVariables: outcome.missing } : {}),
    });
  }
  return { requirements: resolved, missing: [...allMissing].sort() };
}

function conditionMatches(item: Record<string, unknown>, context: DocumentSubjectContext): boolean {
  const key = text(item.condition_key, 60).toLowerCase();
  if (!key) return true;
  const values = splitValues(text(item.condition_value, 300));
  if (key === 'frequency') return values.includes((context.frequency ?? '').toLowerCase());
  if (key === 'access_authorization') {
    const expected = values.includes('yes') || values.includes('true');
    return (context.accessAuthorization === true) === expected;
  }
  if (key === 'customer_products') {
    const expected = values.includes('yes') || values.includes('true');
    return (context.customerProducts === true) === expected;
  }
  if (key === 'role') return values.includes((context.role ?? '').toLowerCase());
  if (key === 'service') {
    return values.includes(normalizedService(context.serviceCode ?? '', context.frequency));
  }
  // Unknown conditions must not silently drop a required document.
  return true;
}

export async function resolveBundle(
  db: D1Database,
  context: DocumentSubjectContext,
): Promise<Record<string, unknown> | null> {
  const subject = context.subjectType;
  const service = normalizedService(context.serviceCode ?? '', context.frequency);
  const candidates =
    subject === 'employee'
      ? [
          `employee.${(context.role ?? 'cleaner').toLowerCase()}`,
          'employee.onboarding',
        ]
      : [
          `customer.${service}`,
          ...(service === 'recurring' ? ['customer.residential'] : []),
          ...(service === 'deep' ? ['customer.residential'] : []),
          ...(service === 'move_in_out' ? ['customer.residential'] : []),
        ];
  for (const code of [...new Set(candidates)]) {
    const rows = await db
      .prepare(
        `SELECT * FROM document_bundles
         WHERE code = ? AND subject_type = ? AND status = 'active' LIMIT 1`,
      )
      .bind(code, subject)
      .all<Record<string, unknown>>();
    const row = (rows.results ?? []).find((entry) => Number(entry.is_system) !== 1);
    if (row) return row;
  }
  const fallbackRows = await db
    .prepare(
      `SELECT * FROM document_bundles
       WHERE subject_type = ? AND service_category = ? AND status = 'active'
       ORDER BY created_at`,
    )
    .bind(subject, service)
    .all<Record<string, unknown>>();
  return (fallbackRows.results ?? []).find((entry) => Number(entry.is_system) !== 1) ?? null;
}

function missingColumn(error: unknown, column: string): boolean {
  const message = String((error as Error)?.message ?? error);
  return new RegExp(`no such column|has no column named`, 'i').test(message) && message.includes(column);
}

export async function activeRequirements(
  db: D1Database,
  context: DocumentSubjectContext,
  options: { bundleId?: string } = {},
): Promise<{ bundle: Record<string, unknown> | null; requirements: Requirement[] }> {
  let bundle: Record<string, unknown> | null;
  if (options.bundleId) {
    bundle = await db
      .prepare(
        `SELECT * FROM document_bundles
         WHERE id = ? AND subject_type = ? AND status = 'active' LIMIT 1`,
      )
      .bind(options.bundleId, context.subjectType)
      .first<Record<string, unknown>>();
    if (!bundle) return { bundle: null, requirements: [] };
  } else {
    bundle = await resolveBundle(db, context);
  }
  if (!bundle) return { bundle: null, requirements: [] };
  const rows = await db
    .prepare(
      `SELECT i.*, t.title, t.version, t.status AS template_status, t.source_kind, t.content_text,
              t.content_sha256, t.r2_key, t.signer_party, t.requires_countersignature,
              t.requires_verification
       FROM document_bundle_items i
       JOIN document_templates t ON t.id = i.template_id
       WHERE i.bundle_id = ? AND t.status = 'approved'
       ORDER BY i.sort_order, t.title`,
    )
    .bind(String(bundle.id))
    .all<Record<string, unknown>>();
  const requirements = (rows.results ?? [])
    .filter((row) => conditionMatches(row, context))
    .map((row) => ({
      templateId: String(row.template_id),
      title: String(row.title),
      version: String(row.version),
      contentText: String(row.content_text ?? ''),
      contentSha256: String(row.content_sha256 ?? ''),
      r2Key: String(row.r2_key ?? ''),
      signerParty: (String(row.signer_party) as Requirement['signerParty']) ?? 'customer',
      requiresCountersignature: Number(row.requires_countersignature) === 1,
      requiresVerification: Number(row.requires_verification) === 1,
      required: Number(row.required) === 1,
      perBooking: Number(row.per_booking) === 1,
      stage: String(row.enforcement_stage) as EnforcementStage,
      sortOrder: Number(row.sort_order) || 0,
    }));
  return { bundle, requirements };
}

const STAGE_ORDER: Record<EnforcementStage, number> = {
  before_payment: 0,
  before_confirmation: 1,
  before_employee_activation: 1,
  optional: 99,
};

function stageApplies(requirementStage: EnforcementStage, requested: EnforcementStage): boolean {
  if (requirementStage === 'optional') return false;
  return STAGE_ORDER[requirementStage] <= STAGE_ORDER[requested];
}

const ACCEPTED_SIGNATURE_STATUSES = new Set(['signed', 'awaiting_verification', 'verified']);

function latestSignatureState(
  rows: Array<Record<string, unknown>>,
): Map<string, { attempt: number; status: string }> {
  const latest = new Map<string, { attempt: number; status: string }>();
  for (const row of rows) {
    const templateId = String(row.template_id ?? '');
    const attempt = Number(row.attempt) || 1;
    const current = latest.get(templateId);
    if (!current || attempt > current.attempt) {
      latest.set(templateId, { attempt, status: String(row.status ?? '') });
    }
  }
  return latest;
}

async function refreshSigningRequestStatus(
  db: D1Database,
  requestId: string,
): Promise<string> {
  const request = await db
    .prepare('SELECT * FROM signing_requests WHERE id = ? LIMIT 1')
    .bind(requestId)
    .first<Record<string, unknown>>();
  if (!request) throw new AdminAuthError(404, 'signing_request_not_found');
  const parsed = JSON.parse(String(request.requirement_snapshot_json || '[]')) as unknown;
  const requirements = Array.isArray(parsed)
    ? (parsed as RequirementSnapshot[]).filter((item) => item && item.required)
    : [];
  const rows = await db
    .prepare('SELECT template_id, status, attempt FROM document_signatures WHERE signing_request_id = ?')
    .bind(requestId)
    .all<Record<string, unknown>>();
  const latest = latestSignatureState(rows.results ?? []);
  const accepted = requirements.filter((requirement) =>
    ACCEPTED_SIGNATURE_STATUSES.has(latest.get(requirement.templateId)?.status ?? ''),
  ).length;
  const status = accepted >= requirements.length ? 'signed' : 'partially_signed';
  await db
    .prepare('UPDATE signing_requests SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, now(), requestId)
    .run();
  if (status === 'signed' && !String(request.executed_copy_text ?? '').trim()) {
    const executed = await buildExecutedCopy(db, request);
    if (executed) {
      await db
        .prepare(
          `UPDATE signing_requests
           SET executed_copy_text = ?, executed_sha256 = ?, executed_at = ?, updated_at = ?
           WHERE id = ? AND executed_copy_text = ''`,
        )
        .bind(executed.text, executed.sha256, now(), now(), requestId)
        .run();
    }
  }
  return status;
}

async function buildExecutedCopy(
  db: D1Database,
  request: Record<string, unknown>,
): Promise<{ text: string; sha256: string } | null> {  const signatures = await db
    .prepare(
      `SELECT s.*, t.title FROM document_signatures s
       JOIN document_templates t ON t.id = s.template_id
       WHERE s.signing_request_id = ?
       ORDER BY t.title, s.attempt`,
    )
    .bind(String(request.id))
    .all<Record<string, unknown>>();
  if (!signatures.results?.length) return null;
  const latest = new Map<string, Record<string, unknown>>();
  for (const row of signatures.results) {
    const id = String(row.template_id ?? '');
    const attempt = Number(row.attempt) || 1;
    const current = latest.get(id);
    if (!current || attempt > (Number(current.attempt) || 1)) latest.set(id, row);
  }
  const lines = [
    'SPARKLING STANDARD LLC',
    'EXECUTED DOCUMENT COPY',
    '',
    `Signing request: ${String(request.id)}`,
    `Bundle: ${String(request.bundle_code ?? '')} v${String(request.bundle_version ?? '')}`,
    `Subject type: ${String(request.subject_type ?? '')}`,
    `Customer: ${String(request.customer_id ?? '')}`,
    `Employee: ${String(request.team_member_id ?? '')}`,
    `Booking reference: ${String(request.booking_reference ?? '')}`,
    `Service: ${String(request.service_code ?? '')}`,
    `Executed at: ${now()}`,
    `Countersigned by: ${String(request.counter_signature_name ?? '') || 'not required'}`,
    '',
  ];
  for (const row of latest.values()) {
    const signature = (() => {
      try {
        return JSON.parse(String(row.signature_json ?? '{}')) as { value?: string; consentVersion?: string };
      } catch {
        return {};
      }
    })();
    lines.push(
      '------------------------------------------------------------',
      `Document: ${String(row.title ?? row.template_id ?? '')}`,
      `Version: ${String(row.template_version ?? '')}`,
      `SHA-256: ${String(row.document_sha256 ?? '')}`,
      `Signer: ${String(row.signer_name ?? '')} <${String(row.signer_email ?? '')}>`,
      `Signed at: ${String(row.signed_at ?? '')}`,
      `Consent: ${String(row.consent_version ?? signature.consentVersion ?? '')}`,
      `Status: ${String(row.status ?? '')}`,
      `Typed signature: ${String(signature.value ?? '')}`,
      '',
    );
  }
  const text = lines.join('\n');
  return { text, sha256: await sha256Hex(text) };
}

/**
 * Builds the executed agreement PDF from the immutable signing snapshot and
 * the latest signature rows. The PDF is generated in the Function runtime with
 * the shared dependency-free renderer; no browser or external service is used.
 */
export async function getExecutedAgreementPdf(
  db: D1Database,
  requestId: string,
): Promise<{ pdf: Uint8Array; sha256: string } | null> {
  const request = await db
    .prepare('SELECT * FROM signing_requests WHERE id = ? LIMIT 1')
    .bind(requestId)
    .first<Record<string, unknown>>();
  if (!request) return null;
  const signatureRows = await db
    .prepare(
      `SELECT s.*, t.title FROM document_signatures s
       JOIN document_templates t ON t.id = s.template_id
       WHERE s.signing_request_id = ?
       ORDER BY t.title, s.attempt`,
    )
    .bind(requestId)
    .all<Record<string, unknown>>();
  if (!signatureRows.results?.length) return null;
  const latest = new Map<string, Record<string, unknown>>();
  for (const row of signatureRows.results) {
    const templateId = String(row.template_id ?? '');
    const attempt = Number(row.attempt) || 1;
    const current = latest.get(templateId);
    if (!current || attempt > (Number(current.attempt) || 1)) latest.set(templateId, row);
  }
  const signatures = [...latest.values()]
    .filter((row) => ['signed', 'verified', 'awaiting_verification'].includes(String(row.status ?? '')))
    .map((row) => {
      const signature = (() => {
        try {
          return JSON.parse(String(row.signature_json ?? '{}')) as { value?: string };
        } catch {
          return {};
        }
      })();
      const content = String(row.signed_content_text ?? '');
      return {
        title: String(row.title ?? row.template_id ?? 'Document'),
        version: String(row.template_version ?? ''),
        templateId: String(row.template_id ?? ''),
        contentText: content,
        contentSha256: String(row.document_sha256 ?? ''),
        signerName: String(row.signer_name ?? ''),
        signerEmail: String(row.signer_email ?? ''),
        signedAt: String(row.signed_at ?? ''),
        typedSignature: String(signature.value ?? ''),
        status: String(row.status ?? ''),
        consentVersion: String(row.consent_version ?? ''),
        sourceKind: content.trim() ? ('text' as const) : ('pdf' as const),
      };
    });
  if (!signatures.length) return null;

  let customerName = '';
  if (request.customer_id) {
    const customer = await db
      .prepare('SELECT first_name, last_name, company_name FROM customers WHERE id = ? LIMIT 1')
      .bind(String(request.customer_id))
      .first<Record<string, unknown>>()
      .catch(() => null);
    if (customer) {
      customerName =
        String(customer.company_name ?? '').trim() ||
        [String(customer.first_name ?? '').trim(), String(customer.last_name ?? '').trim()]
          .filter(Boolean)
          .join(' ');
    }
  }
  let propertyAddress = '';
  if (request.property_id) {
    const property = await db
      .prepare('SELECT line1, line2, city, state, postal_code FROM properties WHERE id = ? LIMIT 1')
      .bind(String(request.property_id))
      .first<Record<string, unknown>>()
      .catch(() => null);
    if (property) {
      propertyAddress = [property.line1, property.line2, property.city, property.state, property.postal_code]
        .map((part) => (typeof part === 'string' ? part.trim() : ''))
        .filter(Boolean)
        .join(', ');
    }
  }

  const pdf = buildExecutedAgreementPdf({
    requestId,
    bundleName: String(request.packet_name ?? request.bundle_code ?? ''),
    bundleCode: String(request.bundle_code ?? ''),
    bundleVersion: Number(request.bundle_version) || 1,
    bookingReference: String(request.booking_reference ?? ''),
    serviceCode: String(request.service_code ?? ''),
    customerName,
    propertyAddress,
    executedAt: String(request.executed_at ?? now()),
    countersignatureName: String(request.counter_signature_name ?? ''),
    signatures,
  });
  const bytes = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return { pdf, sha256 };
}

async function hasValidSignature(
  db: D1Database,
  requirement: Requirement,
  context: DocumentSubjectContext,
): Promise<boolean> {
  const requiresVerification =
    requirement.requiresVerification || requirement.requiresCountersignature;
  const statuses = requiresVerification ? "s.status = 'verified'" : "s.status IN ('signed','verified')";
  const subjectClause: string[] = [];
  const binds: unknown[] = [];
  if (context.subjectType === 'employee') {
    if (!context.teamMemberId) return false;
    subjectClause.push('sr.team_member_id = ?');
    binds.push(context.teamMemberId);
  } else if (requirement.perBooking) {
    if (!context.bookingReference) return false;
    subjectClause.push('sr.booking_reference = ?');
    binds.push(context.bookingReference);
  } else if (context.customerId) {
    subjectClause.push('sr.customer_id = ?');
    binds.push(context.customerId);
  } else if (context.bookingReference) {
    subjectClause.push('sr.booking_reference = ?');
    binds.push(context.bookingReference);
  } else {
    return false;
  }
  const row = await db
    .prepare(
      `SELECT s.id FROM document_signatures s
       JOIN signing_requests sr ON sr.id = s.signing_request_id
       WHERE s.template_id = ? AND s.template_version = ?
         AND s.attempt = (
           SELECT MAX(s2.attempt) FROM document_signatures s2
           WHERE s2.signing_request_id = s.signing_request_id AND s2.template_id = s.template_id
         )
         AND sr.status IN ('pending','partially_signed','signed')
         AND ${statuses}
         AND (${subjectClause.join(' OR ')})
       LIMIT 1`,
    )
    .bind(requirement.templateId, requirement.version, ...binds)
    .first<{ id: string }>();
  return Boolean(row);
}

export async function evaluateDocumentGate(
  db: D1Database | null | undefined,
  context: DocumentSubjectContext,
  stage: EnforcementStage,
): Promise<DocumentGateResult> {
  if (!db) {
    return { satisfied: false, bundleCode: '', stage, requirements: [], missing: [] };
  }
  const { bundle, requirements } = await activeRequirements(db, context);
  const applicable = requirements.filter((item) => item.required && stageApplies(item.stage, stage));
  if (!bundle || applicable.length === 0) {
    return {
      satisfied: true,
      bundleCode: bundle ? String(bundle.code) : '',
      stage,
      requirements,
      missing: [],
    };
  }
  const missing: DocumentGateResult['missing'] = [];
  for (const requirement of applicable) {
    if (!(await hasValidSignature(db, requirement, context))) {
      missing.push({
        templateId: requirement.templateId,
        title: requirement.title,
        stage: requirement.stage,
      });
    }
  }
  return {
    satisfied: missing.length === 0,
    bundleCode: String(bundle.code),
    stage,
    requirements,
    missing,
  };
}

export async function employeeOnboardingStatus(
  db: D1Database | null | undefined,
  teamMemberId: string,
  role = 'cleaner',
): Promise<DocumentGateResult> {
  return evaluateDocumentGate(
    db,
    { subjectType: 'employee', teamMemberId, role },
    'before_employee_activation',
  );
}

export interface CreatedSigningRequest {
  required: boolean;
  requestId?: string;
  token?: string;
  expiresAt?: string;
  bundleCode?: string;
  bundleName?: string;
  instructions?: string;
  requirements?: Requirement[];
}

async function signingSubjectIdentity(
  db: D1Database,
  context: DocumentSubjectContext,
): Promise<{ branchId: string | null; signerEmail: string }> {
  if (context.subjectType === 'employee' && context.teamMemberId) {
    const row = await db
      .prepare('SELECT branch_id, email FROM team_members WHERE id = ? LIMIT 1')
      .bind(context.teamMemberId)
      .first<{ branch_id: string | null; email: string }>();
    return {
      branchId: row?.branch_id ?? null,
      signerEmail: (row?.email ?? context.email ?? '').trim().toLowerCase(),
    };
  }
  if (context.customerId) {
    const row = await db
      .prepare(
        `SELECT c.primary_branch_id,
                (SELECT value FROM customer_contacts cc WHERE cc.customer_id = c.id AND cc.kind = 'email'
                  ORDER BY cc.is_primary DESC LIMIT 1) AS email
         FROM customers c WHERE c.id = ? LIMIT 1`,
      )
      .bind(context.customerId)
      .first<{ primary_branch_id: string | null; email: string | null }>();
    return {
      branchId: row?.primary_branch_id ?? null,
      signerEmail: (row?.email ?? context.email ?? '').trim().toLowerCase(),
    };
  }
  return { branchId: null, signerEmail: (context.email ?? '').trim().toLowerCase() };
}

export async function documentSubjectBranch(
  db: D1Database,
  context: DocumentSubjectContext,
): Promise<string | null> {
  return (await signingSubjectIdentity(db, context)).branchId;
}

export async function createSigningRequest(
  db: D1Database,
  context: DocumentSubjectContext,
  options: {
    createdByAdminUserId?: string | null;
    bundleId?: string;
    instructions?: string;
    variables?: DocumentVariableValues;
  } = {},
): Promise<CreatedSigningRequest> {
  if (!legalPolicyConfig.activation.electronicSigning) {
    throw new AdminAuthError(409, 'electronic_signing_not_activated');
  }
  const { bundle, requirements: rawRequirements } = await activeRequirements(db, context, {
    ...(options.bundleId ? { bundleId: options.bundleId } : {}),
  });
  if (!bundle) return { required: false, requirements: [] };
  const variableValues = {
    ...(await loadDocumentVariables(db, context)),
    ...(options.variables ?? {}),
  };
  const { requirements, missing } = await resolveRequirementVariables(rawRequirements, variableValues);
  const required = requirements.filter((item) => item.required);
  if (required.length === 0) return { required: false, requirements };
  if (missing.length > 0) {
    throw new AdminAuthError(409, `document_variables_missing:${missing.join(',')}`);
  }
  const instructions = text(options.instructions, 2000) || text(bundle.instructions, 2000);
  const snapshot: RequirementSnapshot[] = requirements.map((item) => ({
    ...item,
    bundleCode: String(bundle.code),
    bundleVersion: Number(bundle.version) || 1,
  }));
  const identity = await signingSubjectIdentity(db, context);
  const id = `signreq_${crypto.randomUUID()}`;
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SIGNING_TOKEN_TTL_MS).toISOString();
  const coreBinds = [
    id,
    String(bundle.id),
    String(bundle.code),
    Number(bundle.version) || 1,
    context.subjectType,
    context.customerId ?? null,
    context.teamMemberId ?? null,
    context.propertyId ?? null,
    context.bookingRequestId ?? null,
    context.appointmentId ?? null,
    context.recurringPlanId ?? null,
    text(context.bookingReference, 120),
    text(context.serviceCode, 80),
    JSON.stringify(snapshot),
    await hashToken(token),
    expiresAt,
    options.createdByAdminUserId ?? null,
    identity.branchId,
    identity.signerEmail,
  ];
  try {
    await db
      .prepare(
        `INSERT INTO signing_requests
         (id, bundle_id, bundle_code, bundle_version, subject_type, customer_id, team_member_id,
          property_id, booking_request_id, appointment_id, recurring_plan_id, booking_reference,
          service_code, status, requirement_snapshot_json, token_hash, token_expires_at,
          created_by_admin_user_id, branch_id, signer_email, packet_instructions, packet_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(...coreBinds, instructions, text(bundle.name, 200))
      .run();
  } catch (error) {
    if (!missingColumn(error, 'packet_instructions')) throw error;
    await db
      .prepare(
        `INSERT INTO signing_requests
         (id, bundle_id, bundle_code, bundle_version, subject_type, customer_id, team_member_id,
          property_id, booking_request_id, appointment_id, recurring_plan_id, booking_reference,
          service_code, status, requirement_snapshot_json, token_hash, token_expires_at,
          created_by_admin_user_id, branch_id, signer_email)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
      )
      .bind(...coreBinds)
      .run();
  }
  await audit(db, {
    actorUserId: options.createdByAdminUserId ?? null,
    action: 'documents.signing_request_created',
    entityType: 'signing_request',
    entityId: id,
    detail: String(bundle.code),
  });
  return {
    required: true,
    requestId: id,
    token,
    expiresAt,
    bundleCode: String(bundle.code),
    bundleName: text(bundle.name, 200),
    instructions,
    requirements,
  };
}

export interface PacketPreview {
  required: boolean;
  bundleId: string;
  bundleCode: string;
  bundleName: string;
  bundleVersion: number;
  instructions: string;
  requirements: Requirement[];
  missingVariables: string[];
  totalDocuments: number;
  requiredDocuments: number;
}

/**
 * Renders a packet for owner review without creating a signing request, token,
 * gate, email or audit record. Unresolved variables are reported, never hidden.
 */
export async function previewPacket(
  db: D1Database,
  context: DocumentSubjectContext,
  options: { bundleId?: string; instructions?: string; variables?: DocumentVariableValues } = {},
): Promise<PacketPreview | null> {
  const { bundle, requirements: rawRequirements } = await activeRequirements(db, context, {
    ...(options.bundleId ? { bundleId: options.bundleId } : {}),
  });
  if (!bundle) return null;
  const values = {
    ...(await loadDocumentVariables(db, context)),
    ...(options.variables ?? {}),
  };
  const { requirements, missing } = await resolveRequirementVariables(rawRequirements, values);
  return {
    required: requirements.some((item) => item.required),
    bundleId: String(bundle.id),
    bundleCode: String(bundle.code),
    bundleName: String(bundle.name ?? ''),
    bundleVersion: Number(bundle.version) || 1,
    instructions: text(options.instructions, 2000) || text(bundle.instructions, 2000),
    requirements,
    missingVariables: missing,
    totalDocuments: requirements.length,
    requiredDocuments: requirements.filter((item) => item.required).length,
  };
}

interface SigningRequestRow extends Record<string, unknown> {
  id: string;
  status: string;
  requirement_snapshot_json: string;
  token_expires_at: string;
  bundle_code: string;
  bundle_version: number;
  subject_type: SubjectType;
  customer_id: string | null;
  team_member_id: string | null;
  booking_reference: string;
  service_code: string;
  signer_email?: string;
  branch_id?: string | null;
}

export async function getSigningRequestByToken(
  db: D1Database,
  token: string,
): Promise<{ request: SigningRequestRow; requirements: RequirementSnapshot[]; signatures: Array<Record<string, unknown>> } | null> {
  if (!token) return null;
  const request = await db
    .prepare(
      `SELECT * FROM signing_requests WHERE token_hash = ? AND status IN ('pending','partially_signed','signed')
         AND token_expires_at > ? LIMIT 1`,
    )
    .bind(await hashToken(token), now())
    .first<SigningRequestRow>();
  if (!request) return null;
  const parsedSnapshot = JSON.parse(request.requirement_snapshot_json || '[]') as unknown;
  const requirements = Array.isArray(parsedSnapshot)
    ? (parsedSnapshot as RequirementSnapshot[]).filter(
        (item) => item && typeof item === 'object' && typeof item.templateId === 'string',
      )
    : [];
  const signatures = await db
    .prepare('SELECT * FROM document_signatures WHERE signing_request_id = ?')
    .bind(request.id)
    .all<Record<string, unknown>>();
  return { request, requirements, signatures: signatures.results ?? [] };
}

export interface SignInput {
  signerName: string;
  signerEmail: string;
  consent: boolean;
  signatures: Record<string, { value: string; initials?: string }>;
  request: Request;
}

export async function signSigningRequest(
  db: D1Database,
  token: string,
  input: SignInput,
): Promise<{ requestId: string; status: string; signedCount: number; requiredCount: number }> {
  const resolved = await getSigningRequestByToken(db, token);
  if (!resolved) throw new AdminAuthError(400, 'signing_link_invalid');
  const { request, requirements } = resolved;
  const signerName = text(input.signerName, 200);
  const signerEmail = text(input.signerEmail, 200).toLowerCase();
  if (!input.consent) throw new AdminAuthError(400, 'esign_consent_required');
  if (!signerName) throw new AdminAuthError(400, 'signer_name_required');
  if (!signerEmail) throw new AdminAuthError(400, 'signer_email_required');
  const boundEmail = String(request.signer_email ?? '').trim().toLowerCase();
  if (boundEmail && signerEmail !== boundEmail) {
    throw new AdminAuthError(403, 'signer_email_mismatch');
  }
  const required = requirements.filter((item) => item.required);
  const submitted = Object.values(input.signatures).filter((signature) => text(signature?.value, 200));
  if (submitted.length === 0) throw new AdminAuthError(400, 'signature_required');
  const existing = await db
    .prepare('SELECT template_id, status, attempt FROM document_signatures WHERE signing_request_id = ?')
    .bind(request.id)
    .all<Record<string, unknown>>();
  const latest = latestSignatureState(existing.results ?? []);
  const attempts = new Map<string, number>();
  for (const row of existing.results ?? []) {
    const templateId = String(row.template_id ?? '');
    attempts.set(templateId, Math.max(attempts.get(templateId) ?? 0, Number(row.attempt) || 1));
  }
  const ip = input.request.headers.get('CF-Connecting-IP') ?? '';
  const userAgent = input.request.headers.get('User-Agent') ?? '';
  let signedCount = 0;
  for (const requirement of requirements) {
    const signature = input.signatures[requirement.templateId];
    if (!signature) continue;
    const current = latest.get(requirement.templateId)?.status ?? '';
    if (ACCEPTED_SIGNATURE_STATUSES.has(current)) {
      signedCount += 1;
      continue;
    }
    if (requirement.signerParty === 'employee' && request.subject_type !== 'employee') {
      throw new AdminAuthError(400, `signer_party_mismatch:${requirement.templateId}`);
    }
    const needsReview = requirement.requiresVerification || requirement.requiresCountersignature;
    const attempt = (attempts.get(requirement.templateId) ?? 0) + 1;
    await db
      .prepare(
        `INSERT OR IGNORE INTO document_signatures
         (id, signing_request_id, template_id, template_version, document_sha256, signed_content_text,
          signer_party, signer_name, signer_email, signature_json, consent_version, signed_at,
          signed_ip_hash, signed_user_agent_hash, status, r2_key, attempt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        `sig_${crypto.randomUUID()}`,
        request.id,
        requirement.templateId,
        requirement.version,
        requirement.contentSha256,
        requirement.contentText,
        request.subject_type === 'employee' ? 'employee' : 'customer',
        signerName,
        signerEmail,
        JSON.stringify({
          type: 'typed',
          value: text(signature.value, 200),
          initials: text(signature.initials, 20),
          consentVersion: ESIGN_CONSENT_VERSION,
        }),
        ESIGN_CONSENT_VERSION,
        now(),
        ip ? await hashToken(ip) : null,
        userAgent ? await hashToken(userAgent) : null,
        needsReview ? 'awaiting_verification' : 'signed',
        requirement.r2Key,
        attempt,
      )
      .run();
    latest.set(requirement.templateId, {
      attempt,
      status: needsReview ? 'awaiting_verification' : 'signed',
    });
    attempts.set(requirement.templateId, attempt);
    signedCount += 1;
  }
  const status = await refreshSigningRequestStatus(db, request.id);
  await audit(db, {
    actorUserId: null,
    action: 'documents.signed',
    entityType: 'signing_request',
    entityId: request.id,
    detail: `${signedCount}/${required.length}`,
  });
  return { requestId: request.id, status, signedCount, requiredCount: required.length };
}

export async function rotateSigningRequestToken(
  db: D1Database,
  actorUserId: string | null,
  requestId: string,
): Promise<{ token: string; expiresAt: string; email: string; bundleCode: string }> {
  const request = await db
    .prepare(
      `SELECT sr.*, COALESCE(c.first_name || ' ' || c.last_name, tm.display_name, '') AS subject_name,
              COALESCE(
                (SELECT value FROM customer_contacts cc WHERE cc.customer_id = sr.customer_id AND cc.kind = 'email' LIMIT 1),
                tm.email, ''
              ) AS subject_email
       FROM signing_requests sr
       LEFT JOIN customers c ON c.id = sr.customer_id
       LEFT JOIN team_members tm ON tm.id = sr.team_member_id
       WHERE sr.id = ? LIMIT 1`,
    )
    .bind(requestId)
    .first<Record<string, unknown>>();
  if (!request) throw new AdminAuthError(404, 'signing_request_not_found');
  if (['void', 'expired'].includes(String(request.status))) {
    throw new AdminAuthError(409, 'signing_request_closed');
  }
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SIGNING_TOKEN_TTL_MS).toISOString();
  await db
    .prepare('UPDATE signing_requests SET token_hash = ?, token_expires_at = ?, updated_at = ? WHERE id = ?')
    .bind(await hashToken(token), expiresAt, now(), requestId)
    .run();
  await audit(db, {
    actorUserId,
    action: 'documents.signing_request_resent',
    entityType: 'signing_request',
    entityId: requestId,
  });
  return {
    token,
    expiresAt,
    email: String(request.subject_email ?? ''),
    bundleCode: String(request.bundle_code ?? ''),
  };
}

export async function verifySignature(
  db: D1Database,
  actorUserId: string,
  signatureId: string,
  approve: boolean,
  reason = '',
): Promise<void> {
  const row = await db
    .prepare('SELECT id, signing_request_id, status FROM document_signatures WHERE id = ? LIMIT 1')
    .bind(signatureId)
    .first<{ id: string; signing_request_id: string; status: string }>();
  if (!row) throw new AdminAuthError(404, 'signature_not_found');
  if (row.status === 'rejected') throw new AdminAuthError(409, 'signature_rejected');
  if (row.status === 'verified' && approve) return;
  if (row.status !== 'signed' && row.status !== 'awaiting_verification') {
    throw new AdminAuthError(409, 'signature_not_reviewable');
  }
  await db
    .prepare(
      `UPDATE document_signatures
       SET status = ?, verified_by_admin_user_id = ?, verified_at = ?, rejection_reason = ?
       WHERE id = ? AND status IN ('signed','awaiting_verification')`,
    )
    .bind(approve ? 'verified' : 'rejected', actorUserId, now(), text(reason, 500), signatureId)
    .run();
  await refreshSigningRequestStatus(db, row.signing_request_id);
  await audit(db, {
    actorUserId,
    action: approve ? 'documents.signature_verified' : 'documents.signature_rejected',
    entityType: 'document_signature',
    entityId: signatureId,
    detail: text(reason, 200),
  });
}

export interface TemplateInput {
  title: string;
  category?: string;
  version?: string;
  contentText?: string;
  contentSha256?: string;
  r2Key?: string;
  sourceKind?: 'text' | 'pdf';
  signerParty?: 'customer' | 'employee' | 'both';
  requiresCountersignature?: boolean;
  requiresVerification?: boolean;
  familyKey?: string;
  effectiveDate?: string;
  legalReviewStatus?: string;
  packetNotes?: string;
  supersedesTemplateId?: string;
}

export type LegalReviewStatus =
  | 'not_reviewed'
  | 'owner_review_required'
  | 'owner_approved'
  | 'attorney_review_required'
  | 'attorney_reviewed';

const LEGAL_REVIEW_STATUSES = new Set<string>([
  'not_reviewed',
  'owner_review_required',
  'owner_approved',
  'attorney_review_required',
  'attorney_reviewed',
]);

export async function createTemplate(
  db: D1Database,
  actorUserId: string,
  input: TemplateInput,
): Promise<{ id: string }> {
  const title = text(input.title, 200);
  if (!title) throw new AdminAuthError(400, 'document_title_required');
  const contentText = text(input.contentText, 200_000);
  const sourceKind = input.sourceKind ?? (input.r2Key ? 'pdf' : 'text');
  const contentSha256 = text(input.contentSha256, 64) || (contentText ? await sha256Hex(contentText) : '');
  if (sourceKind === 'text' && !contentText) throw new AdminAuthError(400, 'document_content_required');
  if (sourceKind === 'pdf' && !text(input.r2Key, 500)) throw new AdminAuthError(400, 'document_file_required');
  const id = `doc_${crypto.randomUUID()}`;
  const legalReviewStatus = LEGAL_REVIEW_STATUSES.has(String(input.legalReviewStatus))
    ? String(input.legalReviewStatus)
    : 'not_reviewed';
  const familyKey =
    text(input.familyKey, 120).toLowerCase().replace(/[^a-z0-9._-]+/g, '-') ||
    title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) ||
    id;
  const coreValues = [
    id,
    title,
    text(input.category, 80) || 'general',
    text(input.version, 40) || '1.0',
    sourceKind,
    contentText,
    contentSha256,
    text(input.r2Key, 500),
    input.signerParty ?? 'customer',
    input.requiresCountersignature ? 1 : 0,
    input.requiresVerification ? 1 : 0,
    actorUserId,
  ];
  try {
    await db
      .prepare(
        `INSERT INTO document_templates
         (id, title, category, version, status, source_kind, content_text, content_sha256, r2_key,
          signer_party, requires_countersignature, requires_verification, created_by_admin_user_id,
          family_key, effective_date, legal_review_status, packet_notes, supersedes_template_id)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        ...coreValues,
        familyKey,
        text(input.effectiveDate, 10),
        legalReviewStatus,
        text(input.packetNotes, 1000),
        text(input.supersedesTemplateId, 100) || null,
      )
      .run();
  } catch (error) {
    if (!missingColumn(error, 'family_key')) throw error;
    await db
      .prepare(
        `INSERT INTO document_templates
         (id, title, category, version, status, source_kind, content_text, content_sha256, r2_key,
          signer_party, requires_countersignature, requires_verification, created_by_admin_user_id)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(...coreValues)
      .run();
  }
  await audit(db, {
    actorUserId,
    action: 'documents.template_created',
    entityType: 'document_template',
    entityId: id,
  });
  return { id };
}

export async function approveTemplate(
  db: D1Database,
  actorUserId: string,
  templateId: string,
): Promise<void> {
  const result = await db
    .prepare(
      "UPDATE document_templates SET status = 'approved', approved_by_admin_user_id = ?, approved_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'",
    )
    .bind(actorUserId, now(), now(), templateId)
    .run();
  if (!result.success) throw new AdminAuthError(400, 'document_approval_failed');
  await audit(db, {
    actorUserId,
    action: 'documents.template_approved',
    entityType: 'document_template',
    entityId: templateId,
  });
}

export async function retireTemplate(
  db: D1Database,
  actorUserId: string,
  templateId: string,
): Promise<void> {
  await db
    .prepare(
      "UPDATE document_templates SET status = 'retired', archived_at = ?, updated_at = ? WHERE id = ?",
    )
    .bind(now(), now(), templateId)
    .run();
  await audit(db, {
    actorUserId,
    action: 'documents.template_retired',
    entityType: 'document_template',
    entityId: templateId,
  });
}

/**
 * Edits a draft template only. Approved content is immutable; a change to an
 * approved document must be created as a new version.
 */
export async function updateDraftTemplate(
  db: D1Database,
  actorUserId: string,
  templateId: string,
  input: TemplateInput,
): Promise<void> {
  const existing = await db
    .prepare('SELECT * FROM document_templates WHERE id = ? LIMIT 1')
    .bind(templateId)
    .first<Record<string, unknown>>();
  if (!existing) throw new AdminAuthError(404, 'template_not_found');
  if (String(existing.status) !== 'draft') throw new AdminAuthError(409, 'template_not_editable');
  const sourceKind = String(existing.source_kind) === 'pdf' ? 'pdf' : 'text';
  const contentText = input.contentText === undefined ? String(existing.content_text ?? '') : text(input.contentText, 200_000);
  if (sourceKind === 'text' && !contentText) throw new AdminAuthError(400, 'document_content_required');
  const contentSha256 = contentText ? await sha256Hex(contentText) : text(existing.content_sha256, 64);
  const legalReviewStatus = LEGAL_REVIEW_STATUSES.has(String(input.legalReviewStatus))
    ? String(input.legalReviewStatus)
    : String(existing.legal_review_status ?? 'not_reviewed');
  await db
    .prepare(
      `UPDATE document_templates
       SET title = ?, category = ?, version = ?, content_text = ?, content_sha256 = ?,
           signer_party = ?, requires_countersignature = ?, requires_verification = ?,
           effective_date = ?, legal_review_status = ?, packet_notes = ?, updated_at = ?
       WHERE id = ? AND status = 'draft'`,
    )
    .bind(
      text(input.title, 200) || String(existing.title),
      text(input.category, 80) || String(existing.category ?? 'general'),
      text(input.version, 40) || String(existing.version),
      contentText,
      contentSha256,
      input.signerParty ?? String(existing.signer_party ?? 'customer'),
      input.requiresCountersignature === undefined
        ? Number(existing.requires_countersignature)
        : input.requiresCountersignature ? 1 : 0,
      input.requiresVerification === undefined
        ? Number(existing.requires_verification)
        : input.requiresVerification ? 1 : 0,
      input.effectiveDate === undefined ? existing.effective_date ?? null : text(input.effectiveDate, 10) || null,
      legalReviewStatus,
      input.packetNotes === undefined ? String(existing.packet_notes ?? '') : text(input.packetNotes, 1000),
      now(),
      templateId,
    )
    .run();
  await audit(db, {
    actorUserId,
    action: 'documents.template_draft_updated',
    entityType: 'document_template',
    entityId: templateId,
  });
}

export async function duplicateTemplate(
  db: D1Database,
  actorUserId: string,
  templateId: string,
  input: { title?: string; version?: string } = {},
): Promise<{ id: string }> {
  const row = await db
    .prepare('SELECT * FROM document_templates WHERE id = ? LIMIT 1')
    .bind(templateId)
    .first<Record<string, unknown>>();
  if (!row) throw new AdminAuthError(404, 'template_not_found');
  const title = text(input.title, 200) || `${String(row.title)} (copy)`;
  const version = text(input.version, 40) || String(row.version);
  const existing = await db
    .prepare('SELECT id FROM document_templates WHERE title = ? AND version = ? LIMIT 1')
    .bind(title, version)
    .first<{ id: string }>();
  if (existing) throw new AdminAuthError(409, 'template_copy_exists');
  const id = `doc_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO document_templates
       (id, title, category, version, status, source_kind, content_text, content_sha256, r2_key,
        signer_party, requires_countersignature, requires_verification, created_by_admin_user_id,
        family_key, effective_date, legal_review_status, packet_notes, supersedes_template_id)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      title,
      String(row.category ?? 'general'),
      version,
      String(row.source_kind ?? 'text'),
      String(row.content_text ?? ''),
      String(row.content_sha256 ?? ''),
      String(row.r2_key ?? ''),
      String(row.signer_party ?? 'customer'),
      Number(row.requires_countersignature) ? 1 : 0,
      Number(row.requires_verification) ? 1 : 0,
      actorUserId,
      String(row.family_key || row.id),
      row.effective_date ?? null,
      'not_reviewed',
      String(row.packet_notes ?? ''),
      String(row.id),
    )
    .run();
  await audit(db, {
    actorUserId,
    action: 'documents.template_duplicated',
    entityType: 'document_template',
    entityId: id,
    detail: templateId,
  });
  return { id };
}

/** Restores a retired template to draft review; it never becomes approved. */
export async function restoreTemplate(
  db: D1Database,
  actorUserId: string,
  templateId: string,
): Promise<void> {
  let result;
  try {
    result = await db
      .prepare(
        "UPDATE document_templates SET status = 'draft', archived_at = NULL, restored_at = ?, updated_at = ? WHERE id = ? AND status = 'retired'",
      )
      .bind(now(), now(), templateId)
      .run();
  } catch (error) {
    if (!missingColumn(error, 'restored_at')) throw error;
    result = await db
      .prepare(
        "UPDATE document_templates SET status = 'draft', archived_at = NULL, updated_at = ? WHERE id = ? AND status = 'retired'",
      )
      .bind(now(), templateId)
      .run();
  }
  if (!result.success) throw new AdminAuthError(400, 'document_restore_failed');
  await audit(db, {
    actorUserId,
    action: 'documents.template_restored',
    entityType: 'document_template',
    entityId: templateId,
  });
}

export async function templateHistory(
  db: D1Database,
  templateId: string,
): Promise<Array<Record<string, unknown>>> {
  const rows = await db
    .prepare(
      `SELECT action, success, detail_json, created_at FROM admin_audit
       WHERE entity_type = 'document_template' AND entity_id = ?
       ORDER BY created_at DESC LIMIT 100`,
    )
    .bind(templateId)
    .all();
  return rows.results ?? [];
}

export async function getTemplate(
  db: D1Database,
  templateId: string,
): Promise<Record<string, unknown> | null> {
  return db.prepare('SELECT * FROM document_templates WHERE id = ? LIMIT 1').bind(templateId).first<Record<string, unknown>>();
}

export async function createBundle(
  db: D1Database,
  actorUserId: string,
  input: Record<string, unknown>,
): Promise<{ id: string }> {
  const code = text(input.code, 80).toLowerCase();
  const name = text(input.name, 160);
  if (!/^[a-z0-9][a-z0-9._-]{1,79}$/.test(code) || !name) {
    throw new AdminAuthError(400, 'bundle_fields_required');
  }
  const id = `bundle_${crypto.randomUUID()}`;
  const subjectType = input.subjectType === 'employee' ? 'employee' : 'customer';
  const purpose = ['customer', 'employee', 'operational'].includes(String(input.purpose))
    ? String(input.purpose)
    : subjectType;
  try {
    await db
      .prepare(
        `INSERT INTO document_bundles
         (id, code, name, description, service_category, subject_type, status, version,
          created_by_admin_user_id, purpose, packet_type, instructions)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        code,
        name,
        text(input.description, 500),
        text(input.serviceCategory, 60) || 'general',
        subjectType,
        actorUserId,
        purpose,
        text(input.packetType, 60).toLowerCase().replace(/[^a-z0-9._-]+/g, '_') || 'custom',
        text(input.instructions, 2000),
      )
      .run();
  } catch (error) {
    if (!missingColumn(error, 'purpose')) throw error;
    await db
      .prepare(
        `INSERT INTO document_bundles
         (id, code, name, description, service_category, subject_type, status, version, created_by_admin_user_id)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 1, ?)`,
      )
      .bind(
        id,
        code,
        name,
        text(input.description, 500),
        text(input.serviceCategory, 60) || 'general',
        subjectType,
        actorUserId,
      )
      .run();
  }
  await audit(db, {
    actorUserId,
    action: 'documents.bundle_created',
    entityType: 'document_bundle',
    entityId: id,
    detail: code,
  });
  return { id };
}

export async function updateBundle(
  db: D1Database,
  actorUserId: string,
  bundleId: string,
  input: Record<string, unknown>,
): Promise<void> {
  const bundle = await db
    .prepare('SELECT * FROM document_bundles WHERE id = ? LIMIT 1')
    .bind(bundleId)
    .first<Record<string, unknown>>();
  if (!bundle) throw new AdminAuthError(404, 'bundle_not_found');
  try {
    await db
      .prepare(
        `UPDATE document_bundles
         SET name = ?, description = ?, service_category = ?, status = ?, version = version + 1,
             purpose = ?, packet_type = ?, instructions = ?, archived_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        text(input.name, 160) || bundle.name,
        input.description === undefined ? bundle.description : text(input.description, 500),
        text(input.serviceCategory, 60) || bundle.service_category,
        input.status === 'inactive' ? 'inactive' : 'active',
        ['customer', 'employee', 'operational'].includes(String(input.purpose))
          ? String(input.purpose)
          : bundle.purpose ?? bundle.subject_type,
        text(input.packetType, 60) || (bundle.packet_type ?? 'custom'),
        input.instructions === undefined ? bundle.instructions ?? '' : text(input.instructions, 2000),
        input.status === 'inactive' ? now() : null,
        now(),
        bundleId,
      )
      .run();
  } catch (error) {
    if (!missingColumn(error, 'purpose')) throw error;
    await db
      .prepare(
        `UPDATE document_bundles
         SET name = ?, description = ?, service_category = ?, status = ?, version = version + 1, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        text(input.name, 160) || bundle.name,
        input.description === undefined ? bundle.description : text(input.description, 500),
        text(input.serviceCategory, 60) || bundle.service_category,
        input.status === 'inactive' ? 'inactive' : 'active',
        now(),
        bundleId,
      )
      .run();
  }
  await audit(db, {
    actorUserId,
    action: 'documents.bundle_updated',
    entityType: 'document_bundle',
    entityId: bundleId,
  });
}

export async function duplicateBundle(
  db: D1Database,
  actorUserId: string,
  bundleId: string,
  input: { name?: string; code?: string } = {},
): Promise<{ id: string }> {
  const bundle = await db
    .prepare('SELECT * FROM document_bundles WHERE id = ? LIMIT 1')
    .bind(bundleId)
    .first<Record<string, unknown>>();
  if (!bundle) throw new AdminAuthError(404, 'bundle_not_found');
  const id = `bundle_${crypto.randomUUID()}`;
  const baseCode = `${String(bundle.code)}.copy`;
  let code = text(input.code, 80).toLowerCase() || baseCode;
  const exists = async (candidate: string): Promise<boolean> =>
    Boolean(await db.prepare('SELECT id FROM document_bundles WHERE code = ? LIMIT 1').bind(candidate).first());
  if (await exists(code)) code = `${baseCode}.${id.slice(-6)}`;
  const name = text(input.name, 160) || `${String(bundle.name)} (copy)`;
  await db
    .prepare(
      `INSERT INTO document_bundles
       (id, code, name, description, service_category, subject_type, status, version,
        created_by_admin_user_id, purpose, packet_type, instructions)
       VALUES (?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      code,
      name,
      String(bundle.description ?? ''),
      String(bundle.service_category ?? 'general'),
      String(bundle.subject_type ?? 'customer'),
      actorUserId,
      String(bundle.purpose ?? bundle.subject_type ?? 'customer'),
      String(bundle.packet_type ?? 'custom'),
      String(bundle.instructions ?? ''),
    )
    .run();
  await db
    .prepare(
      `INSERT INTO document_bundle_items
       (bundle_id, template_id, sort_order, required, enforcement_stage, condition_key, condition_value, per_booking)
       SELECT ?, template_id, sort_order, required, enforcement_stage, condition_key, condition_value, per_booking
       FROM document_bundle_items WHERE bundle_id = ?`,
    )
    .bind(id, bundleId)
    .run();
  await audit(db, {
    actorUserId,
    action: 'documents.packet_duplicated',
    entityType: 'document_bundle',
    entityId: id,
    detail: bundleId,
  });
  return { id };
}

export async function addBundleItem(
  db: D1Database,
  actorUserId: string,
  input: Record<string, unknown>,
): Promise<void> {
  const bundleId = text(input.bundleId, 100);
  const templateId = text(input.templateId, 100);
  if (!bundleId || !templateId) throw new AdminAuthError(400, 'bundle_item_fields_required');
  const template = await db
    .prepare('SELECT id, signer_party FROM document_templates WHERE id = ? LIMIT 1')
    .bind(templateId)
    .first<{ id: string; signer_party: string }>();
  if (!template) throw new AdminAuthError(404, 'template_not_found');
  const bundle = await db
    .prepare('SELECT subject_type FROM document_bundles WHERE id = ? LIMIT 1')
    .bind(bundleId)
    .first<{ subject_type: string }>();
  if (!bundle) throw new AdminAuthError(404, 'bundle_not_found');
  const stage = text(input.enforcementStage, 40) as EnforcementStage;
  if (!['before_payment', 'before_confirmation', 'before_employee_activation', 'optional'].includes(stage)) {
    throw new AdminAuthError(400, 'enforcement_stage_invalid');
  }
  if (stage === 'before_payment' && bundle.subject_type === 'employee') {
    throw new AdminAuthError(400, 'enforcement_stage_incompatible');
  }
  if (stage === 'before_employee_activation' && bundle.subject_type === 'customer') {
    throw new AdminAuthError(400, 'enforcement_stage_incompatible');
  }
  if (stage === 'before_payment' && template.signer_party === 'employee') {
    throw new AdminAuthError(400, 'enforcement_stage_incompatible');
  }
  await db
    .prepare(
      `INSERT INTO document_bundle_items
       (bundle_id, template_id, sort_order, required, enforcement_stage, condition_key,
        condition_value, per_booking)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(bundle_id, template_id) DO UPDATE SET
         sort_order = excluded.sort_order,
         required = excluded.required,
         enforcement_stage = excluded.enforcement_stage,
         condition_key = excluded.condition_key,
         condition_value = excluded.condition_value,
         per_booking = excluded.per_booking`,
    )
    .bind(
      bundleId,
      templateId,
      Math.max(0, Math.round(Number(input.sortOrder) || 0)),
      input.required === false ? 0 : 1,
      stage,
      text(input.conditionKey, 60),
      text(input.conditionValue, 300),
      input.perBooking === true ? 1 : 0,
    )
    .run();
  await db
    .prepare('UPDATE document_bundles SET version = version + 1, updated_at = ? WHERE id = ?')
    .bind(now(), bundleId)
    .run();
  await audit(db, {
    actorUserId,
    action: 'documents.bundle_item_saved',
    entityType: 'document_bundle',
    entityId: bundleId,
    detail: templateId,
  });
}

export async function removeBundleItem(
  db: D1Database,
  actorUserId: string,
  bundleId: string,
  templateId: string,
): Promise<void> {
  await db
    .prepare('DELETE FROM document_bundle_items WHERE bundle_id = ? AND template_id = ?')
    .bind(bundleId, templateId)
    .run();
  await db
    .prepare('UPDATE document_bundles SET version = version + 1, updated_at = ? WHERE id = ?')
    .bind(now(), bundleId)
    .run();
  await audit(db, {
    actorUserId,
    action: 'documents.bundle_item_removed',
    entityType: 'document_bundle',
    entityId: bundleId,
    detail: templateId,
  });
}

export async function listTemplates(db: D1Database): Promise<Array<Record<string, unknown>>> {
  try {
    const rows = await db
      .prepare(
        `SELECT id, title, category, version, status, source_kind, content_sha256, signer_party,
                requires_countersignature, requires_verification, approved_at, archived_at, created_at,
                family_key, effective_date, legal_review_status, supersedes_template_id, restored_at,
                packet_notes
         FROM document_templates ORDER BY category, title, created_at DESC`,
      )
      .all();
    return rows.results ?? [];
  } catch (error) {
    if (!missingColumn(error, 'family_key')) throw error;
    const rows = await db
      .prepare(
        `SELECT id, title, category, version, status, source_kind, content_sha256, signer_party,
                requires_countersignature, requires_verification, approved_at, archived_at, created_at
         FROM document_templates ORDER BY category, title, created_at DESC`,
      )
      .all();
    return rows.results ?? [];
  }
}

export async function listBundles(db: D1Database): Promise<Array<Record<string, unknown>>> {
  const rows = await db
    .prepare(
      `SELECT b.*,
              (SELECT COUNT(*) FROM document_bundle_items i WHERE i.bundle_id = b.id) AS document_count
       FROM document_bundles b ORDER BY b.subject_type, b.name`,
    )
    .all();
  return rows.results ?? [];
}

export async function listBundleItems(
  db: D1Database,
  bundleId: string,
): Promise<Array<Record<string, unknown>>> {
  const rows = await db
    .prepare(
      `SELECT i.*, t.title, t.version, t.status AS template_status
       FROM document_bundle_items i JOIN document_templates t ON t.id = i.template_id
       WHERE i.bundle_id = ? ORDER BY i.sort_order, t.title`,
    )
    .bind(bundleId)
    .all();
  return rows.results ?? [];
}

export async function listSigningRequests(
  db: D1Database,
  filters: { customerId?: string; teamMemberId?: string; bookingReference?: string; branchId?: string } = {},
): Promise<Array<Record<string, unknown>>> {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (filters.customerId) {
    clauses.push('sr.customer_id = ?');
    binds.push(filters.customerId);
  }
  if (filters.teamMemberId) {
    clauses.push('sr.team_member_id = ?');
    binds.push(filters.teamMemberId);
  }
  if (filters.bookingReference) {
    clauses.push('sr.booking_reference = ?');
    binds.push(filters.bookingReference);
  }
  if (filters.branchId) {
    clauses.push('sr.branch_id = ?');
    binds.push(filters.branchId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await db
    .prepare(
      `SELECT sr.id, sr.bundle_id, sr.bundle_code, sr.bundle_version, sr.subject_type,
              sr.customer_id, sr.team_member_id, sr.property_id, sr.booking_request_id,
              sr.appointment_id, sr.recurring_plan_id, sr.booking_reference, sr.service_code,
              sr.status, sr.requirement_snapshot_json, sr.token_expires_at,
              sr.branch_id, sr.signer_email, sr.executed_at, sr.executed_sha256,
              sr.counter_signature_name, sr.counter_signed_at,
              sr.created_by_admin_user_id, sr.created_at, sr.updated_at,
              c.first_name, c.last_name, tm.display_name,
              (SELECT COUNT(*) FROM document_signatures s WHERE s.signing_request_id = sr.id) AS signed_count,
              (SELECT COUNT(*) FROM document_signatures s
                 WHERE s.signing_request_id = sr.id AND s.status = 'awaiting_verification') AS awaiting_verification
       FROM signing_requests sr
       LEFT JOIN customers c ON c.id = sr.customer_id
       LEFT JOIN team_members tm ON tm.id = sr.team_member_id
       ${where}
       ORDER BY sr.created_at DESC LIMIT 200`,
    )
    .bind(...binds)
    .all();
  return rows.results ?? [];
}

export async function getSigningRequestDetails(
  db: D1Database,
  requestId: string,
): Promise<Record<string, unknown> | null> {
  const request = await db
    .prepare(
      `SELECT id, bundle_id, bundle_code, bundle_version, subject_type, customer_id,
              team_member_id, property_id, booking_request_id, appointment_id, recurring_plan_id,
              booking_reference, service_code, status, requirement_snapshot_json,
              token_expires_at, branch_id, signer_email, executed_at, executed_sha256,
              counter_signature_name, counter_signed_at, created_by_admin_user_id, created_at, updated_at
       FROM signing_requests WHERE id = ? LIMIT 1`,
    )
    .bind(requestId)
    .first<Record<string, unknown>>();
  if (!request) return null;
  const signatures = await db
    .prepare(
      `SELECT s.*, t.title, t.category FROM document_signatures s
       JOIN document_templates t ON t.id = s.template_id
       WHERE s.signing_request_id = ? ORDER BY t.title`,
    )
    .bind(requestId)
    .all();
  return { request, signatures: signatures.results ?? [] };
}

export async function getExecutedCopy(
  db: D1Database,
  requestId: string,
): Promise<{ requestId: string; text: string; sha256: string; executedAt: string | null; branchId: string | null } | null> {
  const row = await db
    .prepare(
      `SELECT id, executed_copy_text, executed_sha256, executed_at, branch_id
       FROM signing_requests WHERE id = ? LIMIT 1`,
    )
    .bind(requestId)
    .first<{
      id: string;
      executed_copy_text: string;
      executed_sha256: string;
      executed_at: string | null;
      branch_id: string | null;
    }>();
  if (!row || !row.executed_copy_text) return null;
  return {
    requestId: row.id,
    text: row.executed_copy_text,
    sha256: row.executed_sha256,
    executedAt: row.executed_at,
    branchId: row.branch_id,
  };
}

export async function countersignSigningRequest(
  db: D1Database,
  actorUserId: string,
  requestId: string,
  name: string,
): Promise<{ status: string; countersignedBy: string }> {
  const signerName = text(name, 200);
  if (!signerName) throw new AdminAuthError(400, 'countersigner_name_required');
  const request = await db
    .prepare('SELECT id, status FROM signing_requests WHERE id = ? LIMIT 1')
    .bind(requestId)
    .first<{ id: string; status: string }>();
  if (!request) throw new AdminAuthError(404, 'signing_request_not_found');
  if (!['signed', 'partially_signed'].includes(request.status)) {
    throw new AdminAuthError(409, 'signing_request_not_signable');
  }
  const statements = [
    db
      .prepare(
        `UPDATE document_signatures
         SET status = 'verified', verified_by_admin_user_id = ?, verified_at = ?
         WHERE signing_request_id = ? AND status = 'awaiting_verification'`,
      )
      .bind(actorUserId, now(), requestId),
    db
      .prepare(
        `UPDATE signing_requests SET counter_signed_by_admin_user_id = ?, counter_signed_at = ?,
           counter_signature_name = ?, executed_copy_text = '', executed_sha256 = '',
           executed_at = NULL, updated_at = ? WHERE id = ?`,
      )
      .bind(actorUserId, now(), signerName, now(), requestId),
  ];
  if (db.batch) await db.batch(statements);
  else for (const statement of statements) await statement.run();
  const status = await refreshSigningRequestStatus(db, requestId);
  await audit(db, {
    actorUserId,
    action: 'documents.countersigned',
    entityType: 'signing_request',
    entityId: requestId,
    detail: signerName,
  });
  return { status, countersignedBy: signerName };
}

export async function getSignatureForDownload(
  db: D1Database,
  signatureId: string,
): Promise<Record<string, unknown> | null> {
  return db
    .prepare(
      `SELECT s.*, t.title, t.category, t.r2_key AS template_r2_key
       FROM document_signatures s JOIN document_templates t ON t.id = s.template_id
       WHERE s.id = ? LIMIT 1`,
    )
    .bind(signatureId)
    .first<Record<string, unknown>>();
}

export async function sendSigningEmail(
  env: { RESEND_API_KEY?: string; RESEND_FROM_EMAIL?: string; PUBLIC_SITE_URL?: string },
  to: string,
  token: string,
  bundleName: string,
  idempotencyKey: string,
): Promise<boolean> {
  const { buildDocumentSigningEmail, sendAdminEmail } = await import('../admin/email.ts');
  return sendAdminEmail(
    env,
    to,
    buildDocumentSigningEmail(env, token, bundleName),
    idempotencyKey,
  );
}
