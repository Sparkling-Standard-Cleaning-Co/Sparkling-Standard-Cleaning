# Stripe Sandbox Access Verification — 2026-11-22

**Status:** `STRIPE_TEST_SECRET` is configured in Cloudflare, but its value is
encrypted and cannot be read by this local environment. No test-mode transaction
or charge was made.

## What was verified

- Cloudflare Pages project: `sparkling-standard-cleaning`.
- `npx wrangler pages secret list --project-name sparkling-standard-cleaning`
  reports **`STRIPE_TEST_SECRET`** in the production environment (name only;
  values are encrypted and never displayed).
- No Cloudflare **Preview** environment is configured for this project
  (`docs/deployment/DEPLOYMENT.md` records the owner decision not to use previews).
- Local environment checks:
  - `STRIPE_TEST_SECRET` absent from Process, User and Machine scope.
  - `.env` does not contain `STRIPE_TEST_SECRET`.
  - `.dev.vars` does not exist.
- `npm run stripe:checkout-sandbox` therefore exits `2` with
  `MISSING STRIPE TEST KEY`. Nothing was sent.

## Code adaptation completed

- New `src/lib/payments/stripe-secret.ts`:
  - production uses only `STRIPE_SECRET_KEY`;
  - local/preview prefers `STRIPE_TEST_SECRET`;
  - local/preview rejects a live-only key;
  - a test-mode `STRIPE_SECRET_KEY` remains accepted for backward compatibility.
- `functions/api/estimate-checkout.ts` uses the resolver.
- `functions/api/stripe-webhook.ts` uses the resolver for saved-card setup.
- `scripts/stripe-checkout-sandbox.mjs` and `scripts/stripe-sandbox-verify.mjs`
  read `STRIPE_TEST_SECRET` first.
- Unit tests cover production/test separation and local live-key rejection:
  `tests/stripe-secret-selection.test.ts`.

## Why real test-mode E2E could not run

Cloudflare secrets are write-only. There is no API or CLI operation that returns
the `STRIPE_TEST_SECRET` value. This checkout has no local copy and no preview
environment containing it. Running against production would violate the
requirement to keep testing isolated and is explicitly blocked by the
production test-mode gate.

## Safe ways to unblock the real sandbox run

**Option A — local isolated sandbox (recommended):**
1. Put the rotated test secret in the local, git-ignored `.env` or `.dev.vars`:
   `STRIPE_TEST_SECRET=sk_test_...`
2. Add a test webhook signing secret for the local forwarding endpoint:
   `STRIPE_TEST_WEBHOOK_SECRET=whsec_...` (or `STRIPE_WEBHOOK_SECRET`).
3. Set `PUBLIC_SITE_URL=http://localhost:4321`.
4. Run `npm run dev` and `stripe listen --forward-to localhost:4321/api/stripe-webhook`.
5. Run a test-mode checkout with Stripe test instruments only.
6. Never paste the key into chat or commit it.

**Option B — isolated Cloudflare preview/staging:**
1. Create a temporary preview/staging environment (not production).
2. Enter `STRIPE_TEST_SECRET` and the test webhook secret in that environment.
3. Deploy the release candidate to the isolated environment only, with owner
   authorization.
4. Run the test-mode journey and delete/void synthetic records afterward.

Do not copy the test secret into the production environment behavior. The
production resolver uses `STRIPE_SECRET_KEY` only.

## Current acceptance position

- Real Stripe test-mode E2E: **not executed — blocked by secret-value access**.
- Existing live $5 invoice payment: verified for invoice/webhook/reconciliation
  only.
- Signing → executed PDF: verified in staging.
- Signing/payment/checkout logic: **48/48 targeted tests pass**; full unit
  **1,016 tests, 1,015 pass, 1 pre-existing skip, 0 fail**; browser **248/248
  pass**.
- No live charge, no customer notification, no production deployment.
