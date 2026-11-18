# 2026-11-18 — Invoice PDF and email delivery

## Release

- Application code: `e9ea0f0`
- Production deployment: `cc93b287-0c40-4239-b7ee-657627f5d812`
- GitHub `validate`/`browser` passed on `main` (`44420746144`) and `production-safe` (`44420742900`).
- No database migration.

## What changed

- The admin invoice view now exposes **Download invoice PDF** for every invoice the signed-in
  admin is authorised to read.
- Authorised finance users can email an open, partially paid or overdue invoice to the customer
  email on file, with the PDF attached.
- The PDF and email include the customer, service address, itemised lines, subtotal, discount,
  sales tax when recorded, payments received, exact balance due, due date, payment terms, legal
  entity and any existing secure Stripe payment link.
- Internal invoice notes are deliberately excluded from both outputs.
- The invoice email uses the existing Resend configuration (`RESEND_API_KEY`, optional
  `RESEND_FROM_EMAIL` / `RESEND_REPLY_TO`). No new service or paid dependency.
- Sending is audited. A failed audit write cannot turn an already-sent email into a retryable
  error.

## Safety

- Both endpoints require an authenticated admin session; the PDF endpoint requires `finance.read`
  and the email action requires `finance.write` plus CSRF.
- Branch scope is enforced through the existing invoice query.
- No live customer invoice was emailed and no charge/refund occurred during verification.
- The PDF is generated locally with no external conversion service.
- Draft, void and paid invoices are not emailed; a missing/invalid customer email or unconfigured
  Resend fails closed.
- Customer data is never logged; audit detail carries only the outcome status.

## Verification

- `npm run check`: 0 errors.
- `npm test`: 865 tests — 864 pass, 1 pre-existing skip.
- `npm run test:browser`: 221 tests, all pass.
- `npm run build`, `npm run validate`, `npm run smoke`: pass.
- Unit coverage: stored totals, exact balance, no-tax invoice, internal-note exclusion, genuine PDF
  structure, pagination, email content, Resend payload with PDF attachment, and fail-closed
  behaviour.
- Browser coverage: invoice detail exposes the PDF link and email action and posts the correct
  `email_invoice` request.
- Production endpoint without authentication returns `401 unauthorized`.

## Owner use

1. Open the invoice in **Invoices & Payments**.
2. Use **Download invoice PDF** to review it.
3. Use **Email invoice PDF** after confirming the customer email and balance.
4. If a Stripe payment link exists, the email includes a secure payment button.

The first confirmed recurring customer still has no invoice or payment record. Do not create or
send an invoice until the owner confirms whether the service occurred.
