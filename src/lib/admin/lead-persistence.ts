import type { D1Database } from './d1.ts';
import { hashToken } from './auth.ts';

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
}

function normalizedPhone(value: string): string {
  return value.replace(/\D/g, '').slice(0, 15);
}

function serviceCode(requestType: string, fields: Record<string, string>): string {
  if (requestType.includes('church')) return 'church-cleaning';
  if (requestType.includes('commercial')) return 'commercial-cleaning';
  return fields.service_type || 'residential-cleaning';
}

export interface PersistedLead {
  leadId: string;
  customerId: string;
  propertyId: string | null;
}

/**
 * Best-effort durable lead capture. The notification pipeline remains
 * authoritative for delivery; a D1 failure never discards the request.
 */
export async function persistLeadSubmission(
  db: D1Database | null,
  fields: Record<string, string>,
): Promise<PersistedLead | null> {
  if (!db) return null;
  const requestType = (fields.request_type ?? 'residential_estimate').trim();
  const email = (fields.email ?? '').trim().toLowerCase();
  const phone = normalizedPhone(fields.phone ?? '');
  const name = (fields.name ?? '').trim();
  const organization = (fields.organization ?? '').trim();
  if (!email && !phone) return null;

  const idempotencyKey =
    (fields.quote_reference ?? '').trim() ||
    `lead_${await hashToken(`${email}|${phone}|${requestType}|${fields.preferred_date ?? ''}|${fields.quote_reference ?? ''}`)}`;

  const existing = await db
    .prepare('SELECT id, customer_id, property_id FROM leads WHERE idempotency_key = ? LIMIT 1')
    .bind(idempotencyKey)
    .first<{ id: string; customer_id: string | null; property_id: string | null }>();
  if (existing?.id) {
    return {
      leadId: existing.id,
      customerId: existing.customer_id ?? '',
      propertyId: existing.property_id ?? null,
    };
  }

  let customerId = '';
  if (email) {
    const contact = await db
      .prepare("SELECT customer_id FROM customer_contacts WHERE kind = 'email' AND normalized_value = ? LIMIT 1")
      .bind(email)
      .first<{ customer_id: string }>();
    customerId = contact?.customer_id ?? '';
  }
  if (!customerId && phone) {
    const contact = await db
      .prepare("SELECT customer_id FROM customer_contacts WHERE kind = 'phone' AND normalized_value = ? LIMIT 1")
      .bind(phone)
      .first<{ customer_id: string }>();
    customerId = contact?.customer_id ?? '';
  }

  const nameParts = splitName(name);
  if (!customerId) {
    customerId = `cust_${crypto.randomUUID()}`;
    await db
      .prepare(
        `INSERT INTO customers
         (id, primary_branch_id, first_name, last_name, company_name, status, source)
         VALUES (?, 'branch_pensacola', ?, ?, ?, 'active', ?)`,
      )
      .bind(customerId, nameParts.first, nameParts.last, organization, fields.first_utm_source ?? 'website')
      .run();
  }

  if (email) {
    await db
      .prepare(
        `INSERT INTO customer_contacts (id, customer_id, kind, value, normalized_value, is_primary)
         VALUES (?, ?, 'email', ?, ?, 1)
         ON CONFLICT(kind, normalized_value) DO NOTHING`,
      )
      .bind(`ct_${crypto.randomUUID()}`, customerId, email, email)
      .run();
  }
  if (phone) {
    await db
      .prepare(
        `INSERT INTO customer_contacts (id, customer_id, kind, value, normalized_value, is_primary)
         VALUES (?, ?, 'phone', ?, ?, 1)
         ON CONFLICT(kind, normalized_value) DO NOTHING`,
      )
      .bind(`ct_${crypto.randomUUID()}`, customerId, fields.phone ?? '', phone)
      .run();
  }

  let propertyId: string | null = null;
  const line1 = (fields.service_address ?? '').trim();
  if (line1) {
    const existingProperty = await db
      .prepare(
        `SELECT id FROM properties
         WHERE customer_id = ? AND line1 = ? AND postal_code = ?
         LIMIT 1`,
      )
      .bind(customerId, line1, fields.zip ?? '')
      .first<{ id: string }>();
    propertyId = existingProperty?.id ?? `prop_${crypto.randomUUID()}`;
    if (!existingProperty) {
      const lat = Number(fields.pin_latitude);
      const lng = Number(fields.pin_longitude);
      await db
        .prepare(
          `INSERT INTO properties
           (id, customer_id, branch_id, label, line1, line2, city, state, postal_code,
            latitude, longitude, precision, is_primary, status)
           VALUES (?, ?, 'branch_pensacola', 'Service property', ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active')`,
        )
        .bind(
          propertyId,
          customerId,
          line1,
          fields.address_unit ?? '',
          fields.address_city ?? '',
          fields.address_state ?? 'FL',
          fields.zip ?? '',
          Number.isFinite(lat) ? lat : null,
          Number.isFinite(lng) ? lng : null,
          fields.pin_precision ?? 'exact',
        )
        .run();
    }
  }

  const holdId = (fields.booking_hold_id ?? '').trim();
  const requestedDate = (fields.preferred_date ?? '').trim();
  if (requestType === 'reservation_request' && holdId && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    const rawTime = (fields.preferred_time ?? '').trim();
    const timeMatch = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(rawTime);
    let hour = 9;
    let minute = 0;
    if (timeMatch) {
      hour = Number(timeMatch[1]);
      minute = Number(timeMatch[2]);
      const meridiem = (timeMatch[3] ?? '').toUpperCase();
      if (meridiem === 'PM' && hour < 12) hour += 12;
      if (meridiem === 'AM' && hour === 12) hour = 0;
    }
    const startAt = `${requestedDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
    const endAt = new Date(Date.parse(`${startAt}Z`) + 120 * 60_000).toISOString().slice(0, 19);
    const requestId = (fields.booking_request_id ?? '').trim() || `request_${holdId}`;
    await db
      .prepare(
        `INSERT OR IGNORE INTO booking_requests
         (id, hold_id, branch_id, customer_id, property_id, status, quote_reference, requested_date,
          start_at, end_at, duration_minutes, payload_json)
         VALUES (?, ?, 'branch_pensacola', ?, ?, 'pending', ?, ?, ?, ?, 120, ?)`,
      )
      .bind(
        requestId,
        holdId,
        customerId,
        propertyId,
        fields.quote_reference ?? '',
        requestedDate,
        startAt,
        endAt,
        JSON.stringify(fields),
      )
      .run();
    await db
      .prepare(
        `INSERT OR IGNORE INTO booking_holds
         (id, request_id, status, quote_reference, start_at, end_at, expires_at, payload_json)
         VALUES (?, ?, 'held', ?, ?, ?, ?, ?)`,
      )
      .bind(
        holdId,
        requestId,
        fields.quote_reference ?? '',
        startAt,
        endAt,
        fields.booking_hold_expires_at ?? new Date(Date.parse(startAt) + 30 * 60_000).toISOString(),
        JSON.stringify(fields),
      )
      .run();
  }

  const leadId = `lead_${crypto.randomUUID()}`;
  const outstanding =
    fields.photos_outstanding === 'yes'
      ? 'Required photos outstanding'
      : fields.quote_reference
        ? ''
        : 'Quote review';
  await db
    .prepare(
      `INSERT INTO leads
       (id, branch_id, customer_id, property_id, request_type, status, source, quote_reference,
        payload_json, delivery_status, outstanding_requirement, idempotency_key)
       VALUES (?, 'branch_pensacola', ?, ?, ?, 'new', ?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(
      leadId,
      customerId,
      propertyId,
      requestType,
      fields.first_utm_source ?? 'website',
      fields.quote_reference ?? '',
      JSON.stringify(fields),
      outstanding,
      idempotencyKey,
    )
    .run();

  if (fields.quote_reference) {
    const totalCents = Math.round(Number(fields.quoted_price ?? fields.first_visit_total ?? 0) * 100);
    if (Number.isFinite(totalCents) && totalCents > 0) {
      await db
        .prepare(
          `INSERT OR IGNORE INTO estimates
           (id, customer_id, property_id, branch_id, service_code, status, source,
            quote_reference, input_snapshot_json, total_cents, created_at, updated_at)
           VALUES (?, ?, ?, 'branch_pensacola', ?, 'quoted', 'website', ?, ?, ?, ?, ?)`,
        )
        .bind(
          `est_${await hashToken(`${fields.quote_reference}|${customerId}`)}`.slice(0, 80),
          customerId,
          propertyId,
          serviceCode(requestType, fields),
          fields.quote_reference,
          JSON.stringify(fields),
          totalCents,
          new Date().toISOString(),
          new Date().toISOString(),
        )
        .run();
    }
  }

  return { leadId, customerId, propertyId };
}

export async function updateLeadDelivery(
  db: D1Database | null,
  leadId: string | null,
  deliveryStatus: 'pending' | 'sent' | 'failed',
  errorCode = '',
): Promise<void> {
  if (!db || !leadId) return;
  await db
    .prepare(
      `UPDATE leads SET delivery_status = ?,
         delivery_attempts = delivery_attempts + CASE WHEN ? IN ('sent','failed') THEN 1 ELSE 0 END,
         last_delivery_error = CASE WHEN ? = 'failed' THEN ? ELSE '' END,
         updated_at = ?
       WHERE id = ?`,
    )
    .bind(deliveryStatus, deliveryStatus, deliveryStatus, errorCode, new Date().toISOString(), leadId)
    .run()
    .catch(() => undefined);
}
