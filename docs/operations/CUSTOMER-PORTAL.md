# Customer Portal

Passwordless customer access at `/portal/`.

## Security model

- **No passwords.** A customer enters the email on file; the response is always
  generic so account existence is never disclosed.
- A random 32-byte sign-in token is emailed. Only its SHA-256 hash is stored.
- Links expire after **15 minutes** and are single use.
- Successful verification creates a session cookie (`__Host-ss_portal`)
  containing a random token; only the hash is stored. Sessions last 7 days,
  are HttpOnly/Secure/SameSite=Lax and can be revoked.
- State-changing requests require the session CSRF token in `X-Portal-CSRF`.
- Every query is scoped by the session's `customer_id`. Changing an appointment,
  invoice or document id cannot cross customers.
- IP and user-agent values are stored only as SHA-256 hashes. Message bodies and
  tokens are never logged.
- Rate limits apply to link requests, verification and portal actions.

## Customer capabilities

- Appointments and booking history.
- Recurring plan status and next visit.
- Invoices, balances and secure payment links when already issued.
- Stripe-hosted billing portal (payment methods, invoices, receipts) when
  `PORTAL_BILLING_ENABLED=true` and Stripe is configured.
- Executed agreement copies and signed PDFs that belong to that customer.
- Profile, contacts and service properties.
- Customer-service requests routed to the configured customer-service inboxes.

Stripe remains the official source of card receipts. The portal does not send a
second receipt and never stores card numbers.

## Files

- `migrations/0045_customer_portal.sql`
- `src/lib/portal/service.ts`
- `functions/api/portal/auth.ts`
- `functions/api/portal/data.ts`
- `functions/api/portal/document.ts`
- `src/pages/portal/index.astro`
- `src/scripts/portal.ts`
- `tests/portal.test.ts`, `tests/browser/portal.test.mjs`

## Owner configuration

1. Apply migration `0045`.
2. Confirm `RESEND_API_KEY` and the verified sender.
3. Set `PORTAL_BILLING_ENABLED=true` only after Stripe Dashboard portal settings
   are reviewed. The existing Stripe customer mapping is reused; a missing
   Stripe customer is created once, with no charge.
4. Send one controlled sign-in to a real customer mailbox and verify inbox
   receipt and reply routing before announcing the portal.

## Limitations

- Link delivery proof requires mailbox confirmation; provider acceptance alone
  is not proof.
- Portal service requests are internal notifications; they do not automatically
  reschedule, refund, cancel or modify a plan.
- The portal does not expose internal notes, other customers, marketing
  preferences or card data.
