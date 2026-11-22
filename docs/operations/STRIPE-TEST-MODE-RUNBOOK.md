# Stripe Test-Mode Runbook — Controlled Release Acceptance

**Status:** prepared but not executed. The local `.env` currently has no Stripe
secret value. No test-mode or live Stripe request was made during the
2026-11-22 release-acceptance work.

## Safety boundary

- Use only a **test-mode** key (`sk_test_...` or `rk_test_...`).
- Never place a live key in `.env`, this repository, chat, or a report.
- The scripts refuse non-test keys before sending any request.
- Use only synthetic names, emails, addresses and phone numbers.
- Do not use a real customer card. Stripe's documented test card tokens are
  acceptable only inside Stripe test mode.
- No production deployment, D1 mutation or real charge is part of this run.

## A. API-level Checkout verification (script)

This proves the test-mode key can create, replay idempotently, retrieve and
expire the same Checkout Session primitive used by the site. It creates no
charge.

1. In the owner-only local environment, put a rotated test key in `.env`:

```text
STRIPE_SECRET_KEY=sk_test_...
```

2. Run:

```powershell
npm run stripe:checkout-sandbox
```

3. Expected results:
   - `PASS synthetic customer created`
   - `PASS test-mode Checkout Session created`
   - `PASS hosted Checkout URL returned`
   - `PASS idempotent replay returned the same session`
   - `PASS session retrieved`
   - `PASS session expired without payment`
   - `Cleanup: synthetic customer deleted.`
   - `No card was entered and no charge was created.`

4. Remove the test key from `.env` after the run unless it is needed for the
   next controlled test.

## B. Full site checkout verification (requires a preview environment)

The site's quote/hold/signing/checkout path additionally requires:

- A Cloudflare Pages preview or local Pages Functions runtime with the test-mode
  `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
- A private R2 ledger binding (`PAYMENT_LEDGER` or `PHOTOS_BUCKET`).
- A preview/test D1 database with the migrations applied. Never point a test
  run at production D1.
- A synthetic booking hold and a server-verifiable synthetic quote.
- A test-mode webhook endpoint reachable by Stripe, or the Stripe CLI
  `stripe listen --forward-to <preview>/api/stripe-webhook`.

### Recommended synthetic journeys

1. Deep Cleaning: open checkout, complete test payment, confirm one booking,
   one receipt path and no duplicate.
2. Initial Deep Cleaning + recurring: verify the first-visit and ongoing prices
   are distinct and only the first visit is charged at checkout.
3. Move-In / Move-Out and STR: verify the service-specific agreement scope,
   one-time pricing and no recurring rhythm.
4. Commercial / church: verify facility checkout, the 10% church discount where
   eligible, and the separate commercial key-custody authorization.
5. Failed payment: use a Stripe test decline token; verify the request is
   retained, no booking is confirmed, and retry creates a fresh attempt.
6. Interrupted checkout: close the browser after session creation; verify the
   same session is reused and no second booking/payment is created.
7. Webhook replay: resend the same `checkout.session.completed` event; verify
   one primary payment claim, one confirmation and no duplicate calendar event.
8. Expired hold: expire the hold before resuming; verify
   `booking_hold_expired` and no Stripe call.
9. Expired signing intent: wait 60 minutes or expire the ledger record; verify
   `resume_expired` and no Stripe call.

## C. Owner approval required

Running the above needs the owner to:

1. Supply or rotate a **test-mode** Stripe secret key for the controlled run.
2. Supply the matching test-mode webhook signing secret if webhook replay is
   included.
3. Authorize use of the test-mode key with a preview/test D1/R2 environment.
4. Confirm no live-mode key or production database is used.

## D. What is already proven without Stripe access

The repository's unit and browser suites prove with stubs:

- server-side price verification before Stripe;
- pre-payment document gate and signing resume;
- exactly one Stripe session on first resume and reuse on repeat;
- expired hold rejected before a Stripe call;
- expired 60-minute checkout intent rejected before work;
- checkout slot/idempotency and duplicate-payment protections;
- webhook replay handling in the existing payment-webhook tests;
- no duplicate booking in the existing D1 projection tests.

Those stubs are not a substitute for the real test-mode run above.
