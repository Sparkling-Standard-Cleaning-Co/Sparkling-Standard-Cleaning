# Invoice Payment Terms — 2026-11-19

## Implemented policy

- Residential cleaning invoices default to the issue date: payment is due immediately upon
  completion.
- Commercial and church cleaning invoices default to **Net 15** calendar days from issue.
- An explicit owner-entered due date still overrides the default.
- The admin invoice form now asks for the service type and leaves due date optional.
- Manual booking invoices derive the service type from the linked estimate.
- The invoice PDF/email displays the stored due date.

## Scope and limitations

- Existing invoices are unchanged. The two existing $5 test invoices retain their stored due dates
  until the owner voids or adjusts them.
- A direct admin invoice now defaults according to the selected service type; no live commercial
  invoice was created.
- Completion-triggered invoicing is not automatic for residential work; the owner still creates/
  finalizes the invoice after service.
- The existing status machine remains draft, open, partially paid, paid, overdue, void; refunds are
  represented by payment/refund records.
- Stripe payment-link availability remains separately gated by the admin billing flag; no live link
  was created.

## Verification

- Unit test: residential issue date 2026-12-01 → due 2026-12-01; commercial issue date 2026-12-01 →
  due 2026-12-16.
- Full unit suite: 874 tests (873 pass, 1 pre-existing skip).
- Astro check and production build pass.
- No invoice, payment or customer record was modified by this change.
