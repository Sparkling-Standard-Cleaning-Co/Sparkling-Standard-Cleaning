# Gift certificates — offer, payment, fulfillment and accounting

Gift certificates are a **prepaid value toward cleaning services**. They are not a promise that a
fixed amount covers a complete cleaning; the service, scope and price are confirmed with the
recipient exactly as for any customer. The public configuration lives in
`src/config/gift-certificates.ts`.

**Current public state: sales are DISABLED.** The page offers a request form only — no payment is
taken, no amount is advertised, and no certificate is issued until payment verification exists and
the owner approves the terms. This document records how the system works and what remains to be
decided.

## 1. What is built

| Piece | Where | Status |
| --- | --- | --- |
| Public page (explanation, sample, request form) | `/gift-certificates/` | **Live (request mode)** |
| Safe redemption instructions page (QR target) | `/gift-certificates/redeem/` | **Live**, noindex, never looks up or changes a certificate |
| Checkout-return page (noindex, never claims issuance) | `/gift-certificates/success/` | **Live** |
| Printable certificate + working QR (owner tool) | `scripts/gift-certificate.mjs` (`npm run gift:certificate`) | **Working**, QR self-verified |
| Stripe Checkout session creator | `functions/api/gift-checkout.ts` | **Built, dormant** (`enabled: false` → 403; no key → 503) |
| Stripe webhook (signature-verified payment confirmation) | `functions/api/stripe-webhook.ts` | **Built, dormant** (no webhook secret configured) |
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
| Amount/terms confirmation | — | ✔ owner |
| Card payment | ✖ (disabled) | ✔ owner sends a Stripe link/invoice if the customer wants to prepay |
| Payment verification | Webhook code exists but is dormant | ✔ owner checks Stripe |
| Certificate generation | ✔ tool produces the printable file with QR | ✔ owner runs it and prints/sends |
| Certificate delivery to purchaser/recipient | — | ✔ owner emails the file (Gmail; Web3Forms does not send outbound branded mail) |
| Redemption + balance updates | — | ✔ owner ledger |

No automated email is claimed: the free Web3Forms service only notifies the owner. A paid email
service would be required for automated delivery; that is deliberately not introduced.

## 4. Activation checklist (owner decisions required)

1. **Approve denominations** (exact amounts) or keep custom amounts only — set
   `giftCertificateConfig.denominations` and `allowCustomAmount` bounds.
2. **Approve the public terms**: coverage wording, redemption steps, whether they expire
   (do not invent restrictions; Florida — and Alabama where relevant — gift-certificate
   requirements must be reviewed first), refund/cancellation handling.
3. **Stripe**: confirm enabled payment methods and set `STRIPE_SECRET_KEY` (Secret) and
   `STRIPE_WEBHOOK_SECRET` (Secret) in the Cloudflare **production** environment, register the
   webhook endpoint `https://sparkling-standard.com/api/stripe-webhook` for
   `checkout.session.completed`, and turn on Stripe's email receipts.
4. **Flip `enabled: true`** in `src/config/gift-certificates.ts` (one line) after 1–3 are done.
5. **Test**: one owner-authorized live purchase at the smallest denomination, confirm the webhook
   alert, generate and deliver the certificate, then redeem it against a real reservation.
6. Keep the reservation 60-day window out of certificate validity — they are different policies.

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
