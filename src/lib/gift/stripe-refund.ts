// Stripe refund execution for an unused gift certificate. The ledger is updated
// only after Stripe confirms the refund; the idempotency key is the certificate
// code so a retry cannot issue a second refund.

export type GiftRefundResult =
  | { ok: true; refundId: string }
  | { ok: false; error: 'invalid_session' | 'payment_not_found' | 'provider_failed' };

interface RefundInput {
  secretKey: string;
  sessionId: string;
  code: string;
  fetcher?: typeof fetch;
  baseUrl?: string;
}

interface StripeSession {
  payment_intent?: string | null;
  error?: { message?: string };
}

interface StripeRefund {
  id?: string;
  error?: { message?: string };
}

export async function refundStripeGiftPayment(input: RefundInput): Promise<GiftRefundResult> {
  const { secretKey, sessionId, code } = input;
  const fetcher = input.fetcher ?? fetch;
  const baseUrl = (input.baseUrl ?? 'https://api.stripe.com').replace(/\/+$/, '');
  if (!/^cs_(?:test|live)_[A-Za-z0-9_]+$/.test(sessionId)) {
    return { ok: false, error: 'invalid_session' };
  }
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    Accept: 'application/json',
  };

  try {
    const sessionResponse = await fetcher(`${baseUrl}/v1/checkout/sessions/${sessionId}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    const session = (await sessionResponse.json().catch(() => ({}))) as StripeSession;
    if (!sessionResponse.ok) return { ok: false, error: 'provider_failed' };
    const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent.trim() : '';
    if (!paymentIntent) return { ok: false, error: 'payment_not_found' };

    const body = new URLSearchParams();
    body.set('payment_intent', paymentIntent);
    body.set('metadata[gift_code]', code);
    const refundResponse = await fetcher(`${baseUrl}/v1/refunds`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `gift-refund-${code}`,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const refund = (await refundResponse.json().catch(() => ({}))) as StripeRefund;
    if (!refundResponse.ok || !refund.id) return { ok: false, error: 'provider_failed' };
    return { ok: true, refundId: refund.id };
  } catch {
    return { ok: false, error: 'provider_failed' };
  }
}
