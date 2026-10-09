# Financial workflow boundary

The website takes **requests**. It does not book, invoice or charge. This
document fixes the vocabulary so every message, document and dashboard uses the
same five stages — and never blurs them.

| Stage | What it is | Where it lives | What it must never be called |
| --- | --- | --- | --- |
| **Request** | A customer asked for service; nothing is scheduled or owed | Website forms → owner inbox (`docs/operations/LEAD-NOTIFICATION-FORMAT.md`) | "booking", "confirmed", "order" |
| **Estimate** | Provisional pricing from the estimator, or a reviewed quote from the owner; subject to personal confirmation | Estimator + server verification; owner confirms the final scope/price | "final price", "invoice", "amount due" |
| **Booking** | A date is on the calendar **only after the owner confirms it with the customer** | Owner records / reservation ledger (`docs/operations/RESERVATION-TRACKING.md`) | "automatic booking", "instant confirmation" |
| **Invoice** | A request for payment after agreed work, issued by the owner as a document | `scripts/commercial-invoice.mjs` → `docs/operations/COMMERCIAL-INVOICING.md` | "estimate", "receipt" |
| **Receipt** | Proof that payment was actually collected (from the payment processor) | Stripe receipts / gift-certificate records | "request confirmation", "estimate" |

## Rules enforced in the system

1. **A submitted form is a request.** The customer confirmation email and the
   thank-you page say "We received your request" and "This is not a confirmed
   appointment" (`src/lib/forms/customer-confirmation.ts`).
2. **A price from the browser is a proposal.** The server recalculates priced
   reservations and labels the verdict (verified / preliminary / mismatch /
   unverifiable); a mismatch is never presented as accepted
   (`src/lib/estimate/verify.ts`, `src/lib/forms/verification-copy.ts`).
3. **No form takes payment.** Gift-certificate sales are disabled; requests say
   "no payment has been taken" and "we'll send a secure payment link".
4. **Invoices are issued by the owner, never by the website.** The invoice tool
   marks unverified fields (due date, payment terms, legal entity, tax) as
   `[owner to complete]` and refuses to invent bank details, tax IDs or terms.
5. **Receipts come from the payment processor.** No website message ever claims
   a payment was received.
6. **Subjects and copy follow the stages.** Email subjects use "request
   received"; "confirmed" appears only in the owner's own confirmation message
   after the customer agrees (`docs/operations/COMMUNICATION-TEMPLATES.md`).

## Quick reference for written communication

- Before confirmation: *request*, *provisional estimate*, *proposed price*,
  *we'll confirm*.
- After confirmation: *confirmed appointment* (owner message B only).
- After work: *invoice* (request for payment) — never before.
- After payment: *receipt* — issued by the processor, referenced by the owner.
