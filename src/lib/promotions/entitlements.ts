import type { D1Database } from '../admin/d1.ts';
import { AdminAuthError, audit, type AdminActor } from '../admin/operations.ts';

export const FRIENDS15_CODE = 'FRIENDS15';

export interface CustomerEntitlement {
  id: string;
  customerId: string;
  branchId: string | null;
  promotionId: string;
  code: string;
  percent: number;
  status: 'active' | 'inactive';
  assignedAt: string;
  assignedBy: string | null;
  removedAt: string | null;
  removedBy: string | null;
  removalReason: string;
  policyVersion: string;
}

export interface EntitlementPreviewPlan {
  id: string;
  frequency: string;
  status: string;
  currentPriceCents: number;
  discountedPriceCents: number;
  futureAppointments: number;
  willApply: boolean;
}

export interface EntitlementPreviewAppointment {
  id: string;
  reference: string;
  status: string;
  startAt: string;
  planId: string | null;
  invoiceId: string | null;
}

export interface EntitlementPreviewInvoice {
  id: string;
  number: string;
  status: string;
  totalCents: number;
  balanceCents: number;
  action: 'apply' | 'manual_review' | 'excluded';
  reason: string;
}

export interface EntitlementPreview {
  code: string;
  name: string;
  percent: number;
  alreadyActive: boolean;
  recurringPlans: EntitlementPreviewPlan[];
  appointments: EntitlementPreviewAppointment[];
  invoices: EntitlementPreviewInvoice[];
  warnings: string[];
}

interface PromotionRow {
  id: string;
  code: string;
  name: string;
  kind: string;
  percent: number;
  status: string;
  terms_version: string;
}

function text(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function scope(actor: AdminActor, column: string): { sql: string; bind: unknown[] } {
  if (actor.role === 'owner') return { sql: '', bind: [] };
  if (actor.branchId) return { sql: ` AND ${column} = ?`, bind: [actor.branchId] };
  return { sql: ' AND 1 = 0', bind: [] };
}

function record(row: Record<string, unknown>): CustomerEntitlement {
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    branchId: row.branch_id ? String(row.branch_id) : null,
    promotionId: String(row.promotion_id),
    code: String(row.code),
    percent: Number(row.percent) || 0,
    status: row.status === 'inactive' ? 'inactive' : 'active',
    assignedAt: String(row.assigned_at ?? ''),
    assignedBy: row.assigned_by_admin_user_id ? String(row.assigned_by_admin_user_id) : null,
    removedAt: row.removed_at ? String(row.removed_at) : null,
    removedBy: row.removed_by_admin_user_id ? String(row.removed_by_admin_user_id) : null,
    removalReason: String(row.removal_reason ?? ''),
    policyVersion: String(row.policy_version ?? ''),
  };
}

async function customerInScope(
  db: D1Database,
  actor: AdminActor,
  customerId: string,
): Promise<{ id: string; primary_branch_id: string | null }> {
  const branch = scope(actor, 'primary_branch_id');
  const customer = await db
    .prepare(`SELECT id, primary_branch_id FROM customers WHERE id = ? ${branch.sql} LIMIT 1`)
    .bind(customerId, ...branch.bind)
    .first<{ id: string; primary_branch_id: string | null }>();
  if (!customer) throw new AdminAuthError(404, 'customer_not_found');
  return customer;
}

async function promotionForCode(db: D1Database, code: string): Promise<PromotionRow> {
  const promotion = await db
    .prepare('SELECT id, code, name, kind, percent, status, terms_version FROM promotions WHERE code = ? LIMIT 1')
    .bind(code.toUpperCase())
    .first<PromotionRow>();
  if (!promotion) throw new AdminAuthError(404, 'promotion_not_found');
  if (promotion.status !== 'active') throw new AdminAuthError(409, 'promotion_inactive');
  if (promotion.kind !== 'percent' || !Number.isFinite(Number(promotion.percent)) || Number(promotion.percent) <= 0) {
    throw new AdminAuthError(409, 'promotion_not_percent');
  }
  return promotion;
}

export async function activeEntitlementForCustomer(
  db: D1Database | null,
  customerId: string,
  code = FRIENDS15_CODE,
): Promise<CustomerEntitlement | null> {
  if (!db || !customerId) return null;
  const row = await db
    .prepare(
      `SELECT e.* FROM customer_promotion_entitlements e
       WHERE e.customer_id = ? AND e.code = ? AND e.status = 'active' LIMIT 1`,
    )
    .bind(customerId, code.toUpperCase())
    .first<Record<string, unknown>>();
  return row ? record(row) : null;
}

export async function listCustomerEntitlements(
  db: D1Database,
  actor: AdminActor,
  customerId: string,
): Promise<{ customerId: string; entitlements: CustomerEntitlement[]; history: Array<Record<string, unknown>> }> {
  await customerInScope(db, actor, customerId);
  const rows = await db
    .prepare('SELECT * FROM customer_promotion_entitlements WHERE customer_id = ? ORDER BY created_at DESC')
    .bind(customerId)
    .all<Record<string, unknown>>();
  const history = await db
    .prepare(
      `SELECT ev.*, e.code FROM customer_promotion_entitlement_events ev
       JOIN customer_promotion_entitlements e ON e.id = ev.entitlement_id
       WHERE ev.customer_id = ? ORDER BY ev.created_at DESC LIMIT 100`,
    )
    .bind(customerId)
    .all<Record<string, unknown>>();
  return {
    customerId,
    entitlements: (rows.results ?? []).map(record),
    history: history.results ?? [],
  };
}

export async function previewCustomerEntitlement(
  db: D1Database,
  actor: AdminActor,
  customerId: string,
  code = FRIENDS15_CODE,
): Promise<EntitlementPreview> {
  const customer = await customerInScope(db, actor, customerId);
  const promotion = await promotionForCode(db, code);
  const existing = await db
    .prepare(
      `SELECT * FROM customer_promotion_entitlements
       WHERE customer_id = ? AND promotion_id = ? LIMIT 1`,
    )
    .bind(customerId, promotion.id)
    .first<Record<string, unknown>>();
  const alreadyActive = existing?.status === 'active';
  const percent = Number(promotion.percent);

  const plans = await db
    .prepare(
      `SELECT r.id, r.frequency, r.status, r.ongoing_price_cents, r.base_ongoing_price_cents, r.entitlement_id,
              (SELECT COUNT(*) FROM recurring_occurrences o
               WHERE o.plan_id = r.id AND o.status = 'scheduled' AND o.occurrence_date >= date('now')) AS future_appointments
       FROM recurring_plans r
       WHERE r.customer_id = ? AND r.status = 'active'
       ORDER BY r.created_at`,
    )
    .bind(customerId)
    .all<Record<string, unknown>>();

  const appointments = await db
    .prepare(
      `SELECT a.id, a.reference, a.status, a.start_at, a.recurring_plan_id,
              (SELECT i.id FROM invoices i WHERE i.appointment_id = a.id ORDER BY i.created_at DESC LIMIT 1) AS invoice_id
       FROM appointments a
       WHERE a.customer_id = ? AND a.status IN ('pending','confirmed')
         AND datetime(a.start_at) >= datetime('now')
       ORDER BY a.start_at LIMIT 100`,
    )
    .bind(customerId)
    .all<Record<string, unknown>>();

  const invoices = await db
    .prepare(
      `SELECT i.id, i.number, i.status, i.total_cents, i.balance_cents, i.amount_paid_cents,
              i.discount_cents, i.tax_cents, i.entitlement_id, a.status AS appointment_status
       FROM invoices i
       LEFT JOIN appointments a ON a.id = i.appointment_id
       WHERE i.customer_id = ?
         AND i.status IN ('open','partially_paid','paid','void')
         AND i.appointment_id IS NOT NULL
       ORDER BY i.created_at DESC LIMIT 100`,
    )
    .bind(customerId)
    .all<Record<string, unknown>>();

  const warnings: string[] = [];
  if (alreadyActive) warnings.push('This customer already has the active benefit. Reapplying will not duplicate it.');
  if (!customer.primary_branch_id) warnings.push('The customer has no primary branch; the benefit will use the authenticated admin branch when available.');

  return {
    code: promotion.code,
    name: promotion.name,
    percent,
    alreadyActive,
    recurringPlans: (plans.results ?? []).map((plan) => {
      const base = Number(plan.base_ongoing_price_cents ?? plan.ongoing_price_cents) || 0;
      const already = plan.entitlement_id && existing?.id === plan.entitlement_id;
      return {
        id: String(plan.id),
        frequency: String(plan.frequency),
        status: String(plan.status),
        currentPriceCents: Number(plan.ongoing_price_cents) || 0,
        discountedPriceCents: already ? Number(plan.ongoing_price_cents) || 0 : Math.round(base * (100 - percent) / 100),
        futureAppointments: Number(plan.future_appointments) || 0,
        willApply: !already,
      };
    }),
    appointments: (appointments.results ?? []).map((appointment) => ({
      id: String(appointment.id),
      reference: String(appointment.reference ?? ''),
      status: String(appointment.status ?? ''),
      startAt: String(appointment.start_at ?? ''),
      planId: appointment.recurring_plan_id ? String(appointment.recurring_plan_id) : null,
      invoiceId: appointment.invoice_id ? String(appointment.invoice_id) : null,
    })),
    invoices: (invoices.results ?? []).map((invoice) => {
      const safe =
        invoice.status === 'open' &&
        Number(invoice.amount_paid_cents) === 0 &&
        Number(invoice.discount_cents) === 0 &&
        Number(invoice.tax_cents) === 0 &&
        !invoice.entitlement_id &&
        invoice.appointment_status !== 'cancelled';
      const excluded = ['paid', 'void'].includes(String(invoice.status));
      return {
        id: String(invoice.id),
        number: String(invoice.number ?? ''),
        status: String(invoice.status ?? ''),
        totalCents: Number(invoice.total_cents) || 0,
        balanceCents: Number(invoice.balance_cents) || 0,
        action: excluded ? 'excluded' : safe ? 'apply' : 'manual_review',
        reason: excluded
          ? 'Paid or void invoice; historical financial record is not changed.'
          : safe
            ? 'Open, unpaid invoice with no existing discount or tax can be discounted safely.'
            : 'Requires a manual invoice revision, credit or reissue because it has payments, tax, an existing discount or prior benefit.',
      };
    }),
    warnings,
  };
}

async function event(
  db: D1Database,
  actor: AdminActor,
  entitlementId: string,
  customerId: string,
  action: 'assigned' | 'reactivated' | 'removed' | 'applied',
  detail: Record<string, unknown>,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO customer_promotion_entitlement_events
       (id, entitlement_id, customer_id, action, actor_admin_user_id, detail_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(`entevt_${crypto.randomUUID()}`, entitlementId, customerId, action, actor.id, JSON.stringify(detail))
    .run();
}

export async function applyCustomerEntitlement(
  db: D1Database,
  actor: AdminActor,
  input: { customerId: string; code?: string; previewToken?: string },
): Promise<{ entitlement: CustomerEntitlement; preview: EntitlementPreview; appliedPlans: number; appliedInvoices: number }> {
  const customer = await customerInScope(db, actor, input.customerId);
  const promotion = await promotionForCode(db, input.code ?? FRIENDS15_CODE);
  if (input.previewToken !== 'confirmed') {
    throw new AdminAuthError(409, 'entitlement_preview_required');
  }
  const preview = await previewCustomerEntitlement(db, actor, input.customerId, promotion.code);
  const existing = await db
    .prepare('SELECT * FROM customer_promotion_entitlements WHERE customer_id = ? AND promotion_id = ? LIMIT 1')
    .bind(input.customerId, promotion.id)
    .first<Record<string, unknown>>();
  const entitlementId = existing?.id ? String(existing.id) : `ent_${crypto.randomUUID()}`;
  const wasActive = existing?.status === 'active';
  const branchId = existing?.branch_id ? String(existing.branch_id) : customer.primary_branch_id ?? actor.branchId ?? null;
  const percent = Number(promotion.percent);

  if (!existing) {
    await db
      .prepare(
        `INSERT INTO customer_promotion_entitlements
         (id, customer_id, branch_id, promotion_id, code, percent, status, assigned_at,
          assigned_by_admin_user_id, policy_version)
         VALUES (?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, ?, ?)`,
      )
      .bind(entitlementId, input.customerId, branchId, promotion.id, promotion.code, percent, actor.id, promotion.terms_version ?? '')
      .run();
    await event(db, actor, entitlementId, input.customerId, 'assigned', { percent, code: promotion.code });
  } else if (!wasActive) {
    await db
      .prepare(
        `UPDATE customer_promotion_entitlements
         SET status = 'active', assigned_at = CURRENT_TIMESTAMP, assigned_by_admin_user_id = ?,
             removed_at = NULL, removed_by_admin_user_id = NULL, removal_reason = '',
             percent = ?, policy_version = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(actor.id, percent, promotion.terms_version ?? '', entitlementId)
      .run();
    await event(db, actor, entitlementId, input.customerId, 'reactivated', { percent, code: promotion.code });
  }

  let appliedPlans = 0;
  const plans = await db
    .prepare(
      `SELECT id, ongoing_price_cents, base_ongoing_price_cents, entitlement_id
       FROM recurring_plans WHERE customer_id = ? AND status = 'active'`,
    )
    .bind(input.customerId)
    .all<Record<string, unknown>>();
  for (const plan of plans.results ?? []) {
    if (plan.entitlement_id === entitlementId) continue;
    const base = Number(plan.base_ongoing_price_cents ?? plan.ongoing_price_cents) || 0;
    if (base <= 0) continue;
    const discounted = Math.max(0, Math.round(base * (100 - percent) / 100));
    await db
      .prepare(
        `UPDATE recurring_plans
         SET base_ongoing_price_cents = ?, ongoing_price_cents = ?, entitlement_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(base, discounted, entitlementId, new Date().toISOString(), String(plan.id))
      .run();
    appliedPlans += 1;
  }

  let appliedInvoices = 0;
  for (const invoice of preview.invoices.filter((entry) => entry.action === 'apply')) {
    const discount = Math.max(0, Math.round((invoice.totalCents * percent) / 100));
    if (discount <= 0) continue;
    const newTotal = Math.max(0, invoice.totalCents - discount);
    await db
      .prepare(
        `UPDATE invoices
         SET discount_cents = ?, total_cents = ?, balance_cents = ?, entitlement_id = ?,
             entitlement_discount_cents = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'open' AND amount_paid_cents = 0 AND discount_cents = 0
           AND tax_cents = 0 AND entitlement_id IS NULL`,
      )
      .bind(discount, newTotal, newTotal, entitlementId, discount, invoice.id)
      .run();
    const nextSort = await db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM invoice_lines WHERE invoice_id = ?')
      .bind(invoice.id)
      .first<{ next_sort: number }>();
    await db
      .prepare(
        `INSERT INTO invoice_lines
         (id, invoice_id, kind, description, quantity, unit_amount_cents, total_cents, sort_order)
         VALUES (?, ?, 'discount', ?, 1, ?, ?, ?)`,
      )
      .bind(`line_${crypto.randomUUID()}`, invoice.id, `FRIENDS15 — ${percent}% customer benefit`, discount, discount, Number(nextSort?.next_sort) || 0)
      .run();
    await audit(db, {
      actorUserId: actor.id,
      action: 'invoice.entitlement_discount_applied',
      entityType: 'invoice',
      entityId: invoice.id,
      detail: `${promotion.code}:${discount}`,
    }).catch(() => undefined);
    appliedInvoices += 1;
  }

  await event(db, actor, entitlementId, input.customerId, 'applied', {
    code: promotion.code,
    percent,
    appliedPlans,
    appliedInvoices,
  });
  await audit(db, {
    actorUserId: actor.id,
    action: 'customer.entitlement_applied',
    entityType: 'customer',
    entityId: input.customerId,
    detail: `${promotion.code}:${appliedPlans}:${appliedInvoices}`,
  });
  return {
    entitlement: (await activeEntitlementForCustomer(db, input.customerId, promotion.code)) as CustomerEntitlement,
    preview,
    appliedPlans,
    appliedInvoices,
  };
}

export async function removeCustomerEntitlement(
  db: D1Database,
  actor: AdminActor,
  input: { customerId: string; entitlementId: string; reason?: string },
): Promise<{ removed: boolean; restoredPlans: number }> {
  await customerInScope(db, actor, input.customerId);
  const entitlement = await db
    .prepare('SELECT * FROM customer_promotion_entitlements WHERE id = ? AND customer_id = ? LIMIT 1')
    .bind(input.entitlementId, input.customerId)
    .first<Record<string, unknown>>();
  if (!entitlement) throw new AdminAuthError(404, 'entitlement_not_found');
  if (entitlement.status !== 'active') return { removed: false, restoredPlans: 0 };
  await db
    .prepare(
      `UPDATE customer_promotion_entitlements
       SET status = 'inactive', removed_at = CURRENT_TIMESTAMP, removed_by_admin_user_id = ?,
           removal_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
    .bind(actor.id, text(input.reason, 500) || 'owner removed benefit', input.entitlementId)
    .run();
  const plans = await db
    .prepare('SELECT id, base_ongoing_price_cents FROM recurring_plans WHERE entitlement_id = ?')
    .bind(input.entitlementId)
    .all<Record<string, unknown>>();
  let restoredPlans = 0;
  for (const plan of plans.results ?? []) {
    const base = Number(plan.base_ongoing_price_cents) || 0;
    if (base <= 0) continue;
    await db
      .prepare(
        `UPDATE recurring_plans
         SET ongoing_price_cents = ?, base_ongoing_price_cents = NULL, entitlement_id = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .bind(base, new Date().toISOString(), String(plan.id))
      .run();
    restoredPlans += 1;
  }
  await event(db, actor, input.entitlementId, input.customerId, 'removed', {
    reason: text(input.reason, 500) || 'owner removed benefit',
    restoredPlans,
  });
  await audit(db, {
    actorUserId: actor.id,
    action: 'customer.entitlement_removed',
    entityType: 'customer',
    entityId: input.customerId,
    detail: input.entitlementId,
  });
  return { removed: true, restoredPlans };
}
