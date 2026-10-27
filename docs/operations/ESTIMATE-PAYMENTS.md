# Estimate payments (Pay Now)

**Owner-directed 2026-10-26.** A customer can choose one of two paths at the end of an
instant estimate:

1. **Reserve This Cleaning** — submit the request with no upfront payment.
2. **Pay Now Securely** — submit the same request, then pay the server-verified proposed
   amount through Stripe-hosted Checkout.

The request is delivered by `/api/lead` before checkout starts. A payment failure never discards
the cleaning request.

## Where Pay Now appears

- Residential `/estimate/residential/` when the estimate produces a proposed price.
- STR `/estimate/str/` when the turnover estimate produces a proposed price.
- Commercial `/estimate/commercial/` only for a single-price **Tier A** preliminary total.
- Church `/estimate/church/` only for a single-price **Tier A** preliminary total.

Tier B ranges, Tier C scope reviews and residential custom-confirmation jobs remain
reservation-only. The site never charges a range, a custom quote or an unknown amount.

## Security model

- The browser price is **not trusted**. `/api/estimate-checkout` recalculates the quote with
  the same shared estimator configuration used by the page.
- Residential/STR quotes are re-resolved and re-routed server-side. A changed pin, changed
  scope, stale configuration or a client price that does not match the server total is rejected.
- Facility payments require a server-generated route and an exact Tier A total. No client
  `travel_one_way_miles` value is trusted.
- The Stripe amount is built from the server result only.
- Stripe-hosted Checkout handles card data. No card number touches this site.
- The success URL is display-only. Payment is confirmed by the `checkout.session.completed`
  webhook with `payment_status=paid`, and the success page separately verifies the Checkout
  Session through the server.

## Configuration

Runtime secrets in Cloudflare Pages (never in Git):

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `PUBLIC_SITE_URL` (optional; production default is `https://sparkling-standard.com`)

The Pay Now button stays hidden unless `GET /api/estimate-checkout` reports
`{ ok: true, enabled: true }`. Without the Stripe secret, customers see only the reservation path.
The server-side feature switch is `estimatePaymentConfig.enabled` in `src/config/payments.ts`.

### Stripe dashboard

Create or retain the existing webhook endpoint:

```text
https://sparkling-standard.com/api/stripe-webhook
```

Subscribe it to `checkout.session.completed`. The existing endpoint handles both estimate payments
and approved gift-certificate purchases. Do not create a second webhook handler.

The success URL is:

```text
https://sparkling-standard.com/estimate/payment-success/?session_id={CHECKOUT_SESSION_ID}
```

## Owner notification

The estimate request arrives through the normal lead relay with the customer's payment preference.
A separate **PAID estimate** email is sent only from the verified webhook, with the Stripe amount and
quote reference. Do not treat the customer's "Pay Now" selection as paid until that separate notice
arrives.

## What is not claimed

- Live Stripe configuration has not been independently verified in the code repository; the secret
  is environment-only.
- Payment by itself does not book an appointment. Sparkling Standard still confirms scope, date and
  final details.
- The success page does not say "paid" unless the server verifies the Checkout Session.
- No refund/cancellation policy is invented here; the existing owner-approved terms govern.

## Tests

- `tests/api.test.ts` covers the configuration probe, missing-secret fail-closed behavior, invalid
  payload rejection, and non-payable facility quotes.
- `tests/browser/initiative-6.6-content.test.mjs` covers the address state restriction, optional
  facility ZIP after a confirmed location, bundle offers and the public copy corrections.
- A live paid card test was **not** performed. Use Stripe test mode with the owner's test keys before
  claiming production payment readiness.
