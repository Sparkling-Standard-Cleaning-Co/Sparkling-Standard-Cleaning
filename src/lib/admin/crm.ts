import type { AdminActor } from './operations.ts';
import { AdminAuthError, audit } from './operations.ts';
import type { D1Database, D1PreparedStatement } from './d1.ts';
import { hasPropertyInput, normalizePropertyInput, type NormalizedProperty } from './property-profile.ts';
import { defaultActiveBranch } from './branches.ts';
import { resolveServiceBranchStrict } from '../branches/registry.ts';
import { buildLeadNotification } from '../forms/lead-notification.ts';
import { suspectTestReasons } from './lead-classification.ts';

function now(): string {
  return new Date().toISOString();
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function flag(value: unknown): number {
  return value === true || value === 1 || value === '1' || value === 'yes' ? 1 : 0;
}

function scope(actor: AdminActor, column: string): { sql: string; bind: unknown[] } {
  if (actor.role === 'owner') return { sql: '', bind: [] };
  if (actor.branchId) return { sql: ` AND ${column} = ?`, bind: [actor.branchId] };
  return { sql: ' AND 1 = 0', bind: [] };
}

async function assertBranch(db: D1Database, branchId: string | null): Promise<string | null> {
  if (!branchId) return null;
  const row = await db
    .prepare("SELECT id FROM branches WHERE id = ? AND status = 'active'")
    .bind(branchId)
    .first();
  if (!row) throw new AdminAuthError(400, 'branch_invalid');
  return branchId;
}

function customerBranch(actor: AdminActor, requested: unknown): string | null {
  if (actor.role !== 'owner') return actor.branchId;
  return text(requested, 80) || null;
}

export interface CustomerListInput {
  q?: string;
  status?: string;
  limit?: number;
  offset?: number;
  sort?: string;
}

const CUSTOMER_SORTS: Record<string, string> = {
  created_at: 'c.created_at DESC, c.id ASC',
  name: 'c.last_name ASC, c.first_name ASC, c.id ASC',
  status: 'c.status ASC, c.created_at DESC, c.id ASC',
};

function customerFilters(actor: AdminActor, input: CustomerListInput): { sql: string; bind: unknown[] } {
  const q = text(input.q, 120);
  const requested = input.status ?? '';
  const deleted = requested === 'deleted';
  const status = deleted ? 'archived' : ['active', 'archived'].includes(requested) ? requested : '';
  const branch = scope(actor, 'c.primary_branch_id');
  return {
    sql: `WHERE c.source <> 'financial_system'
         AND (? = '' OR c.status = ?)
         ${deleted
           ? "AND c.first_name = 'Deleted' AND c.last_name = 'Customer'"
           : status === 'archived'
             ? "AND NOT (c.first_name = 'Deleted' AND c.last_name = 'Customer')"
             : ''}
         AND (? = '' OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.company_name LIKE ?
              OR EXISTS (SELECT 1 FROM customer_contacts cc WHERE cc.customer_id = c.id AND cc.normalized_value LIKE ?))
         ${branch.sql}`,
    bind: [status, status, q, `%${q}%`, `%${q}%`, `%${q}%`, `%${q.toLowerCase()}%`, ...branch.bind],
  };
}

export function customerPageBounds(input: CustomerListInput): { limit: number; offset: number; sort: string } {
  const limit = Math.min(Math.max(Number(input.limit) || 25, 1), 200);
  const offset = Math.max(Number(input.offset) || 0, 0);
  const sort = CUSTOMER_SORTS[input.sort ?? ''] ? String(input.sort) : 'created_at';
  return { limit, offset, sort };
}

export async function listCustomers(
  db: D1Database,
  actor: AdminActor,
  input: CustomerListInput,
): Promise<Array<Record<string, unknown>>> {
  const bounds = customerPageBounds(input);
  const filter = customerFilters(actor, input);
  const result = await db
    .prepare(
      `SELECT c.id, c.first_name, c.last_name, c.company_name, c.status, c.source,
              c.do_not_contact, c.marketing_consent, c.created_at,
              b.name AS branch_name,
              (SELECT value FROM customer_contacts cc WHERE cc.customer_id = c.id AND cc.kind = 'email' ORDER BY cc.is_primary DESC LIMIT 1) AS email,
              (SELECT value FROM customer_contacts cc WHERE cc.customer_id = c.id AND cc.kind = 'phone' ORDER BY cc.is_primary DESC LIMIT 1) AS phone,
              (SELECT COUNT(*) FROM properties p WHERE p.customer_id = c.id AND p.status = 'active') AS property_count
       FROM customers c LEFT JOIN branches b ON b.id = c.primary_branch_id
       ${filter.sql}
       ORDER BY ${CUSTOMER_SORTS[bounds.sort]} LIMIT ? OFFSET ?`,
    )
    .bind(...filter.bind, bounds.limit, bounds.offset)
    .all();
  return result.results ?? [];
}

export async function countCustomers(
  db: D1Database,
  actor: AdminActor,
  input: CustomerListInput,
): Promise<number> {
  const filter = customerFilters(actor, input);
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM customers c ${filter.sql}`)
    .bind(...filter.bind)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export interface CustomerTimelineEvent {
  at: string;
  kind: string;
  title: string;
  detail: string;
  entityType: string;
  entityId: string;
  appointmentId?: string;
  invoiceId?: string;
  requestId?: string;
  leadId?: string;
}

function human(value: unknown): string {
  const raw = String(value ?? '').replaceAll('_', ' ').trim();
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '';
}

function customerMoney(value: unknown): string {
  const cents = Number(value);
  return Number.isFinite(cents) ? `$${(cents / 100).toFixed(2)}` : '$0.00';
}

function buildCustomerTimeline(input: {
  leads: Array<Record<string, unknown>>;
  estimates: Array<Record<string, unknown>>;
  appointments: Array<Record<string, unknown>>;
  invoices: Array<Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
  signingRequests: Array<Record<string, unknown>>;
  reviewRequests: Array<Record<string, unknown>>;
  communications: Array<Record<string, unknown>>;
  jobMedia: Array<Record<string, unknown>>;
  notes: Array<Record<string, unknown>>;
  tipAllocations: Array<Record<string, unknown>>;
}): CustomerTimelineEvent[] {
  const events: CustomerTimelineEvent[] = [];
  const add = (
    at: unknown,
    kind: string,
    title: string,
    detail: string,
    links: Partial<CustomerTimelineEvent> = {},
  ): void => {
    const value = String(at ?? '').trim();
    if (!value) return;
    events.push({
      at: value,
      kind,
      title,
      detail,
      entityType: links.entityType ?? '',
      entityId: links.entityId ?? '',
      ...links,
    });
  };
  for (const row of input.leads) {
    add(row.created_at, 'inquiry', 'Inquiry received', `${human(row.request_type)} · ${human(row.status)}`, {
      entityType: 'lead',
      entityId: String(row.id ?? ''),
      leadId: String(row.id ?? ''),
    });
  }
  for (const row of input.estimates) {
    add(row.created_at, 'estimate', `Estimate ${String(row.quote_reference ?? '')}`.trim(), `${customerMoney(row.total_cents)} · ${human(row.status)}`, {
      entityType: 'estimate',
      entityId: String(row.id ?? ''),
    });
  }
  for (const row of input.appointments) {
    add(row.start_at, 'job', `Service ${human(row.status)}`, `Job ${String(row.reference ?? '')}`, {
      entityType: 'appointment',
      entityId: String(row.id ?? ''),
      appointmentId: String(row.id ?? ''),
    });
    const updated = String(row.updated_at ?? '');
    const started = String(row.start_at ?? '');
    if (updated && updated !== started && ['completed', 'cancelled', 'no_show'].includes(String(row.status))) {
      add(updated, 'job', `Service ${human(row.status)}`, `Job ${String(row.reference ?? '')}`, {
        entityType: 'appointment',
        entityId: String(row.id ?? ''),
        appointmentId: String(row.id ?? ''),
      });
    }
  }
  for (const row of input.invoices) {
    add(
      row.created_at,
      'invoice',
      `${row.invoice_role === 'supplemental' ? 'Supplemental invoice' : 'Invoice'} ${String(row.number ?? '')}`.trim(),
      `${customerMoney(row.total_cents)} · ${human(row.status)}`,
      {
        entityType: 'invoice',
        entityId: String(row.id ?? ''),
        invoiceId: String(row.id ?? ''),
        ...(row.appointment_id ? { appointmentId: String(row.appointment_id) } : {}),
      },
    );
  }
  for (const row of input.payments) {
    const tip = Number(row.tip_cents ?? 0);
    add(
      row.received_at || row.created_at,
      'payment',
      `Payment ${human(row.status)}`,
      `${customerMoney(row.amount_cents)}${tip > 0 ? ` including ${customerMoney(tip)} gratuity` : ''} via ${human(row.provider)}`,
      {
        entityType: 'payment',
        entityId: String(row.id ?? ''),
        ...(row.invoice_id ? { invoiceId: String(row.invoice_id) } : {}),
        ...(row.appointment_id ? { appointmentId: String(row.appointment_id) } : {}),
      },
    );
  }
  for (const row of input.signingRequests) {
    const label = String(row.packet_name || row.bundle_code || 'Agreement');
    if (row.executed_at) {
      add(row.executed_at, 'agreement', 'Agreement executed', label, {
        entityType: 'signing_request',
        entityId: String(row.id ?? ''),
        requestId: String(row.id ?? ''),
        ...(row.appointment_id ? { appointmentId: String(row.appointment_id) } : {}),
      });
    }
    add(row.created_at, 'agreement', 'Agreement request created', `${label} · ${human(row.status)}`, {
      entityType: 'signing_request',
      entityId: String(row.id ?? ''),
      requestId: String(row.id ?? ''),
      ...(row.appointment_id ? { appointmentId: String(row.appointment_id) } : {}),
    });
  }
  for (const row of input.reviewRequests) {
    add(
      row.sent_at || row.created_at,
      'review',
      `Review invitation ${human(row.status)}`,
      String(row.suppressed_reason || row.channel || ''),
      { entityType: 'review_request', entityId: String(row.id ?? '') },
    );
  }
  for (const row of input.communications) {
    add(
      row.created_at,
      'communication',
      `${human(row.channel)} ${human(row.direction)}`,
      `${human(row.status)}${row.subject ? ` · ${String(row.subject)}` : row.template ? ` · ${String(row.template)}` : ''}`,
      { entityType: 'communication', entityId: String(row.id ?? '') },
    );
  }
  for (const row of input.jobMedia) {
    add(row.created_at, 'photo', 'Photo added', human(row.kind), {
      entityType: 'job_media',
      entityId: String(row.id ?? ''),
      ...(row.appointment_id ? { appointmentId: String(row.appointment_id) } : {}),
    });
  }
  for (const row of input.notes) {
    add(row.created_at, 'note', 'Internal note', String(row.body ?? '').slice(0, 180), {
      entityType: 'customer_note',
      entityId: String(row.id ?? ''),
    });
  }
  for (const row of input.tipAllocations) {
    add(
      row.created_at,
      'tip',
      'Gratuity allocation',
      `${String(row.team_member_name || 'Unassigned')} · ${customerMoney(row.amount_cents)} · ${human(row.status)}`,
      {
        entityType: 'tip_allocation',
        entityId: String(row.id ?? ''),
        ...(row.invoice_id ? { invoiceId: String(row.invoice_id) } : {}),
        ...(row.appointment_id ? { appointmentId: String(row.appointment_id) } : {}),
      },
    );
  }
  return events
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, 150);
}

export async function getCustomer(
  db: D1Database,
  actor: AdminActor,
  customerId: string,
): Promise<Record<string, unknown> | null> {
  const branch = scope(actor, 'c.primary_branch_id');
  const customer = await db
    .prepare(
      `SELECT c.*, b.name AS branch_name FROM customers c
       LEFT JOIN branches b ON b.id = c.primary_branch_id
       WHERE c.id = ? AND c.source <> 'financial_system' ${branch.sql} LIMIT 1`,
    )
    .bind(customerId, ...branch.bind)
    .first();
  if (!customer) return null;
  const canSeeNotes = actor.role === 'owner' || actor.role === 'manager';
  const canSeeFinance = actor.role === 'owner' || actor.permissions.includes('finance.read');
  const [contacts, properties, notes, leads, estimates, appointments, recurring, invoices, paymentAuthorizations, signingRequests, gifts, quickEstimates, reviewState, payments, communications, reviewRequests, jobMedia, tipAllocations] = await Promise.all([
    db.prepare('SELECT * FROM customer_contacts WHERE customer_id = ? ORDER BY is_primary DESC, created_at').bind(customerId).all(),
    db.prepare('SELECT * FROM properties WHERE customer_id = ? ORDER BY is_primary DESC, created_at').bind(customerId).all(),
    canSeeNotes
      ? db.prepare('SELECT * FROM customer_notes WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50').bind(customerId).all()
      : Promise.resolve({ success: true, results: [] }),
    db.prepare('SELECT id, request_type, status, quote_reference, delivery_status, created_at FROM leads WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50').bind(customerId).all(),
    db.prepare('SELECT id, quote_reference, status, total_cents, created_at FROM estimates WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50').bind(customerId).all(),
    db.prepare(
      `SELECT id, reference, status, start_at, end_at, property_id, created_at, updated_at
       FROM appointments WHERE customer_id = ? ORDER BY start_at DESC LIMIT 50`,
    ).bind(customerId).all(),
    db.prepare('SELECT id, frequency, status, ongoing_price_cents, next_visit_date FROM recurring_plans WHERE customer_id = ? ORDER BY created_at DESC').bind(customerId).all(),
    db.prepare(
      `SELECT id, number, status, total_cents, balance_cents, due_date, appointment_id,
              invoice_role, related_invoice_id, created_at
       FROM invoices WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50`,
    ).bind(customerId).all().catch(() =>
      db.prepare(
        `SELECT id, number, status, total_cents, balance_cents, due_date, appointment_id, created_at
         FROM invoices WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50`,
      ).bind(customerId).all(),
    ),
    canSeeFinance
      ? db.prepare(
          `SELECT pa.id, pa.service_code, pa.amount_cents, pa.max_amount_cents, pa.charge_after_service,
                  pa.status, pa.signed_at, pa.used_at, a.signed_content_text, a.sha256, a.signature_json
           FROM payment_authorizations pa JOIN agreements a ON a.id = pa.agreement_id
           WHERE pa.customer_id = ? ORDER BY pa.created_at DESC LIMIT 25`,
        ).bind(customerId).all()
      : Promise.resolve({ success: true, results: [] }),
    db.prepare(
      `SELECT id, packet_name, bundle_code, status, booking_reference, appointment_id,
              signer_email, executed_at, created_at
       FROM signing_requests WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50`,
    ).bind(customerId).all().catch(() =>
      db.prepare(
        `SELECT id, bundle_code, status, booking_reference, appointment_id,
                signer_email, executed_at, created_at
         FROM signing_requests WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50`,
      ).bind(customerId).all(),
    ),
    db.prepare(
      `SELECT id, code, status, value_cents, balance_cents, valid_from_date, activates_at, created_at,
              CASE WHEN purchaser_customer_id = ? THEN 'purchased' ELSE 'received' END AS role
       FROM gift_certificates WHERE purchaser_customer_id = ? OR recipient_customer_id = ?
       ORDER BY created_at DESC LIMIT 50`,
    ).bind(customerId, customerId, customerId).all(),
    db.prepare(
      `SELECT id, status, engine, service_code, total_cents, ongoing_cents, address_text,
              converted_request_id, created_at, updated_at
       FROM quick_estimates WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50`,
    ).bind(customerId).all().catch(() => ({ success: true, results: [] })),
    db.prepare('SELECT * FROM customer_review_state WHERE customer_id = ? LIMIT 1')
      .bind(customerId).first().catch(() => null),
    canSeeFinance
      ? db.prepare(
          `SELECT id, invoice_id, appointment_id, provider, status, amount_cents,
                  service_cents, tip_cents, tip_refunded_cents, received_at, created_at
           FROM payments WHERE customer_id = ? ORDER BY COALESCE(received_at, created_at) DESC LIMIT 100`,
        ).bind(customerId).all().catch(() =>
          db.prepare(
            `SELECT id, invoice_id, appointment_id, provider, status, amount_cents, received_at, created_at
             FROM payments WHERE customer_id = ? ORDER BY COALESCE(received_at, created_at) DESC LIMIT 100`,
          ).bind(customerId).all(),
        )
      : Promise.resolve({ success: true, results: [] }),
    db.prepare(
      `SELECT id, appointment_id, channel, direction, template, status, subject, created_at
       FROM communications WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100`,
    ).bind(customerId).all().catch(() => ({ success: true, results: [] })),
    db.prepare(
      `SELECT id, status, channel, created_at, sent_at, suppressed_reason
       FROM review_requests WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50`,
    ).bind(customerId).all().catch(() => ({ success: true, results: [] })),
    db.prepare(
      `SELECT jm.id, jm.appointment_id, jm.kind, jm.content_type, jm.created_at
       FROM job_media jm
       WHERE jm.appointment_id IN (SELECT id FROM appointments WHERE customer_id = ?)
       ORDER BY jm.created_at DESC LIMIT 100`,
    ).bind(customerId).all().catch(() => ({ success: true, results: [] })),
    canSeeFinance
      ? db.prepare(
          `SELECT ta.id, ta.payment_id, ta.invoice_id, ta.appointment_id, ta.team_member_id,
                  ta.amount_cents, ta.refunded_cents, ta.status, ta.created_at,
                  tm.display_name AS team_member_name
           FROM tip_allocations ta LEFT JOIN team_members tm ON tm.id = ta.team_member_id
           WHERE ta.customer_id = ? ORDER BY ta.created_at DESC LIMIT 100`,
        ).bind(customerId).all().catch(() => ({ success: true, results: [] }))
      : Promise.resolve({ success: true, results: [] }),
  ]);
  const [commercialProposals, commercialContracts] = await Promise.all([
    db
      .prepare(
        `SELECT id, proposal_number, title, status, recurring_total_cents, first_invoice_total_cents,
                expiration_date, contract_id, created_at
         FROM commercial_proposals WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50`,
      )
      .bind(customerId)
      .all<Record<string, unknown>>()
      .catch(() => ({ success: true, results: [] as Array<Record<string, unknown>> })),
    db
      .prepare(
        `SELECT id, status, start_date, billing_frequency, payment_terms, recurring_total_cents,
                next_invoice_date, created_at
         FROM commercial_contracts WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50`,
      )
      .bind(customerId)
      .all<Record<string, unknown>>()
      .catch(() => ({ success: true, results: [] as Array<Record<string, unknown>> })),
  ]);
  const paymentRows = payments.results ?? [];
  const communicationRows = communications.results ?? [];
  const reviewRequestRows = reviewRequests.results ?? [];
  const jobMediaRows = jobMedia.results ?? [];
  const noteRows = notes.results ?? [];
  const tipAllocationRows = tipAllocations.results ?? [];
  return {
    customer,
    contacts: contacts.results ?? [],
    properties: (properties.results ?? []).map((property) =>
      canSeeNotes ? property : { ...property, internal_notes: '' },
    ),
    notes: noteRows,
    leads: leads.results ?? [],
    estimates: estimates.results ?? [],
    appointments: appointments.results ?? [],
    recurringPlans: recurring.results ?? [],
    invoices: invoices.results ?? [],
    paymentAuthorizations: paymentAuthorizations.results ?? [],
    signingRequests: signingRequests.results ?? [],
    gifts: gifts.results ?? [],
    quickEstimates: quickEstimates.results ?? [],
    reviewState,
    payments: paymentRows,
    communications: communicationRows,
    reviewRequests: reviewRequestRows,
    jobMedia: jobMediaRows,
    tipAllocations: tipAllocationRows,
    commercialProposals: commercialProposals.results ?? [],
    commercialContracts: commercialContracts.results ?? [],
    timeline: buildCustomerTimeline({
      leads: leads.results ?? [],
      estimates: estimates.results ?? [],
      appointments: appointments.results ?? [],
      invoices: invoices.results ?? [],
      payments: paymentRows,
      signingRequests: signingRequests.results ?? [],
      reviewRequests: reviewRequestRows,
      communications: communicationRows,
      jobMedia: jobMediaRows,
      notes: noteRows,
      tipAllocations: tipAllocationRows,
    }),
  };
}

export async function createCustomer(
  db: D1Database,
  actor: AdminActor,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const id = `cust_${crypto.randomUUID()}`;
  let requestedBranch = customerBranch(actor, input.branchId);
  if (!requestedBranch && actor.role === 'owner') {
    const resolved = await resolveServiceBranchStrict(db, {
      zip: text(input.postalCode, 10),
      state: text(input.state, 2),
    }).catch(() => null);
    requestedBranch = resolved?.branch?.id ?? null;
  }
  const branchId = await assertBranch(
    db,
    requestedBranch ?? (await defaultActiveBranch(db)),
  );
  const first = text(input.firstName, 80);
  const last = text(input.lastName, 80);
  const company = text(input.companyName, 120);
  if (!first && !last && !company) throw new AdminAuthError(400, 'customer_name_required');
  for (const [kind, raw] of [['email', text(input.email, 200)], ['phone', text(input.phone, 30)]] as const) {
    const normalized = kind === 'email' ? raw.toLowerCase() : raw.replace(/\D/g, '');
    if (!normalized) continue;
    const used = await db.prepare('SELECT customer_id FROM customer_contacts WHERE kind = ? AND normalized_value = ? LIMIT 1').bind(kind, normalized).first();
    if (used) throw new AdminAuthError(409, 'contact_in_use');
  }
  const propertyInput = Boolean(text(input.addressLine1, 200)) || hasPropertyInput(input)
    ? normalizePropertyInput({ ...input, isPrimary: true })
    : null;
  const statements: D1PreparedStatement[] = [];
  statements.push(
    db
      .prepare(
        `INSERT INTO customers (id, primary_branch_id, first_name, last_name, company_name, status, source, notes_summary, do_not_contact, marketing_consent)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      )
      .bind(id, branchId, first, last, company, text(input.source, 80) || 'admin', text(input.notesSummary, 2000), flag(input.doNotContact), flag(input.marketingConsent)),
  );
  for (const [kind, raw] of [['email', text(input.email, 200)], ['phone', text(input.phone, 30)]] as const) {
    const normalized = kind === 'email' ? raw.toLowerCase() : raw.replace(/\D/g, '');
    if (!normalized) continue;
    statements.push(
      db
        .prepare(
          `INSERT INTO customer_contacts (id, customer_id, kind, value, normalized_value, is_primary)
           VALUES (?, ?, ?, ?, ?, 1)
           ON CONFLICT(kind, normalized_value) DO UPDATE SET value = excluded.value`,
        )
        .bind(`ct_${crypto.randomUUID()}`, id, kind, raw, normalized),
    );
  }
  if (propertyInput) {
    statements.push(
      propertyInsertStatement(db, {
        id: `prop_${crypto.randomUUID()}`,
        customerId: id,
        branchId,
        property: propertyInput,
      }),
    );
  }
  try {
    await runWriteBatch(db, statements);
  } catch (error) {
    await db.prepare('DELETE FROM customers WHERE id = ?').bind(id).run().catch(() => undefined);
    throw error;
  }
  await audit(db, { actorUserId: actor.id, action: 'customer.created', entityType: 'customer', entityId: id });
  return { id };
}

async function upsertContact(db: D1Database, customerId: string, kind: 'email' | 'phone', value: string): Promise<void> {
  if (!value) return;
  const normalized = kind === 'email' ? value.toLowerCase() : value.replace(/\D/g, '');
  if (!normalized) return;
  const existing = await db
    .prepare('SELECT customer_id FROM customer_contacts WHERE kind = ? AND normalized_value = ? LIMIT 1')
    .bind(kind, normalized)
    .first<{ customer_id: string }>();
  if (existing && existing.customer_id !== customerId) throw new AdminAuthError(409, 'contact_in_use');
  await db
    .prepare(
      `INSERT INTO customer_contacts (id, customer_id, kind, value, normalized_value, is_primary)
       VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT(kind, normalized_value) DO UPDATE SET value = excluded.value`,
    )
    .bind(`ct_${crypto.randomUUID()}`, customerId, kind, value, normalized)
    .run();
}

export async function updateCustomer(
  db: D1Database,
  actor: AdminActor,
  customerId: string,
  input: Record<string, unknown>,
): Promise<void> {
  const current = await getCustomer(db, actor, customerId);
  if (!current) throw new AdminAuthError(404, 'customer_not_found');
  const status = input.status === 'archived' ? 'archived' : 'active';
  await db
    .prepare(
      `UPDATE customers SET first_name = ?, last_name = ?, company_name = ?, status = ?,
         notes_summary = ?, do_not_contact = ?, marketing_consent = ?, archived_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      text(input.firstName, 80) || String((current.customer as Record<string, unknown>).first_name ?? ''),
      text(input.lastName, 80) || String((current.customer as Record<string, unknown>).last_name ?? ''),
      text(input.companyName, 120),
      status,
      text(input.notesSummary, 2000),
      flag(input.doNotContact),
      flag(input.marketingConsent),
      status === 'archived' ? now() : null,
      now(),
      customerId,
    )
    .run();
  await upsertContact(db, customerId, 'email', text(input.email, 200));
  await upsertContact(db, customerId, 'phone', text(input.phone, 30));
  await audit(db, { actorUserId: actor.id, action: 'customer.updated', entityType: 'customer', entityId: customerId });
}

const PROPERTY_COLUMNS =
  'label, line1, line2, city, state, postal_code, latitude, longitude, precision, access_notes, parking_notes, property_type, square_feet, bedrooms, full_baths, half_baths, stories, beds, pets, internal_notes, is_primary';

function propertyBindValues(property: NormalizedProperty): unknown[] {
  return [
    property.label,
    property.line1,
    property.line2,
    property.city,
    property.state,
    property.postalCode,
    property.latitude,
    property.longitude,
    property.precision,
    property.accessNotes,
    property.parkingNotes,
    property.propertyType,
    property.squareFeet,
    property.bedrooms,
    property.fullBaths,
    property.halfBaths,
    property.stories,
    property.beds,
    property.pets,
    property.internalNotes,
    property.isPrimary ? 1 : 0,
  ];
}

function propertyInsertStatement(
  db: D1Database,
  input: { id: string; customerId: string; branchId: string | null; property: NormalizedProperty },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO properties (id, customer_id, branch_id, ${PROPERTY_COLUMNS})
       VALUES (?, ?, ?, ${new Array(PROPERTY_COLUMNS.split(',').length).fill('?').join(', ')})`,
    )
    .bind(input.id, input.customerId, input.branchId, ...propertyBindValues(input.property));
}

function propertyUpdateStatement(
  db: D1Database,
  input: { id: string; status: string; property: NormalizedProperty },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE properties SET label = ?, line1 = ?, line2 = ?, city = ?, state = ?, postal_code = ?,
         latitude = ?, longitude = ?, precision = ?, access_notes = ?, parking_notes = ?, property_type = ?,
         square_feet = ?, bedrooms = ?, full_baths = ?, half_baths = ?, stories = ?, beds = ?, pets = ?,
         internal_notes = ?, is_primary = ?, status = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(...propertyBindValues(input.property), input.status, now(), input.id);
}

async function runWriteBatch(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  if (db.batch) {
    await db.batch(statements);
    return;
  }
  for (const statement of statements) {
    const result = await statement.run();
    if (!result.success) throw new AdminAuthError(500, 'write_failed');
  }
}

export async function addProperty(
  db: D1Database,
  actor: AdminActor,
  customerId: string,
  input: Record<string, unknown>,
): Promise<{ id: string }> {
  const current = await getCustomer(db, actor, customerId);
  if (!current) throw new AdminAuthError(404, 'customer_not_found');
  const customerRow = (current.customer ?? {}) as Record<string, unknown>;
  const existingProperties = (current.properties as Array<Record<string, unknown>>) ?? [];
  const hasPrimary = existingProperties.some(
    (row) => Number(row.is_primary) === 1 && row.status !== 'archived',
  );
  const normalized = normalizePropertyInput(input);
  const property = normalized.isPrimary || !hasPrimary ? { ...normalized, isPrimary: true } : normalized;
  const id = `prop_${crypto.randomUUID()}`;
  const requestedBranch = actor.role === 'owner' ? text(input.branchId, 80) : '';
  const branch = await assertBranch(
    db,
    requestedBranch || String(customerRow.primary_branch_id ?? '') || customerBranch(actor, input.branchId),
  );
  const statements: D1PreparedStatement[] = [];
  if (property.isPrimary) {
    statements.push(db.prepare('UPDATE properties SET is_primary = 0 WHERE customer_id = ?').bind(customerId));
  }
  statements.push(propertyInsertStatement(db, { id, customerId, branchId: branch, property }));
  await runWriteBatch(db, statements);
  await audit(db, { actorUserId: actor.id, action: 'property.created', entityType: 'property', entityId: id });
  return { id };
}

export async function updateProperty(
  db: D1Database,
  actor: AdminActor,
  propertyId: string,
  input: Record<string, unknown>,
): Promise<void> {
  const property = await db
    .prepare(
      `SELECT p.id, p.customer_id, p.status, p.line1, p.city, p.state, p.postal_code,
              p.latitude, p.longitude, p.precision
       FROM properties p
       JOIN customers c ON c.id = p.customer_id
       WHERE p.id = ? ${scope(actor, 'c.primary_branch_id').sql} LIMIT 1`,
    )
    .bind(propertyId, ...scope(actor, 'c.primary_branch_id').bind)
    .first<{
      id: string;
      customer_id: string;
      status: string;
      line1: string;
      city: string;
      state: string;
      postal_code: string;
      latitude: number | null;
      longitude: number | null;
      precision: string;
    }>();
  if (!property) throw new AdminAuthError(404, 'property_not_found');
  const normalized = normalizePropertyInput(input);
  const addressChanged =
    normalized.line1 !== property.line1 ||
    normalized.city !== property.city ||
    normalized.state !== property.state ||
    normalized.postalCode !== property.postal_code;
  if (input.latitude === undefined && input.longitude === undefined && !addressChanged) {
    normalized.latitude = property.latitude;
    normalized.longitude = property.longitude;
    normalized.precision = ['exact', 'street', 'approximate', 'zip'].includes(property.precision)
      ? (property.precision as 'exact' | 'street' | 'approximate' | 'zip')
      : 'exact';
  }
  const status =
    input.status === 'archived' ? 'archived' : input.status === 'active' ? 'active' : property.status;
  const statements: D1PreparedStatement[] = [];
  if (normalized.isPrimary) {
    statements.push(db.prepare('UPDATE properties SET is_primary = 0 WHERE customer_id = ?').bind(property.customer_id));
  }
  statements.push(propertyUpdateStatement(db, { id: propertyId, status, property: normalized }));
  await runWriteBatch(db, statements);
  await audit(db, { actorUserId: actor.id, action: 'property.updated', entityType: 'property', entityId: propertyId });
}

export async function addCustomerNote(
  db: D1Database,
  actor: AdminActor,
  customerId: string,
  body: string,
  visibility = 'internal',
): Promise<void> {
  const current = await getCustomer(db, actor, customerId);
  if (!current) throw new AdminAuthError(404, 'customer_not_found');
  const note = text(body, 4000);
  if (!note) throw new AdminAuthError(400, 'note_required');
  await db
    .prepare('INSERT INTO customer_notes (id, customer_id, author_user_id, visibility, body) VALUES (?, ?, ?, ?, ?)')
    .bind(`note_${crypto.randomUUID()}`, customerId, actor.id, visibility === 'private' ? 'private' : 'internal', note)
    .run();
  await audit(db, { actorUserId: actor.id, action: 'customer.note_added', entityType: 'customer', entityId: customerId });
}

export interface LeadListInput {
  status?: string;
  q?: string;
  limit?: number;
  offset?: number;
  sort?: string;
}

const LEAD_SORTS: Record<string, string> = {
  created_at: 'l.created_at DESC, l.id ASC',
  status: 'l.status ASC, l.created_at DESC, l.id ASC',
  request_type: 'l.request_type ASC, l.created_at DESC, l.id ASC',
};

function leadFilters(actor: AdminActor, input: LeadListInput): { sql: string; bind: unknown[] } {
  const status = text(input.status, 30);
  const q = text(input.q, 120);
  const branch = scope(actor, 'l.branch_id');
  let statusSql = "(? = '' OR l.status = ?)";
  let statusBind: unknown[] = [status, status];
  if (status === 'active') {
    statusSql = "l.status NOT IN ('archived','lost','converted') AND l.is_test = 0 AND l.is_duplicate = 0";
    statusBind = [];
  } else if (status === 'test') {
    statusSql = 'l.is_test = 1';
    statusBind = [];
  } else if (status === 'duplicates') {
    statusSql = 'l.is_duplicate = 1';
    statusBind = [];
  } else if (status === 'archived') {
    statusSql = "l.status = 'archived'";
    statusBind = [];
  }
  return {
    sql: `WHERE ${statusSql}
         AND (? = '' OR l.quote_reference LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ?
              OR c.company_name LIKE ? OR p.line1 LIKE ? OR l.payload_json LIKE ?)
         ${branch.sql}`,
    bind: [...statusBind, q, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, ...branch.bind],
  };
}

export function leadPageBounds(input: LeadListInput): { limit: number; offset: number; sort: string } {
  const limit = Math.min(Math.max(Number(input.limit) || 25, 1), 200);
  const offset = Math.max(Number(input.offset) || 0, 0);
  const sort = LEAD_SORTS[input.sort ?? ''] ? String(input.sort) : 'created_at';
  return { limit, offset, sort };
}

export async function listLeads(
  db: D1Database,
  actor: AdminActor,
  input: LeadListInput,
): Promise<Array<Record<string, unknown>>> {
  const bounds = leadPageBounds(input);
  const filter = leadFilters(actor, input);
  const result = await db
    .prepare(
      `SELECT l.id, l.request_type, l.status, l.source, l.quote_reference, l.delivery_status,
              l.delivery_attempts, l.last_delivery_error, l.outstanding_requirement,
              l.payload_json, l.created_at, l.updated_at, l.is_test, l.is_duplicate,
              l.duplicate_of_lead_id, l.previous_status, l.archived_at,
              c.first_name, c.last_name, c.company_name, c.id AS customer_id,
              p.line1, p.city, p.state, p.postal_code
       FROM leads l LEFT JOIN customers c ON c.id = l.customer_id
       LEFT JOIN properties p ON p.id = l.property_id
       ${filter.sql}
       ORDER BY ${LEAD_SORTS[bounds.sort]} LIMIT ? OFFSET ?`,
    )
    .bind(...filter.bind, bounds.limit, bounds.offset)
    .all();
  return result.results ?? [];
}

export async function countLeads(
  db: D1Database,
  actor: AdminActor,
  input: LeadListInput,
): Promise<number> {
  const filter = leadFilters(actor, input);
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM leads l
       LEFT JOIN customers c ON c.id = l.customer_id
       LEFT JOIN properties p ON p.id = l.property_id
       ${filter.sql}`,
    )
    .bind(...filter.bind)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function updateLead(
  db: D1Database,
  actor: AdminActor,
  leadId: string,
  input: { status?: string; note?: string },
): Promise<void> {
  const allowed = new Set(['new', 'contacted', 'quoted', 'converted', 'lost', 'archived']);
  const status = text(input.status, 30);
  if (status && !allowed.has(status)) throw new AdminAuthError(400, 'lead_status_invalid');
  const row = await db
    .prepare(`SELECT l.id, l.customer_id FROM leads l WHERE l.id = ? ${scope(actor, 'l.branch_id').sql} LIMIT 1`)
    .bind(leadId, ...scope(actor, 'l.branch_id').bind)
    .first<{ id: string; customer_id: string | null }>();
  if (!row) throw new AdminAuthError(404, 'lead_not_found');
  if (status) {
    await db.prepare('UPDATE leads SET status = ?, updated_at = ? WHERE id = ?').bind(status, now(), leadId).run();
  }
  if (text(input.note, 2000) && row.customer_id) {
    await addCustomerNote(db, actor, row.customer_id, text(input.note, 2000));
  }
  await audit(db, { actorUserId: actor.id, action: 'lead.updated', entityType: 'lead', entityId: leadId, detail: status });
}

export async function leadArchiveEligibility(
  db: D1Database,
  actor: AdminActor,
  leadId: string,
  operation: 'archive' | 'restore' | 'delete',
): Promise<{ ok: boolean; error?: string; row?: Record<string, unknown> }> {
  const row = await db
    .prepare(
      `SELECT l.id, l.request_type, l.status, l.customer_id, l.quote_reference,
              l.is_test, l.is_duplicate, l.previous_status
       FROM leads l WHERE l.id = ? ${scope(actor, 'l.branch_id').sql} LIMIT 1`,
    )
    .bind(leadId, ...scope(actor, 'l.branch_id').bind)
    .first<Record<string, unknown>>();
  if (!row) return { ok: false, error: 'lead_not_found' };
  if (operation === 'restore') {
    return String(row.status) === 'archived' ? { ok: true, row } : { ok: false, error: 'lead_not_archived', row };
  }
  if (operation === 'archive') {
    return { ok: true, row };
  }
  if (actor.role !== 'owner') return { ok: false, error: 'owner_required', row };
  // Deleting the inquiry row never deletes the customer, appointment, invoice,
  // agreement or payment history. An explicitly classified test inquiry is
  // therefore safe to remove from the sales pipeline.
  if (Number(row.is_test) === 1) return { ok: true, row };
  if (row.customer_id) return { ok: false, error: 'linked_customer_history_retained', row };
  if (String(row.request_type) === 'reservation_request') {
    return { ok: false, error: 'reservation_history_retained', row };
  }
  if (String(row.quote_reference ?? '').trim()) {
    return { ok: false, error: 'quoted_inquiry_history_retained', row };
  }
  return { ok: true, row };
}

export async function archiveLead(
  db: D1Database,
  actor: AdminActor,
  leadId: string,
): Promise<void> {
  const result = await leadArchiveEligibility(db, actor, leadId, 'archive');
  if (!result.ok) throw new AdminAuthError(404, result.error ?? 'lead_not_found');
  if (String(result.row?.status) !== 'archived') {
    await db
      .prepare(
        `UPDATE leads SET previous_status = ?, status = 'archived', archived_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(String(result.row?.status ?? 'new'), now(), now(), leadId)
      .run();
  }
  await audit(db, { actorUserId: actor.id, action: 'lead.archived', entityType: 'lead', entityId: leadId });
}

export async function restoreLead(
  db: D1Database,
  actor: AdminActor,
  leadId: string,
): Promise<void> {
  const result = await leadArchiveEligibility(db, actor, leadId, 'restore');
  if (!result.ok) throw new AdminAuthError(409, result.error ?? 'lead_not_archived');
  const previous = String(result.row?.previous_status ?? '').trim();
  const restoreStatus = ['new', 'contacted', 'quoted', 'converted', 'lost'].includes(previous) ? previous : 'new';
  await db
    .prepare('UPDATE leads SET status = ?, previous_status = NULL, archived_at = NULL, updated_at = ? WHERE id = ?')
    .bind(restoreStatus, now(), leadId)
    .run();
  await audit(db, { actorUserId: actor.id, action: 'lead.restored', entityType: 'lead', entityId: leadId });
}

export async function markLeadTest(
  db: D1Database,
  actor: AdminActor,
  leadId: string,
  isTest: boolean,
): Promise<void> {
  const result = await leadArchiveEligibility(db, actor, leadId, 'archive');
  if (!result.ok) throw new AdminAuthError(404, result.error ?? 'lead_not_found');
  await db
    .prepare(
      `UPDATE leads SET is_test = ?, test_marked_at = ?, test_marked_by_admin_user_id = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(isTest ? 1 : 0, isTest ? now() : null, isTest ? actor.id : null, now(), leadId)
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: isTest ? 'lead.marked_test' : 'lead.unmarked_test',
    entityType: 'lead',
    entityId: leadId,
  });
}

export async function markLeadDuplicate(
  db: D1Database,
  actor: AdminActor,
  leadId: string,
  isDuplicate: boolean,
  duplicateOf = '',
): Promise<void> {
  const result = await leadArchiveEligibility(db, actor, leadId, 'archive');
  if (!result.ok) throw new AdminAuthError(404, result.error ?? 'lead_not_found');
  await db
    .prepare('UPDATE leads SET is_duplicate = ?, duplicate_of_lead_id = ?, updated_at = ? WHERE id = ?')
    .bind(isDuplicate ? 1 : 0, isDuplicate ? text(duplicateOf, 120) || null : null, now(), leadId)
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: isDuplicate ? 'lead.marked_duplicate' : 'lead.unmarked_duplicate',
    entityType: 'lead',
    entityId: leadId,
  });
}

export async function markLeadConverted(
  db: D1Database,
  actor: AdminActor,
  leadId: string,
): Promise<void> {
  await updateLead(db, actor, leadId, { status: 'converted' });
}

export async function deleteDisposableLead(
  db: D1Database,
  actor: AdminActor,
  leadId: string,
): Promise<void> {
  const result = await leadArchiveEligibility(db, actor, leadId, 'delete');
  if (!result.ok) throw new AdminAuthError(result.error === 'owner_required' ? 403 : 409, result.error ?? 'lead_not_deletable');
  await db.prepare('DELETE FROM leads WHERE id = ?').bind(leadId).run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'lead.disposable_deleted',
    entityType: 'lead',
    entityId: leadId,
    detail: Number(result.row?.is_test) === 1
      ? 'Explicitly classified test inquiry removed; customer and operational history preserved.'
      : 'No customer, reservation or quote history was linked.',
  });
}

export interface SuspectedTestLead {
  id: string;
  reference: string;
  requestType: string;
  status: string;
  createdAt: string;
  customerName: string;
  reasons: string[];
}

export async function previewSuspectedTestLeads(
  db: D1Database,
  actor: AdminActor,
): Promise<SuspectedTestLead[]> {
  const branch = scope(actor, 'l.branch_id');
  const rows = await db
    .prepare(
      `SELECT l.id, l.request_type, l.status, l.quote_reference, l.created_at,
              l.source, l.payload_json, c.first_name, c.last_name, c.company_name,
              (SELECT value FROM customer_contacts cc WHERE cc.customer_id = c.id AND cc.kind = 'email' LIMIT 1) AS email,
              (SELECT value FROM customer_contacts cc WHERE cc.customer_id = c.id AND cc.kind = 'phone' LIMIT 1) AS phone
       FROM leads l LEFT JOIN customers c ON c.id = l.customer_id
       WHERE l.is_test = 0${branch.sql}
       ORDER BY l.created_at DESC LIMIT 300`,
    )
    .bind(...branch.bind)
    .all<Record<string, unknown>>();
  const suspects: SuspectedTestLead[] = [];
  for (const row of rows.results ?? []) {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(String(row.payload_json ?? '{}')) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    const reasons = suspectTestReasons({
      name: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.company_name,
      email: row.email,
      phone: row.phone,
      source: row.source,
      payload,
    });
    if (reasons.length === 0) continue;
    suspects.push({
      id: String(row.id),
      reference: String(row.quote_reference ?? ''),
      requestType: String(row.request_type ?? ''),
      status: String(row.status ?? ''),
      createdAt: String(row.created_at ?? ''),
      customerName: [row.first_name, row.last_name].filter(Boolean).join(' ') || String(row.company_name ?? ''),
      reasons,
    });
  }
  return suspects;
}

export async function retryLeadNotification(
  db: D1Database,
  actor: AdminActor,
  leadId: string,
  env: { WEB3FORMS_ACCESS_KEY?: string; WEB3FORMS_ENDPOINT?: string },
): Promise<{ delivered: boolean }> {
  const row = await db
    .prepare(
      `SELECT l.id, l.payload_json, l.delivery_status, l.delivery_attempts, l.quote_reference
       FROM leads l WHERE l.id = ? ${scope(actor, 'l.branch_id').sql} LIMIT 1`,
    )
    .bind(leadId, ...scope(actor, 'l.branch_id').bind)
    .first<{ id: string; payload_json: string; delivery_status: string; delivery_attempts: number; quote_reference: string }>();
  if (!row) throw new AdminAuthError(404, 'lead_not_found');
  if (row.delivery_status === 'sent') return { delivered: true };
  if (!env.WEB3FORMS_ACCESS_KEY) throw new AdminAuthError(503, 'email_not_configured');
  let fields: Record<string, string> = {};
  try {
    const parsed = JSON.parse(row.payload_json) as Record<string, unknown>;
    fields = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value ?? '')]));
  } catch {
    throw new AdminAuthError(400, 'lead_payload_invalid');
  }
  const notification = buildLeadNotification(fields);
  const endpoint = env.WEB3FORMS_ENDPOINT ?? 'https://api.web3forms.com/submit';
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        access_key: env.WEB3FORMS_ACCESS_KEY,
        subject: `Sparkling Standard request recovery${row.quote_reference ? ` - ${row.quote_reference}` : ''}`,
        from_name: 'Sparkling Standard Website',
        ...(fields.email ? { replyto: fields.email } : {}),
        botcheck: '',
        ...notification,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as { success?: boolean };
    if (response.ok && data.success === true) {
      await db
        .prepare("UPDATE leads SET delivery_status = 'sent', delivery_attempts = delivery_attempts + 1, last_delivery_error = '', updated_at = ? WHERE id = ?")
        .bind(now(), leadId)
        .run();
      await audit(db, { actorUserId: actor.id, action: 'lead.notification_resent', entityType: 'lead', entityId: leadId });
      return { delivered: true };
    }
    throw new Error('provider_rejected');
  } catch {
    await db
      .prepare("UPDATE leads SET delivery_status = 'failed', delivery_attempts = delivery_attempts + 1, last_delivery_error = 'provider_failed', updated_at = ? WHERE id = ?")
      .bind(now(), leadId)
      .run();
    await audit(db, { actorUserId: actor.id, action: 'lead.notification_retry_failed', entityType: 'lead', entityId: leadId, success: false });
    return { delivered: false };
  }
}

export async function setCustomerStatus(
  db: D1Database,
  actor: AdminActor,
  customerId: string,
  status: 'active' | 'archived',
): Promise<void> {
  const current = await getCustomer(db, actor, customerId);
  if (!current) throw new AdminAuthError(404, 'customer_not_found');
  await db
    .prepare('UPDATE customers SET status = ?, archived_at = ?, updated_at = ? WHERE id = ?')
    .bind(status, status === 'archived' ? now() : null, now(), customerId)
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: status === 'archived' ? 'customer.archived' : 'customer.restored',
    entityType: 'customer',
    entityId: customerId,
  });
}

async function count(db: D1Database, sql: string, customerId: string): Promise<number> {
  const row = await db.prepare(sql).bind(customerId).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export async function deleteCustomer(
  db: D1Database,
  actor: AdminActor,
  customerId: string,
  confirmation: string,
): Promise<{ mode: 'deleted' | 'anonymized' }> {
  if (actor.role !== 'owner') throw new AdminAuthError(403, 'owner_required');
  if (confirmation !== 'DELETE') throw new AdminAuthError(400, 'delete_confirmation_required');
  const current = await getCustomer(db, actor, customerId);
  if (!current) return { mode: 'deleted' };
  const stamp = now();
  const legalHold = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM legal_holds
       WHERE status = 'active'
         AND (
           (subject_type = 'customer' AND subject_id = ?)
           OR (subject_type = 'booking_request' AND subject_id IN
               (SELECT id FROM booking_requests WHERE customer_id = ?))
           OR (subject_type = 'appointment' AND subject_id IN
               (SELECT id FROM appointments WHERE customer_id = ?))
           OR (subject_type = 'invoice' AND subject_id IN
               (SELECT id FROM invoices WHERE customer_id = ?))
         )`,
    )
    .bind(customerId, customerId, customerId, customerId)
    .first<{ n: number }>();
  if (Number(legalHold?.n ?? 0) > 0) {
    throw new AdminAuthError(409, 'legal_hold_active');
  }
  const blockers = await Promise.all([
    count(db, "SELECT COUNT(*) AS n FROM appointments WHERE customer_id = ? AND status IN ('pending','confirmed','in_progress')", customerId),
    count(db, "SELECT COUNT(*) AS n FROM booking_requests WHERE customer_id = ? AND status IN ('pending','confirmed') AND archived_at IS NULL AND closed_at IS NULL", customerId),
    count(db, "SELECT COUNT(*) AS n FROM recurring_plans WHERE customer_id = ? AND status IN ('active','paused')", customerId),
    count(db, "SELECT COUNT(*) AS n FROM invoices WHERE customer_id = ? AND balance_cents > 0 AND status NOT IN ('paid','void')", customerId),
    count(db, "SELECT COUNT(*) AS n FROM payments WHERE customer_id = ? AND status = 'pending'", customerId),
    count(db, "SELECT COUNT(*) AS n FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE p.customer_id = ? AND r.status = 'pending'", customerId),
    count(db, "SELECT COUNT(*) AS n FROM gift_certificates WHERE ? IN (purchaser_customer_id, recipient_customer_id) AND status = 'active' AND balance_cents > 0", customerId),
  ]);
  const blockerNames = ['active_booking', 'pending_booking_request', 'active_recurring_plan', 'outstanding_invoice', 'pending_payment', 'pending_refund', 'active_gift_liability'];
  const blocking = blockerNames.filter((_, index) => (blockers[index] ?? 0) > 0);
  if (blocking.length > 0) throw new AdminAuthError(409, blocking[0]!);
  const history = await Promise.all([
    count(db, 'SELECT COUNT(*) AS n FROM appointments WHERE customer_id = ?', customerId),
    count(db, 'SELECT COUNT(*) AS n FROM booking_requests WHERE customer_id = ?', customerId),
    count(db, 'SELECT COUNT(*) AS n FROM invoices WHERE customer_id = ?', customerId),
    count(db, 'SELECT COUNT(*) AS n FROM payments WHERE customer_id = ?', customerId),
    count(db, 'SELECT COUNT(*) AS n FROM agreements WHERE customer_id = ?', customerId),
    count(db, 'SELECT COUNT(*) AS n FROM estimates WHERE customer_id = ?', customerId),
    count(db, 'SELECT COUNT(*) AS n FROM leads WHERE customer_id = ?', customerId),
    count(db, 'SELECT COUNT(*) AS n FROM recurring_plans WHERE customer_id = ?', customerId),
    count(db, 'SELECT COUNT(*) AS n FROM gift_certificates WHERE ? IN (purchaser_customer_id, recipient_customer_id)', customerId),
  ]);
  await db.prepare('DELETE FROM customer_contacts WHERE customer_id = ?').bind(customerId).run();
  await db.prepare('DELETE FROM customer_notes WHERE customer_id = ?').bind(customerId).run();
  await db.prepare('DELETE FROM customer_consents WHERE customer_id = ?').bind(customerId).run();
  const scrubStatements = [
    db.prepare("UPDATE leads SET payload_json = '{}', source = 'redacted', updated_at = ? WHERE customer_id = ?").bind(stamp, customerId),
    db.prepare("UPDATE booking_requests SET payload_json = '{}', updated_at = ? WHERE customer_id = ?").bind(stamp, customerId),
    db.prepare("UPDATE estimates SET input_snapshot_json = '{}', updated_at = ? WHERE customer_id = ?").bind(stamp, customerId),
    db.prepare("UPDATE signing_requests SET signer_email = '', updated_at = ? WHERE customer_id = ?").bind(stamp, customerId),
    db
      .prepare(
        `UPDATE document_signatures SET signer_name = 'Redacted', signer_email = '',
           signed_content_text = ''
         WHERE signing_request_id IN (SELECT id FROM signing_requests WHERE customer_id = ?)`,
      )
      .bind(customerId),
    db
      .prepare("UPDATE agreements SET signed_content_text = '' WHERE customer_id = ?")
      .bind(customerId),
    db
      .prepare(
        `UPDATE gift_certificates SET purchaser_name = 'Redacted', purchaser_email = '',
           recipient_name = 'Redacted', recipient_email = ''
         WHERE purchaser_customer_id = ? OR recipient_customer_id = ?`,
      )
      .bind(customerId, customerId),
  ];
  const portalTable = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'customer_portal_requests' LIMIT 1")
    .first<{ name: string }>();
  if (portalTable) {
    scrubStatements.push(
      db.prepare("UPDATE customer_portal_requests SET message = '[redacted]' WHERE customer_id = ?").bind(customerId),
      db.prepare('DELETE FROM customer_portal_sessions WHERE customer_id = ?').bind(customerId),
      db.prepare('DELETE FROM customer_portal_tokens WHERE customer_id = ?').bind(customerId),
    );
  }
  if (db.batch) await db.batch(scrubStatements);
  else for (const statement of scrubStatements) await statement.run();
  const hasHistory = history.some((value) => value > 0);
  if (hasHistory) {
    await db
      .prepare("UPDATE customers SET first_name = 'Deleted', last_name = 'Customer', company_name = '', status = 'archived', notes_summary = '', do_not_contact = 1, marketing_consent = 0, archived_at = COALESCE(archived_at, ?), updated_at = ? WHERE id = ?")
      .bind(stamp, stamp, customerId)
      .run();
    await db
      .prepare("UPDATE properties SET label = 'Archived property', line1 = 'Address removed for privacy', line2 = '', city = '', state = 'FL', postal_code = '', latitude = NULL, longitude = NULL, access_notes = '', parking_notes = '', status = 'archived', updated_at = ? WHERE customer_id = ?")
      .bind(stamp, customerId)
      .run();
  } else {
    await db.prepare('DELETE FROM properties WHERE customer_id = ?').bind(customerId).run();
    await db.prepare('DELETE FROM customers WHERE id = ?').bind(customerId).run();
  }
  await audit(db, {
    actorUserId: actor.id,
    action: hasHistory ? 'customer.anonymized' : 'customer.deleted',
    entityType: 'customer',
    entityId: customerId,
    detail: hasHistory ? 'historical records retained and identifiers removed' : 'no retained history',
  });
  return { mode: hasHistory ? 'anonymized' : 'deleted' };
}
