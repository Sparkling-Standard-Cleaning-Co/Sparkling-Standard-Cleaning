# Invoice Payment Receipts — 2026-11-19

## Production transaction audit

Read-only production inspection confirms:

- Invoice `INV-20261119-1106A9` is `paid`.
- Amount paid: **$5.00**; outstanding balance: **$0.00**.
- Stripe Checkout Session is stored on the invoice and matches the payment.
- One succeeded `stripe` payment exists for the invoice.
- Stripe PaymentIntent and webhook reconciliation are recorded.
- Customer email is present on the customer record.
- The successful payment is recorded once.
- No customer identity, email, card data or secret is reproduced here.

## Why no receipt arrived

The invoice-payment webhook branch reconciled the payment and updated the invoice, but returned
before any receipt delivery. The existing app receipt code was used only for estimate payments.

Stripe Dashboard receipt-email behavior is outside the repository and was not verifiable without
exposing account configuration. The owner's report confirms no receipt email arrived.

## Selected receipt mechanism

One application-generated, itemized receipt through the existing verified webhook and Resend
infrastructure. Stripe-native receipts must not be enabled simultaneously for this flow.

Implementation:

- `payment_receipts` table (migration `0037`) records invoice, payment, channel, status, Resend
  message ID, error code and sent timestamp.
- Webhook delivery occurs only after `applyInvoiceCheckoutPayment` verifies success.
- The receipt is tied to the exact invoice and succeeded payment.
- Resend idempotency key is `invoice-receipt-<paymentId>`, preventing duplicate sends from repeated
  webhook events.
- A sent receipt is reused; a failed/skipped delivery is recorded and can be retried by the owner.
- Admin paid-invoice view shows receipt status and a **Resend payment receipt** action.
- The historical $5 invoice can be safely resent without another charge; no resend was performed
  automatically.
- Receipt branding uses **Sparkling Standard Cleaning Co.** and **Standards That Sparkle.**

## Historical $5 transaction

A receipt was not delivered historically. It can now be generated and sent from the paid invoice's
**Resend payment receipt** action. This is a message-only operation and does not create a charge,
refund or new payment.

## Tests

- Unit: **876 tests — 875 pass, 1 pre-existing skip**.
- Browser: **221 pass**.
- Receipt unit test covers exactly one send, duplicate suppression, recorded Resend message ID and
  explicit resend.
- Astro check/build/validate/smoke pass.
- No live customer receipt was sent during verification.

## Remaining owner action

1. Open Admin → Invoices & Payments → the paid $5 invoice.
2. Verify the receipt status.
3. Click **Resend payment receipt** to deliver the historical receipt.
4. Keep Stripe-native receipt emails disabled for invoice Checkout while the app receipt is active.

## Phase A closeout � 2026-11-19

Verified against the implementation and automated tests:

- `payment_receipts` is created by migration `0037` and indexed by invoice and status.
- The webhook delivers a receipt only after the paid invoice reconciliation succeeds.
- One receipt per `(invoice_id, payment_id, channel)`; duplicate webhook delivery does not send twice.
- The Resend idempotency key is `invoice-receipt-<paymentId>`; an owner resend uses a new key.
- The receipt is built from the stored invoice, invoice lines, customer email and succeeded payment.
- Resend message ID, error code and sent timestamp are recorded and audited.
- The admin paid-invoice view shows the latest receipt status and the **Resend payment receipt** action.
- The resend action requires `finance.write`; a manager without that permission is refused, and a
  finance user outside the invoice branch cannot see or resend it.
- The non-gift tender row now reads **Total paid** without a misleading minus sign.
- New focused tests cover exact receipt data, branding, customer email, failed provider delivery,
  audit failure recording and branch/permission enforcement.

Current suite after this closeout: see the final closeout report. No live customer receipt was sent,
no new charge was created and the historical $5 invoice was not automatically resent.
