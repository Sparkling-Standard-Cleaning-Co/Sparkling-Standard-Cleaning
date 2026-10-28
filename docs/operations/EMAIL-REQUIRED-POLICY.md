# Email-required customer policy

**Owner decision (2026-10-28):** a valid customer email is mandatory for every customer
submission and transaction. Phone-only submissions are no longer accepted.

## Scope

Required for:

- residential and STR estimates/reservations;
- commercial and church requests;
- contact, special-service and Community Support inquiries;
- Reserve Without Payment and Pay Now;
- gift certificate purchases and customer-linked gift requests;
- term acceptance and future electronic-signature delivery;
- promotion/SPARKLE100 and recurring-enrollment requests;
- any other customer-submitted lead or transaction.

Email is **not** required to browse the website, read services/pricing, use preliminary estimator
steps, view the service area/policies or review gift options.

## Implementation

- Shared server/client validator: `src/lib/forms/contact-email.ts`.
- Client lead adapter rejects missing/invalid email before the static provider fallback:
  `src/lib/forms/submit.ts`.
- Server lead relay requires a valid email before terms, verification or provider delivery:
  `functions/api/lead.ts`.
- Stripe estimate checkout independently requires a valid email:
  `functions/api/estimate-checkout.ts`.
- Gift checkout requires a valid purchaser email; recipient email is required for direct recipient
  email or scheduled delivery: `functions/api/gift-checkout.ts`.
- HTML forms already use `type="email"` and `required`; the shared client adapter and server are the
  authoritative gates.
- Emails are trimmed, lowercased, length-bounded and stored as contact data. **Syntax validation is
  not ownership verification.** No email-verification claim is made.
- Email is for transactional administration (receipts, agreements, booking notices, certificates).
  Providing it does not opt the customer into marketing. No marketing subscription is created.

## Error codes and customer copy

- `email_required` — no address was supplied.
- `email_invalid` — the address is not syntactically valid.
- Gift-only: `recipient_email_required`, `recipient_email_invalid`.
- Customer-facing copy lives in `src/lib/forms/failure-copy.ts` and the gift checkout client.

## Tests

- `tests/contact-email.test.ts`
- `tests/failure-copy.test.ts`
- `tests/api.test.ts` (missing, invalid, phone-only, normalized-valid email)
- `tests/gift-checkout.test.ts` (purchaser email, recipient email, scheduled date)
- `tests/api-verification.test.ts` and `tests/facility-lead-travel.test.ts` (email-bearing leads)

No real email was sent by these tests; provider calls are stubbed.
