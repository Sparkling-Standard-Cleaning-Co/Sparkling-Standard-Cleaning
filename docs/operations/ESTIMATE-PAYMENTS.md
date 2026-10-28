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

## Terms acceptance (Initiative 6.8, 2026-10-27)

A reservation, estimate or Pay Now request now requires an unchecked-by-default acceptance of the
current `Terms and Conditions` and applicable policies. The server independently checks
`terms_accepted=yes` and the exact `legalTerms.termsVersion`; a missing/outdated acceptance returns
`terms_required`/`terms_outdated` and no lead or checkout is created. The server stamps the
acceptance time and a unique id, records it privately under
`legal/acceptances/YYYY-MM-DD/<id>.json` when the R2 binding is available, and includes the version,
policy version, time and record id in the owner notification. The customer confirmation includes the
accepted version. Contact-form messages are exempt.

If the private R2 write fails for a transactional request, the lead fails closed with
`acceptance_storage_failed` so the customer can retry; it is never silently reported as recorded.
The acceptance record is not used for analytics or marketing.

## Initiative 6.7 reliability (2026-10-27)

Pay Now is now fail-closed on operational readiness, not merely key presence. The configuration
probe reports `ok`, `enabled`, `mode` and named checks (Stripe key, webhook secret, webhook endpoint,
notifier, durable ledger). Pay Now stays hidden unless the required checks pass. Test-mode keys are
accepted only on non-production origins.

Checkout is verified-only: the server requires a confirmed non-street address, a live route, a
current pricing configuration and an acknowledged initial Deep Cleaning for new recurring service.
Custom, preliminary, unverified, range and Tier B/C quotes remain reservation-only. A genuine price
change returns `409 quote_changed` with the server amount; checkout continues only after explicit
customer acceptance of that exact amount. No client-supplied price or route is trusted.

Checkout attempts are recorded privately in R2 (`PAYMENT_LEDGER`, falling back to `PHOTOS_BUCKET`)
under `payments/checkouts/`; the key is a SHA-256 attempt fingerprint. An open Checkout Session is
reused, a completed one redirects to the verified status page, and an expired one may be recreated.
Stripe receives a deterministic idempotency key. Concurrent duplicate calls fail closed rather than
opening two payable sessions.

Stripe webhook events are durably claimed under `payments/events/` before notification or gift
fulfillment. A duplicate delivery is acknowledged without repeating side effects; a notification
failure returns a retryable error so Stripe redelivers. The existing in-memory Set is only a
fallback when R2 is unavailable, not the primary deduplication mechanism.

Cancellation now returns to `/estimate/payment-canceled/`, which explains that no appointment was
confirmed, preserves a safe quote reference, and offers a path back to the estimator. The success
page distinguishes paid, open/pending, expired, unknown and unavailable verification states; it
never displays a false paid confirmation.

A failed Pay Now attempt preserves the submitted reservation and allows a direct payment retry
without resubmitting the lead. The reservation-without-payment path is unchanged.

The R2 records contain payment references and limited purchaser metadata. Keep the bucket private;
never expose those object keys, Stripe secrets, card data or customer records in logs or reports.

## Initiative 6.9 Pay Now recovery (2026-10-28)

**Root cause of the owner screenshot:** the final summary always showed the "Pay Now Securely"
marketing sentence, while the button was hidden by the client-side eligibility rule. A manual/ZIP
address with estimated travel produced a preliminary quote; `clientPaymentEligible()` required a
verified live route and a precise confirmed destination, so it correctly withheld checkout. The
summary copy did not reflect that state, leaving a promise with no action.

**Fix:** the final summary now renders its explanation from the actual checkout state:

- Eligible verified quote: Pay Now and Reserve This Cleaning (Pay Later).
- Exact price but unverified travel/address: **Verify Address & Finalize Price** opens the address
  resolver and pin confirmation; after confirmation the estimate recalculates and the customer
  returns to the final step with Pay Now unlocked when the live route is verified.
- Manual-review or payment-not-ready quote: no Pay Now promise; reservation and owner confirmation
  are clearly offered.

The server remains authoritative: no preliminary, moved-pin, approximate, stale or manipulated
quote can create a Checkout Session. The 6.7 SHA-256 idempotency, R2 session/event records, signed
webhook, retry and duplicate-charge protections are unchanged.

Regression coverage: `tests/browser/initiative-6.9-paynow.test.mjs` reproduces the preliminary state
at desktop and mobile, asserts that Pay Now is hidden and the verification action is present, then
confirms the pin and asserts that the real Pay Now button and Pay Later reservation choice appear.

### Address-verification loop correction (2026-10-28)

Owner testing found two ways the verification action could loop without changing the outcome:

1. The resolver returned the ZIP-area **approximate** pin (or a street-level pin). Confirming it
   left the customer on the address step; if they moved forward, the same verification action was
   still offered, but it could only reproduce the same approximate result.
2. The address resolved **exactly**, but the live travel route was unavailable. The address was not
   the problem, yet verification remained the only action because checkout eligibility required both
   an exact address and a verified route.

**Fix:** the address finder now reports an explicit pin-confirmation event and verification outcome
to the estimate wizards.

- An exact pin returns the customer to the final step. Pay Now appears as soon as the live route is
  verified; the address is never re-verified just because travel is pending or unavailable.
- An approximate or street-level confirmation is accepted once for the request, returns to the
  final step with online payment withheld, and replaces the verification action with a clear
  manual-review path: reserve without paying, and the owner confirms the exact property and sends a
  secure payment link.
- An unresolved or unavailable lookup also returns to the final step with the manual-review path.
  Missing street/city/ZIP information keeps the customer on the address step with a specific error
  and does not consume the attempt.
- Editing the address clears the manual-review state so a corrected address can be verified.
- The residential/STR and commercial/church forms share the same behavior.

The server is unchanged and remains authoritative: approximate, street-level, unresolved or
unverified-route quotes still cannot create a Checkout Session.

Regression coverage: `tests/browser/initiative-6.9-paynow.test.mjs` now covers the approximate
match and the exact-address/unavailable-route cases; `tests/browser/initiative-6.6-content.test.mjs`
covers the approximate facility path. Each asserts that the verification action is hidden after the
attempt and that the reservation/manual-review path remains available.

**Not yet proven:** a controlled Stripe test-mode card payment. The production runtime currently has
a live-mode key; no test-mode credentials were provided, and no live charge was authorized.
