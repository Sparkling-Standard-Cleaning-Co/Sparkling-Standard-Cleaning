# Stripe Sandbox Test Results — 2026-11-22

**Status:** real Stripe test-mode API transactions completed successfully.
No live charge, production deployment, production D1/R2 change or customer
notification was made.

## Secret access

`STRIPE_TEST_SECRET` is present as a Windows **User** environment variable and
was verified as test-mode (`sk_test_`/`rk_test_`) without displaying its value.
No `STRIPE_WEBHOOK_SECRET` or `STRIPE_TEST_WEBHOOK_SECRET` is present locally.
The value was used only in child-process environment variables and was removed
after each run.

## Real Stripe test-mode results

### Checkout Session primitive — 6/6 pass

`npm run stripe:checkout-sandbox`:

- synthetic test customer created;
- test-mode Checkout Session created, status `open`, amount `100` cents;
- hosted Checkout URL returned;
- idempotent replay returned the same session;
- session retrieved, unpaid;
- session expired without payment;
- synthetic customer deleted.

No card was entered and no charge was created by this check.

### Administrative billing / payment lifecycle — 23/23 pass

`npm run stripe:sandbox`:

- test customer and test card attached (`visa •••• 4242`);
- invoice finalized and paid with the test card;
- test refund created;
- saved-card setup intent and saved method retrieved;
- off-session charge succeeded and was refunded;
- administrative Checkout link created and readable;
- customer mapping stored;
- settlement charge succeeded;
- webhook reconciliation into D1 applied once; duplicate call returned
  `duplicate=true`;
- administrative refund recorded;
- cash-payment recording reconciled;
- webhook signature accepted; tampered and wrong-secret payloads rejected;
- missing authorization rejected;
- live administrative charging remained disabled;
- synthetic test customers deleted.

This is a real Stripe test-mode payment/refund lifecycle, not a stub.

### Declined payment — pass

A real test-mode PaymentIntent using Stripe's declined test instrument returned:

```text
HTTP 402
code=card_declined
decline_code=generic_decline
```

No charge was created. This proves the provider-level decline path; application
recovery behavior is covered by the 48 signing/payment/checkout tests.

## What is verified in the application

- All 27 approved documents and 10 staging packets: hashes match, zero missing
  variables, zero staging errors.
- Staging signing request completed and executed PDF generated:
  `deep-executed-signed.pdf`,
  SHA-256 `f7041cc773bd8b55854deab3408d17a95b26bc1f872a1b8065ab0e3fe497b0b4`.
- Focused signing/payment/checkout tests: **48/48 pass**.
- Full unit suite: **1,016 tests, 1,015 pass, 1 pre-existing skip, 0 fail**.
- Full browser suite: **248/248 pass**.
- PR #1 CI: `validate` and `browser` pass.

## Full site estimate → agreement → signature → payment → booking

This combined live-site journey was **not executed** in this environment. The
remaining blockers are environmental, not a failure result:

1. **No isolated Pages runtime/preview** is configured with `STRIPE_TEST_SECRET`
   and a test webhook signing secret. The test secret is readable locally, but
   the site’s Pages Functions D1/R2 runtime is not running locally with a
   disposable state.
2. **No local/preview webhook signing secret** (`STRIPE_TEST_WEBHOOK_SECRET`) is
   configured. Stripe CLI forwarding could supply a temporary secret, but it
   must be connected to an isolated Pages runtime, not production.
3. **No Google Calendar credentials** are present locally
   (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`,
   `GOOGLE_CALENDAR_ID`). Calendar synchronization cannot be truthfully verified
   without them.
4. **No Resend credentials** are present, so customer notification delivery is
   intentionally not attempted.
5. Production test mode is deliberately blocked by the application; running
   there would violate the isolated-testing requirement.

The parts that do not need those external bindings are verified by the real
Stripe runs and the automated tests. A full site acceptance run requires an
isolated runtime with a disposable D1/R2 and a test webhook endpoint.

## No production impact

- No live Stripe key was used.
- No real charge, capture, refund or customer notification occurred.
- No production D1/R2 write, deployment or activation occurred.
- No Stripe secret is recorded in this document, the repository or logs.


## Cloudflare bindings audit — 2026-11-22

Inspected via the authenticated Cloudflare API. Values were not recorded.

### Production environment

`STRIPE_SECRET_KEY`, `STRIPE_TEST_SECRET`, `STRIPE_WEBHOOK_SECRET`,
`GOOGLE_CALENDAR_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REFRESH_TOKEN`, `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are present.
Production has D1 `sparkling-standard-operations` and the production R2
`DOCUMENTS_BUCKET` / `PHOTOS_BUCKET`.

**Critical configuration issue:** `GOOGLE_CLIENT_SECRET` is stored as
`plain_text`, not `secret_text`. It was returned by the Cloudflare API during
this inspection. The exposed value must be rotated and re-entered as a
`secret_text` binding before any further Google Calendar testing. Do not use the
exposed value.

### Preview environment

- `STRIPE_TEST_SECRET` is **not** present in Preview.
- `PUBLIC_SITE_URL` is **not** present in Preview.
- **No D1 binding is configured for Preview.**
- Preview `DOCUMENTS_BUCKET` and `PHOTOS_BUCKET` point at the
  **production** R2 buckets.
- Google and Resend secrets are present in Preview, but they are not a
  dedicated test calendar or test-recipient configuration.

**Conclusion:** the existing Preview environment is not isolated. Running the
site journey there would risk production R2 data and would not have a working
D1. It must not be used for the E2E acceptance run until disposable D1/R2
resources are bound to Preview and the test-specific bindings are added.

### What this means

The credentials are not missing. The blocker is that the preview/deployment
configuration is not yet an isolated test runtime. The production Google client
secret also requires rotation because of its plain-text storage.
