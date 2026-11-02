# Financial workflow boundary

The website takes **requests** and can confirm a complete paid booking
automatically when payment, address, photos, time and resources verify. It does
not issue invoices; the owner does. This document fixes the vocabulary so every
message, document and dashboard uses the same five stages without blurring them.

| Stage | What it is | Where it lives | What it must never be called |
| --- | --- | --- | --- |
| **Request** | A customer asked for service; nothing is scheduled or owed | Website forms → owner inbox (`docs/operations/LEAD-NOTIFICATION-FORMAT.md`) | "booking", "confirmed", "order" |
| **Estimate** | Provisional pricing from the estimator, or a reviewed quote from the owner; subject to personal confirmation | Estimator + server verification; owner confirms the final scope/price | "final price", "invoice", "amount due" |
| **Booking** | A complete paid booking may confirm automatically after all server checks; unpaid requests need owner confirmation | Calendar, holds and reservation ledger (`docs/operations/RESERVATION-TRACKING.md`) | "confirmed" before verification |
| **Invoice** | A request for payment after agreed work, issued by the owner as a document | `scripts/commercial-invoice.mjs` → `docs/operations/COMMERCIAL-INVOICING.md` | "estimate", "receipt" |
| **Receipt** | Proof that payment was actually collected (from the payment processor) | Stripe receipts / gift-certificate records | "request confirmation", "estimate" |

## Rules enforced in the system

1. **A submitted form is a request until it is paid and verified.** The customer
   confirmation email is not a booking or a receipt; a complete paid booking
   confirms automatically only after all server checks.
2. **A price from the browser is a proposal.** The server recalculates priced
   reservations and labels the verdict (verified / preliminary / mismatch /
   unverifiable); a mismatch is never presented as accepted
   (`src/lib/estimate/verify.ts`, `src/lib/forms/verification-copy.ts`).
3. **Reservation-only requests take no payment.** Pay Now is a separate Stripe
   Checkout step after the request is delivered. It is available only for an
   exact, server-verified quote; custom/range/custom-review quotes stay
   reservation-only. Gift-certificate sales are live.
4. **Invoices are issued by the owner, never by the website.** The invoice tool
   marks unverified fields (due date, payment terms, legal entity, tax) as
   `[owner to complete]` and refuses to invent bank details, tax IDs or terms.
5. **Receipts come from the payment processor.** The success page asks the server to verify the
   Checkout Session; the owner paid notice comes only from the signature-verified webhook. The site
   never claims payment from a success URL alone.
6. **Subjects and copy follow the stages.** Email subjects use "request
   received"; "confirmed" appears only in the owner's own confirmation message
   after the customer agrees (`docs/operations/COMMUNICATION-TEMPLATES.md`).

## Refund rules

- Refunds are recorded as immutable attempts with a caller-supplied idempotency
  key. Retrying the same request never creates a second refund or reduces the
  invoice twice.
- The cumulative succeeded and pending refunds may never exceed the original
  payment amount. A full refund makes the payment `refunded`; a partial refund
  makes it `partially_refunded`.
- Invoice paid and balance values are recomputed from payment and refund rows,
  not by decrementing stored totals.
- Stripe refunds reserve the amount as `pending` before the provider call. Only
  a returned `succeeded` refund adjusts the invoice; `pending` waits for
  reconciliation, and a failed/canceled refund releases the reservation.
- Voiding an invoice, recording a payment or recording a refund clears its
  stored payment link so a stale or superseded amount cannot be reused.

Migration `0022_refund_idempotency.sql` adds the unique refund request key.

## Quick reference for written communication

- Before confirmation: *request*, *provisional estimate*, *proposed price*,
  *we'll confirm*.
- After confirmation: *confirmed appointment* (owner message B only).
- After work: *invoice* (request for payment) — never before.
- After payment: *receipt* — issued by the processor, referenced by the owner.
