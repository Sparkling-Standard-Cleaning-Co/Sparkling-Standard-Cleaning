# Invoice Payment Link — 2026-11-19

## Production configuration verified

- Latest production deployment after this release: `1c8ef822-9864-4cb7-b4ff-25711d3983bc`
  (source `e324f0b`).
- Pages production project configuration resolves:
  - `ADMIN_STRIPE_BILLING_ENABLED = "true"`
  - `STRIPE_SECRET_KEY` present as an encrypted secret
  - `STRIPE_WEBHOOK_SECRET` present as an encrypted secret
  - D1 binding `DB` present
  - R2 bindings `DOCUMENTS_BUCKET` and `PHOTOS_BUCKET` present
- No secret values were printed or stored.
- Webhook endpoint is reachable: an unsigned POST returns
  `400 {"ok":false,"error":"invalid_signature","reason":"missing"}`.
- The live/test mode of the secret key cannot be read without exposing credentials; no live charge
  was attempted.

## Previous broken link

- No `invoice.payment_link_created` audit event exists.
- Both existing invoices have `payment_url = NULL` and `stripe_checkout_session_id = NULL`.
- The previous link was never created; the most likely cause was the disabled
  `ADMIN_STRIPE_BILLING_ENABLED` gate. The owner has now enabled it in production.

## Application changes

- `Email Invoice + Payment Link` admin action:
  - validates invoice/email/balance;
  - reuses a valid session or creates a fresh Checkout Session for the exact balance;
  - sends no email if link creation fails;
  - attaches the invoice PDF and includes the secure button and URL.
- `Preview invoice email` action renders the email without sending; it warns when no payment link
  exists yet.
- Existing `Email invoice PDF only` and PDF download remain.
- Invoice PDF/email branding now uses **Sparkling Standard Cleaning Co.** and
  **Standards That Sparkle.**
- Email includes the current site icon as the brand mark.
- No pricing, FRIENDS15, Community Care, agreements, bookings or recurring prices changed.

## Security and financial behavior

- Link creation requires `finance.write`, owner/authorized admin session and CSRF.
- The link is tied to the internal invoice ID and current balance.
- Paid/void invoices are rejected; existing valid sessions are reused; stale sessions are expired
  before a new one is created.
- Webhook reconciliation remains the only authority for marking an invoice paid.
- Repeated webhook events are idempotent through the existing payment idempotency key.
- No live payment link, charge or refund was created during verification.

## Receipts

- Estimate payments use the app receipt.
- Invoice payments still have no app-generated receipt.
- Stripe Dashboard receipt-email behavior remains unverified.
- Owner must choose one source before adding another receipt.

## Tests

- Unit: **875 tests — 874 pass, 1 pre-existing skip**.
- Browser: **221 pass**.
- Astro check/build/validate/smoke pass.
- No live-money test has been performed.

## Remaining owner actions

1. Open an eligible unpaid invoice in Admin → Invoices & Payments.
2. Click **Preview invoice email** and verify the PDF/link presentation.
3. Click **Email Invoice + Payment Link** only when ready; this creates a live Stripe Checkout
   Session and emails the customer.
4. Confirm Stripe receipt emails in the Dashboard.
5. Approve a controlled real-money verification later; none is authorized by this release.
