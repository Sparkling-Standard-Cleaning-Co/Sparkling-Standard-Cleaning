# Optional customer gratuities

Last updated: 2026-11-23

## Customer experience

Every invoice payment page (`/invoice-pay/?token=…`) and every tip-only link uses
the same mobile-first page. The initial selection is **No tip**. Suggested
amounts come from `src/config/tips.ts`; a customer may choose a suggestion, a
custom amount, or no tip. No tip does not require a second confirmation and does
not affect the service, review invitation, receipt or future service.

When a service balance remains, the page shows the service balance and the
gratuity separately, then the final total before handing off to Stripe Checkout.
When the service is already paid, the same page becomes tip-only: it shows
“Already paid”, collects only the voluntary gratuity, and never charges the
service again. A customer can close the page without tipping.

## Secure links

Links are HMAC-signed tokens bound to one invoice and one mode (`invoice` or
`tip`) with a 30-day default lifetime. They contain no customer data.

- **Admin → Invoices → Email Invoice + Payment Link** creates an `invoice` link.
- **Create secure payment page** creates/reopens the same page link.
- **Create optional tip link** is available on a paid invoice and creates a
  `tip` link after the service is paid and completed.
- Existing unpaid invoices work through the same page; the admin does not need
  to create a new invoice.

Signing secret: `TIPS_LINK_SECRET` in the Cloudflare Pages production secrets.
If it is absent, the existing `STRIPE_WEBHOOK_SECRET` is used as a fallback. Set
`TIPS_ENABLED=false` to fail closed and remove all tipping access; the default is
enabled.

## Stripe and accounting

`createInvoiceCheckoutSession` reads the invoice balance from D1. The service
amount and gratuity are separate Stripe line items and separate metadata
(`service_amount_cents`, `tip_cents`, `checkout_kind`). The browser never
supplies a trusted service amount or final charge.

- `checkout_kind=invoice_payment` applies only the service portion to the
  invoice and records the gratuity separately.
- `checkout_kind=invoice_tip` requires a fully paid invoice and records only the
  gratuity.
- Webhook idempotency is the Stripe Checkout Session ID; a repeated delivery
  never duplicates the payment or gratuity.

`payments.service_cents`, `payments.tip_cents` and `tip_allocations` preserve
service revenue, collected gratuity, allocation and refund history separately.

## Allocation policy

100% of collected tips belong to the cleaners who performed the service.
Allocation uses actual `time_intervals` work participation linked to the
appointment, not the originally scheduled crew. The split is deterministic:
equal shares, with any indivisible cent remainder assigned in stable team-member
ID order.

If no actual participation record exists, the full tip is stored as
`unallocated`; it is never assigned to a guessed person. An authorized finance
administrator can confirm the participating cleaners on the invoice, which
replaces the unallocated row and writes an audit record. Later corrections
preserve the original rows and audit history.

Refunds recompute the service and tip portions; gratuity refunds are reflected
in `tip_allocations.refunded_cents` and a fully reversed allocation is marked
`reversed`. Tip refunds never silently reopen or double-settle the service.

## Communication boundaries

Invoice email explains that the payment page offers an optional gratuity and
that it defaults to $0.00. Post-service review email support includes an optional
tip link and never conditions the review invitation on tipping. Review
automation remains under its existing disabled/branch configuration.

## Verification

- `tests/tips.test.ts` — token signing/tamper/expiry, $275 + $25, no tip, custom
  cents, tip-only, service protection, equal split, unallocated confirmation,
  full refund reversal, exact Stripe line items and public endpoint behavior.
- `tests/browser/invoice-tipping.test.mjs` — default zero, suggestions, custom
  amount, return to zero, final total, tip-only page, mobile layout.
- `tests/admin.test.ts` — existing invoice payment, webhook idempotency and
  receipt behavior remain green.

No automated test contacts live Resend or charges a card.
