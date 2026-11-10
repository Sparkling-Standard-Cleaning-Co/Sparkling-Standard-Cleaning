// Durable Stripe Customer resolution for public cleaning checkout.
//
// The internal D1 customer is the identity authority. Email alone is never
// sufficient to merge two customer records. A Stripe Customer is reused only
// when it is already linked to the same D1 customer (directly or through the
// financial projection), and creation uses a deterministic idempotency key so
// simultaneous checkout attempts cannot create duplicates.

import type { D1Database } from '../admin/d1.ts';

export interface StripeCustomerEnv {
  STRIPE_SECRET_KEY?: string;
}

export interface CheckoutCustomer {
  customerId: string | null;
  stripeCustomerId: string | null;
  source: 'linked' | 'legacy_projection' | 'created' | 'guest';
}

interface StripeCustomer {
  id?: string;
  deleted?: boolean;
  metadata?: Record<string, string>;
}

function stripeKey(env: StripeCustomerEnv): string {
  return env.STRIPE_SECRET_KEY?.trim() ?? '';
}

async function stripeGet(
  env: StripeCustomerEnv,
  customerId: string,
): Promise<StripeCustomer | null> {
  const response = await fetch(
    `https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`,
    {
      headers: { Authorization: `Bearer ${stripeKey(env)}` },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('stripe_customer_lookup_failed');
  return (await response.json().catch(() => ({}))) as StripeCustomer;
}

async function stripeCreate(
  env: StripeCustomerEnv,
  input: { customerId: string; email: string; name: string },
  idempotencyKey: string,
): Promise<string> {
  const form = new URLSearchParams();
  form.set('email', input.email);
  if (input.name) form.set('name', input.name);
  form.set('metadata[customer_id]', input.customerId);
  form.set('metadata[sparkling_standard]', 'durable_cleaning_customer');
  const response = await fetch('https://api.stripe.com/v1/customers', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey(env)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': idempotencyKey,
    },
    body: form,
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await response.json().catch(() => ({}))) as StripeCustomer & {
    error?: { code?: string };
  };
  if (!response.ok || !data.id) {
    console.error('[stripe-customers] create_failed', {
      status: response.status,
      code: data.error?.code ?? 'unknown',
    });
    throw new Error('stripe_customer_create_failed');
  }
  return data.id;
}

async function linkedCustomerId(
  db: D1Database,
  reference: string,
  holdId: string,
): Promise<string | null> {
  if (!reference && !holdId) return null;
  const booking =
    holdId || reference
      ? await db
          .prepare(
            `SELECT customer_id FROM booking_requests
             WHERE (hold_id = ? AND ? <> '') OR (quote_reference = ? AND ? <> '')
             ORDER BY created_at DESC LIMIT 1`,
          )
          .bind(holdId, holdId, reference, reference)
          .first<{ customer_id: string | null }>()
      : null;
  if (booking?.customer_id) return booking.customer_id;
  const lead = reference
    ? await db
        .prepare(
          'SELECT customer_id FROM leads WHERE quote_reference = ? ORDER BY created_at DESC LIMIT 1',
        )
        .bind(reference)
        .first<{ customer_id: string | null }>()
    : null;
  if (lead?.customer_id) return lead.customer_id;
  const estimate = reference
    ? await db
        .prepare(
          'SELECT customer_id FROM estimates WHERE quote_reference = ? ORDER BY created_at DESC LIMIT 1',
        )
        .bind(reference)
        .first<{ customer_id: string | null }>()
    : null;
  return estimate?.customer_id ?? null;
}

async function legacyStripeCustomer(
  db: D1Database,
  customerId: string,
): Promise<string | null> {
  const party = await db
    .prepare(
      `SELECT stripe_customer_id FROM financial_parties
       WHERE customer_id = ? AND stripe_customer_id IS NOT NULL AND stripe_customer_id <> ''
       ORDER BY created_at LIMIT 1`,
    )
    .bind(customerId)
    .first<{ stripe_customer_id: string }>();
  if (party?.stripe_customer_id) return party.stripe_customer_id;
  const payment = await db
    .prepare(
      `SELECT stripe_customer_id FROM payments
       WHERE customer_id = ? AND stripe_customer_id IS NOT NULL AND stripe_customer_id <> ''
       ORDER BY created_at LIMIT 1`,
    )
    .bind(customerId)
    .first<{ stripe_customer_id: string }>();
  return payment?.stripe_customer_id ?? null;
}

/**
 * Resolve the D1 customer from the authoritative booking/lead/estimate link,
 * then reuse or create exactly one Stripe Customer for that D1 identity.
 * Returns a guest result when no D1 customer can be identified.
 */
export async function resolveCheckoutStripeCustomer(
  db: D1Database | null,
  env: StripeCustomerEnv,
  input: {
    reference: string;
    holdId?: string;
    email: string;
    name?: string;
  },
): Promise<CheckoutCustomer> {
  if (!db || !stripeKey(env)) {
    return { customerId: null, stripeCustomerId: null, source: 'guest' };
  }
  const customerId = await linkedCustomerId(db, input.reference, input.holdId ?? '');
  if (!customerId) {
    return { customerId: null, stripeCustomerId: null, source: 'guest' };
  }
  const stored = await db
    .prepare(
      'SELECT stripe_customer_id, first_name, last_name, company_name FROM customers WHERE id = ? LIMIT 1',
    )
    .bind(customerId)
    .first<{
      stripe_customer_id: string | null;
      first_name: string;
      last_name: string;
      company_name: string;
    }>();
  if (!stored) {
    return { customerId: null, stripeCustomerId: null, source: 'guest' };
  }
  const email = input.email.trim().toLowerCase();
  const name =
    input.name?.trim() ||
    [stored.first_name, stored.last_name].filter(Boolean).join(' ') ||
    stored.company_name ||
    email;

  if (stored.stripe_customer_id) {
    const fetched = await stripeGet(env, stored.stripe_customer_id).catch(() => null);
    if (fetched && !fetched.deleted && fetched.id) {
      return {
        customerId,
        stripeCustomerId: fetched.id,
        source: 'linked',
      };
    }
    // The linked customer was deleted at Stripe. Clear only this customer's
    // stale link, then create a replacement below.
    await db
      .prepare(
        'UPDATE customers SET stripe_customer_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND stripe_customer_id = ?',
      )
      .bind(customerId, stored.stripe_customer_id)
      .run()
      .catch(() => undefined);
  } else {
    const legacy = await legacyStripeCustomer(db, customerId);
    if (legacy) {
      const fetched = await stripeGet(env, legacy).catch(() => null);
      if (fetched && !fetched.deleted && fetched.id) {
        await db
          .prepare(
            'UPDATE customers SET stripe_customer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (stripe_customer_id IS NULL OR stripe_customer_id = \'\')',
          )
          .bind(fetched.id, customerId)
          .run();
        return { customerId, stripeCustomerId: fetched.id, source: 'legacy_projection' };
      }
    }
  }

  // Same deterministic key for every concurrent attempt. Stripe returns the
  // same Customer for identical parameters; a re-create after deletion uses a
  // distinct key so a deleted record cannot be resurrected.
  const idempotencyKey = stored.stripe_customer_id
    ? `ss-customer-${customerId}-recreate`
    : `ss-customer-${customerId}`;
  const created = await stripeCreate(env, { customerId, email, name }, idempotencyKey);
  await db
    .prepare(
      `UPDATE customers SET stripe_customer_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND (stripe_customer_id IS NULL OR stripe_customer_id = '')`,
    )
    .bind(created, customerId)
    .run()
    .catch(() => undefined);
  const final = await db
    .prepare('SELECT stripe_customer_id FROM customers WHERE id = ? LIMIT 1')
    .bind(customerId)
    .first<{ stripe_customer_id: string | null }>();
  return {
    customerId,
    stripeCustomerId: final?.stripe_customer_id || created,
    source: 'created',
  };
}
