# Checkout Failure Investigation and Recovery — 2026-11-21

## Reported symptom

A live customer reached the final estimator step, clicked **Pay Now**, and saw:

> Your request was received, but secure checkout could not start right now.
> You can try payment again, or arrange payment when we confirm your appointment.
> No payment has been taken by this website.

## Exact reproduction

The failure was reproduced against production using the owner-specified address:

**6360 Haupert Ln, Molino, FL 32577**

- Address resolved exactly by Google geocoding (`30.7210325, -87.4415066`, ZIP 32577).
- Travel route resolved to approximately 15.7 miles one way / 21 minutes.
- Residential standard cleaning, 1,600 sq ft, 3 bedrooms, 2 full baths, one-time,
  maintained condition, 5h 55m scheduled window, $270 verified quote.
- Pay Now reached `/api/estimate-checkout` and returned a 502
  `stripe_unavailable`; the browser showed the reported fallback message.

## Root cause

Cloudflare runtime logs captured the actual Stripe rejection:

```
[estimate-checkout] stripe_session_failed {
  status: 400,
  code: "parameter_unknown",
  type: "invalid_request_error",
  param: "customer_update[email]",
  message: "Received unknown parameter: customer_update[email]"
}
```

`functions/api/estimate-checkout.ts` added `customer_update[email]=auto` when a
reusable Stripe Customer existed. Stripe Checkout does not accept that
parameter. Every live Checkout Session for a returning/mapped customer was
therefore rejected before a session URL existed. The browser interpreted the
502 as an unknown checkout failure and showed the fallback copy.

## Contributing defects found and repaired

1. **Stripe Checkout parameter** — removed `customer_update[email]`. The linked
   Stripe Customer already carries the verified email, and the existing
   `customer_email` path handles customers without a Stripe Customer.
2. **Transient routing rejection** — if Google Routes briefly failed during
   checkout verification, the quote degraded to a straight-line estimate and
   checkout rejected it as `quote_not_verified`, even though `/api/travel` had
   just verified the route. Google routing now retries once and falls back to
   the MapMap route before the straight-line estimate.
3. **Retry idempotency** — a failed Stripe attempt deleted the checkout record,
   so a retry reused the same Stripe idempotency generation and could receive a
   cached failure. The failure generation is now retained separately and the
   retry advances to the next Stripe idempotency key. Concurrent duplicate
   clicks still resolve to one session/claim.
4. **Diagnostics** — Stripe failures now log the safe error code, type, `param`
   and message; the 502 response includes a safe reason code.

## Production verification

Applied to production on commit **`84379cb`**. The verified production
checkout build was deployment `3f6ded04`; the final metadata-corrected build is
deployment `edc50a01` (same application code).

Verified live:

| Check | Result |
|---|---|
| Address geocode | exact Google result for 6360 Haupert Ln, Molino, FL 32577 |
| Travel | live route verified, ~15.7 mi / ~21 min |
| Lead verification | `verified`, travel verified, config match |
| Normal Pay Now | **redirected to live Stripe Checkout** (`cs_live_...`) |
| Simulated checkout failure | customer saw the retry state and **Try Secure Payment Again** |
| Retry | returned to Stripe Checkout successfully without a second booking request |
| Payment | **no card entered, no charge, no refund, no paid webhook event** |
| Pay Later | unchanged; existing reservation path untouched |

Synthetic records created by the investigation were reconciled:

- 21 leads archived
- 21 booking requests released
- 21 holds released
- open checkout slots expired
- 1 synthetic customer archived
- estimates voided
- audit action `test.checkout_diagnostics_reconciled`

Production payment/refund rows since 04:00 UTC: **0 payments, 0 refunds,
0 paid receipt events**.

## Verification suites

- `npm test`: **974 tests, 973 pass, 1 pre-existing skip, 0 fail**
- `npm run check`: **0 errors**
- `npm run build`: **39 pages**
- `npm run validate`: passed
- `npm run test:browser`: **240 pass / 0 fail**

## Files changed

- `functions/api/estimate-checkout.ts`
- `src/lib/travel/server-routing.ts`
- `tests/estimate-checkout.test.ts`
- `tests/google-maps-provider.test.ts`

## Outstanding configuration

None required for checkout initiation. Stripe remains in live mode with the
existing verified keys, webhook endpoint and product setup. The webhook and the
previously verified payment-completion paths were not changed; no live payment
completion was executed.
