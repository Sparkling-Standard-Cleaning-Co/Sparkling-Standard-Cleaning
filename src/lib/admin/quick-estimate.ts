// Owner-only Quick Estimate for phone and walk-in inquiries.
//
// The calculation is the SAME server-side engine used by the public estimator
// and manual bookings. A Quick Estimate never creates a customer, property,
// booking, hold, invoice, payment or calendar event unless the owner explicitly
// converts it into a booking.

import type { D1Database } from './d1.ts';
import { AdminAuthError, audit, type AdminActor } from './operations.ts';
import {
  addressDestination,
  createManualBooking,
  normalizeInput,
  priceEstimateInput,
  type ManualBookingDependencies,
  type ManualBookingEnv,
  type ManualEstimateInput,
  type ManualQuote,
} from './manual-booking.ts';
import type { Condition, Frequency, LastProfessionalClean, PetSituation, PropertyType } from '../estimate/types.ts';

export interface QuickEstimateEnv extends ManualBookingEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  RESEND_REPLY_TO?: string;
  PUBLIC_SITE_URL?: string;
}

export interface QuickEstimateInput extends ManualEstimateInput {
  addressLine1: string;
  addressUnit?: string | undefined;
  placeId?: string | undefined;
  county?: string | undefined;
  formattedAddress?: string | undefined;
  city: string;
  state: string;
  postalCode: string;
  latitude?: number | undefined;
  longitude?: number | undefined;
  customerId?: string | undefined;
  propertyId?: string | undefined;
  branchId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  notes: string;
  serviceDate?: string | undefined;
}

export type QuickEstimateQuote = Omit<ManualQuote, 'fields' | 'documentsRequired'>;

export interface QuickEstimateResult {
  input: QuickEstimateInput;
  quote: QuickEstimateQuote;
  addressText: string;
  pricingVersion: string;
}

export interface QuickEstimateRecord {
  id: string;
  status: 'draft' | 'saved' | 'converted' | 'discarded';
  branch_id: string;
  engine: string;
  service_code: string;
  customer_id: string | null;
  property_id: string | null;
  quote_reference: string;
  estimate_number: string;
  pricing_version: string;
  promotion_code: string;
  input_json: string;
  quote_json: string;
  total_cents: number | null;
  ongoing_cents: number | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  address_text: string;
  notes: string;
  converted_request_id: string | null;
  converted_at: string | null;
  discarded_at: string | null;
  created_at: string;
  updated_at: string;
}

function text(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function numberOrUndefined(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function now(): string {
  return new Date().toISOString();
}

async function resolveBranch(
  db: D1Database,
  actor: AdminActor,
  requested: string,
): Promise<string> {
  if (actor.role !== 'owner' && actor.branchId) return actor.branchId;
  const candidate = text(requested, 100);
  if (candidate) {
    const row = await db
      .prepare("SELECT id FROM branches WHERE id = ? AND status = 'active' LIMIT 1")
      .bind(candidate)
      .first<{ id: string }>();
    if (row) return row.id;
    throw new AdminAuthError(400, 'branch_invalid');
  }
  const fallback = actor.branchId
    ? null
    : await db
        .prepare("SELECT id FROM branches WHERE status = 'active' ORDER BY CASE WHEN id = 'branch_pensacola' THEN 0 ELSE 1 END, name LIMIT 1")
        .first<{ id: string }>();
  return fallback?.id ?? actor.branchId ?? 'branch_pensacola';
}

async function verifyCustomerProperty(
  db: D1Database,
  actor: AdminActor,
  customerId: string,
  propertyId: string,
): Promise<void> {
  if (!customerId) return;
  const branch = actor.role === 'owner' ? '' : actor.branchId ? ' AND primary_branch_id = ?' : ' AND 1 = 0';
  const binds = actor.role === 'owner' ? [customerId] : actor.branchId ? [customerId, actor.branchId] : [customerId];
  const customer = await db
    .prepare(`SELECT id FROM customers WHERE id = ? ${branch} LIMIT 1`)
    .bind(...binds)
    .first<{ id: string }>();
  if (!customer) throw new AdminAuthError(404, 'customer_not_found');
  if (!propertyId) return;
  const property = await db
    .prepare('SELECT id FROM properties WHERE id = ? AND customer_id = ? AND status = ? LIMIT 1')
    .bind(propertyId, customerId, 'active')
    .first<{ id: string }>();
  if (!property) throw new AdminAuthError(404, 'property_not_found');
}

export function normalizeQuickEstimateInput(
  raw: Record<string, unknown>,
  branchId: string,
): QuickEstimateInput {
  const base = normalizeInput(raw);
  const input: QuickEstimateInput = {
    ...base,
    engine: base.engine,
    serviceType: base.serviceType,
    propertyType: base.propertyType ?? 'house',
    frequency: (base.frequency ?? 'one_time') as Frequency,
    condition: (base.condition ?? 'maintained') as Condition,
    lastClean: (base.lastClean ?? 'within_month') as LastProfessionalClean,
    pets: (base.pets ?? 'none') as PetSituation,
    addressLine1: text(raw.addressLine1, 200),
    addressUnit: text(raw.addressUnit, 40),
    placeId: text(raw.placeId, 200),
    county: text(raw.county, 120),
    formattedAddress: text(raw.formattedAddress, 300),
    city: text(raw.city, 120),
    state: (text(raw.state, 2).toUpperCase() || 'FL') as string,
    postalCode: text(raw.postalCode, 12),
    ...(numberOrUndefined(raw.latitude) !== undefined ? { latitude: Number(raw.latitude) } : {}),
    ...(numberOrUndefined(raw.longitude) !== undefined ? { longitude: Number(raw.longitude) } : {}),
    customerId: text(raw.customerId, 100) || undefined,
    propertyId: text(raw.propertyId, 100) || undefined,
    branchId,
    customerName: text(raw.customerName, 200),
    customerEmail: text(raw.customerEmail, 200).toLowerCase(),
    customerPhone: text(raw.customerPhone, 40),
    notes: text(raw.notes, 2000),
    ...(text(raw.serviceDate, 10) ? { serviceDate: text(raw.serviceDate, 10) } : {}),
  };
  if (!input.propertyType) input.propertyType = 'house' as PropertyType;
  return input;
}

function addressText(input: QuickEstimateInput): string {
  const line = [
    [input.addressLine1, input.addressUnit].filter(Boolean).join(', '),
    input.city,
    [input.state, input.postalCode].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');
  return line || (input.postalCode ? `ZIP ${input.postalCode}` : '');
}

export async function calculateQuickEstimate(
  env: QuickEstimateEnv,
  db: D1Database,
  actor: AdminActor,
  raw: Record<string, unknown>,
): Promise<QuickEstimateResult> {
  const branchId = await resolveBranch(db, actor, text(raw.branchId, 100));
  const input = normalizeQuickEstimateInput(raw, branchId);
  if (!/^\d{5}(-\d{4})?$/.test(input.postalCode) && (input.latitude === undefined || input.longitude === undefined)) {
    throw new AdminAuthError(400, 'address_or_zip_required');
  }
  if (input.customerId) {
    await verifyCustomerProperty(db, actor, input.customerId, input.propertyId ?? '');
  } else if (input.propertyId) {
    throw new AdminAuthError(400, 'customer_property_required');
  }
  const destination = await addressDestination(env, {
    line1: input.addressLine1,
    city: input.city,
    state: input.state,
    postal_code: input.postalCode,
    ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
    ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
  });
  const reference = text(raw.reference, 120) || `QE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const quote = await priceEstimateInput(env, db, input, destination, {
    branchId,
    ...(input.customerId ? { customerId: input.customerId } : {}),
    ...(input.propertyId ? { propertyId: input.propertyId } : {}),
    reference,
    ...(input.serviceDate ? { serviceDate: input.serviceDate } : {}),
  }, {
    postal_code: input.postalCode,
    property_type: input.propertyType,
    square_feet: input.squareFeet,
    bedrooms: input.bedrooms,
    full_baths: input.fullBaths,
    half_baths: input.halfBaths,
    beds: input.beds,
    pets: input.pets,
  });
  return {
    input,
    quote,
    addressText: addressText(input),
    pricingVersion: quote.pricingVersion,
  };
}

function scoped(
  actor: AdminActor,
  alias = 'q',
): { sql: string; bind: unknown[] } {
  if (actor.role === 'owner') return { sql: '', bind: [] };
  if (actor.branchId) return { sql: ` AND ${alias}.branch_id = ?`, bind: [actor.branchId] };
  return { sql: ' AND 1 = 0', bind: [] };
}

async function nextEstimateNumber(db: D1Database): Promise<string> {
  const year = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
  }).format(new Date());
  const prefix = `EST-${year}-`;
  const row = await db
    .prepare(
      `SELECT MAX(CAST(substr(estimate_number, ?) AS INTEGER)) AS maximum
       FROM quick_estimates WHERE estimate_number LIKE ?`,
    )
    .bind(prefix.length + 1, `${prefix}%`)
    .first<{ maximum: number | null }>()
    .catch(() => null);
  const next = Number(row?.maximum ?? 0) + 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

export async function saveQuickEstimate(
  env: QuickEstimateEnv,
  db: D1Database,
  actor: AdminActor,
  raw: Record<string, unknown>,
): Promise<{ id: string; status: string; estimateNumber: string; quote: QuickEstimateQuote }> {
  const existingId = text(raw.id, 120);
  if (existingId) {
    const existing = await getQuickEstimate(db, actor, existingId);
    if (!existing) throw new AdminAuthError(404, 'quick_estimate_not_found');
    if (!['draft', 'saved'].includes(existing.status)) {
      throw new AdminAuthError(409, 'quick_estimate_closed');
    }
  }
  const calculated = await calculateQuickEstimate(env, db, actor, raw);
  const status = raw.status === 'draft' ? 'draft' : 'saved';
  const id = existingId || `qe_${crypto.randomUUID()}`;
  const inputJson = JSON.stringify(calculated.input);
  const quoteJson = JSON.stringify(calculated.quote);
  let estimateNumber = existingId
    ? String(
        (
          await db
            .prepare('SELECT estimate_number FROM quick_estimates WHERE id = ? LIMIT 1')
            .bind(existingId)
            .first<{ estimate_number: string }>()
            .catch(() => null)
        )?.estimate_number ?? '',
      )
    : await nextEstimateNumber(db);
  if (!estimateNumber) estimateNumber = await nextEstimateNumber(db);
  if (existingId) {
    await db
      .prepare(
        `UPDATE quick_estimates
         SET status = ?, engine = ?, service_code = ?, customer_id = ?, property_id = ?,
             quote_reference = ?, estimate_number = ?, pricing_version = ?, promotion_code = ?,
             input_json = ?, quote_json = ?, total_cents = ?, ongoing_cents = ?, customer_name = ?,
             customer_email = ?, customer_phone = ?, address_text = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        status,
        calculated.input.engine,
        calculated.quote.serviceCode,
        calculated.input.customerId ?? null,
        calculated.input.propertyId ?? null,
        text(raw.reference, 120) || id,
        estimateNumber,
        calculated.pricingVersion,
        calculated.input.promotionCode ?? '',
        inputJson,
        quoteJson,
        calculated.quote.totalCents,
        calculated.quote.ongoingPerVisitCents,
        calculated.input.customerName,
        calculated.input.customerEmail,
        calculated.input.customerPhone,
        calculated.addressText,
        calculated.input.notes,
        now(),
        id,
      )
      .run();
  } else {
    const bindValues = [
      id,
      actor.id,
      calculated.input.branchId,
      status,
      calculated.input.engine,
      calculated.quote.serviceCode,
      calculated.input.customerId ?? null,
      calculated.input.propertyId ?? null,
      text(raw.reference, 120) || id,
      calculated.pricingVersion,
      calculated.input.promotionCode ?? '',
      inputJson,
      quoteJson,
      calculated.quote.totalCents,
      calculated.quote.ongoingPerVisitCents,
      calculated.input.customerName,
      calculated.input.customerEmail,
      calculated.input.customerPhone,
      calculated.addressText,
      calculated.input.notes,
    ];
    try {
      await db
        .prepare(
          `INSERT INTO quick_estimates
           (id, created_by_admin_user_id, branch_id, status, engine, service_code, customer_id,
            property_id, quote_reference, estimate_number, pricing_version, promotion_code,
            input_json, quote_json, total_cents, ongoing_cents, customer_name, customer_email,
            customer_phone, address_text, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(...bindValues.slice(0, 9), estimateNumber, ...bindValues.slice(9))
        .run();
    } catch (error) {
      if (!(error instanceof Error) || !/estimate_number/i.test(error.message)) throw error;
      await db
        .prepare(
          `INSERT INTO quick_estimates
           (id, created_by_admin_user_id, branch_id, status, engine, service_code, customer_id,
            property_id, quote_reference, pricing_version, promotion_code, input_json, quote_json,
            total_cents, ongoing_cents, customer_name, customer_email, customer_phone,
            address_text, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(...bindValues)
        .run();
    }
  }
  await audit(db, {
    actorUserId: actor.id,
    action: existingId ? 'quick_estimate.updated' : 'quick_estimate.created',
    entityType: 'quick_estimate',
    entityId: id,
    detail: `${calculated.quote.status}:${calculated.quote.totalCents ?? 'none'}:${calculated.pricingVersion}`,
  });
  return { id, status, estimateNumber, quote: calculated.quote };
}

export async function listQuickEstimates(
  db: D1Database,
  actor: AdminActor,
  filters: { status?: string; q?: string } = {},
): Promise<Array<Record<string, unknown>>> {
  const branch = scoped(actor);
  const clauses: string[] = ['1 = 1'];
  const binds: unknown[] = [];
  if (filters.status && ['draft', 'saved', 'converted', 'discarded'].includes(filters.status)) {
    clauses.push('q.status = ?');
    binds.push(filters.status);
  }
  if (filters.q) {
    clauses.push('(q.customer_name LIKE ? OR q.customer_email LIKE ? OR q.customer_phone LIKE ? OR q.address_text LIKE ? OR q.quote_reference LIKE ?)');
    const like = `%${filters.q.slice(0, 120)}%`;
    binds.push(like, like, like, like, like);
  }
  const query = (estimateNumberColumn: string) =>
    db
      .prepare(
        `SELECT q.id, q.status, q.engine, q.service_code, q.customer_id, q.property_id,
                q.quote_reference, ${estimateNumberColumn} AS estimate_number, q.pricing_version,
                q.total_cents, q.ongoing_cents, q.customer_name, q.customer_email, q.customer_phone,
                q.address_text, q.converted_request_id, q.created_at, q.updated_at,
                c.first_name, c.last_name
         FROM quick_estimates q
         LEFT JOIN customers c ON c.id = q.customer_id
         WHERE ${clauses.join(' AND ')}${branch.sql}
         ORDER BY q.updated_at DESC LIMIT 100`,
      )
      .bind(...binds, ...branch.bind)
      .all<Record<string, unknown>>();
  const rows = await query('q.estimate_number').catch(async (error) => {
    if (!(error instanceof Error) || !/estimate_number/i.test(error.message)) throw error;
    return query("''");
  });
  return rows.results ?? [];
}

export async function getQuickEstimate(
  db: D1Database,
  actor: AdminActor,
  id: string,
): Promise<QuickEstimateRecord | null> {
  const branch = scoped(actor);
  return db
    .prepare(`SELECT q.* FROM quick_estimates q WHERE q.id = ?${branch.sql} LIMIT 1`)
    .bind(id, ...branch.bind)
    .first<QuickEstimateRecord>();
}

export async function discardQuickEstimate(
  db: D1Database,
  actor: AdminActor,
  id: string,
): Promise<void> {
  const existing = await getQuickEstimate(db, actor, id);
  if (!existing) throw new AdminAuthError(404, 'quick_estimate_not_found');
  if (existing.status === 'converted') throw new AdminAuthError(409, 'quick_estimate_converted');
  await db
    .prepare("UPDATE quick_estimates SET status = 'discarded', discarded_at = ?, updated_at = ? WHERE id = ?")
    .bind(now(), now(), id)
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'quick_estimate.discarded',
    entityType: 'quick_estimate',
    entityId: id,
  });
}

export async function assignQuickEstimate(
  db: D1Database,
  actor: AdminActor,
  id: string,
  raw: Record<string, unknown>,
): Promise<void> {
  const existing = await getQuickEstimate(db, actor, id);
  if (!existing) throw new AdminAuthError(404, 'quick_estimate_not_found');
  if (existing.status === 'converted') throw new AdminAuthError(409, 'quick_estimate_converted');
  const customerId = text(raw.customerId, 100);
  const propertyId = text(raw.propertyId, 100);
  if (!customerId || !propertyId) throw new AdminAuthError(400, 'customer_property_required');
  await verifyCustomerProperty(db, actor, customerId, propertyId);
  await db
    .prepare('UPDATE quick_estimates SET customer_id = ?, property_id = ?, updated_at = ? WHERE id = ?')
    .bind(customerId, propertyId, now(), id)
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'quick_estimate.assigned',
    entityType: 'quick_estimate',
    entityId: id,
    detail: `${customerId}:${propertyId}`,
  });
}

export interface QuickEstimateConversion {
  requestId: string;
  holdId: string;
  reference: string;
  quote: ManualQuote;
}

/**
 * Converts a saved estimate into a real pending booking. The entire estimate,
 * promotion and travel calculation is revalidated by createManualBooking; a
 * stale or ineligible price can never be carried into the booking.
 */
export async function convertQuickEstimate(
  env: QuickEstimateEnv,
  db: D1Database,
  actor: AdminActor,
  id: string,
  raw: Record<string, unknown>,
  overrides: Partial<ManualBookingDependencies> = {},
): Promise<QuickEstimateConversion> {
  const existing = await getQuickEstimate(db, actor, id);
  if (!existing) throw new AdminAuthError(404, 'quick_estimate_not_found');
  if (existing.status === 'converted') throw new AdminAuthError(409, 'quick_estimate_converted');
  if (existing.status === 'discarded') throw new AdminAuthError(409, 'quick_estimate_discarded');
  const customerId = text(raw.customerId, 100) || existing.customer_id || '';
  const propertyId = text(raw.propertyId, 100) || existing.property_id || '';
  if (!customerId || !propertyId) throw new AdminAuthError(409, 'assign_customer_required');
  await verifyCustomerProperty(db, actor, customerId, propertyId);
  const input = JSON.parse(existing.input_json || '{}') as Record<string, unknown>;
  const date = text(raw.date, 10);
  const start = text(raw.start, 40);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !start) {
    throw new AdminAuthError(400, 'booking_date_required');
  }
  const created = await createManualBooking(env, db, actor, {
    ...input,
    customerId,
    propertyId,
    date,
    start,
    crewSize: Number(raw.crewSize) || 1,
    teamMemberIds: Array.isArray(raw.teamMemberIds)
      ? raw.teamMemberIds.filter((value): value is string => typeof value === 'string')
      : [],
    notes: text(raw.notes, 2000) || existing.notes,
    promotionCode: existing.promotion_code || input.promotionCode || '',
  }, overrides);
  await db
    .prepare(
      `UPDATE quick_estimates
       SET status = 'converted', customer_id = ?, property_id = ?, converted_request_id = ?,
           converted_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(customerId, propertyId, created.requestId, now(), now(), id)
    .run();
  await audit(db, {
    actorUserId: actor.id,
    action: 'quick_estimate.converted',
    entityType: 'quick_estimate',
    entityId: id,
    detail: `${created.requestId}:${created.reference}`,
  });
  return {
    requestId: created.requestId,
    holdId: created.holdId,
    reference: created.reference,
    quote: created.quote,
  };
}
