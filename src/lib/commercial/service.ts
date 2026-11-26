/**
 * Commercial accounts, custom proposals, agreements and contract billing.
 *
 * A commercial proposal is owner-authored structured scope. It is independent
 * of the public estimator's fixed service configuration, but it reuses the
 * existing customer/property, document-signing, invoice and audit systems.
 */
import type { D1Database } from '../admin/d1.ts';
import { AdminAuthError, audit, type AdminActor } from '../admin/operations.ts';
import { createInvoice } from '../admin/billing.ts';
import {
  addBundleItem,
  approveTemplate,
  createBundle,
  createSigningRequest,
  createTemplate,
  sendSigningEmail,
} from '../documents/service.ts';

export type ProposalStatus =
  | 'draft'
  | 'published'
  | 'sent'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'archived';

export type BillingFrequency = 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'per_visit';

export interface ProposalTask {
  name: string;
  frequency: string;
  monthlyCents: number;
}

export interface ProposalArea {
  name: string;
  notes: string;
  tasks: ProposalTask[];
}

export interface ProposalLocation {
  propertyId: string;
  name: string;
  address: string;
  notes: string;
  areas: ProposalArea[];
}

export interface ProposalScope {
  locations: ProposalLocation[];
  oneTimeCharges: Array<{ label: string; amountCents: number }>;
  addOns: Array<{ label: string; amountCents: number; recurring: boolean }>;
  supplies: string;
  equipment: string;
  crewRequirements: string;
  scheduleNotes: string;
  exclusions: string;
}

export interface ProposalInput {
  customerId: string;
  propertyId?: string;
  branchId?: string;
  title: string;
  billingFrequency: BillingFrequency;
  paymentTerms: string;
  taxRateBps: number;
  discountCents: number;
  expirationDate?: string;
  notes?: string;
  terms?: string;
  scope: ProposalScope;
}

export interface ProposalTotals {
  recurringTotalCents: number;
  oneTimeTotalCents: number;
  taxCents: number;
  discountCents: number;
  firstInvoiceTotalCents: number;
}

const FREQUENCIES = new Set<BillingFrequency>([
  'monthly',
  'quarterly',
  'semiannual',
  'annual',
  'per_visit',
]);

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cents(value: unknown): number {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year!, (month ?? 1) - 1 + months, day ?? 1, 12));
  return next.toISOString().slice(0, 10);
}

export function billingIntervalMonths(frequency: BillingFrequency): number {
  switch (frequency) {
    case 'quarterly':
      return 3;
    case 'semiannual':
      return 6;
    case 'annual':
      return 12;
    default:
      return 1;
  }
}

export function nextInvoiceDate(start: string, frequency: BillingFrequency): string {
  return addMonths(start, billingIntervalMonths(frequency));
}

function normalizeScope(raw: unknown): ProposalScope {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const locations = Array.isArray(input.locations)
    ? input.locations.slice(0, 40).map((entry) => {
        const location = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
        const areas = Array.isArray(location.areas)
          ? location.areas.slice(0, 80).map((areaEntry) => {
              const area = areaEntry && typeof areaEntry === 'object' ? (areaEntry as Record<string, unknown>) : {};
              const tasks = Array.isArray(area.tasks)
                ? area.tasks.slice(0, 100).map((taskEntry) => {
                    const task =
                      taskEntry && typeof taskEntry === 'object'
                        ? (taskEntry as Record<string, unknown>)
                        : {};
                    return {
                      name: text(task.name, 200),
                      frequency: text(task.frequency, 80),
                      monthlyCents: cents(task.monthlyCents),
                    };
                  }).filter((task) => task.name)
                : [];
              return {
                name: text(area.name, 160),
                notes: text(area.notes, 1000),
                tasks,
              };
            }).filter((area) => area.name || area.tasks.length > 0)
          : [];
        return {
          propertyId: text(location.propertyId, 100),
          name: text(location.name, 200),
          address: text(location.address, 300),
          notes: text(location.notes, 1000),
          areas,
        };
      }).filter((location) => location.name || location.address || location.areas.length > 0)
    : [];
  const charges = Array.isArray(input.oneTimeCharges)
    ? input.oneTimeCharges.slice(0, 40).map((entry) => {
        const charge = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
        return { label: text(charge.label, 200), amountCents: cents(charge.amountCents) };
      }).filter((charge) => charge.label && charge.amountCents > 0)
    : [];
  const addOns = Array.isArray(input.addOns)
    ? input.addOns.slice(0, 40).map((entry) => {
        const addOn = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
        return {
          label: text(addOn.label, 200),
          amountCents: cents(addOn.amountCents),
          recurring: addOn.recurring === true,
        };
      }).filter((addOn) => addOn.label && addOn.amountCents > 0)
    : [];
  return {
    locations,
    oneTimeCharges: charges,
    addOns,
    supplies: text(input.supplies, 300),
    equipment: text(input.equipment, 300),
    crewRequirements: text(input.crewRequirements, 500),
    scheduleNotes: text(input.scheduleNotes, 1000),
    exclusions: text(input.exclusions, 2000),
  };
}

export function calculateProposalTotals(input: {
  scope: ProposalScope;
  taxRateBps: number;
  discountCents: number;
}): ProposalTotals {
  let recurring = 0;
  for (const location of input.scope.locations) {
    for (const area of location.areas) {
      for (const task of area.tasks) recurring += task.monthlyCents;
    }
  }
  for (const addOn of input.scope.addOns) {
    if (addOn.recurring) recurring += addOn.amountCents;
  }
  let oneTime = 0;
  for (const charge of input.scope.oneTimeCharges) oneTime += charge.amountCents;
  for (const addOn of input.scope.addOns) {
    if (!addOn.recurring) oneTime += addOn.amountCents;
  }
  const subtotal = recurring + oneTime;
  const discount = Math.min(subtotal, Math.max(0, Math.round(input.discountCents)));
  const taxable = Math.max(0, subtotal - discount);
  const taxRate = Math.min(10000, Math.max(0, Math.round(input.taxRateBps)));
  const tax = Math.round((taxable * taxRate) / 10000);
  return {
    recurringTotalCents: recurring,
    oneTimeTotalCents: oneTime,
    discountCents: discount,
    taxCents: tax,
    firstInvoiceTotalCents: Math.max(0, taxable + tax),
  };
}

function normalizeInput(input: Record<string, unknown>): {
  value: ProposalInput;
  totals: ProposalTotals;
} {
  const customerId = text(input.customerId, 100);
  if (!customerId) throw new AdminAuthError(400, 'customer_required');
  const title = text(input.title, 200);
  if (!title) throw new AdminAuthError(400, 'proposal_title_required');
  const frequency = text(input.billingFrequency, 20) as BillingFrequency;
  if (!FREQUENCIES.has(frequency)) throw new AdminAuthError(400, 'billing_frequency_invalid');
  const taxRateBps = Math.min(10000, Math.max(0, Math.round(Number(input.taxRateBps) || 0)));
  const discountCents = Math.min(1_000_000_00, Math.max(0, Math.round(Number(input.discountCents) || 0)));
  const expirationDate = text(input.expirationDate, 10);
  if (expirationDate && !/^\d{4}-\d{2}-\d{2}$/.test(expirationDate)) {
    throw new AdminAuthError(400, 'proposal_expiration_invalid');
  }
  const scope = normalizeScope(input.scope);
  if (scope.locations.length === 0) throw new AdminAuthError(400, 'proposal_scope_required');
  let taskCount = 0;
  for (const location of scope.locations) {
    for (const area of location.areas) taskCount += area.tasks.length;
  }
  if (taskCount === 0) throw new AdminAuthError(400, 'proposal_tasks_required');
  const totals = calculateProposalTotals({ scope, taxRateBps, discountCents });
  if (totals.recurringTotalCents === 0 && totals.oneTimeTotalCents === 0) {
    throw new AdminAuthError(400, 'proposal_price_required');
  }
  return {
    value: {
      customerId,
      propertyId: text(input.propertyId, 100),
      branchId: text(input.branchId, 60),
      title,
      billingFrequency: frequency,
      paymentTerms: text(input.paymentTerms, 120) || 'Net 15',
      taxRateBps,
      discountCents,
      expirationDate,
      notes: text(input.notes, 2000),
      terms: text(input.terms, 6000),
      scope,
    },
    totals,
  };
}

function money(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100);
}

function scopeHtml(scope: ProposalScope): string {
  return scope.locations
    .map((location) => {
      const areas = location.areas
        .map((area) => {
          const rows = area.tasks
            .map(
              (task) =>
                `<tr><td>${escapeHtml(task.name)}</td><td>${escapeHtml(task.frequency)}</td><td style="text-align:right">${money(task.monthlyCents)}</td></tr>`,
            )
            .join('');
          return `<h4>${escapeHtml(area.name)}</h4>${area.notes ? `<p>${escapeHtml(area.notes)}</p>` : ''}<table><thead><tr><th>Task</th><th>Frequency</th><th>Price / period</th></tr></thead><tbody>${rows}</tbody></table>`;
        })
        .join('');
      return `<section><h3>${escapeHtml(location.name || location.address || 'Location')}</h3>${location.address ? `<p>${escapeHtml(location.address)}</p>` : ''}${location.notes ? `<p>${escapeHtml(location.notes)}</p>` : ''}${areas}</section>`;
    })
    .join('');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function renderProposalHtml(input: {
  proposalNumber: string;
  title: string;
  customerName: string;
  propertyLine: string;
  billingFrequency: BillingFrequency;
  paymentTerms: string;
  expirationDate: string;
  notes: string;
  terms: string;
  scope: ProposalScope;
  totals: ProposalTotals;
}): string {
  const terms = input.terms ? `<h3>Terms and conditions</h3><p>${escapeHtml(input.terms).replaceAll('\n', '<br>')}</p>` : '';
  const exclusions = input.scope.exclusions
    ? `<h3>Exclusions</h3><p>${escapeHtml(input.scope.exclusions).replaceAll('\n', '<br>')}</p>`
    : '';
  const oneTime = input.scope.oneTimeCharges.length + input.scope.addOns.filter((entry) => !entry.recurring).length
    ? `<h3>One-time charges</h3><table><thead><tr><th>Item</th><th style="text-align:right">Amount</th></tr></thead><tbody>${[
        ...input.scope.oneTimeCharges,
        ...input.scope.addOns.filter((entry) => !entry.recurring),
      ]
        .map((entry) => `<tr><td>${escapeHtml(entry.label)}</td><td style="text-align:right">${money(entry.amountCents)}</td></tr>`)
        .join('')}</tbody></table>`
    : '';
  const responsibilities = [
    input.scope.supplies ? `Supplies: ${input.scope.supplies}` : '',
    input.scope.equipment ? `Equipment: ${input.scope.equipment}` : '',
    input.scope.crewRequirements ? `Crew: ${input.scope.crewRequirements}` : '',
    input.scope.scheduleNotes ? `Schedule: ${input.scope.scheduleNotes}` : '',
  ].filter(Boolean);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(input.title)}</title><style>
body{font-family:Georgia,serif;color:#2d2523;line-height:1.55;max-width:900px;margin:0 auto;padding:40px}
h1,h2,h3,h4{font-family:Arial,Helvetica,sans-serif;color:#5d2b36} h1{font-size:28px;margin:0 0 4px}
.brand{font-family:Arial,Helvetica,sans-serif;font-weight:700;letter-spacing:.14em;color:#a98544}
table{width:100%;border-collapse:collapse;margin:8px 0 20px}th,td{border-bottom:1px solid #e6ddd5;padding:7px;text-align:left;font-size:14px}
.totals{background:#fbf6f0;border:1px solid #e6ddd5;padding:16px;border-radius:8px}
.totals p{display:flex;justify-content:space-between;margin:4px 0} .muted{color:#7d7169}
section{margin:18px 0}
</style></head><body>
<p class="brand">SPARKLING STANDARD</p>
<h1>${escapeHtml(input.title)}</h1>
<p class="muted">Proposal ${escapeHtml(input.proposalNumber)} · ${escapeHtml(input.customerName)} · ${escapeHtml(input.propertyLine)}</p>
<p><strong>Billing:</strong> ${escapeHtml(input.billingFrequency.replaceAll('_', ' '))} · <strong>Terms:</strong> ${escapeHtml(input.paymentTerms)}${input.expirationDate ? ` · <strong>Valid through:</strong> ${escapeHtml(input.expirationDate)}` : ''}</p>
${input.notes ? `<p>${escapeHtml(input.notes).replaceAll('\n', '<br>')}</p>` : ''}
${scopeHtml(input.scope)}
${responsibilities.length ? `<h3>Responsibilities and schedule</h3><ul>${responsibilities.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : ''}
${oneTime}
${exclusions}
<div class="totals">
<p><span>Recurring service total</span><strong>${money(input.totals.recurringTotalCents)}</strong></p>
<p><span>One-time charges</span><strong>${money(input.totals.oneTimeTotalCents)}</strong></p>
<p><span>Discount</span><strong>-${money(input.totals.discountCents)}</strong></p>
<p><span>Tax</span><strong>${money(input.totals.taxCents)}</strong></p>
<p><span>First invoice total</span><strong>${money(input.totals.firstInvoiceTotalCents)}</strong></p>
</div>
${terms}
<h3>Acceptance</h3>
<p>By signing electronically, the customer accepts this proposal and the incorporated terms. The signed copy, pricing snapshot and document hash are retained as the executed agreement.</p>
<p class="muted">Sparkling Standard Cleaning Co. · Standards That Sparkle. · (850) 426-8479</p>
</body></html>`;
}

function rowToProposal(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    scope: JSON.parse(String(row.scope_json ?? '{}')),
    snapshot: JSON.parse(String(row.snapshot_json ?? '{}')),
  };
}

async function proposalRow(
  db: D1Database,
  actor: AdminActor,
  id: string,
): Promise<Record<string, unknown> | null> {
  const scopeSql = actor.role === 'owner' || !actor.branchId ? '' : ' AND p.branch_id = ?';
  return db
    .prepare(
      `SELECT p.*, c.first_name, c.last_name, c.company_name,
              (SELECT value FROM customer_contacts WHERE customer_id = c.id AND kind = 'email' ORDER BY is_primary DESC LIMIT 1) AS customer_email,
              pr.label AS property_label, pr.line1, pr.city, pr.state, pr.postal_code
       FROM commercial_proposals p
       JOIN customers c ON c.id = p.customer_id
       LEFT JOIN properties pr ON pr.id = p.property_id
       WHERE p.id = ?${scopeSql} LIMIT 1`,
    )
    .bind(id, ...(scopeSql ? [actor.branchId] : []))
    .first<Record<string, unknown>>();
}

export async function listCommercialProposals(
  db: D1Database,
  actor: AdminActor,
  filters: { status?: string; customerId?: string } = {},
): Promise<Array<Record<string, unknown>>> {
  const clauses = ['1 = 1'];
  const binds: unknown[] = [];
  if (actor.role !== 'owner' && actor.branchId) {
    clauses.push('p.branch_id = ?');
    binds.push(actor.branchId);
  } else if (actor.role !== 'owner' && !actor.branchId) {
    clauses.push('1 = 0');
  }
  if (filters.status) {
    clauses.push('p.status = ?');
    binds.push(filters.status);
  }
  if (filters.customerId) {
    clauses.push('p.customer_id = ?');
    binds.push(filters.customerId);
  }
  const result = await db
    .prepare(
      `SELECT p.id, p.proposal_number, p.title, p.status, p.version, p.billing_frequency,
              p.recurring_total_cents, p.one_time_total_cents, p.first_invoice_total_cents,
              p.expiration_date, p.signing_request_id, p.contract_id, p.created_at, p.updated_at,
              c.first_name, c.last_name, c.company_name,
              pr.label AS property_label, pr.line1, pr.city
       FROM commercial_proposals p
       JOIN customers c ON c.id = p.customer_id
       LEFT JOIN properties pr ON pr.id = p.property_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY p.created_at DESC LIMIT 200`,
    )
    .bind(...binds)
    .all<Record<string, unknown>>();
  return result.results ?? [];
}

export async function getCommercialProposal(
  db: D1Database,
  actor: AdminActor,
  id: string,
): Promise<Record<string, unknown>> {
  const row = await proposalRow(db, actor, id);
  if (!row) throw new AdminAuthError(404, 'proposal_not_found');
  await syncProposalSigningStatus(db, id);
  const fresh = await proposalRow(db, actor, id);
  return rowToProposal(fresh ?? row);
}

async function nextProposalNumber(db: D1Database): Promise<string> {
  const year = new Date().getUTCFullYear();
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM commercial_proposals WHERE proposal_number LIKE ?")
    .bind(`CMP-${year}-%`)
    .first<{ count: number }>();
  const sequence = Number(row?.count ?? 0) + 1;
  return `CMP-${year}-${String(sequence).padStart(4, '0')}`;
}

export async function createCommercialProposal(
  db: D1Database,
  actor: AdminActor,
  input: Record<string, unknown>,
): Promise<{ id: string; proposalNumber: string }> {
  if (!['owner', 'manager'].includes(actor.role)) throw new AdminAuthError(403, 'admin_required');
  const { value, totals } = normalizeInput(input);
  const customer = await db
    .prepare('SELECT id, primary_branch_id FROM customers WHERE id = ? LIMIT 1')
    .bind(value.customerId)
    .first<{ id: string; primary_branch_id: string | null }>();
  if (!customer) throw new AdminAuthError(404, 'customer_not_found');
  if (value.propertyId) {
    const property = await db
      .prepare('SELECT id FROM properties WHERE id = ? AND customer_id = ? LIMIT 1')
      .bind(value.propertyId, value.customerId)
      .first();
    if (!property) throw new AdminAuthError(400, 'property_invalid');
  }
  const branchId = value.branchId || customer.primary_branch_id || 'branch_pensacola';
  if (actor.role !== 'owner' && actor.branchId && branchId !== actor.branchId) {
    throw new AdminAuthError(403, 'branch_scope_denied');
  }
  const id = `prop_${crypto.randomUUID()}`;
  const proposalNumber = await nextProposalNumber(db);
  await db
    .prepare(
      `INSERT INTO commercial_proposals
       (id, branch_id, customer_id, property_id, proposal_number, title, status, version,
        billing_frequency, payment_terms, tax_rate_bps, discount_cents,
        recurring_total_cents, one_time_total_cents, first_invoice_total_cents,
        expiration_date, notes, terms, exclusions, scope_json, created_by_admin_user_id)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      branchId,
      value.customerId,
      value.propertyId || null,
      proposalNumber,
      value.title,
      value.billingFrequency,
      value.paymentTerms,
      value.taxRateBps,
      totals.discountCents,
      totals.recurringTotalCents,
      totals.oneTimeTotalCents,
      totals.firstInvoiceTotalCents,
      value.expirationDate || null,
      value.notes ?? '',
      value.terms ?? '',
      value.scope.exclusions,
      JSON.stringify(value.scope),
      actor.id,
    )
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'commercial.proposal_created',
    entityType: 'commercial_proposal',
    entityId: id,
    detail: proposalNumber,
  });
  return { id, proposalNumber };
}

export async function updateCommercialProposal(
  db: D1Database,
  actor: AdminActor,
  id: string,
  input: Record<string, unknown>,
): Promise<void> {
  const existing = await proposalRow(db, actor, id);
  if (!existing) throw new AdminAuthError(404, 'proposal_not_found');
  if (String(existing.status) === 'accepted' || String(existing.status) === 'archived') {
    throw new AdminAuthError(409, 'proposal_not_editable');
  }
  const { value, totals } = normalizeInput(input);
  if (value.customerId !== String(existing.customer_id)) {
    throw new AdminAuthError(400, 'proposal_customer_locked');
  }
  const snapshot = canonical({ ...value, totals });
  await db
    .prepare(
      `UPDATE commercial_proposals SET
         property_id = ?, title = ?, status = 'draft', billing_frequency = ?, payment_terms = ?,
         tax_rate_bps = ?, discount_cents = ?, recurring_total_cents = ?, one_time_total_cents = ?,
         first_invoice_total_cents = ?, expiration_date = ?, notes = ?, terms = ?, exclusions = ?,
         scope_json = ?, snapshot_json = ?, content_sha256 = ?, signing_request_id = NULL,
         updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      value.propertyId || null,
      value.title,
      value.billingFrequency,
      value.paymentTerms,
      value.taxRateBps,
      totals.discountCents,
      totals.recurringTotalCents,
      totals.oneTimeTotalCents,
      totals.firstInvoiceTotalCents,
      value.expirationDate || null,
      value.notes ?? '',
      value.terms ?? '',
      value.scope.exclusions,
      JSON.stringify(value.scope),
      snapshot,
      await sha256(snapshot),
      new Date().toISOString(),
      id,
    )
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'commercial.proposal_updated',
    entityType: 'commercial_proposal',
    entityId: id,
  });
}

function customerName(row: Record<string, unknown>): string {
  return (
    String(row.company_name ?? '').trim() ||
    [row.first_name, row.last_name].filter(Boolean).join(' ').trim() ||
    'Customer'
  );
}

function propertyLine(row: Record<string, unknown>): string {
  return [row.property_label, row.line1, row.city, row.state, row.postal_code]
    .filter(Boolean)
    .join(', ');
}

export async function publishCommercialProposal(
  db: D1Database,
  actor: AdminActor,
  id: string,
): Promise<void> {
  const row = await proposalRow(db, actor, id);
  if (!row) throw new AdminAuthError(404, 'proposal_not_found');
  if (!['draft', 'published', 'sent'].includes(String(row.status))) {
    throw new AdminAuthError(409, 'proposal_not_publishable');
  }
  const scope = JSON.parse(String(row.scope_json ?? '{}')) as ProposalScope;
  const totals = calculateProposalTotals({
    scope,
    taxRateBps: Number(row.tax_rate_bps) || 0,
    discountCents: Number(row.discount_cents) || 0,
  });
  const snapshot = {
    proposalNumber: String(row.proposal_number),
    title: String(row.title),
    customerName: customerName(row),
    propertyLine: propertyLine(row),
    billingFrequency: String(row.billing_frequency),
    paymentTerms: String(row.payment_terms),
    expirationDate: String(row.expiration_date ?? ''),
    notes: String(row.notes ?? ''),
    terms: String(row.terms ?? ''),
    scope,
    totals,
    publishedAt: new Date().toISOString(),
  };
  const snapshotJson = canonical(snapshot);
  await db
    .prepare(
      `INSERT INTO commercial_proposal_revisions
       (id, proposal_id, version, snapshot_json, note, created_by_admin_user_id)
       VALUES (?, ?, ?, ?, 'Published', ?)
       ON CONFLICT(proposal_id, version) DO UPDATE SET
         snapshot_json = excluded.snapshot_json,
         created_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      `cprev_${crypto.randomUUID()}`,
      id,
      Number(row.version) || 1,
      snapshotJson,
      actor.id,
    )
    .run();
  await db
    .prepare(
      `UPDATE commercial_proposals SET status = 'published', snapshot_json = ?, content_sha256 = ?,
         recurring_total_cents = ?, one_time_total_cents = ?, first_invoice_total_cents = ?,
         updated_at = ? WHERE id = ?`,
    )
    .bind(
      snapshotJson,
      await sha256(snapshotJson),
      totals.recurringTotalCents,
      totals.oneTimeTotalCents,
      totals.firstInvoiceTotalCents,
      new Date().toISOString(),
      id,
    )
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'commercial.proposal_published',
    entityType: 'commercial_proposal',
    entityId: id,
    detail: `v${row.version}`,
  });
}

export async function createProposalRevision(
  db: D1Database,
  actor: AdminActor,
  id: string,
): Promise<{ version: number }> {
  const row = await proposalRow(db, actor, id);
  if (!row) throw new AdminAuthError(404, 'proposal_not_found');
  if (String(row.status) === 'accepted') throw new AdminAuthError(409, 'proposal_already_accepted');
  const version = (Number(row.version) || 1) + 1;
  await db
    .prepare(
      `INSERT INTO commercial_proposal_revisions
       (id, proposal_id, version, snapshot_json, note, created_by_admin_user_id)
       VALUES (?, ?, ?, ?, 'Revision for changes', ?)`,
    )
    .bind(
      `cprev_${crypto.randomUUID()}`,
      id,
      version,
      String(row.snapshot_json || '{}'),
      actor.id,
    )
    .run();
  await db
    .prepare(
      `UPDATE commercial_proposals SET version = ?, status = 'draft', signing_request_id = NULL,
         updated_at = ? WHERE id = ?`,
    )
    .bind(version, new Date().toISOString(), id)
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'commercial.proposal_revision_created',
    entityType: 'commercial_proposal',
    entityId: id,
    detail: `v${version}`,
  });
  return { version };
}

async function customerEmail(db: D1Database, customerId: string): Promise<string> {
  const row = await db
    .prepare(
      "SELECT value FROM customer_contacts WHERE customer_id = ? AND kind = 'email' ORDER BY is_primary DESC, created_at LIMIT 1",
    )
    .bind(customerId)
    .first<{ value: string }>();
  return String(row?.value ?? '').trim().toLowerCase();
}

export async function sendCommercialProposal(
  db: D1Database,
  actor: AdminActor,
  id: string,
  env: { RESEND_API_KEY?: string; RESEND_FROM_EMAIL?: string; PUBLIC_SITE_URL?: string },
): Promise<{ signingRequestId: string; emailStatus: string }> {
  const row = await proposalRow(db, actor, id);
  if (!row) throw new AdminAuthError(404, 'proposal_not_found');
  if (!['published', 'sent'].includes(String(row.status))) {
    throw new AdminAuthError(409, 'publish_proposal_first');
  }
  const email = await customerEmail(db, String(row.customer_id));
  if (!email) throw new AdminAuthError(409, 'customer_email_required');
  const scope = JSON.parse(String(row.scope_json ?? '{}')) as ProposalScope;
  const totals = calculateProposalTotals({
    scope,
    taxRateBps: Number(row.tax_rate_bps) || 0,
    discountCents: Number(row.discount_cents) || 0,
  });
  const html = renderProposalHtml({
    proposalNumber: String(row.proposal_number),
    title: String(row.title),
    customerName: customerName(row),
    propertyLine: propertyLine(row),
    billingFrequency: String(row.billing_frequency) as BillingFrequency,
    paymentTerms: String(row.payment_terms),
    expirationDate: String(row.expiration_date ?? ''),
    notes: String(row.notes ?? ''),
    terms: String(row.terms ?? ''),
    scope,
    totals,
  });
  let templateId: string;
  const existingTemplate = await db
    .prepare(
      "SELECT id FROM document_templates WHERE family_key = ? AND status = 'approved' LIMIT 1",
    )
    .bind(`commercial-proposal-${String(row.proposal_number).toLowerCase()}`)
    .first<{ id: string }>();
  if (existingTemplate) {
    templateId = existingTemplate.id;
  } else {
    const created = await createTemplate(db, actor.id, {
      title: `Commercial Service Agreement — ${String(row.proposal_number)}`,
      category: 'commercial-proposal',
      version: `v${row.version}`,
      contentText: html,
      signerParty: 'customer',
      familyKey: `commercial-proposal-${String(row.proposal_number).toLowerCase()}`,
      legalReviewStatus: 'owner_approved',
    });
    templateId = created.id;
    await approveTemplate(db, actor.id, templateId);
  }
  let bundleId = (
    await db
      .prepare("SELECT id FROM document_bundles WHERE code = ? LIMIT 1")
      .bind(`commercial-proposal-${String(row.proposal_number).toLowerCase()}`)
      .first<{ id: string }>()
  )?.id ?? '';
  if (!bundleId) {
    const bundle = await createBundle(db, actor.id, {
      code: `commercial-proposal-${String(row.proposal_number).toLowerCase()}`,
      name: `Commercial Proposal ${String(row.proposal_number)}`,
      subjectType: 'customer',
      purpose: 'customer',
      packetType: 'standard',
      instructions: 'Review the proposal and sign to accept the commercial service agreement.',
    });
    bundleId = bundle.id;
  }
  await addBundleItem(db, actor.id, {
    bundleId,
    templateId,
    sortOrder: 0,
    required: true,
    enforcementStage: 'before_confirmation',
    perBooking: true,
  });
  const request = await createSigningRequest(
    db,
    {
      subjectType: 'customer',
      customerId: String(row.customer_id),
      ...(row.property_id ? { propertyId: String(row.property_id) } : {}),
      serviceCode: 'commercial-cleaning',
      bookingReference: String(row.proposal_number),
      email,
    },
    { createdByAdminUserId: actor.id, bundleId },
  );
  if (!request.required || !request.requestId || !request.token) {
    throw new AdminAuthError(409, 'signing_request_unavailable');
  }
  const emailSent = request.token
    ? await sendSigningEmail(
        env,
        email,
        request.token,
        request.bundleName ?? 'Commercial service agreement',
        `commercial-proposal-${id}-v${row.version}`,
      ).catch(() => false)
    : false;
  await db
    .prepare(
      `UPDATE commercial_proposals SET status = 'sent', signing_request_id = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(request.requestId, new Date().toISOString(), id)
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'commercial.proposal_sent',
    entityType: 'commercial_proposal',
    entityId: id,
    detail: request.requestId,
  });
  return {
    signingRequestId: request.requestId,
    emailStatus: emailSent ? 'sent' : 'not_sent',
  };
}

/** Brings the proposal status in line with the existing signing system. */
export async function syncProposalSigningStatus(
  db: D1Database,
  proposalId: string,
): Promise<'unchanged' | 'accepted'> {
  const row = await db
    .prepare(
      "SELECT id, status, signing_request_id FROM commercial_proposals WHERE id = ? LIMIT 1",
    )
    .bind(proposalId)
    .first<{ id: string; status: string; signing_request_id: string | null }>();
  if (!row?.signing_request_id || row.status === 'accepted') return 'unchanged';
  const request = await db
    .prepare('SELECT status FROM signing_requests WHERE id = ? LIMIT 1')
    .bind(row.signing_request_id)
    .first<{ status: string }>();
  if (request?.status !== 'signed') return 'unchanged';
  const signer = await db
    .prepare(
      `SELECT signer_name, signer_email, signed_at FROM document_signatures
       WHERE signing_request_id = ? ORDER BY signed_at DESC LIMIT 1`,
    )
    .bind(row.signing_request_id)
    .first<{ signer_name: string; signer_email: string; signed_at: string }>();
  await db
    .prepare(
      `UPDATE commercial_proposals SET status = 'accepted', accepted_at = ?,
         accepted_by_name = ?, accepted_by_email = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      signer?.signed_at ?? new Date().toISOString(),
      String(signer?.signer_name ?? ''),
      String(signer?.signer_email ?? ''),
      new Date().toISOString(),
      proposalId,
    )
    .run();
  await audit(db, {
    actorUserId: null,
    action: 'commercial.proposal_accepted',
    entityType: 'commercial_proposal',
    entityId: proposalId,
  });
  return 'accepted';
}

export async function createCommercialContract(
  db: D1Database,
  actor: AdminActor,
  proposalId: string,
  input: { startDate?: string; notes?: string } = {},
): Promise<{ id: string }> {
  const row = await proposalRow(db, actor, proposalId);
  if (!row) throw new AdminAuthError(404, 'proposal_not_found');
  await syncProposalSigningStatus(db, proposalId);
  const fresh = await db
    .prepare('SELECT status, version FROM commercial_proposals WHERE id = ? LIMIT 1')
    .bind(proposalId)
    .first<{ status: string; version: number }>();
  if (fresh?.status !== 'accepted') throw new AdminAuthError(409, 'proposal_not_accepted');
  if (row.contract_id) return { id: String(row.contract_id) };
  const startDate = text(input.startDate, 10) || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new AdminAuthError(400, 'contract_start_invalid');
  const id = `contract_${crypto.randomUUID()}`;
  const frequency = String(row.billing_frequency) as BillingFrequency;
  await db
    .prepare(
      `INSERT INTO commercial_contracts
       (id, proposal_id, branch_id, customer_id, property_id, status, start_date,
        billing_frequency, payment_terms, recurring_total_cents, tax_rate_bps,
        next_invoice_date, scope_json, notes, created_by_admin_user_id)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      proposalId,
      row.branch_id,
      row.customer_id,
      row.property_id,
      startDate,
      frequency,
      String(row.payment_terms),
      Number(row.recurring_total_cents) || 0,
      Number(row.tax_rate_bps) || 0,
      nextInvoiceDate(startDate, frequency),
      String(row.scope_json ?? '{}'),
      text(input.notes, 1000),
      actor.id,
    )
    .run();
  await db
    .prepare('UPDATE commercial_proposals SET contract_id = ?, updated_at = ? WHERE id = ?')
    .bind(id, new Date().toISOString(), proposalId)
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'commercial.contract_created',
    entityType: 'commercial_contract',
    entityId: id,
    detail: proposalId,
  });
  return { id };
}

export async function listCommercialContracts(
  db: D1Database,
  actor: AdminActor,
): Promise<Array<Record<string, unknown>>> {
  const scopeSql = actor.role === 'owner' || !actor.branchId ? '' : ' WHERE k.branch_id = ?';
  const result = await db
    .prepare(
      `SELECT k.*, c.first_name, c.last_name, c.company_name,
              pr.label AS property_label, pr.line1, pr.city,
              (SELECT COUNT(*) FROM commercial_contract_invoices ci WHERE ci.contract_id = k.id) AS invoice_count
       FROM commercial_contracts k
       JOIN customers c ON c.id = k.customer_id
       LEFT JOIN properties pr ON pr.id = k.property_id
       ${scopeSql}
       ORDER BY k.created_at DESC LIMIT 200`,
    )
    .bind(...(scopeSql ? [actor.branchId] : []))
    .all<Record<string, unknown>>();
  return result.results ?? [];
}

export async function generateContractInvoice(
  db: D1Database,
  actor: AdminActor,
  contractId: string,
): Promise<{ invoiceId: string; number: string; totalCents: number }> {
  const contract = await db
    .prepare('SELECT * FROM commercial_contracts WHERE id = ? LIMIT 1')
    .bind(contractId)
    .first<Record<string, unknown>>();
  if (!contract) throw new AdminAuthError(404, 'contract_not_found');
  if (String(contract.status) !== 'active') throw new AdminAuthError(409, 'contract_not_active');
  if (actor.role !== 'owner' && actor.branchId && String(contract.branch_id) !== actor.branchId) {
    throw new AdminAuthError(403, 'branch_scope_denied');
  }
  const periodStart = String(contract.next_invoice_date || today());
  const frequency = String(contract.billing_frequency) as BillingFrequency;
  const periodEnd = addMonths(periodStart, billingIntervalMonths(frequency));
  const duplicate = await db
    .prepare(
      'SELECT invoice_id FROM commercial_contract_invoices WHERE contract_id = ? AND period_start = ? LIMIT 1',
    )
    .bind(contractId, periodStart)
    .first<{ invoice_id: string }>();
  if (duplicate) throw new AdminAuthError(409, 'contract_period_already_invoiced');
  const scope = JSON.parse(String(contract.scope_json ?? '{}')) as ProposalScope;
  const lines: Array<Record<string, unknown>> = [];
  for (const location of scope.locations) {
    for (const area of location.areas) {
      for (const task of area.tasks) {
        if (task.monthlyCents <= 0) continue;
        lines.push({
          description: `${location.name || 'Facility'} — ${area.name} — ${task.name} (${task.frequency})`,
          quantity: 1,
          unitAmountCents: task.monthlyCents,
          kind: 'service',
        });
      }
    }
  }
  for (const addOn of scope.addOns) {
    if (!addOn.recurring || addOn.amountCents <= 0) continue;
    lines.push({ description: addOn.label, quantity: 1, unitAmountCents: addOn.amountCents, kind: 'service' });
  }
  if (lines.length === 0) throw new AdminAuthError(409, 'contract_has_no_recurring_lines');
  const taxRateBps = Number(contract.tax_rate_bps) || 0;
  if (taxRateBps > 0) {
    const subtotal = lines.reduce((sum, line) => sum + Number(line.unitAmountCents), 0);
    lines.push({
      description: `Sales tax (${(taxRateBps / 100).toFixed(2)}%)`,
      quantity: 1,
      unitAmountCents: Math.round((subtotal * taxRateBps) / 10000),
      kind: 'tax',
    });
  }
  const invoice = await createInvoice(db, actor, {
    customerId: contract.customer_id,
    ...(contract.property_id ? { propertyId: contract.property_id } : {}),
    serviceCode: 'commercial-cleaning',
    serviceLabel: 'Commercial cleaning — contract billing',
    issueDate: today(),
    dueDate: text(contract.payment_terms, 120).match(/net\s*(\d+)/i)
      ? addMonths(today(), 0)
      : today(),
    lines,
    bookingRequestId: null,
  });
  // Net terms: replace the same-day default with the approved term date.
  const termDays = Number((String(contract.payment_terms).match(/net\s*(\d+)/i) ?? [])[1] ?? 15);
  const due = new Date(Date.now() + Math.max(0, termDays) * 86_400_000).toISOString().slice(0, 10);
  await db
    .prepare('UPDATE invoices SET due_date = ?, commercial_contract_id = ?, updated_at = ? WHERE id = ?')
    .bind(due, contractId, new Date().toISOString(), invoice.id)
    .run();
  await db
    .prepare(
      `INSERT INTO commercial_contract_invoices (id, contract_id, invoice_id, period_start, period_end)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(`ci_${crypto.randomUUID()}`, contractId, invoice.id, periodStart, periodEnd)
    .run();
  await db
    .prepare(
      'UPDATE commercial_contracts SET last_invoice_at = ?, next_invoice_date = ?, updated_at = ? WHERE id = ?',
    )
    .bind(new Date().toISOString(), nextInvoiceDate(periodEnd, frequency), new Date().toISOString(), contractId)
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'commercial.contract_invoice_created',
    entityType: 'commercial_contract',
    entityId: contractId,
    detail: invoice.id,
  });
  return { invoiceId: invoice.id, number: invoice.number, totalCents: invoice.totalCents };
}

export async function listPropertyContacts(
  db: D1Database,
  propertyId: string,
): Promise<Array<Record<string, unknown>>> {
  const result = await db
    .prepare(
      'SELECT * FROM property_contacts WHERE property_id = ? ORDER BY is_primary DESC, name LIMIT 100',
    )
    .bind(propertyId)
    .all<Record<string, unknown>>();
  return result.results ?? [];
}

export async function addPropertyContact(
  db: D1Database,
  actor: AdminActor,
  input: Record<string, unknown>,
): Promise<{ id: string }> {
  const propertyId = text(input.propertyId, 100);
  const name = text(input.name, 160);
  if (!propertyId || !name) throw new AdminAuthError(400, 'contact_fields_required');
  const property = await db
    .prepare('SELECT customer_id FROM properties WHERE id = ? LIMIT 1')
    .bind(propertyId)
    .first<{ customer_id: string }>();
  if (!property) throw new AdminAuthError(404, 'property_not_found');
  const role = ['billing', 'facility', 'manager', 'authorized', 'other'].includes(String(input.role))
    ? String(input.role)
    : 'facility';
  const email = text(input.email, 200).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new AdminAuthError(400, 'contact_email_invalid');
  }
  const id = `pc_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO property_contacts
       (id, customer_id, property_id, name, role, email, phone, is_primary, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      property.customer_id,
      propertyId,
      name,
      role,
      email,
      text(input.phone, 40),
      input.isPrimary === true ? 1 : 0,
      text(input.notes, 500),
    )
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'commercial.property_contact_added',
    entityType: 'property',
    entityId: propertyId,
    detail: role,
  });
  return { id };
}

export async function listWalkthroughs(
  db: D1Database,
  propertyId: string,
): Promise<Array<Record<string, unknown>>> {
  const result = await db
    .prepare(
      'SELECT * FROM commercial_walkthroughs WHERE property_id = ? ORDER BY walked_at DESC LIMIT 100',
    )
    .bind(propertyId)
    .all<Record<string, unknown>>();
  return result.results ?? [];
}

export async function addWalkthrough(
  db: D1Database,
  actor: AdminActor,
  input: Record<string, unknown>,
): Promise<{ id: string }> {
  const propertyId = text(input.propertyId, 100);
  const walkedAt = text(input.walkedAt, 10) || today();
  if (!propertyId || !/^\d{4}-\d{2}-\d{2}$/.test(walkedAt)) {
    throw new AdminAuthError(400, 'walkthrough_fields_required');
  }
  const property = await db
    .prepare('SELECT customer_id, branch_id FROM properties WHERE id = ? LIMIT 1')
    .bind(propertyId)
    .first<{ customer_id: string; branch_id: string | null }>();
  if (!property) throw new AdminAuthError(404, 'property_not_found');
  const id = `walk_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO commercial_walkthroughs
       (id, branch_id, customer_id, property_id, walked_at, attendees, findings, scope_notes, follow_up, created_by_admin_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      property.branch_id,
      property.customer_id,
      propertyId,
      walkedAt,
      text(input.attendees, 500),
      text(input.findings, 4000),
      text(input.scopeNotes, 4000),
      text(input.followUp, 2000),
      actor.id,
    )
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'commercial.walkthrough_recorded',
    entityType: 'property',
    entityId: propertyId,
    detail: walkedAt,
  });
  return { id };
}
