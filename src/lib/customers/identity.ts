/**
 * Canonical customer/property identity helpers for checkout-style intake.
 *
 * Repeated attempts with +1/10-digit phone variants, email casing or harmless
 * street-suffix differences must reuse the existing record. Units remain
 * distinct: a different apartment is a different property.
 */
import type { D1Database } from '../admin/d1.ts';
import { normalizeEmail, phoneKey, samePropertyAddress } from '../address/address-key.ts';

export async function findCustomerByContact(
  db: D1Database,
  input: { email?: unknown; phone?: unknown },
): Promise<string> {
  const email = normalizeEmail(input.email);
  if (email) {
    const row = await db
      .prepare("SELECT customer_id FROM customer_contacts WHERE kind = 'email' AND normalized_value = ? LIMIT 1")
      .bind(email)
      .first<{ customer_id: string }>();
    if (row?.customer_id) return row.customer_id;
  }
  const key = phoneKey(input.phone);
  if (key.length === 10) {
    const row = await db
      .prepare(
        `SELECT customer_id FROM customer_contacts
         WHERE kind = 'phone' AND (normalized_value = ? OR normalized_value = ? OR normalized_value = ?)
         ORDER BY CASE WHEN normalized_value = ? THEN 0 ELSE 1 END LIMIT 1`,
      )
      .bind(key, `1${key}`, `+1${key}`, key)
      .first<{ customer_id: string }>();
    if (row?.customer_id) return row.customer_id;
  }
  return '';
}

export interface PropertyAddressInput {
  line1?: unknown;
  line2?: unknown;
  postalCode?: unknown;
}

export async function findCustomerProperty(
  db: D1Database,
  customerId: string,
  address: PropertyAddressInput,
): Promise<{ id: string } | null> {
  if (!customerId || !String(address.line1 ?? '').trim()) return null;
  const rows = await db
    .prepare(
      `SELECT id, line1, line2, postal_code FROM properties
       WHERE customer_id = ? AND status = 'active'
       ORDER BY is_primary DESC, created_at ASC LIMIT 100`,
    )
    .bind(customerId)
    .all<{ id: string; line1: string; line2: string; postal_code: string }>();
  for (const row of rows.results ?? []) {
    if (
      samePropertyAddress(
        { line1: row.line1, line2: row.line2, postalCode: row.postal_code },
        address,
      )
    ) {
      return { id: row.id };
    }
  }
  return null;
}
