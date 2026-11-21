// Owner-controlled communications and notification settings.
//
// The six department addresses are approved architecture and are not editable.
// Owners may change which department receives each operational notice, the
// reply-to department for customer-facing mail, and the wording of approved
// notification templates. Critical security and backup notices always include
// both admin and owner and cannot be redirected.
//
// This module stores configuration, previews templates, records delivery
// events and performs an explicit owner-authorized test send. It never stores
// message bodies in delivery records and never exposes provider secrets.

import { EMAIL_ROUTING } from '../../config/email-routing.ts';
import { AdminAuthError, audit, type AdminActor } from './operations.ts';
import type { D1Database } from './d1.ts';

export const DEPARTMENT_KEYS = [
  'bookings',
  'customerService',
  'billing',
  'hiring',
  'admin',
  'owner',
] as const;

export type DepartmentKey = (typeof DEPARTMENT_KEYS)[number];

export const DEPARTMENT_LABELS: Record<DepartmentKey, string> = {
  bookings: 'Bookings',
  customerService: 'Customer Service',
  billing: 'Billing',
  hiring: 'Hiring',
  admin: 'Admin',
  owner: 'Owner',
};

export const DEPARTMENT_ADDRESSES: Record<DepartmentKey, string> = {
  bookings: EMAIL_ROUTING.bookings,
  customerService: EMAIL_ROUTING.customerService,
  billing: EMAIL_ROUTING.billing,
  hiring: EMAIL_ROUTING.hiring,
  admin: EMAIL_ROUTING.admin,
  owner: EMAIL_ROUTING.owner,
};

export const NOTIFICATION_EVENTS = [
  'booking_request',
  'booking_confirmation',
  'booking_reminder',
  'invoice_delivery',
  'payment_receipt',
  'contact_inquiry',
  'careers_application',
  'hiring_notification',
  'security_alert',
  'backup_failure',
  'owner_escalation',
  'weekly_health_digest',
] as const;

export type NotificationEventKey = (typeof NOTIFICATION_EVENTS)[number];

export const EVENT_DEFINITIONS: Record<
  NotificationEventKey,
  { label: string; critical: boolean; defaults: DepartmentKey[]; description: string }
> = {
  booking_request: {
    label: 'New booking or reservation request',
    critical: false,
    defaults: ['bookings'],
    description: 'Sent when a customer requests a cleaning appointment.',
  },
  booking_confirmation: {
    label: 'Booking confirmation',
    critical: false,
    defaults: ['bookings'],
    description: 'Sent when the office confirms a booking.',
  },
  booking_reminder: {
    label: 'Appointment reminder',
    critical: false,
    defaults: ['bookings'],
    description: 'Scheduled reminder before a confirmed appointment.',
  },
  invoice_delivery: {
    label: 'Invoice delivery',
    critical: false,
    defaults: ['billing'],
    description: 'Invoice email and payment-link delivery.',
  },
  payment_receipt: {
    label: 'Payment receipt',
    critical: false,
    defaults: ['billing'],
    description: 'Application receipt copy; Stripe remains the official receipt.',
  },
  contact_inquiry: {
    label: 'General contact inquiry',
    critical: false,
    defaults: ['customerService'],
    description: 'Website contact form and customer-service correspondence.',
  },
  careers_application: {
    label: 'Career application received',
    critical: false,
    defaults: ['hiring'],
    description: 'Applicant acknowledgment and hiring department notification.',
  },
  hiring_notification: {
    label: 'Hiring workflow notification',
    critical: false,
    defaults: ['hiring'],
    description: 'Internal hiring status and interview notices.',
  },
  security_alert: {
    label: 'Critical security alert',
    critical: true,
    defaults: ['admin', 'owner'],
    description: 'Immediate notification of a critical security event.',
  },
  backup_failure: {
    label: 'Backup failure',
    critical: true,
    defaults: ['admin', 'owner'],
    description: 'Immediate notification when a backup fails or is missed.',
  },
  owner_escalation: {
    label: 'Owner escalation',
    critical: true,
    defaults: ['admin', 'owner'],
    description: 'Escalation after an unresolved operational failure.',
  },
  weekly_health_digest: {
    label: 'Weekly health digest',
    critical: false,
    defaults: ['admin', 'owner'],
    description: 'Weekly operational, backup and delivery health summary.',
  },
};

export const REPLY_TO_KEYS = [
  'bookingConfirmations',
  'invoices',
  'receipts',
  'careers',
  'contact',
] as const;

export type ReplyToKey = (typeof REPLY_TO_KEYS)[number];

export const REPLY_TO_LABELS: Record<ReplyToKey, string> = {
  bookingConfirmations: 'Booking confirmations',
  invoices: 'Invoice email',
  receipts: 'Payment receipts',
  careers: 'Careers correspondence',
  contact: 'General customer service',
};

const TEMPLATE_DEFINITIONS = {
  booking_confirmation: {
    label: 'Booking confirmation',
    variables: ['customer_name', 'reference', 'service_date', 'address', 'total'],
    defaultSubject: 'Your Sparkling Standard cleaning is confirmed - {{reference}}',
    defaultBody:
      'Hello {{customer_name}},\n\nYour cleaning is confirmed for {{service_date}} at {{address}}.\n\nReference: {{reference}}\nQuoted total: {{total}}\n\nIf anything has changed, reply to this message and our bookings team will help.\n\nSparkling Standard',
  },
  invoice_delivery: {
    label: 'Invoice delivery',
    variables: ['customer_name', 'invoice_number', 'balance', 'due_date', 'payment_link'],
    defaultSubject: 'Sparkling Standard invoice {{invoice_number}}',
    defaultBody:
      'Hello {{customer_name}},\n\nYour invoice {{invoice_number}} for {{balance}} is due {{due_date}}.\n\nSecure payment link: {{payment_link}}\n\nBilling questions? Reply to this message.\n\nSparkling Standard',
  },
  payment_receipt: {
    label: 'Payment receipt copy',
    variables: ['customer_name', 'invoice_number', 'amount_paid'],
    defaultSubject: 'Payment received for invoice {{invoice_number}}',
    defaultBody:
      'Hello {{customer_name}},\n\nWe recorded your payment of {{amount_paid}} for invoice {{invoice_number}}.\n\nStripe sends the official card receipt separately. Reply to this message with any billing question.\n\nSparkling Standard',
  },
  careers_acknowledgment: {
    label: 'Career application acknowledgment',
    variables: ['applicant_name', 'reference'],
    defaultSubject: 'Application received - {{reference}}',
    defaultBody:
      'Hello {{applicant_name}},\n\nThank you for applying to Sparkling Standard. We received application {{reference}}.\n\nWe review every application against the current hiring need. If your experience and availability are a fit, the hiring team will contact you. We do not promise a role, schedule or pay rate before that review.\n\nPlease do not send sensitive documents such as a Social Security number or banking information by email.\n\nSparkling Standard | Hiring Team',
  },
  hiring_notification: {
    label: 'Internal hiring notification',
    variables: ['applicant_name', 'reference', 'desired_role', 'branch'],
    defaultSubject: 'New career application - {{applicant_name}} - {{branch}}',
    defaultBody:
      'New application {{reference}}\n\nName: {{applicant_name}}\nDesired role: {{desired_role}}\nBranch: {{branch}}\n\nReview securely in Admin -> Careers.',
  },
  security_alert: {
    label: 'Critical security alert',
    variables: ['event_detail', 'occurred_at'],
    defaultSubject: 'CRITICAL: Sparkling Standard security alert',
    defaultBody:
      'A critical security event was recorded at {{occurred_at}}.\n\n{{event_detail}}\n\nSign in to Operations and review the audit history. If this was not expected, escalate to the owner immediately.\n\nSparkling Standard Operations',
  },
  backup_alert: {
    label: 'Backup failure alert',
    variables: ['event_detail', 'occurred_at', 'escalation_minutes'],
    defaultSubject: 'CRITICAL: Sparkling Standard backup failure',
    defaultBody:
      'A backup failure was recorded at {{occurred_at}}.\n\n{{event_detail}}\n\nOwner escalation occurs after {{escalation_minutes}} minutes without resolution. Do not treat this backup as verified until a restore rehearsal succeeds.\n\nSparkling Standard Operations',
  },
  weekly_digest: {
    label: 'Weekly health digest',
    variables: ['period', 'summary'],
    defaultSubject: 'Sparkling Standard weekly health digest - {{period}}',
    defaultBody:
      'Weekly health digest for {{period}}.\n\n{{summary}}\n\nThis digest is generated from recorded operational data, not from inbox delivery confirmation.\n\nSparkling Standard Operations',
  },
} as const;

export type TemplateKey = keyof typeof TEMPLATE_DEFINITIONS;

export const TEMPLATE_KEYS = Object.keys(TEMPLATE_DEFINITIONS) as TemplateKey[];

const TEMPLATE_SAMPLE_VALUES: Record<TemplateKey, Record<string, string>> = {
  booking_confirmation: {
    customer_name: 'Jordan Example',
    reference: 'SS-EXAMPLE-1001',
    service_date: 'Monday, December 1 at 8:00 AM',
    address: '100 Example Street, Pensacola, FL',
    total: '$245.00',
  },
  invoice_delivery: {
    customer_name: 'Jordan Example',
    invoice_number: 'INV-1001',
    balance: '$245.00',
    due_date: 'December 5, 2026',
    payment_link: 'https://sparkling-standard.com/invoice-payment/',
  },
  payment_receipt: {
    customer_name: 'Jordan Example',
    invoice_number: 'INV-1001',
    amount_paid: '$245.00',
  },
  careers_acknowledgment: {
    applicant_name: 'Jordan Example',
    reference: 'APP-20261120-EXAMPLE',
  },
  hiring_notification: {
    applicant_name: 'Jordan Example',
    reference: 'APP-20261120-EXAMPLE',
    desired_role: 'Residential Cleaner',
    branch: 'Pensacola',
  },
  security_alert: {
    event_detail: 'Example event detail for preview only.',
    occurred_at: '2026-11-20 09:00 UTC',
  },
  backup_alert: {
    event_detail: 'Example backup failure detail for preview only.',
    occurred_at: '2026-11-20 09:00 UTC',
    escalation_minutes: '30',
  },
  weekly_digest: {
    period: 'November 14-20, 2026',
    summary: 'Example digest summary for preview only.',
  },
};

export interface DepartmentConfig {
  address: string;
  enabled: boolean;
}

export interface TemplateConfig {
  subject: string;
  body: string;
  enabled: boolean;
}

export interface CommunicationSettings {
  schemaVersion: 1;
  departments: Record<DepartmentKey, DepartmentConfig>;
  routing: Record<NotificationEventKey, DepartmentKey[]>;
  replyTo: Record<ReplyToKey, DepartmentKey>;
  templates: Record<TemplateKey, TemplateConfig>;
  alerts: {
    escalationMinutes: number;
    failureThreshold: number;
  };
}

export interface CommunicationSettingsState {
  settings: CommunicationSettings;
  source: 'default' | 'stored';
  valid: boolean;
  errors: string[];
}

const SETTINGS_KEY = 'communications.config';
const DEFAULT_REPLY_TO: Record<ReplyToKey, DepartmentKey> = {
  bookingConfirmations: 'bookings',
  invoices: 'billing',
  receipts: 'billing',
  careers: 'hiring',
  contact: 'customerService',
};

function departmentsRecord(enabled = true): Record<DepartmentKey, DepartmentConfig> {
  return Object.fromEntries(
    DEPARTMENT_KEYS.map((key) => [key, { address: DEPARTMENT_ADDRESSES[key], enabled }]),
  ) as Record<DepartmentKey, DepartmentConfig>;
}

function routingRecord(): Record<NotificationEventKey, DepartmentKey[]> {
  return Object.fromEntries(
    NOTIFICATION_EVENTS.map((key) => [key, [...EVENT_DEFINITIONS[key].defaults]]),
  ) as Record<NotificationEventKey, DepartmentKey[]>;
}

function templatesRecord(): Record<TemplateKey, TemplateConfig> {
  return Object.fromEntries(
    TEMPLATE_KEYS.map((key) => [
      key,
      {
        subject: TEMPLATE_DEFINITIONS[key].defaultSubject,
        body: TEMPLATE_DEFINITIONS[key].defaultBody,
        enabled: true,
      },
    ]),
  ) as Record<TemplateKey, TemplateConfig>;
}

export function defaultCommunicationSettings(): CommunicationSettings {
  return {
    schemaVersion: 1,
    departments: departmentsRecord(true),
    routing: routingRecord(),
    replyTo: { ...DEFAULT_REPLY_TO },
    templates: templatesRecord(),
    alerts: { escalationMinutes: 30, failureThreshold: 3 },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function templateVariables(templateKey: TemplateKey): readonly string[] {
  return TEMPLATE_DEFINITIONS[templateKey].variables;
}

export function extractTemplateVariables(value: string): string[] {
  const found = new Set<string>();
  for (const match of value.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

function templateErrors(templateKey: TemplateKey, template: TemplateConfig): string[] {
  const errors: string[] = [];
  const allowed = new Set<string>(TEMPLATE_DEFINITIONS[templateKey].variables);
  if (!template.enabled) {
    if (!template.subject) errors.push(`${templateKey}: subject is required`);
    if (!template.body) errors.push(`${templateKey}: body is required`);
    return errors;
  }
  if (!template.subject) errors.push(`${templateKey}: subject is required`);
  if (template.subject.length > 200) errors.push(`${templateKey}: subject is too long`);
  if (!template.body) errors.push(`${templateKey}: body is required`);
  if (template.body.length > 6000) errors.push(`${templateKey}: body is too long`);
  for (const variable of extractTemplateVariables(template.subject)) {
    if (!allowed.has(variable)) errors.push(`${templateKey}: unsupported subject variable {{${variable}}}`);
  }
  for (const variable of extractTemplateVariables(template.body)) {
    if (!allowed.has(variable)) errors.push(`${templateKey}: unsupported body variable {{${variable}}}`);
  }
  return errors;
}

export function validateCommunicationSettings(input: unknown): {
  ok: boolean;
  settings: CommunicationSettings;
  errors: string[];
} {
  const errors: string[] = [];
  const defaults = defaultCommunicationSettings();
  if (!isRecord(input)) {
    return { ok: false, settings: defaults, errors: ['settings must be an object'] };
  }

  const departments = departmentsRecord(true);
  const departmentInput = isRecord(input.departments) ? input.departments : {};
  for (const key of DEPARTMENT_KEYS) {
    const entry = isRecord(departmentInput[key]) ? departmentInput[key] as Record<string, unknown> : {};
    const address = text(entry.address, 200) || DEPARTMENT_ADDRESSES[key];
    if (address !== DEPARTMENT_ADDRESSES[key]) {
      errors.push(`departments.${key}: only the approved address may be used`);
    }
    departments[key] = { address: DEPARTMENT_ADDRESSES[key], enabled: bool(entry.enabled, true) };
    if ((key === 'admin' || key === 'owner') && !departments[key].enabled) {
      errors.push(`departments.${key}: critical departments cannot be disabled`);
    }
  }

  const routing = routingRecord();
  const routingInput = isRecord(input.routing) ? input.routing : {};
  for (const key of NOTIFICATION_EVENTS) {
    const raw = routingInput[key];
    const requested = Array.isArray(raw)
      ? raw.map((entry) => text(entry, 40)).filter((entry): entry is DepartmentKey => (DEPARTMENT_KEYS as readonly string[]).includes(entry))
      : [];
    const unique = [...new Set(requested)];
    if (unique.length === 0) {
      errors.push(`routing.${key}: choose at least one department`);
      continue;
    }
    if (unique.length !== requested.length) errors.push(`routing.${key}: duplicate department`);
    if (unique.length > 3) errors.push(`routing.${key}: too many departments`);
    if (EVENT_DEFINITIONS[key].critical) {
      const expected = ['admin', 'owner'];
      const matches = unique.length === expected.length && expected.every((entry) => unique.includes(entry as DepartmentKey));
      if (!matches) errors.push(`routing.${key}: critical alerts must include admin and owner only`);
    }
    for (const department of unique) {
      if (!departments[department].enabled) errors.push(`routing.${key}: ${department} is disabled`);
    }
    routing[key] = unique;
  }

  const replyTo = { ...DEFAULT_REPLY_TO };
  const replyInput = isRecord(input.replyTo) ? input.replyTo : {};
  for (const key of REPLY_TO_KEYS) {
    const requested = text(replyInput[key], 40) as DepartmentKey;
    const department = (DEPARTMENT_KEYS as readonly string[]).includes(requested) ? requested : DEFAULT_REPLY_TO[key];
    if (department === 'owner') {
      errors.push(`replyTo.${key}: owner@ cannot be a public reply-to address`);
      continue;
    }
    if (!departments[department].enabled) {
      errors.push(`replyTo.${key}: ${department} is disabled`);
      continue;
    }
    replyTo[key] = department;
  }

  const templates = templatesRecord();
  const templateInput = isRecord(input.templates) ? input.templates : {};
  for (const key of TEMPLATE_KEYS) {
    const entry = isRecord(templateInput[key]) ? templateInput[key] as Record<string, unknown> : {};
    const template = {
      subject: text(entry.subject, 200) || defaults.templates[key].subject,
      body: text(entry.body, 6000) || defaults.templates[key].body,
      enabled: bool(entry.enabled, true),
    };
    templates[key] = template;
    errors.push(...templateErrors(key, template));
  }

  const alertInput = isRecord(input.alerts) ? input.alerts : {};
  const alerts = {
    escalationMinutes: integer(alertInput.escalationMinutes, 30, 5, 1440),
    failureThreshold: integer(alertInput.failureThreshold, 3, 1, 100),
  };
  if (!Number.isFinite(alerts.escalationMinutes)) errors.push('alerts.escalationMinutes is invalid');
  if (!Number.isFinite(alerts.failureThreshold)) errors.push('alerts.failureThreshold is invalid');

  const settings: CommunicationSettings = {
    schemaVersion: 1,
    departments,
    routing,
    replyTo,
    templates,
    alerts,
  };
  return { ok: errors.length === 0, settings, errors };
}

function decodeSetting(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function readCommunicationSettings(db: D1Database): Promise<CommunicationSettingsState> {
  const row = await db
    .prepare('SELECT value_json FROM admin_settings WHERE key = ? LIMIT 1')
    .bind(SETTINGS_KEY)
    .first<{ value_json: string }>();
  if (!row?.value_json) {
    return { settings: defaultCommunicationSettings(), source: 'default', valid: true, errors: [] };
  }
  const validation = validateCommunicationSettings(decodeSetting(row.value_json));
  if (!validation.ok) {
    return { settings: defaultCommunicationSettings(), source: 'stored', valid: false, errors: validation.errors };
  }
  return { settings: validation.settings, source: 'stored', valid: true, errors: [] };
}

export async function saveCommunicationSettings(
  db: D1Database,
  actor: AdminActor,
  input: unknown,
  changeNote: string,
): Promise<{ settings: CommunicationSettings; version: number }> {
  if (actor.role !== 'owner') throw new AdminAuthError(403, 'owner_required');
  const validation = validateCommunicationSettings(input);
  if (!validation.ok) throw new AdminAuthError(400, `invalid_settings:${validation.errors[0] ?? 'unknown'}`);
  const latest = await db
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM communication_settings_versions')
    .first<{ version: number }>();
  const version = Number(latest?.version ?? 0) + 1;
  const settingsJson = JSON.stringify(validation.settings);
  await db
    .prepare(
      `INSERT INTO communication_settings_versions
       (id, version, settings_json, change_note, created_by_admin_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `commver_${crypto.randomUUID()}`,
      version,
      settingsJson,
      text(changeNote, 500),
      actor.id,
      new Date().toISOString(),
    )
    .run();
  await db
    .prepare(
      `INSERT INTO admin_settings (key, value_json, updated_by_admin_user_id, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_by_admin_user_id = excluded.updated_by_admin_user_id,
         updated_at = excluded.updated_at`,
    )
    .bind(SETTINGS_KEY, settingsJson, actor.id, new Date().toISOString())
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'communications.settings_saved',
    entityType: 'communication_settings',
    entityId: String(version),
    detail: text(changeNote, 200),
  });
  return { settings: validation.settings, version };
}

export async function listCommunicationVersions(
  db: D1Database,
  limit = 20,
): Promise<Array<Record<string, unknown>>> {
  const bounded = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const result = await db
    .prepare(
      `SELECT v.id, v.version, v.change_note, v.created_at, u.display_name AS created_by
       FROM communication_settings_versions v
       LEFT JOIN admin_users u ON u.id = v.created_by_admin_user_id
       ORDER BY v.version DESC LIMIT ?`,
    )
    .bind(bounded)
    .all<Record<string, unknown>>();
  return result.results ?? [];
}

export function renderTemplate(
  templateKey: TemplateKey,
  template: TemplateConfig,
  values: Record<string, string>,
): { subject: string; body: string } {
  const allowed = new Set<string>(TEMPLATE_DEFINITIONS[templateKey].variables);
  for (const variable of extractTemplateVariables(`${template.subject}\n${template.body}`)) {
    if (!allowed.has(variable)) throw new AdminAuthError(400, `template_variable_invalid:${variable}`);
    if (!(variable in values)) throw new AdminAuthError(400, `template_value_missing:${variable}`);
  }
  const replace = (source: string): string =>
    source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, variable: string) => String(values[variable] ?? ''));
  return { subject: replace(template.subject), body: replace(template.body) };
}

export function previewTemplate(
  settings: CommunicationSettings,
  templateKey: TemplateKey,
): { subject: string; body: string; variables: readonly string[] } {
  if (!TEMPLATE_KEYS.includes(templateKey)) throw new AdminAuthError(400, 'template_key_invalid');
  const rendered = renderTemplate(templateKey, settings.templates[templateKey], TEMPLATE_SAMPLE_VALUES[templateKey]);
  return { ...rendered, variables: TEMPLATE_DEFINITIONS[templateKey].variables };
}

export interface CommunicationEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  RESEND_REPLY_TO?: string;
  RESEND_BILLING_REPLY_TO?: string;
}

export function communicationProviderStatus(env: CommunicationEnv): Record<string, unknown> {
  return {
    provider: 'resend',
    resendConfigured: Boolean(env.RESEND_API_KEY?.trim()),
    senderConfigured: Boolean(env.RESEND_FROM_EMAIL?.trim()),
    replyToConfigured: Boolean(env.RESEND_REPLY_TO?.trim() || env.RESEND_BILLING_REPLY_TO?.trim()),
    domain: 'sparkling-standard.com',
    note:
      'A successful provider API request is not proof of inbox delivery. Confirm receipt in the destination mailbox before treating a route as verified.',
  };
}

export async function recordNotificationDelivery(
  db: D1Database,
  input: {
    eventKey: string;
    department: string;
    recipient: string;
    status: 'queued' | 'sent' | 'delivered' | 'failed' | 'suppressed';
    provider?: string;
    providerId?: string;
    errorCode?: string;
    attempts?: number;
    relatedType?: string;
    relatedId?: string;
  },
): Promise<string> {
  const id = `notif_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO notification_delivery_events
       (id, event_key, department, channel, recipient, status, provider, provider_id,
        error_code, attempts, related_type, related_id, created_at, updated_at)
       VALUES (?, ?, ?, 'email', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      text(input.eventKey, 60),
      text(input.department, 40),
      text(input.recipient, 200),
      input.status,
      text(input.provider, 40) || 'resend',
      text(input.providerId, 200) || null,
      text(input.errorCode, 200),
      Math.max(1, Math.round(Number(input.attempts) || 1)),
      text(input.relatedType, 60),
      text(input.relatedId, 120),
      now,
      now,
    )
    .run();
  return id;
}

export async function deliveryHealth(db: D1Database): Promise<Record<string, unknown>> {
  const empty = { results: [] as Array<Record<string, unknown>> };
  const [counts, recent, leadFailures, bookingFailures, receiptFailures] = await Promise.all([
    db
      .prepare(
        `SELECT status, COUNT(*) AS count FROM notification_delivery_events
         WHERE created_at >= datetime('now', '-30 days') GROUP BY status`,
      )
      .all<Record<string, unknown>>()
      .catch(() => empty),
    db
      .prepare(
        `SELECT id, event_key, department, recipient, status, provider, error_code, attempts, created_at
         FROM notification_delivery_events ORDER BY created_at DESC LIMIT 25`,
      )
      .all<Record<string, unknown>>()
      .catch(() => empty),
    db
      .prepare(
        `SELECT id, quote_reference, request_type, delivery_status, last_delivery_error, created_at
         FROM leads WHERE delivery_status = 'failed' ORDER BY created_at DESC LIMIT 10`,
      )
      .all<Record<string, unknown>>()
      .catch(() => empty),
    db
      .prepare(
        `SELECT id, kind, recipient_email, status, error_detail, attempts, created_at
         FROM booking_notifications WHERE status = 'failed' ORDER BY created_at DESC LIMIT 10`,
      )
      .all<Record<string, unknown>>()
      .catch(() => empty),
    db
      .prepare(
        `SELECT id, invoice_id, payment_id, status, error_code, created_at
         FROM payment_receipts WHERE status = 'failed' ORDER BY created_at DESC LIMIT 10`,
      )
      .all<Record<string, unknown>>()
      .catch(() => empty),
  ]);
  const summary = Object.fromEntries(
    (counts.results ?? []).map((row) => [String(row.status), Number(row.count ?? 0)]),
  );
  return {
    summary,
    recent: recent.results ?? [],
    leadFailures: leadFailures.results ?? [],
    bookingFailures: bookingFailures.results ?? [],
    receiptFailures: receiptFailures.results ?? [],
    note:
      'Delivery records prove what the application sent. Inbox delivery and reply routing require owner confirmation in the destination mailbox.',
  };
}

export async function sendTestNotification(
  db: D1Database,
  actor: AdminActor,
  env: CommunicationEnv,
  departmentKey: DepartmentKey,
): Promise<{ status: 'sent' | 'failed' | 'not_configured'; recipient: string; eventId: string }> {
  if (actor.role !== 'owner') throw new AdminAuthError(403, 'owner_required');
  if (!DEPARTMENT_KEYS.includes(departmentKey)) throw new AdminAuthError(400, 'department_invalid');
  const state = await readCommunicationSettings(db);
  const department = state.settings.departments[departmentKey];
  if (!department.enabled) throw new AdminAuthError(409, 'department_disabled');
  const recipient = department.address;
  const key = env.RESEND_API_KEY?.trim();
  if (!key) {
    const eventId = await recordNotificationDelivery(db, {
      eventKey: 'communications_test',
      department: departmentKey,
      recipient,
      status: 'suppressed',
      errorCode: 'resend_not_configured',
    });
    await audit(db, {
      actorUserId: actor.id,
      action: 'communications.test_not_sent',
      entityType: 'communication',
      entityId: departmentKey,
      detail: 'resend_not_configured',
    });
    return { status: 'not_configured', recipient, eventId };
  }
  const timestamp = new Date().toISOString();
  const subject = `[TEST] Sparkling Standard communications check - ${DEPARTMENT_LABELS[departmentKey]}`;
  const body = [
    'This is a controlled communications test from Sparkling Standard Operations.',
    '',
    `Department: ${DEPARTMENT_LABELS[departmentKey]}`,
    `Recipient: ${recipient}`,
    `Sent: ${timestamp}`,
    '',
    'No customer data is included. If this message arrived in the correct mailbox and replies reach the intended department, record the verification in the closeout ledger.',
  ].join('\n');
  let status: 'sent' | 'failed' = 'failed';
  let providerId = '';
  let errorCode = '';
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `communications-test-${departmentKey}-${timestamp}`.slice(0, 200),
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL?.trim() || EMAIL_ROUTING.notificationsSender,
        to: [recipient],
        reply_to: EMAIL_ROUTING.admin,
        subject,
        text: body,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
    if (response.ok) {
      status = 'sent';
      providerId = payload.id ?? '';
    } else {
      errorCode = payload.message ?? `http_${response.status}`;
    }
  } catch (error) {
    errorCode = error instanceof Error ? error.name : 'network_error';
  }
  const eventId = await recordNotificationDelivery(db, {
    eventKey: 'communications_test',
    department: departmentKey,
    recipient,
    status,
    providerId,
    errorCode,
  });
  await audit(db, {
    actorUserId: actor.id,
    action: status === 'sent' ? 'communications.test_sent' : 'communications.test_failed',
    entityType: 'communication',
    entityId: departmentKey,
    detail: status === 'sent' ? 'provider_accepted' : errorCode,
  });
  return { status, recipient, eventId };
}
