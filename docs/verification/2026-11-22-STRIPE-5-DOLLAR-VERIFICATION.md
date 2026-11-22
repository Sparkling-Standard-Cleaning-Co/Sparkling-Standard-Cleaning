# Live $5 Stripe Transaction Verification — 2026-11-22

**Status:** verified from **production D1** and the application audit record.
The Stripe Dashboard itself was not queried from this environment because no
live Stripe secret is available locally. No new charge or test transaction was
made.

## Transaction found

| Field | Value |
|---|---|
| Payment ID | `payment_439a2b1e-a925-4e5d-a8ce-d79cfcde5323` |
| Status | `succeeded` |
| Amount | **$5.00** (`500` cents, USD) |
| Provider | Stripe |
| Received at | `2026-11-19T18:36:21.404Z` |
| Stripe PaymentIntent | `pi_3UdaBbArIaVXsguz1uTz65Yl` |
| Stripe Checkout Session | `cs_live_agDXVT2yBhT5jf9s8ciwjE1YvNkUkwXYCDntQ9XqfB0HmlxWvvfqh6iLSS` |
| Invoice ID | `invoice_72d384f1-a97d-433a-ae9f-355786eec5b8` |
| Invoice number | `INV-20261119-1106A9` |
| Invoice status | `paid` |
| Invoice total | `500` cents |
| Amount paid | `500` cents |
| Balance | `0` |
| Booking request | none (`NULL`) |
| Appointment | none (`NULL`) |
| Customer ID | `cust_1f11a2e8-c013-40e1-8f92-7450cf2e96b0` |

The payment metadata records:

```json
{"checkout_session_id":"cs_live_agDXVT2yBhT5jf9s8ciwjE1YvNkUkwXYCDntQ9XqfB0HmlxWvvfqh6iLSS","source":"stripe_webhook"}
```

The `cs_live_` prefix confirms a live-mode Checkout Session.

## Webhook and reconciliation evidence

Production D1 contains:

- exactly **one** successful payment for this invoice;
- exactly **one** payment for this Checkout Session;
- **zero** payment reconciliation issues;
- invoice status `paid`, amount paid `500`, balance `0`.

Application audit:

| When | Action | Actor | Result |
|---|---|---|---|
| `2026-11-19 18:33:34` | `invoice.payment_link_created` | owner admin | success |
| `2026-11-19 18:33:34` | `invoice.emailed` | owner admin | sent |
| `2026-11-19 18:36:21` | `invoice.stripe_paid` | system/webhook (no user actor) | success |

The `invoice.stripe_paid` audit record names the payment ID and amount `500`.
This, together with the payment metadata source `stripe_webhook` and the invoice
state transition, proves the paid Checkout Session was processed by the webhook
and reconciled into the invoice.

The raw Stripe event ID is not stored for invoice payments; invoice payment
idempotency is the Checkout Session ID (`stripe-checkout:<session>`), and the
single payment row proves replay did not create a duplicate.

## What this transaction proves

- Live Stripe Checkout can complete a real card payment.
- The paid Checkout Session webhook is accepted and creates a D1 payment.
- The invoice is marked paid, amount paid and balance reconcile exactly.
- Invoice payment-link creation and invoice email delivery occurred before
  payment.
- Duplicate protection for this invoice/session held: one payment, zero
  reconciliation issues.

## What this transaction does **not** prove

- It is an **invoice payment**, not an estimate/booking payment.
- It has **no booking request and no appointment**, so it does not prove the
  estimate → temporary hold → booking confirmation path.
- It has **no signing request and no executed agreement**, so it does not prove
  signing → payment → booking.
- It does not prove executed PDF generation or retrieval for a paid packet.
- It does not prove customer receipt delivery: production has **0**
  `payment_receipts` rows for this invoice. The invoice email was sent, but a
  post-payment receipt is not evidenced for this transaction.
- It does not prove refunds, disputes, partial payments, failed-payment
  recovery, or automatic booking confirmation.

## New signing → payment → booking logic

Because no live/test charge may be made, the new path is verified by automated
integration tests:

- `tests/document-agreement.test.ts` — pre-payment document gate, variable
  resolution, signature snapshot, executed PDF, checkout resume intent.
- `tests/estimate-checkout.test.ts` — verified quote, hold, checkout
  idempotency, session reuse and status handling.
- `tests/checkout-registry.test.ts` — durable checkout slot lifecycle.
- `tests/payment-webhook.test.ts` — paid event handling and duplicate
  protection.
- `tests/browser/initiative-6.9-paynow.test.mjs` and the full browser suite —
  Pay Now availability and final action behavior.

Targeted payment-path run: **48/48 pass**. Full unit suite: **1,013 tests,
1,012 pass, 1 pre-existing skip, 0 fail**. Full browser suite: **248/248 pass**.

The staging import also completed a real signing request, all required
signatures, and an executed combined PDF with SHA-256
`f7041cc773bd8b55854deab3408d17a95b26bc1f872a1b8065ab0e3fe497b0b4`.

## Release conclusion

The existing $5 transaction is sufficient evidence that **live invoice payment
and webhook reconciliation work**. It is not sufficient evidence that the newly
integrated **signing → payment → booking** workflow has completed a real payment.
No further charge is required or authorized; the remaining path is covered by
automated integration/browser tests and a staging signing execution.

Test mode is therefore **not a mandatory release gate**. A real end-to-end
signing/payment/booking charge remains an optional owner-authorized production
acceptance step.
