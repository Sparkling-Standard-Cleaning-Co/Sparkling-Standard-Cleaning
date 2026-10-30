import type { AdminActor } from './operations.ts';
import { AdminAuthError, audit } from './operations.ts';
import type { D1Database } from './d1.ts';
import { buildLeadNotification } from '../forms/lead-notification.ts';

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

export async function listCustomers(
  db: D1Database,
  actor: AdminActor,
  input: { q?: string; status?: string; limit?: number },
): Promise<Array<Record<string, unknown>>> {
  const q = text(input.q, 120);
  const status = ['active', 'archived'].includes(input.status ?? '') ? input.status : '';
  const bounded = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
  const branch = scope(actor, 'c.primary_branch_id');
  const result = await db
    .prepare(
      `SELECT c.id, c.first_name, c.last_name, c.company_name, c.status, c.source,
              c.do_not_contact, c.marketing_consent, c.created_at,
              b.name AS branch_name,
              (SELECT value FROM customer_contacts cc WHERE cc.customer_id = c.id AND cc.kind = 'email' ORDER BY cc.is_primary DESC LIMIT 1) AS email,
              (SELECT value FROM customer_contacts cc WHERE cc.customer_id = c.id AND cc.kind = 'phone' ORDER BY cc.is_primary DESC LIMIT 1) AS phone,
              (SELECT COUNT(*) FROM properties p WHERE p.customer_id = c.id AND p.status = 'active') AS property_count
       FROM customers c LEFT JOIN branches b ON b.id = c.primary_branch_id
       WHERE (? = '' OR c.status = ?)
         AND (? = '' OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.company_name LIKE ?
              OR EXISTS (SELECT 1 FROM customer_contacts cc WHERE cc.customer_id = c.id AND cc.normalized_value LIKE ?))
         ${branch.sql}
       ORDER BY c.created_at DESC LIMIT ?`,
    )
    .bind(
      status,
      status,
      q,
      `%${q}%`,
      `%${q}%`,
      `%${q}%`,
      `%${q.toLowerCase()}%`,
      ...branch.bind,
      bounded,
    )
    .all();
  return result.results ?? [];
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
       WHERE c.id = ? ${branch.sql} LIMIT 1`,
    )
    .bind(customerId, ...branch.bind)
    .first();
  if (!customer) return null;
  const canSeeNotes = actor.role === 'owner' || actor.role === 'manager';
  const [contacts, properties, notes, leads, estimates, appointments, recurring, invoices, paymentAuthorizations] = await Promise.all([
    db.prepare('SELECT * FROM customer_contacts WHERE customer_id = ? ORDER BY is_primary DESC, created_at').bind(customerId).all(),
    db.prepare('SELECT * FROM properties WHERE customer_id = ? ORDER BY is_primary DESC, created_at').bind(customerId).all(),
    canSeeNotes
      ? db.prepare('SELECT * FROM customer_notes WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50').bind(customerId).all()
      : Promise.resolve({ success: true, results: [] }),
    db.prepare('SELECT id, request_type, status, quote_reference, delivery_status, created_at FROM leads WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50').bind(customerId).all(),
    db.prepare('SELECT id, quote_reference, status, total_cents, created_at FROM estimates WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50').bind(customerId).all(),
    db.prepare('SELECT id, reference, status, start_at, end_at FROM appointments WHERE customer_id = ? ORDER BY start_at DESC LIMIT 50').bind(customerId).all(),
    db.prepare('SELECT id, frequency, status, ongoing_price_cents, next_visit_date FROM recurring_plans WHERE customer_id = ? ORDER BY created_at DESC').bind(customerId).all(),
    db.prepare('SELECT id, number, status, total_cents, balance_cents, due_date FROM invoices WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50').bind(customerId).all(),
    db.prepare(
      `SELECT pa.id, pa.service_code, pa.amount_cents, pa.max_amount_cents, pa.charge_after_service,
              pa.status, pa.signed_at, pa.used_at, a.signed_content_text, a.sha256, a.signature_json
       FROM payment_authorizations pa JOIN agreements a ON a.id = pa.agreement_id
       WHERE pa.customer_id = ? ORDER BY pa.created_at DESC LIMIT 25`,
    ).bind(customerId).all(),
  ]);
  return {
    customer,
    contacts: contacts.results ?? [],
    properties: properties.results ?? [],
    notes: notes.results ?? [],
    leads: leads.results ?? [],
    estimates: estimates.results ?? [],
    appointments: appointments.results ?? [],
    recurringPlans: recurring.results ?? [],
    invoices: invoices.results ?? [],
    paymentAuthorizations: paymentAuthorizations.results ?? [],
  };
}

export async function createCustomer(
  db: D1Database,
  actor: AdminActor,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const id = `cust_${crypto.randomUUID()}`;
  const branchId = await assertBranch(db, customerBranch(actor, input.branchId));
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
  await db
    .prepare(
      `INSERT INTO customers (id, primary_branch_id, first_name, last_name, company_name, status, source, notes_summary, do_not_contact, marketing_consent)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    )
    .bind(id, branchId, first, last, company, text(input.source, 80) || 'admin', text(input.notesSummary, 2000), flag(input.doNotContact), flag(input.marketingConsent))
    .run();
  await upsertContact(db, id, 'email', text(input.email, 200));
  await upsertContact(db, id, 'phone', text(input.phone, 30));
  if (text(input.addressLine1, 200)) {
    await addProperty(db, actor, id, {
      label: text(input.propertyLabel, 80) || 'Service property',
      line1: text(input.addressLine1, 200),
      line2: text(input.addressLine2, 120),
      city: text(input.city, 80),
      state: text(input.state, 20) || 'FL',
      postalCode: text(input.postalCode, 12),
      accessNotes: text(input.accessNotes, 1000),
      parkingNotes: text(input.parkingNotes, 1000),
      isPrimary: true,
    });
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

export async function addProperty(
  db: D1Database,
  actor: AdminActor,
  customerId: string,
  input: Record<string, unknown>,
): Promise<{ id: string }> {
  const current = await getCustomer(db, actor, customerId);
  if (!current) throw new AdminAuthError(404, 'customer_not_found');
  const line1 = text(input.line1, 200);
  if (!line1) throw new AdminAuthError(400, 'address_required');
  const id = `prop_${crypto.randomUUID()}`;
  const branch = await assertBranch(db, customerBranch(actor, input.branchId));
  if (flag(input.isPrimary)) {
    await db.prepare('UPDATE properties SET is_primary = 0 WHERE customer_id = ?').bind(customerId).run();
  }
  await db
    .prepare(
      `INSERT INTO properties (id, customer_id, branch_id, label, line1, line2, city, state, postal_code, access_notes, parking_notes, is_primary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, customerId, branch, text(input.label, 80) || 'Service property', line1, text(input.line2, 120), text(input.city, 80), text(input.state, 20) || 'FL', text(input.postalCode, 12), text(input.accessNotes, 1000), text(input.parkingNotes, 1000), flag(input.isPrimary))
    .run();
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
      `SELECT p.id, p.customer_id FROM properties p
       JOIN customers c ON c.id = p.customer_id
       WHERE p.id = ? ${scope(actor, 'c.primary_branch_id').sql} LIMIT 1`,
    )
    .bind(propertyId, ...scope(actor, 'c.primary_branch_id').bind)
    .first<{ id: string; customer_id: string }>();
  if (!property) throw new AdminAuthError(404, 'property_not_found');
  const status = input.status === 'archived' ? 'archived' : 'active';
  if (flag(input.isPrimary)) {
    await db.prepare('UPDATE properties SET is_primary = 0 WHERE customer_id = ?').bind(property.customer_id).run();
  }
  await db
    .prepare(
      `UPDATE properties SET label = ?, line1 = ?, line2 = ?, city = ?, state = ?, postal_code = ?,
         access_notes = ?, parking_notes = ?, is_primary = ?, status = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(text(input.label, 80), text(input.line1, 200), text(input.line2, 120), text(input.city, 80), text(input.state, 20) || 'FL', text(input.postalCode, 12), text(input.accessNotes, 1000), text(input.parkingNotes, 1000), flag(input.isPrimary), status, now(), propertyId)
    .run();
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

export async function listLeads(
  db: D1Database,
  actor: AdminActor,
  input: { status?: string; q?: string; limit?: number },
): Promise<Array<Record<string, unknown>>> {
  const status = text(input.status, 30);
  const q = text(input.q, 120);
  const branch = scope(actor, 'l.branch_id');
  const result = await db
    .prepare(
      `SELECT l.id, l.request_type, l.status, l.source, l.quote_reference, l.delivery_status,
              l.delivery_attempts, l.last_delivery_error, l.outstanding_requirement,
              l.payload_json, l.created_at, l.updated_at,
              c.first_name, c.last_name, c.id AS customer_id,
              p.line1, p.city, p.state, p.postal_code
       FROM leads l LEFT JOIN customers c ON c.id = l.customer_id
       LEFT JOIN properties p ON p.id = l.property_id
       WHERE (? = '' OR l.status = ?)
         AND (? = '' OR l.quote_reference LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ?
              OR p.line1 LIKE ? OR l.payload_json LIKE ?)
         ${branch.sql}
       ORDER BY l.created_at DESC LIMIT ?`,
    )
    .bind(status, status, q, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, ...branch.bind, Math.min(Math.max(Number(input.limit) || 100, 1), 300))
    .all();
  return result.results ?? [];
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
