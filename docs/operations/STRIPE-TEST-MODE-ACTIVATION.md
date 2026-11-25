> **Release note (2026-11-22):** test mode is **not** a mandatory release gate.
> A live $5 invoice payment has already been verified. See
> `docs/verification/2026-11-22-STRIPE-5-DOLLAR-VERIFICATION.md`. No further
> test or live charge is authorized without explicit owner approval.

# Stripe Test-Mode Activation

**Status:** test-mode credentials are not configured in this checkout. No test
Checkout Session, payment, webhook, refund or live charge has been made.

Never paste a secret key, webhook secret or card number into chat, a commit, a
document or a support message.

## Local test-mode setup

1. In the Stripe Dashboard, switch to **Test mode**.
2. Open **Developers → API keys** and copy the test secret key beginning
   `sk_test_` (or a restricted test key beginning `rk_test_`).
3. Put it only in the local, git-ignored `.env`:

   ```text
   STRIPE_TEST_SECRET=sk_test_...
   ```

4. Start the local site:

   ```powershell
   npm run dev
   ```

5. Forward test webhooks to the local function:

   ```powershell
   stripe listen --forward-to localhost:4321/api/stripe-webhook
   ```

6. Copy the `whsec_...` signing secret printed by the Stripe CLI into `.env`:

   ```text
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

7. Verify the key and Checkout primitive without a charge:

   ```powershell
   npm run stripe:checkout-sandbox
   ```

   This script refuses live keys, creates only a synthetic test customer and an
   unpaid Checkout Session, proves idempotent replay, expires the session and
   deletes the synthetic customer.

## Preview-environment setup

Cloudflare secrets are write-only; a secret configured in the Cloudflare project
cannot be read back into a local shell. For a local run, use `.env` or
`.dev.vars`. For a preview run, use Cloudflare Pages **Preview** environment
variables, never the Production environment:

- `STRIPE_TEST_SECRET` = test-mode secret key
- `STRIPE_TEST_WEBHOOK_SECRET` = signing secret for the preview webhook endpoint
- `PUBLIC_SITE_URL` = the preview origin

Create a separate Stripe test-mode webhook endpoint pointing to:

```text
https://<preview-host>/api/stripe-webhook
```

The application deliberately refuses test-mode checkout on the production host.
Test-mode is for local/preview only.

## Full test-mode acceptance sequence

1. Complete a real estimate in the preview environment.
2. Select a real temporary appointment hold.
3. Complete the approved agreement packet and electronic signature.
4. Confirm the executed PDF is generated and privately stored.
5. Reach Stripe Checkout with a test card (`4242 4242 4242 4242`, any future
   expiry, any CVC).
6. Confirm the signed webhook is accepted and the booking is confirmed.
7. Verify the customer/admin records, executed document and notification.
8. Replay the same checkout attempt and confirm no duplicate charge or booking.
9. Simulate a declined test card and confirm the retry/failed-payment state.
10. Verify the customer can retrieve the executed document.

## Evidence required

Record:

- Stripe test-mode session ID prefix and `livemode: false` (never full card data)
- webhook event IDs and verification result
- booking reference and resulting status
- executed document SHA-256 and retention location
- duplicate-prevention result
- failed-payment recovery result
- any deviation from the expected sequence

A stubbed test is not an acceptance test. Only a real test-mode transaction with
signed webhook delivery counts.
