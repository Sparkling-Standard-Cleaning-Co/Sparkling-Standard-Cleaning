// Shared read-only classification for checkout-session inspection.
//
// A failed setup (no Stripe session) is a platform/quote problem. A failed
// session that reached Stripe is a provider/application problem. An open
// session older than 35 minutes is ordinary abandonment unless a webhook says
// otherwise. Nothing here mutates a payment or a booking.

export interface CheckoutSessionInspection {
  category: string;
  explanation: string;
  actionable: boolean;
}

export function classifyCheckoutSession(
  row: { status?: unknown; expires_at?: unknown; stripe_session_id?: unknown; created_at?: unknown },
  now = Date.now(),
): CheckoutSessionInspection {
  const status = String(row.status ?? '');
  const expires = Date.parse(String(row.expires_at ?? ''));
  const created = Date.parse(String(row.created_at ?? ''));
  const hasStripeSession = Boolean(String(row.stripe_session_id ?? '').trim());
  if (status === 'failed' && !hasStripeSession) {
    return {
      category: 'Setup failure',
      explanation:
        'Stripe Checkout was never created. The quote, hold, payment configuration or provider request failed before a payment page existed.',
      actionable: true,
    };
  }
  if (status === 'failed') {
    return {
      category: 'Provider/session failure',
      explanation:
        'A Stripe Checkout session was created but the application recorded a failure. Review the request detail and provider status before retrying.',
      actionable: true,
    };
  }
  if (status === 'open' && Number.isFinite(expires) && expires <= now) {
    return {
      category: 'Abandoned checkout',
      explanation:
        'The customer opened Stripe Checkout but did not complete payment before the session expired. This is ordinary abandonment, not a platform failure.',
      actionable: false,
    };
  }
  if (status === 'open' && Number.isFinite(created) && created <= now - 35 * 60_000) {
    return {
      category: 'Stale open checkout',
      explanation:
        'The session is still marked open after its expected window. Recheck the provider status before treating it as a failure.',
      actionable: false,
    };
  }
  if (status === 'completed') {
    return {
      category: 'Completed',
      explanation: 'Stripe reports this checkout as completed. Payment reconciliation remains authoritative.',
      actionable: false,
    };
  }
  return {
    category: status ? status[0]!.toUpperCase() + status.slice(1) : 'Unknown',
    explanation: 'No exception is recorded for this checkout session.',
    actionable: false,
  };
}
