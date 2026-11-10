// Owner-managed promotions. Base cleaning-price formulas are untouched: a
// promotion is a post-calculation discount with its own eligibility rules.

import type { D1Database } from '../admin/d1.ts';

export type PromotionKind = 'fixed' | 'percent';
export type PromotionStatus = 'draft' | 'active' | 'disabled' | 'expired';

export interface PromotionRecord {
  id: string;
  name: string;
  code: string;
  kind: PromotionKind;
  valueCents: number;
  percent: number;
  services: string[];
  branches: string[];
  minPurchaseCents: number;
  maxDiscountCents: number;
  startsAt: string | null;
  expiresAt: string | null;
  maxRedemptions: number;
  perCustomerLimit: number;
  newCustomersOnly: boolean;
  recurringOnly: boolean;
  firstVisitOnly: boolean;
  combinable: boolean;
  status: PromotionStatus;
  termsVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromotionEvaluation {
  ok: boolean;
  reason: string;
  promotion?: PromotionRecord;
  discountCents?: number;
}

function text(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function integer(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => text(item, 80)).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((item) => text(item, 80)).filter(Boolean);
    } catch {
      return [];
    }
  }
  return [];
}

function flag(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'yes' || value === 'on';
}

function now(): string {
  return new Date().toISOString();
}

function rowToRecord(row: Record<string, unknown>): PromotionRecord {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    code: String(row.code ?? ''),
    kind: String(row.kind) === 'percent' ? 'percent' : 'fixed',
    valueCents: Number(row.value_cents) || 0,
    percent: Number(row.percent) || 0,
    services: list(row.services_json),
    branches: list(row.branches_json),
    minPurchaseCents: Number(row.min_purchase_cents) || 0,
    maxDiscountCents: Number(row.max_discount_cents) || 0,
    startsAt: row.starts_at ? String(row.starts_at) : null,
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    maxRedemptions: Number(row.max_redemptions) || 0,
    perCustomerLimit: Number(row.per_customer_limit) || 1,
    newCustomersOnly: Number(row.new_customers_only) === 1,
    recurringOnly: Number(row.recurring_only) === 1,
    firstVisitOnly: Number(row.first_visit_only) === 1,
    combinable: Number(row.combinable) === 1,
    status: ['draft', 'active', 'disabled', 'expired'].includes(String(row.status))
      ? (String(row.status) as PromotionStatus)
      : 'draft',
    termsVersion: String(row.terms_version ?? ''),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

function normalizeCode(value: unknown): string {
  return text(value, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
}

export function validatePromotionInput(input: Record<string, unknown>): {
  ok: boolean;
  error?: string;
} {
  if (!text(input.name, 200)) return { ok: false, error: 'promotion_name_required' };
  const code = normalizeCode(input.code);
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) return { ok: false, error: 'promotion_code_invalid' };
  const kind = input.kind === 'percent' ? 'percent' : 'fixed';
  const percent = integer(input.percent);
  const valueCents = integer(input.valueCents);
  if (kind === 'percent' && (percent < 1 || percent > 100)) {
    return { ok: false, error: 'promotion_percent_invalid' };
  }
  if (kind === 'fixed' && valueCents < 1) return { ok: false, error: 'promotion_amount_invalid' };
  const services = list(input.services);
  if (services.length === 0) return { ok: false, error: 'promotion_services_required' };
  const branches = list(input.branches);
  if (branches.length === 0) return { ok: false, error: 'promotion_branches_required' };
  if (input.startsAt && input.expiresAt && Date.parse(String(input.expiresAt)) <= Date.parse(String(input.startsAt))) {
    return { ok: false, error: 'promotion_dates_invalid' };
  }
  return { ok: true };
}

export async function listPromotions(db: D1Database): Promise<Array<Record<string, unknown>>> {
  const rows = await db
    .prepare(
      `SELECT p.*,
              (SELECT COUNT(*) FROM promotion_redemptions r WHERE r.promotion_id = p.id AND r.status = 'redeemed') AS redeemed_count,
              (SELECT COALESCE(SUM(r.amount_cents),0) FROM promotion_redemptions r WHERE r.promotion_id = p.id AND r.status = 'redeemed') AS redeemed_cents
       FROM promotions p ORDER BY p.created_at DESC`,
    )
    .all();
  const nowMs = Date.now();
  return (rows.results ?? []).map((row) => {
    const record = rowToRecord(row);
    const displayStatus =
      record.status === 'draft' || record.status === 'disabled'
        ? record.status
        : record.expiresAt && Date.parse(record.expiresAt) < nowMs
          ? 'expired'
          : record.startsAt && Date.parse(record.startsAt) > nowMs
            ? 'scheduled'
            : record.status;
    return {
      ...record,
      displayStatus,
      redeemedCount: Number(row.redeemed_count) || 0,
      redeemedCents: Number(row.redeemed_cents) || 0,
    };
  });
}

export async function getPromotion(db: D1Database, id: string): Promise<PromotionRecord | null> {
  const row = await db.prepare('SELECT * FROM promotions WHERE id = ? LIMIT 1').bind(id).first();
  return row ? rowToRecord(row) : null;
}

async function writePromotion(
  db: D1Database,
  id: string,
  input: Record<string, unknown>,
  actorId: string,
): Promise<{ id: string; code: string }> {
  const validation = validatePromotionInput(input);
  if (!validation.ok) throw new Error(validation.error);
  const code = normalizeCode(input.code);
  const services = JSON.stringify(list(input.services));
  const branches = JSON.stringify(list(input.branches));
  const kind = input.kind === 'percent' ? 'percent' : 'fixed';
  const percent = integer(input.percent);
  const valueCents = integer(input.valueCents);
  const status = text(input.status, 20) || 'draft';
  if (!['draft', 'active', 'disabled', 'expired'].includes(status)) {
    throw new Error('promotion_status_invalid');
  }
  await db
    .prepare(
      `INSERT INTO promotions
       (id, name, code, kind, value_cents, percent, services_json, branches_json,
        min_purchase_cents, max_discount_cents, starts_at, expires_at, max_redemptions,
        per_customer_limit, new_customers_only, recurring_only, first_visit_only, combinable,
        status, terms_version, created_by_admin_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, code = excluded.code, kind = excluded.kind,
         value_cents = excluded.value_cents, percent = excluded.percent,
         services_json = excluded.services_json, branches_json = excluded.branches_json,
         min_purchase_cents = excluded.min_purchase_cents,
         max_discount_cents = excluded.max_discount_cents,
         starts_at = excluded.starts_at, expires_at = excluded.expires_at,
         max_redemptions = excluded.max_redemptions,
         per_customer_limit = excluded.per_customer_limit,
         new_customers_only = excluded.new_customers_only,
         recurring_only = excluded.recurring_only,
         first_visit_only = excluded.first_visit_only,
         combinable = excluded.combinable, status = excluded.status,
         terms_version = excluded.terms_version, updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      id,
      text(input.name, 200),
      code,
      kind,
      valueCents,
      percent,
      services,
      branches,
      integer(input.minPurchaseCents),
      integer(input.maxDiscountCents),
      input.startsAt ? String(input.startsAt) : null,
      input.expiresAt ? String(input.expiresAt) : null,
      integer(input.maxRedemptions),
      Math.max(1, integer(input.perCustomerLimit, 1)),
      flag(input.newCustomersOnly) ? 1 : 0,
      flag(input.recurringOnly) ? 1 : 0,
      flag(input.firstVisitOnly) ? 1 : 0,
      flag(input.combinable) ? 1 : 0,
      status,
      text(input.termsVersion, 80) || '2026-11-10.promotions.v1',
      actorId,
    )
    .run();
  return { id, code };
}

export async function createPromotion(
  db: D1Database,
  actorId: string,
  input: Record<string, unknown>,
): Promise<{ id: string; code: string }> {
  const id = `promo_${crypto.randomUUID()}`;
  return writePromotion(db, id, input, actorId);
}

export async function updatePromotion(
  db: D1Database,
  actorId: string,
  id: string,
  input: Record<string, unknown>,
): Promise<{ id: string; code: string }> {
  const current = await getPromotion(db, id);
  if (!current) throw new Error('promotion_not_found');
  return writePromotion(db, id, { ...current, ...input, services: input.services ?? current.services, branches: input.branches ?? current.branches }, actorId);
}

export async function duplicatePromotion(
  db: D1Database,
  actorId: string,
  id: string,
): Promise<{ id: string; code: string }> {
  const current = await getPromotion(db, id);
  if (!current) throw new Error('promotion_not_found');
  const copy = {
    ...current,
    name: `${current.name} (copy)`,
    code: `${current.code}-COPY-${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
    status: 'draft',
  };
  return createPromotion(db, actorId, copy);
}

export async function setPromotionStatus(
  db: D1Database,
  id: string,
  status: PromotionStatus,
): Promise<void> {
  await db
    .prepare('UPDATE promotions SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, now(), id)
    .run();
}

async function customerIdForQuote(
  db: D1Database,
  quoteReference: string,
  holdId: string,
): Promise<string | null> {
  const booking =
    holdId || quoteReference
      ? await db
          .prepare(
            `SELECT customer_id FROM booking_requests
             WHERE (hold_id = ? AND ? <> '') OR (quote_reference = ? AND ? <> '')
             ORDER BY created_at DESC LIMIT 1`,
          )
          .bind(holdId, holdId, quoteReference, quoteReference)
          .first<{ customer_id: string | null }>()
      : null;
  if (booking?.customer_id) return booking.customer_id;
  if (!quoteReference) return null;
  const lead = await db
    .prepare(
      'SELECT customer_id FROM leads WHERE quote_reference = ? ORDER BY created_at DESC LIMIT 1',
    )
    .bind(quoteReference)
    .first<{ customer_id: string | null }>();
  return lead?.customer_id ?? null;
}

export interface PromotionQuoteInput {
  code: string;
  cleaningAmountCents: number;
  serviceType: string;
  branchId: string;
  frequency: string;
  quoteReference: string;
  holdId: string;
  hasExistingDiscount?: boolean;
}

export async function evaluatePromotionForQuote(
  db: D1Database | null,
  input: PromotionQuoteInput,
): Promise<PromotionEvaluation> {
  if (!db) return { ok: false, reason: 'promotion_unavailable' };
  const code = normalizeCode(input.code);
  if (!code) return { ok: false, reason: 'promotion_code_required' };
  const row = await db.prepare('SELECT * FROM promotions WHERE code = ? LIMIT 1').bind(code).first();
  if (!row) return { ok: false, reason: 'promotion_not_found' };
  const promotion = rowToRecord(row);
  if (promotion.status !== 'active') return { ok: false, reason: 'promotion_inactive' };
  const at = Date.now();
  if (promotion.startsAt && Date.parse(promotion.startsAt) > at) {
    return { ok: false, reason: 'promotion_not_started' };
  }
  if (promotion.expiresAt && Date.parse(promotion.expiresAt) < at) {
    return { ok: false, reason: 'promotion_expired' };
  }
  if (!promotion.services.includes(input.serviceType)) {
    return { ok: false, reason: 'promotion_service_ineligible' };
  }
  if (promotion.branches.length > 0 && !promotion.branches.includes(input.branchId)) {
    return { ok: false, reason: 'promotion_branch_ineligible' };
  }
  if (promotion.recurringOnly && !['weekly', 'biweekly', 'monthly'].includes(input.frequency)) {
    return { ok: false, reason: 'promotion_recurring_only' };
  }
  if (!promotion.combinable && input.hasExistingDiscount) {
    return { ok: false, reason: 'promotion_not_combinable' };
  }
  if ((input.cleaningAmountCents || 0) < promotion.minPurchaseCents) {
    return { ok: false, reason: 'promotion_minimum_not_met' };
  }
  const customerId = await customerIdForQuote(db, input.quoteReference, input.holdId);
  if (promotion.newCustomersOnly) {
    if (!customerId) return { ok: false, reason: 'promotion_customer_required' };
    const prior = await db
      .prepare(
        `SELECT COUNT(*) AS count FROM booking_requests
         WHERE customer_id = ? AND quote_reference <> ? AND status IN ('confirmed','pending')`,
      )
      .bind(customerId, input.quoteReference)
      .first<{ count: number }>();
    if (Number(prior?.count ?? 0) > 0) return { ok: false, reason: 'promotion_new_customers_only' };
  }
  if (promotion.perCustomerLimit > 0 && customerId) {
    const used = await db
      .prepare(
        `SELECT COUNT(*) AS count FROM promotion_redemptions
         WHERE promotion_id = ? AND customer_id = ? AND (status = 'redeemed' OR (status = 'reserved' AND reserved_at >= datetime('now','-2 hours')))`,
      )
      .bind(promotion.id, customerId)
      .first<{ count: number }>();
    if (Number(used?.count ?? 0) >= promotion.perCustomerLimit) {
      return { ok: false, reason: 'promotion_customer_limit_reached' };
    }
  }
  if (promotion.maxRedemptions > 0) {
    const used = await db
      .prepare(
        `SELECT COUNT(*) AS count FROM promotion_redemptions
         WHERE promotion_id = ? AND (status = 'redeemed' OR (status = 'reserved' AND reserved_at >= datetime('now','-2 hours')))`,
      )
      .bind(promotion.id)
      .first<{ count: number }>();
    if (Number(used?.count ?? 0) >= promotion.maxRedemptions) {
      return { ok: false, reason: 'promotion_exhausted' };
    }
  }
  let discount =
    promotion.kind === 'percent'
      ? Math.round((input.cleaningAmountCents * promotion.percent) / 100)
      : promotion.valueCents;
  if (promotion.maxDiscountCents > 0) discount = Math.min(discount, promotion.maxDiscountCents);
  discount = Math.max(0, Math.min(discount, input.cleaningAmountCents));
  return {
    ok: true,
    reason: 'eligible',
    promotion,
    discountCents: discount,
    ...(customerId ? { customerId } : {}),
  } as PromotionEvaluation & { customerId?: string };
}

export async function reservePromotionRedemption(
  db: D1Database,
  promotionId: string,
  input: {
    code: string;
    customerId: string | null;
    checkoutAttempt: string;
    quoteReference: string;
    amountCents: number;
  },
): Promise<{ ok: boolean; reason: string; redemptionId?: string }> {
  const existing = await db
    .prepare(
      'SELECT id, status FROM promotion_redemptions WHERE promotion_id = ? AND checkout_attempt = ? LIMIT 1',
    )
    .bind(promotionId, input.checkoutAttempt)
    .first<{ id: string; status: string }>();
  if (existing) {
    return { ok: existing.status !== 'released', reason: existing.status, redemptionId: existing.id };
  }
  const id = `promo_redemption_${crypto.randomUUID()}`;
  const result = await db
    .prepare(
      `INSERT INTO promotion_redemptions
       (id, promotion_id, code, customer_id, checkout_attempt, quote_reference, amount_cents, status)
       SELECT ?, p.id, ?, ?, ?, ?, ?, 'reserved'
       FROM promotions p
       WHERE p.id = ? AND p.status = 'active'
         AND (p.max_redemptions = 0 OR
              (SELECT COUNT(*) FROM promotion_redemptions r
               WHERE r.promotion_id = p.id AND (r.status = 'redeemed' OR (status = 'reserved' AND reserved_at >= datetime('now','-2 hours')))) < p.max_redemptions)
         AND (p.per_customer_limit = 0 OR ? IS NULL OR
              (SELECT COUNT(*) FROM promotion_redemptions r
               WHERE r.promotion_id = p.id AND r.customer_id = ? AND (r.status = 'redeemed' OR (status = 'reserved' AND reserved_at >= datetime('now','-2 hours')))) < p.per_customer_limit)`,
    )
    .bind(
      id,
      input.code,
      input.customerId,
      input.checkoutAttempt,
      input.quoteReference,
      input.amountCents,
      promotionId,
      input.customerId,
      input.customerId,
    )
    .run();
  if (!result.success || Number(result.meta?.changes ?? 0) === 0) {
    return { ok: false, reason: 'promotion_unavailable' };
  }
  return { ok: true, reason: 'reserved', redemptionId: id };
}

export async function redeemPromotionRedemption(
  db: D1Database,
  checkoutAttempt: string,
  stripeSessionId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE promotion_redemptions
       SET status = 'redeemed', redeemed_at = CURRENT_TIMESTAMP, stripe_session_id = ?
       WHERE checkout_attempt = ? AND status = 'reserved'`,
    )
    .bind(stripeSessionId, checkoutAttempt)
    .run();
}

export async function releasePromotionRedemption(
  db: D1Database,
  checkoutAttempt: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE promotion_redemptions SET status = 'released', released_at = CURRENT_TIMESTAMP
       WHERE checkout_attempt = ? AND status = 'reserved'`,
    )
    .bind(checkoutAttempt)
    .run();
}

export async function promotionReporting(db: D1Database): Promise<Array<Record<string, unknown>>> {
  return listPromotions(db);
}
