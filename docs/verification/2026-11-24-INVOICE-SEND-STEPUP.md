# Invoice Email Step-Up Removal — 2026-11-24 P0

**Branch:** `production-safe`
**Base:** `cdb4cbe`
**Status:** verified locally; production deployment evidence appended after release.

## Root cause

`functions/api/admin/finance.ts` included `email_invoice` in the MFA step-up
action list. With an MFA-enabled owner session that had not completed a recent
step-up, the server returned `403 mfa_step_up_required`. The shared client `api()`
helper interpreted that as a sensitive-action challenge and opened the browser
`window.prompt()` asking for the six-digit email code.

The invoice-send action itself was otherwise correctly authenticated, CSRF
protected, permission checked and audited. The challenge was an unnecessary
step-up on a routine email action, not a broken Resend configuration or payment
link path.

## Fixes

- Removed only `email_invoice` from the finance step-up list.
- Preserved step-up for high-risk actions: invoice creation, status mutation,
  payments, refunds, credits, payment-link creation, billing portal, receipt
  resend and Stripe refund execution.
- Replaced the direct PDF/link send clicks with the existing branded
  `adminConfirm()` dialog showing:
  - customer name
  - recipient email
  - invoice number
  - amount due
  - payment-link inclusion or PDF-only
  - **Cancel** / **Confirm & Send Invoice** or **Confirm & Send PDF**
- No native browser prompt is used for invoice sending.
- Added an in-flight guard and a retained idempotency key per invoice attempt so
  a double click cannot send twice; a successful send clears the key.
- Success and provider failure messages remain explicit; the server still writes
  `invoice.emailed` / `invoice.email_failed` audit events.
- Payment-link generation, PDF attachment and optional $0-default tipping are
  unchanged.

## Tests

- `tests/admin.test.ts`: MFA-enabled owner with no step-up receives a real
  invoice email success (mocked provider) instead of `mfa_step_up_required`;
  CSRF failure sends nothing; manager without finance permission is rejected;
  expired session is rejected; `create_invoice` still requires step-up.
- `tests/browser/invoice-send-confirmation.test.mjs`: branded confirmation shows
  correct customer/email/invoice/$275/payment-link details, Cancel sends
  nothing, Confirm & Send sends exactly once, PDF-only confirmation remains
  functional, and no native browser prompt appears at 390px.
- `tests/browser/admin-operations.test.mjs`: existing PDF-only invoice email
  flow updated for the confirmation dialog.
- Full regression: unit **1,100** (1,099 pass, 1 pre-existing skip); browser
  **274/274**; `astro check` 0 errors/0 warnings; build 41 pages; validation
  2,631 links; smoke 21 pages.

## Boundaries

- No real customer email was sent during automated testing. Resend is mocked or
  guarded.
- No invoice was created, modified or sent in production by verification.
- No card was charged.
