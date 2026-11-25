/**
 * Signed service change orders / agreement amendments.
 *
 * The original agreement and primary invoice are never rewritten. A change
 * order uses the owner-approved Additional Service and Add-On Authorization
 * template through the existing signature engine, then links one explicit
 * supplemental invoice after execution.
 */
import type { D1Database } from '../admin/d1.ts';
import { AdminAuthError, audit } from '../admin/operations.ts';
import {
  addBundleItem,
  createBundle,
  createSigningRequest,
  type DocumentSubjectContext,
} from '../documents/service.ts';

const CHANGE_ORDER_TEMPLATE_TITLE = 'Additional Service and Add-On Authorization';

export interface ChangeOrderRecord extends Record<string, unknown> {
  id: string;
  reference: string;
  appointment_id: string;
  customer_id: string;
  status: string;
  effective_status: string;
  adjustment_cents: number;
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function now(): string {
  return new Date().toISOString();
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function reference(): string {
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `CO-${day}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

const CHANGE_ORDER_SELECT = `
  SELECT co.*, a.reference AS job_reference, a.start_at, a.branch_id AS job_branch_id,
         c.first_name, c.last_name, c.company_name,
         p.label AS property_label, p.line1, p.city, p.state, p.postal_code,
         sr.status AS signing_status, sr.executed_at AS signing_executed_at,
         sr.token_expires_at AS signing_expires_at,
         primary_invoice.number AS primary_invoice_number,
         supplemental_invoice.number AS supplemental_invoice_number,
         CASE
           WHEN co.status IN ('declined','cancelled','billed') THEN co.status
           WHEN sr.id IS NOT NULL AND (sr.executed_at IS NOT NULL OR sr.status = 'signed') THEN 'signed'
           WHEN sr.status = 'void' THEN 'cancelled'
           WHEN sr.status = 'expired' THEN 'expired'
           ELSE co.status
         END AS effective_status
  FROM service_change_orders co
  JOIN appointments a ON a.id = co.appointment_id
  JOIN customers c ON c.id = co.customer_id
  LEFT JOIN properties p ON p.id = co.property_id
  LEFT JOIN signing_requests sr ON sr.id = co.signing_request_id
  LEFT JOIN invoices primary_invoice ON primary_invoice.id = co.primary_invoice_id
  LEFT JOIN invoices supplemental_invoice ON supplemental_invoice.id = co.supplemental_invoice_id`;

export async function listChangeOrders(
  db: D1Database,
  input: { appointmentId?: string; customerId?: string } = {},
): Promise<ChangeOrderRecord[]> {
  const appointmentId = text(input.appointmentId, 120);
  const customerId = text(input.customerId, 100);
  const rows = await db
    .prepare(
      `${CHANGE_ORDER_SELECT}
       WHERE (? = '' OR co.appointment_id = ?) AND (? = '' OR co.customer_id = ?)
       ORDER BY co.created_at DESC LIMIT 100`,
    )
    .bind(appointmentId, appointmentId, customerId, customerId)
    .all<ChangeOrderRecord>();
  return rows.results ?? [];
}

export async function getChangeOrder(db: D1Database, id: string): Promise<ChangeOrderRecord | null> {
  return db.prepare(`${CHANGE_ORDER_SELECT} WHERE co.id = ? LIMIT 1`).bind(id).first<ChangeOrderRecord>();
}

async function approvedChangeOrderTemplate(db: D1Database): Promise<{ id: string; title: string }> {
  const template = await db
    .prepare(
      `SELECT id, title FROM document_templates
       WHERE status = 'approved' AND title = ?
       ORDER BY approved_at DESC, created_at DESC LIMIT 1`,
    )
    .bind(CHANGE_ORDER_TEMPLATE_TITLE)
    .first<{ id: string; title: string }>();
  if (!template) throw new AdminAuthError(409, 'change_order_template_missing');
  return template;
}

async function originalExecutedAgreement(
  db: D1Database,
  appointmentId: string,
  customerId: string,
  propertyId: string | null,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT id FROM signing_requests
       WHERE executed_at IS NOT NULL
         AND (appointment_id = ? OR (customer_id = ? AND (? = '' OR property_id = ?)))
       ORDER BY executed_at DESC LIMIT 1`,
    )
    .bind(appointmentId, customerId, propertyId ?? '', propertyId ?? '')
    .first<{ id: string }>();
  return row?.id ?? null;
}

export async function createChangeOrder(
  db: D1Database,
  actorUserId: string,
  input: Record<string, unknown>,
): Promise<ChangeOrderRecord> {
  const appointmentId = text(input.appointmentId, 120);
  if (!appointmentId) throw new AdminAuthError(400, 'appointment_required');
  const job = await db
    .prepare(
      `SELECT a.id, a.reference, a.branch_id, a.customer_id, a.property_id,
              e.total_cents AS estimate_total_cents, e.service_code,
              i.id AS primary_invoice_id, i.number AS primary_invoice_number, i.total_cents AS invoice_total_cents
       FROM appointments a
       LEFT JOIN estimates e ON e.id = a.estimate_id
       LEFT JOIN invoices i ON i.appointment_id = a.id AND i.invoice_role = 'primary'
       WHERE a.id = ? LIMIT 1`,
    )
    .bind(appointmentId)
    .first<{
      id: string;
      reference: string;
      branch_id: string;
      customer_id: string;
      property_id: string | null;
      estimate_total_cents: number | null;
      service_code: string | null;
      primary_invoice_id: string | null;
      primary_invoice_number: string | null;
      invoice_total_cents: number | null;
    }>();
  if (!job) throw new AdminAuthError(404, 'appointment_not_found');
  const originalScope = text(input.originalScope, 4000);
  const revisedScope = text(input.revisedScope, 4000);
  const reason = text(input.reason, 2000);
  if (!revisedScope) throw new AdminAuthError(400, 'change_order_scope_required');
  if (!reason) throw new AdminAuthError(400, 'change_order_reason_required');
  const adjustmentCents = Math.round(Number(input.adjustmentCents));
  if (!Number.isFinite(adjustmentCents) || adjustmentCents === 0) {
    throw new AdminAuthError(400, 'change_order_adjustment_required');
  }
  if (Math.abs(adjustmentCents) > 100_000_000) {
    throw new AdminAuthError(400, 'change_order_adjustment_invalid');
  }
  const originalPriceCents =
    Math.round(Number(job.invoice_total_cents ?? job.estimate_total_cents ?? input.originalPriceCents ?? 0)) || 0;
  if (originalPriceCents <= 0) throw new AdminAuthError(409, 'change_order_original_price_missing');
  const revisedPriceCents = originalPriceCents + adjustmentCents;
  if (revisedPriceCents < 0) throw new AdminAuthError(400, 'change_order_revised_price_invalid');
  const template = await approvedChangeOrderTemplate(db);
  const originalAgreement = await originalExecutedAgreement(
    db,
    appointmentId,
    String(job.customer_id),
    job.property_id,
  );
  const id = `change_${crypto.randomUUID()}`;
  const ref = reference();
  const timestamp = now();
  await db
    .prepare(
      `INSERT INTO service_change_orders
         (id, reference, branch_id, customer_id, property_id, appointment_id,
          original_signing_request_id, primary_invoice_id, template_id,
          original_scope, revised_scope, reason, original_price_cents, revised_price_cents,
          adjustment_cents, status, requested_by_admin_user_id, effective_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?, ?)`,
    )
    .bind(
      id,
      ref,
      job.branch_id,
      job.customer_id,
      job.property_id,
      appointmentId,
      originalAgreement,
      job.primary_invoice_id,
      template.id,
      originalScope,
      revisedScope,
      reason,
      originalPriceCents,
      revisedPriceCents,
      adjustmentCents,
      actorUserId,
      text(input.effectiveDate, 10) || new Date().toISOString().slice(0, 10),
      timestamp,
      timestamp,
    )
    .run();
  await audit(db, {
    actorUserId,
    action: 'change_order.created',
    entityType: 'service_change_order',
    entityId: id,
    detail: `${ref} ${money(adjustmentCents)}`,
  });
  const created = await getChangeOrder(db, id);
  if (!created) throw new AdminAuthError(500, 'change_order_create_failed');
  return created;
}

export async function approveChangeOrder(
  db: D1Database,
  actorUserId: string,
  id: string,
): Promise<ChangeOrderRecord> {
  const row = await getChangeOrder(db, id);
  if (!row) throw new AdminAuthError(404, 'change_order_not_found');
  if (row.status !== 'pending_approval') throw new AdminAuthError(409, 'change_order_not_pending');
  await db
    .prepare(
      `UPDATE service_change_orders
       SET status = 'approved', approved_by_admin_user_id = ?, approved_at = ?, updated_at = ?
       WHERE id = ? AND status = 'pending_approval'`,
    )
    .bind(actorUserId, now(), now(), id)
    .run();
  await audit(db, {
    actorUserId,
    action: 'change_order.approved',
    entityType: 'service_change_order',
    entityId: id,
    detail: String(row.reference ?? ''),
  });
  const approved = await getChangeOrder(db, id);
  if (!approved) throw new AdminAuthError(404, 'change_order_not_found');
  return approved;
}

export async function declineChangeOrder(
  db: D1Database,
  actorUserId: string,
  id: string,
  reason = '',
): Promise<void> {
  const row = await getChangeOrder(db, id);
  if (!row) throw new AdminAuthError(404, 'change_order_not_found');
  if (['billed', 'signed', 'cancelled'].includes(String(row.effective_status))) {
    throw new AdminAuthError(409, 'change_order_not_declinable');
  }
  await db
    .prepare("UPDATE service_change_orders SET status = 'declined', updated_at = ? WHERE id = ?")
    .bind(now(), id)
    .run();
  await audit(db, {
    actorUserId,
    action: 'change_order.declined',
    entityType: 'service_change_order',
    entityId: id,
    detail: text(reason, 500),
  });
}

export interface SentChangeOrder {
  requestId: string;
  token: string;
  signingUrl: string;
  bundleName: string;
}

export async function sendChangeOrder(
  db: D1Database,
  actorUserId: string,
  id: string,
): Promise<SentChangeOrder> {
  const row = await getChangeOrder(db, id);
  if (!row) throw new AdminAuthError(404, 'change_order_not_found');
  if (row.signing_request_id && ['sent', 'signed'].includes(String(row.effective_status))) {
    throw new AdminAuthError(409, 'change_order_already_sent');
  }
  if (row.status !== 'approved') throw new AdminAuthError(409, 'change_order_not_approved');
  const template = await approvedChangeOrderTemplate(db);
  const appointmentId = String(row.appointment_id);
  const customerId = String(row.customer_id);
  const propertyId = text(row.property_id, 100) || null;
  const job = await db
    .prepare('SELECT reference, service_code FROM appointments a LEFT JOIN estimates e ON e.id = a.estimate_id WHERE a.id = ? LIMIT 1')
    .bind(appointmentId)
    .first<{ reference: string; service_code: string | null }>();
  if (!job) throw new AdminAuthError(404, 'appointment_not_found');
  const code = `change.${String(row.reference).toLowerCase()}`;
  const bundle = await createBundle(db, actorUserId, {
    code,
    name: `Change Order ${String(row.reference)}`,
    description: `Signed amendment for job ${job.reference}`,
    serviceCategory: 'change_order',
    subjectType: 'customer',
    packetType: 'change_order',
    instructions: 'Review the revised scope and price. Sign only if you approve this change.',
  });
  try {
    await addBundleItem(db, actorUserId, {
      bundleId: bundle.id,
      templateId: template.id,
      required: true,
      enforcementStage: 'optional',
    });
    const context: DocumentSubjectContext = {
      subjectType: 'customer',
      customerId,
      ...(propertyId ? { propertyId } : {}),
      appointmentId,
      bookingReference: job.reference,
      serviceCode: job.service_code ?? 'residential-cleaning',
      frequency: 'one_time',
    };
    const adjustment = Number(row.adjustment_cents);
    const variables: Record<string, string> = {
      'service.scope': String(row.revised_scope ?? ''),
      'service.additions': String(row.reason ?? ''),
      'price.summary': money(adjustment),
      'price.line_items': `Change order ${String(row.reference)}: ${String(row.revised_scope ?? '')} - ${money(adjustment)}`,
      'payment.terms': 'Due upon acceptance of this change order.',
      'service.date': String(row.effective_date ?? ''),
      'agreement.effective_date': String(row.effective_date ?? ''),
    };
    const created = await createSigningRequest(db, context, {
      createdByAdminUserId: actorUserId,
      bundleId: bundle.id,
      instructions: `Change order ${String(row.reference)}. Original price ${money(Number(row.original_price_cents))}; revised price ${money(Number(row.revised_price_cents))}.`,
      variables,
    });
    if (!created.required || !created.requestId || !created.token) {
      throw new AdminAuthError(409, 'change_order_packet_not_required');
    }
    await db
      .prepare(
        `UPDATE service_change_orders
         SET signing_request_id = ?, bundle_id = ?, template_id = ?, status = 'sent', updated_at = ?
         WHERE id = ?`,
      )
      .bind(created.requestId, bundle.id, template.id, now(), id)
      .run();
    await audit(db, {
      actorUserId,
      action: 'change_order.sent_for_signature',
      entityType: 'service_change_order',
      entityId: id,
      detail: `${String(row.reference)} -> ${created.requestId}`,
    });
    return {
      requestId: created.requestId,
      token: created.token,
      signingUrl: `/document-sign/?token=${encodeURIComponent(created.token)}`,
      bundleName: created.bundleName ?? `Change Order ${String(row.reference)}`,
    };
  } finally {
    await db
      .prepare("UPDATE document_bundles SET status = 'inactive' WHERE id = ?")
      .bind(bundle.id)
      .run()
      .catch(() => undefined);
  }
}

export async function changeOrderInvoiceInput(
  db: D1Database,
  id: string,
): Promise<Record<string, unknown>> {
  const row = await getChangeOrder(db, id);
  if (!row) throw new AdminAuthError(404, 'change_order_not_found');
  if (String(row.effective_status) !== 'signed') {
    throw new AdminAuthError(409, 'change_order_not_signed');
  }
  if (row.supplemental_invoice_id) throw new AdminAuthError(409, 'change_order_already_billed');
  const adjustment = Number(row.adjustment_cents);
  if (adjustment <= 0) throw new AdminAuthError(409, 'change_order_credit_requires_refund');
  const timeZone = row.branch_id === 'branch_tampa' ? 'America/New_York' : 'America/Chicago';
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const effectiveDate = String(row.effective_date ?? '');
  const serviceDate = effectiveDate && effectiveDate <= today ? effectiveDate : today;
  return {
    customerId: String(row.customer_id),
    propertyId: text(row.property_id, 100) || undefined,
    appointmentId: String(row.appointment_id),
    relatedInvoiceId: text(row.primary_invoice_id, 100) || undefined,
    invoiceRole: 'supplemental',
    serviceDate,
    lines: [
      {
        kind: 'service',
        description: `Change order ${String(row.reference)}: ${String(row.revised_scope ?? '')}`,
        quantity: 1,
        unitAmountCents: adjustment,
        totalCents: adjustment,
      },
    ],
  };
}

export async function linkChangeOrderInvoice(
  db: D1Database,
  actorUserId: string,
  id: string,
  invoiceId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE service_change_orders
       SET supplemental_invoice_id = ?, status = 'billed', updated_at = ?
       WHERE id = ? AND supplemental_invoice_id IS NULL`,
    )
    .bind(invoiceId, now(), id)
    .run();
  await audit(db, {
    actorUserId,
    action: 'change_order.supplemental_invoice_created',
    entityType: 'service_change_order',
    entityId: id,
    detail: invoiceId,
  });
}
