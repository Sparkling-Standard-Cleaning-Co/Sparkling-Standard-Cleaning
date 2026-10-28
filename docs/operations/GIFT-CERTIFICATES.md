# Gift certificates — offer, payment, fulfillment and accounting

Gift certificates are a **prepaid value toward cleaning services**. They are not a promise that a
fixed amount covers a complete cleaning; the service, scope and price are confirmed with the
recipient exactly as for any customer. The public configuration lives in
`src/config/gift-certificates.ts`.

**Current public state: sales are DISABLED.** The page offers a request form only — no payment is
taken, no amount is charged, and no certificate is issued until final legal review and a live test
purchase are approved. The purchase UI, approved amounts, delivery choices, scheduled delivery,
ledger and owner register are implemented behind the activation gate.

**2026-10-27 policy update:** the public terms state that a purchased certificate does not expire
and carries no post-sale service, dormancy, maintenance or cash-out fee (Fla. Stat. § 501.95).

**2026-10-28 owner decisions:** approved denominations are **$50, $100, $150, $200**; custom amounts
are **$25–$500**; a completely unused certificate may be refunded within **14 days**; certificates
are transferable by valid code, partial redemption is allowed, and the remaining balance is
preserved. No voluntary cash redemption except where legally required. The final public wording
still needs legal review.

**2026-10-28 gift administration:** paid webhooks create one durable certificate under
`gifts/certificates/` (idempotent by Stripe event). The certificate ledger records original value,
remaining balance, purchaser/recipient fields, payment references and every redemption. Owner-only
lookup, inventory, partial redemption, summary metrics and financial controls are under
`/api/gift-admin`. **Gift administration is protected by Hayli's password session.** `/gift-admin/`
has a normal login screen, HttpOnly session cookie, CSRF protection, rate limiting, audit records
and a verified-email recovery flow. The legacy shared bearer token is no longer accepted by the
register; the photo token has no financial authority. Sales remain disabled.

**2026-10-28 delivery/balance update:** after a verified paid webhook and one durable issuance, the
webhook sends the branded certificate (HTML + plain text) to the purchaser and, when the purchaser
selected email delivery, the recipient through Resend with idempotency keys. Delivery failure
returns a retryable error and never creates a second certificate. Scheduled recipient delivery is
stored durably under `gifts/deliveries/` and is processed by the Hayli-only
`POST /api/gift-delivery` owner/cron trigger. The repository includes an hourly GitHub Actions
trigger that sends only at or after 09:00 America/Chicago once the owner supplies its repository
secrets. The redemption page can verify a code's remaining balance through `GET /api/gift-balance`
without exposing names/contact details. The purchase has not been exercised with a real Stripe payment.


**2026-10-28 password administration:** `/gift-admin/` no longer asks for a bearer token.
The owner creates the administrator password once using `GIFT_ADMIN_SETUP_CODE` (a Cloudflare
secret), then signs in normally. Passwords use PBKDF2-SHA-256 (210,000 iterations, random salt);
only the hash is stored server-side. Sessions are random opaque tokens in a `__Host-` HttpOnly,
Secure, SameSite=Strict cookie with a two-hour expiry. Every financial POST requires the session
CSRF token and the administrator password again (step-up). Login is rate-limited and returns a
generic failure. The dashboard lists/search/filters/paginates the certificate inventory, shows
liability totals, lets Hayli review a record, resend, redeem, refund or void an unused
certificate, and exposes delivery failure state. Backup-email verification and single-use
recovery links are implemented through Resend. Phone OTP is deliberately not offered until an
SMS provider is approved, configured and tested; the page does not claim otherwise.
**2026-10-28 refund/void update:** `POST /api/gift-admin` accepts `action: "refund"` or
`action: "void"` for an **active, completely unused** certificate. A refund retrieves the original
Checkout Session's PaymentIntent, submits a Stripe refund with the fixed idempotency key
`gift-refund-<certificate code>`, and only then marks the durable ledger `refunded` with the Stripe
refund id. A retry reuses the same Stripe idempotency key, so it cannot issue a second refund. A void
marks the unused certificate `void` without moving money. Both actions record a ledger adjustment and
cancel a pending scheduled delivery; the scheduled processor also rechecks certificate status before
sending. No live Stripe refund or void has been performed.


## 1. What is built

| Piece | Where | Status |
| --- | --- | --- |
| Public page (explanation, sample, delivery choices, request/purchase UI) | `/gift-certificates/` | **Live (request mode)**; purchase UI gated |
| Safe redemption instructions page (QR target) | `/gift-certificates/redeem/` | **Live**, noindex, never looks up or changes a certificate |
| Checkout-return page (noindex, never claims issuance) | `/gift-certificates/success/` | **Live** |
| Printable certificate + working QR (owner tool) | `scripts/gift-certificate.mjs` (`npm run gift:certificate`) | **Working**, QR self-verified |
| Stripe Checkout session creator | `functions/api/gift-checkout.ts` | **Built**, amounts/delivery/email validated; dormant behind `enabled: false` |
| Stripe webhook (signature-verified payment confirmation) | `functions/api/stripe-webhook.ts` | **Built**, idempotent issuance and scheduled-delivery records |
| Scheduled delivery processor | `functions/api/gift-delivery.ts` | **Built**, token-protected; hourly trigger prepared; 09:00 America/Chicago gate |
| Owner gift register | `/gift-admin/` + `/api/gift-admin` | **Built**, noindex; password login, secure session, inventory/search/filter/pagination, lookup, redemption, refund/void/resend |
| Fulfillment notification (paid → owner alert with code) | `src/lib/gift/fulfillment.ts` | **Built**, unit-tested |

## 2. Purchase lifecycle

```
customer request (/gift-certificates/ form)
  → owner confirms amount + recipient details
  → owner sends a payment path (Stripe Checkout once enabled, or a Stripe payment link/invoice)
  → payment verified: Stripe webhook (signature-verified, paid status only)
  → owner receives a fulfillment alert with the unique certificate code
  → owner generates the printable certificate and delivers it manually
  → recipient redeems by code with the owner
```

The success URL a customer sees after paying **never** issues anything: only the verified webhook
authorizes issuance. The certificate code derives from the Stripe event id, so a retried webhook
can never mint a second code; the ledger records the Stripe event id as the durable dedupe key.

## 3. Automatic vs manual (be honest about it)

| Step | Automatic today | Manual today |
| --- | --- | --- |
| Public explanation + request capture | ✔ (website, lead relay) | — |
| Purchase amount/email/delivery validation | ✔ server-side | — |
| Card payment | ✖ (gate closed) | Owner activation required |
| Payment verification | ✔ signature-verified paid webhook | — |
| Certificate issuance | ✔ idempotent durable ledger | — |
| Purchaser certificate email | ✔ Resend, purchaser confirmation | — |
| Immediate recipient email | ✔ when selected | — |
| Scheduled recipient delivery | ✔ durable record; owner/cron processor | Trigger must be configured |
| Printable certificate | ✔ tool produces the file with QR | Owner prints/sends if chosen |
| Redemption + balance updates | ✔ server ledger/admin | Owner approves redemption |
| Refunds/voids | ✔ unused certificate, Stripe refund + durable adjustment | Owner action; no live test yet |

The request acknowledgment is automatic. Certificate email delivery uses Resend with idempotency
keys; a failure is retryable and never mints a second certificate. The printable file remains
available through `npm run gift:certificate`. The public sales gate remains off.

## 4. Activation checklist (owner decisions required)

1. **Denominations:** approved values and custom bounds are already in
   `giftCertificateConfig.denominations` / `allowCustomAmount`; do not re-approve.
2. **Final legal review:** coverage wording, redemption steps, refund/transfer/unclaimed-property
   language, and the scheduled-delivery consent. The 2026-10-27 public terms prohibit expiration
   and post-sale fees; keep them unless counsel confirms a stricter requirement.
3. **Stripe:** confirm enabled payment methods and set `STRIPE_SECRET_KEY` (Secret) and
   `STRIPE_WEBHOOK_SECRET` (Secret) in the Cloudflare **production** environment, register the
   webhook endpoint `https://sparkling-standard.com/api/stripe-webhook` for
   `checkout.session.completed`, and turn on Stripe receipts.
4. **Configure `GIFT_ADMIN_SETUP_CODE`** (a one-time Cloudflare secret), open `/gift-admin/`, and
   complete the password + backup-email setup. Verify the backup email before relying on recovery.
   `GIFT_OWNER_TOKEN` remains only for the scheduled-delivery processor, never for browser login.
   Add the `GIFT_DELIVERY_URL` and `GIFT_OWNER_TOKEN` GitHub repository secrets to enable the
   prepared hourly scheduled-delivery workflow.
5. **Flip `enabled: true`** only after 1–4 are done.
6. **Test:** one owner-authorized live purchase at the smallest denomination, confirm the webhook
   alert, purchaser email, certificate, optional recipient delivery, one partial redemption and the
   owner register. Test one scheduled delivery with the processor in a non-production path first.
   Test one unused certificate refund and one unused certificate void in Stripe test mode; confirm
   the ledger adjustment and pending-delivery cancellation.
7. Keep the reservation 60-day window out of certificate validity — they are different policies.

## 5. Accounting (obligations, not revenue)

A sold certificate is a liability until redeemed. Keep a private ledger
(`docs/operations/GIFT-CERTIFICATE-LEDGER-TEMPLATE.csv`, imported into a Google Sheet) with:

| Column | Purpose |
| --- | --- |
| `certificate_code` | Unique code on the certificate. |
| `issue_date` | When it was issued. |
| `original_value_usd` | Purchased value. |
| `payment_reference` | Stripe payment/event id (or manual transaction note). |
| `purchaser_name`, `purchaser_email` | Purchaser records. |
| `recipient_name`, `recipient_email` | Recipient records (optional email). |
| `gift_message` | Kept for re-issuing the certificate if needed. |
| `redemption_date`, `reservation_reference`, `amount_applied` | One row per redemption. |
| `remaining_balance_usd` | `original_value − sum(amount_applied)`. |
| `refund_or_cancel`, `notes` | Exceptions and why. |

Rules: never redeem without the code; never apply a certificate twice; a zero balance certificate
cannot be applied again; refunds follow the owner's approved policy (Stripe can refund the original
payment). Never store card numbers anywhere — Stripe holds only payment references.

## 6. Security properties

- No card data ever reaches the website or function (`Stripe-hosted Checkout` only).
- Webhook signature verification is constant-time and timestamp-bounded (5 minutes), so a captured
  header cannot be replayed later.
- Only `checkout.session.completed` with `payment_status: 'paid'` authorizes issuance; unpaid or
  ignored events never do.
- A paid purchase that cannot be forwarded returns HTTP 500 so Stripe retries instead of losing it.
- Certificate QR codes contain only `/gift-certificates/redeem/?ref=<code>` — no names, emails or
  addresses — and that page neither looks up nor mutates anything.
- Codes use an unambiguous alphabet (no I/L/O/0/1) and are deterministic per purchase.
- Gift financial actions accept **only** an authenticated Hayli session plus CSRF and password
  step-up. The photo owner token and legacy shared gift token are not alternatives.
- Scheduled deliveries are stored under `gifts/deliveries/` and use an idempotency key; a sent record
  is not resent. The scheduled processor uses the private `GIFT_OWNER_TOKEN` server-to-server.
- The owner register is noindex, stores no password in the browser, and keeps only the CSRF token
  in memory/session state. The session cookie is HttpOnly, Secure and SameSite=Strict.
- Refunds use the original Checkout Session's PaymentIntent and a fixed per-certificate idempotency
  key. The ledger is marked only after Stripe confirms; a failed ledger update is reported for
  retry. No live refund or void was performed.
- Backup and retention separation are documented in `docs/operations/R2-STORAGE-AND-BACKUP.md`.

## 7. Known gaps before live gift sales

- No customer-facing gift-code application inside the cleaning estimator/checkout yet. The owner
  ledger can record an owner-approved redemption against a job reference, but automatic gift credit
  against a live Stripe difference is not implemented.
- Stripe refund execution, unused-certificate voiding and scheduled-delivery cancellation are
  implemented but have not been exercised against live Stripe. Chargeback/dispute reconciliation
  remains manual.
- The hourly scheduled-delivery workflow is prepared but remains inactive until the owner adds
  `GIFT_DELIVERY_URL` and `GIFT_OWNER_TOKEN` repository secrets; it then sends only at/after 09:00
  Central and is idempotent.
- The owner register supports redemption, refund and void for unused certificates; it is not a
  general accounting replacement, and partial refunds/chargeback adjustments are not exposed.
- The final gift terms/legal review and a live test purchase are still required before
  `enabled: true`.
