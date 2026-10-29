// Server-side itemized receipt delivery through Resend.
//
// The receipt is built only from the server-owned checkout record and the
// verified payment event. A receipt failure never invalidates the payment or
// suppresses the owner notification; the owner sees the delivery status and can
// resend from Stripe/Resend if needed.
import { buildReceipt, type ReceiptData } from '../payments/receipt.ts';

export interface ReceiptEmailEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  RESEND_REPLY_TO?: string;
}

export type ReceiptEmailStatus =
  | 'sent'
  | 'skipped_no_email'
  | 'skipped_invalid_email'
  | 'skipped_not_configured'
  | 'failed';

export interface ReceiptEmailOutcome {
  status: ReceiptEmailStatus;
  providerStatus?: number;
}

const DEFAULT_FROM = 'Sparkling Standard <notifications@sparkling-standard.com>';
const DEFAULT_REPLY_TO = 'owner@sparkling-standard.com';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function sendCustomerReceipt(
  data: ReceiptData,
  env: ReceiptEmailEnv,
  idempotencyKey: string,
): Promise<ReceiptEmailOutcome> {
  const to = (data.customerEmail ?? '').trim();
  if (!to) return { status: 'skipped_no_email' };
  if (!EMAIL_PATTERN.test(to)) return { status: 'skipped_invalid_email' };
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) return { status: 'skipped_not_configured' };

  const receipt = buildReceipt(data);
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM,
        to: [to],
        subject: receipt.subject,
        html: receipt.html,
        text: receipt.text,
        reply_to: env.RESEND_REPLY_TO?.trim() || DEFAULT_REPLY_TO,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return { status: 'sent' };
    return { status: 'failed', providerStatus: response.status };
  } catch {
    return { status: 'failed' };
  }
}

/** Safe log label — never includes the customer's email or the API key. */
export function describeReceiptOutcome(outcome: ReceiptEmailOutcome): string {
  if (outcome.status === 'failed' && outcome.providerStatus) {
    return `customer-receipt: failed (provider ${outcome.providerStatus})`;
  }
  return `customer-receipt: ${outcome.status}`;
}
