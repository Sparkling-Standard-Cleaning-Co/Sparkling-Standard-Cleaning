# Stripe test-mode payment acceptance requirements

**Status:** blocked by owner-provided test-mode credentials. The abandoned live
Checkout Session is not a completed payment test and must never be reported as one.

## Why this cannot be completed from the repository alone

Production uses a live Stripe key. The code deliberately refuses to use live keys
on a non-production origin and refuses to use test keys on the production origin
(`src/lib/payments/stripe-secret.ts`). A completed acceptance test therefore needs
a separate non-production runtime.

## Exact owner-provided configuration

Provide these only in the staging/Preview or local environment. Never paste them
into Git, a report, a screenshot or a public message.

| Requirement | Exact value / action |
| --- | --- |
| Stripe test secret key | `STRIPE_TEST_SECRET=sk_test_...` (or a restricted `rk_test_...`). A live `sk_live_...` is rejected by the test guard. |
| Test webhook signing secret | `STRIPE_TEST_WEBHOOK_SECRET=whsec_...` from the test-mode webhook endpoint below. |
| Non-production origin | Set `PUBLIC_SITE_URL` to the exact staging/Preview origin, e.g. `https://<preview-host>` or `http://localhost:4321`. The origin must not equal `https://sparkling-standard.com`. |
| Webhook endpoint | Create/enable a Stripe **test-mode** endpoint at `<non-production-origin>/api/stripe-webhook`. It must subscribe to `checkout.session.completed` and `checkout.session.expired` (the readiness probe requires at least `checkout.session.completed`). |
| Ledger binding | The test runtime must have the normal private ledger/R2 binding used by the checkout code. |
| Notification key | `WEB3FORMS_ACCESS_KEY` must be present for the readiness probe and the server-side owner notification path. |
| Customer contact for the test | A synthetic test identity; never a real customer. |
| Test card | Stripe test card `4242 4242 4242 4242`, any future expiry and any CVC, entered only on the Stripe-hosted test Checkout page. |

The existing variables `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` remain the
production secrets. Do not put test values into those production variables.

## Required acceptance sequence

1. Deploy the staging/Preview runtime with the test variables above.
2. Confirm `GET /api/estimate-checkout` returns `ok:true`, `enabled:true`,
   `mode:"test"`, and `checks.stripe_key`, `checks.webhook_secret`,
   `checks.webhook_endpoint`, `checks.ledger`, `checks.notification`,
   `checks.mode_allowed` are all true.
3. Submit a synthetic residential quote through the real estimator and Pay Now.
4. Pay with the Stripe test card; do not use a live card.
5. Verify the Stripe test webhook receives `checkout.session.completed` with
   `payment_status=paid`.
6. Verify the server creates exactly one paid/confirmed booking, one calendar
   event, one receipt delivery attempt and no duplicate webhook side effects.
7. Replay the webhook and verify idempotency.
8. Cancel/expire a second test session and verify it does not confirm a booking.
9. Record the test-mode session ID privately; never record the customer card.

## Current evidence

- Production readiness probe: `enabled:true`, `mode:"live"`, all checks true.
- Local `.env`: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are empty.
- The previously observed live Checkout Session was not completed and is not
  evidence of payment acceptance.
- No customer charge, booking or email was created during this verification.

Until the owner provides the four test-mode configuration items above, a completed
payment acceptance test is **blocked by an unavoidable owner action**, not by a
code defect.
