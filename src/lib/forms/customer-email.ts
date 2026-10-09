// Server-side customer confirmation delivery through Resend.
//
// The lead relay (functions/api/lead.ts) calls this ONLY after the owner
// notification has been accepted by the form provider. The lead is already
// preserved at that point, so a customer-email failure is logged and ignored —
// it must never turn a successful lead into a failed submission.
//
// Rules:
//  - `RESEND_API_KEY` is a server-only runtime secret; it never appears in a
//    client bundle, a response, or a log line.
//  - The customer's email address is never logged; outcomes carry a status
//    enum (and the provider's HTTP status) only.
//  - The message body comes from the ONE confirmation template
//    (`customer-confirmation.ts`); there is no second template system.
//  - Sending is attempted at most once per server request (one invocation =
//    one call); duplicate submissions are prevented client-side.
//
// The business facts below are the owner-approved public values. They cannot
// be imported from `src/config/business.ts` because that module reads
// `import.meta.env` (Vite-only) and the Cloudflare runtime would throw on
// import. A unit test verifies these constants against business.ts source so
// they cannot drift.

import { buildCustomerConfirmation, type ConfirmationBusiness } from './customer-confirmation.ts';

/** Owner-approved public facts (drift-guarded by tests/customer-email.test.ts). */
export const CUSTOMER_EMAIL_BUSINESS: ConfirmationBusiness = {
  name: 'Sparkling Standard Cleaning Co.',
  founder: 'Hayli',
  phone: '(850) 426-8479',
  email: 'owner@sparkling-standard.com',
  website: 'sparkling-standard.com',
};

/** Default sender once the Sparkling Standard domain is verified in Resend. */
export const DEFAULT_CUSTOMER_EMAIL_FROM =
  'Sparkling Standard Cleaning Co. <notifications@sparkling-standard.com>';

/** Customer replies reach the owner directly. */
export const DEFAULT_CUSTOMER_EMAIL_REPLY_TO = 'owner@sparkling-standard.com';

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface CustomerEmailEnv {
  RESEND_API_KEY?: string;
  /** Optional override, e.g. another verified sender. */
  RESEND_FROM_EMAIL?: string;
  /** Optional override for the reply-to address. */
  RESEND_REPLY_TO?: string;
}

export type CustomerEmailStatus =
  | 'sent'
  | 'skipped_no_email'
  | 'skipped_invalid_email'
  | 'skipped_not_configured'
  | 'failed';

export interface CustomerEmailOutcome {
  status: CustomerEmailStatus;
  /** Provider HTTP status on failure — never contains PII or the key. */
  providerStatus?: number;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sends the branded confirmation to the customer's submitted address.
 * Never throws; returns a status the caller can log safely.
 */
export async function sendCustomerConfirmation(
  fields: Record<string, string>,
  env: CustomerEmailEnv,
): Promise<CustomerEmailOutcome> {
  const to = (fields.email ?? '').trim();
  if (!to) return { status: 'skipped_no_email' };
  if (!EMAIL_PATTERN.test(to)) return { status: 'skipped_invalid_email' };

  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) return { status: 'skipped_not_configured' };

  const confirmation = buildCustomerConfirmation(fields, CUSTOMER_EMAIL_BUSINESS);
  const from = env.RESEND_FROM_EMAIL?.trim() || DEFAULT_CUSTOMER_EMAIL_FROM;
  const replyTo = env.RESEND_REPLY_TO?.trim() || DEFAULT_CUSTOMER_EMAIL_REPLY_TO;

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: confirmation.subject,
        html: confirmation.html,
        text: confirmation.text,
        reply_to: replyTo,
      }),
    });
    if (response.ok) return { status: 'sent' };
    return { status: 'failed', providerStatus: response.status };
  } catch {
    return { status: 'failed' };
  }
}

/** One safe log line for a non-sent outcome — no PII, no secrets. */
export function describeCustomerEmailOutcome(outcome: CustomerEmailOutcome): string {
  if (outcome.status === 'failed' && outcome.providerStatus) {
    return `customer-confirmation: failed (provider ${outcome.providerStatus})`;
  }
  return `customer-confirmation: ${outcome.status}`;
}
