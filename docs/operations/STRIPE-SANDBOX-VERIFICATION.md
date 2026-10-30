# Stripe sandbox verification

**Status (2026-10-30): tooling ready; live sandbox run blocked by an unavailable test key.**

Production customer Pay Now remains operational in live mode (`/api/estimate-checkout` reports
`enabled: true`, `mode: "live"`, all readiness checks true). No live charge, live refund or
administrative charge was performed during this work.

> **Credential rule:** a sandbox secret key and a webhook signing secret are different values.
> `STRIPE_SECRET_KEY` (`sk_test_...`) authenticates API calls. `STRIPE_WEBHOOK_SECRET`
> (`whsec_...`) verifies webhook signatures. Neither belongs in Git, a screenshot, a chat message or
> the production environment as a test value.

## Why this exists

The administrative billing code (invoice payment links, refunds, saved-card setup and after-service
charging) is implemented and mock-tested but has never been exercised against the real Stripe test
API. Mocked tests are not integration verification. This tool closes that gap without risking real
money.

## The exact owner action

1. Open the Stripe Dashboard and switch to **Test mode**.
2. Create or rotate a **test-mode secret key** so the exposed key from the previous session is no
   longer used.
3. Open this file in a text editor:

   ```text
   C:\Users\thoma\Downloads\Sparkling-Standard-Master\01_WEBSITE_REPOSITORY\.env
   ```

   (While the repository still lives in Documents, the same file is
   `C:\Users\thoma\Documents\Sparkling-Standard-Master\01-Website-Repository\.env`.)

4. Paste the new key after the equals sign on the line that begins `STRIPE_SECRET_KEY=`.
   The file already exists, is ignored by Git and contains the owner's existing local values.
5. If webhook replay will be tested, run `stripe listen --forward-to localhost:4321/api/stripe-webhook`
   and paste the printed `whsec_...` after `STRIPE_WEBHOOK_SECRET=`.
6. In a terminal at the repository root run:

   ```powershell
   npm run stripe:sandbox
   ```

The script refuses any key that does not start with `sk_test_` or `rk_test_`, never prints the key,
creates only synthetic test-mode objects, and deletes its test customers when finished. It never
connects to the production D1 database.

## What the script verifies against the real Stripe test API

- Test customer creation and deletion.
- Invoice line item, invoice creation, finalisation and card payment using `pm_card_visa`.
- Refund creation against the test payment intent.
- Saved-card SetupIntent with an off-session usage flag, and retrieval of the saved card brand and
  last four digits.
- Off-session PaymentIntent charge and refund.
- The repository's `createInvoicePaymentLink()` against a real Checkout Session, and reading the
  session back.
- `applyInvoiceCheckoutPayment()` reconciliation into an in-memory SQLite database built from the
  committed migrations, including duplicate-delivery idempotency and a zero balance.
- `refundStripePayment()` against the real test payment.
- Cash/check payment recording and balance reconciliation.
- Webhook HMAC signature acceptance, tamper rejection and wrong-secret rejection using
  `verifyStripeSignature()`.
- Missing authorization rejection and the disabled off-session gate.

It does **not** prove a real webhook *delivery*. That requires Stripe CLI forwarding (or a deployed
endpoint plus the real webhook secret) and is documented separately.

## Recorded result

| Item | Result |
| --- | --- |
| Test key available locally | **No** — `.env` placeholders are empty |
| Real Stripe test API contacted | **No** |
| Script preflight (refuses missing/live keys) | Verified |
| Mocked/unit billing coverage | Passing in `npm test` |
| Production public Pay Now | Live and ready (read-only check) |

This is a genuine credential blocker, not a code failure. When the key is supplied, the script
produces the evidence needed to decide whether the administrative gates may be enabled.

## Production gates

These server flags stay unset/`false` until the sandbox run passes and the owner approves activation:

- `ADMIN_STRIPE_BILLING_ENABLED`
- `ADMIN_STRIPE_REFUNDS_ENABLED`
- `ADMIN_STRIPE_SAVED_CARDS_ENABLED`
- `ADMIN_STRIPE_OFF_SESSION_ENABLED`

Setting them in the local `.env` affects only local scripts. Changing production requires an
explicit owner decision in Cloudflare Pages.

## Webhook replay (after the key is available)

```powershell
stripe login
stripe listen --forward-to localhost:4321/api/stripe-webhook
# copy the printed whsec_... into .env as STRIPE_WEBHOOK_SECRET
stripe trigger checkout.session.completed
stripe trigger payment_intent.succeeded
```

Confirm:

1. The endpoint returns 200.
2. A replayed event returns 200 without duplicating the payment.
3. A tampered signature returns 400.
4. An event with an unknown session is ignored safely.

Never point the CLI at production with a test-mode key, and never replace the production
`STRIPE_WEBHOOK_SECRET`.
