# Sparkling Standard infrastructure checkpoint - 2026-10-30

This is the authoritative record of infrastructure the owner already created and configured.
It exists so future engineering sessions do not ask the owner to recreate services or re-add
existing secrets. No credential values belong in this file.

## Production website and repository

- Repository: `Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning`
- Production branch: `main`
- Public domain: `https://sparkling-standard.com`
- Cloudflare Pages project: `sparkling-standard-cleaning`
- Cloudflare account: owner account `owner@sparkling-standard.com`
- Existing GitHub-connected Pages deployment is authoritative. Preserve it; do not replace it with
  an unrelated Pages project or deployment mechanism.
- Verified production admin code release at this checkpoint: `cbd4b96`; deployment
  `b19620e8-2cc9-45fc-b046-f8aa3e8a1575`.
- Documentation checkpoint: `d6fa22e`; deployment
  `e34023d5-d8ee-4769-b556-941038e0b3d3`.
- The prior customer Pay Now fix remains included: release `48930a0`, deployment
  `c067b24b-968a-4fae-95c3-59925cef5fc2`.

## Cloudflare D1

- Database name: `sparkling-standard-operations`
- Database ID: `82af5623-e4a0-48c5-b5da-b3aea5e84105`
- Remote database was created before migrations and initially contained only the Cloudflare
  internal table.
- Pages production binding exists with variable name `DB`.
- Remote migrations `0001`-`0010` were applied on 2026-10-30.
- Verified remote state after migration:
  - migration records: `10`
  - business tables plus Cloudflare internal table: `54` (`53` migrated tables)
  - branches: Pensacola active, Tampa Bay future/inactive
  - foreign-key violations: `0`
- Pre-migration and post-migration exports were downloaded to a private temporary location. The
  post-migration export restored independently with `53` tables (`plus Cloudflare internal metadata`),
  `10` migrations, both branches and no foreign-key violations.

## Verified production secret names

Present in the Pages production environment; values are encrypted and were not read or copied:

`ADMIN_SETUP_CODE`, `BOOKING_OWNER_TOKEN`, `GIFT_ADMIN_SETUP_CODE`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CALENDAR_ID`, `GOOGLE_REFRESH_TOKEN`, `MFA_ENCRYPTION_KEY`, `PHOTO_OWNER_TOKEN`,
`RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `ROUTES_API_KEY`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `TRAVEL_ORIGIN`, `WEB3FORMS_ACCESS_KEY`.

`ADMIN_SETUP_CODE` becomes unusable once the owner exists. `GOOGLE_CLIENT_SECRET` is a working
environment value even though it is not shown in the secret listing; production
`/api/booking-status` reports it configured.

`GOOGLE_CLIENT_SECRET` is not shown in the Pages secret listing but is present as a working
environment value: the production booking-status endpoint reports
`configured.GOOGLE_CLIENT_SECRET: true`.

Presence of a secret name is not proof that the value is valid for every operation. See the
integration checks below.

## Integration status

### Google Calendar

Production `/api/booking-status` reports all required Google values configured, the booking store
configured, calendar connected to **Sparkling Standard - Bookings**, timezone `America/Chicago`, and
event reads succeeding. Do not create a second calendar. Do not create or modify real customer
events for testing.

### Stripe

- Existing customer-facing Pay Now checkout is operational in production.
- Neither the production Stripe secret nor webhook secret was replaced by test credentials.
- Administrative invoice payment links, refunds, saved-card setup and off-session charging exist in
  the code behind separate environment gates and require test-mode validation before activation.
- Public checkout access was accidentally reported as missing because the confirmed-address finder
  reset its UI state on Continue. Commit `48930a0` fixed that; production exact-address mobile and
  desktop checks show the green Pay Now action.

### Resend

`RESEND_API_KEY` is present in production. Invitation/reset email code reuses Resend and returns the
one-time link even when delivery fails. Live delivery to a controlled owner address remains to be
recorded after activation.

### R2 and existing ledgers

`PHOTO_OWNER_TOKEN` is present; existing photo/payment/gift R2 ledgers remain authoritative. No
historical ledger was overwritten or deleted. Gift and booking reconciliation tooling can generate
reviewable D1 SQL from exported R2 JSON without connecting to production R2.

## Owner password recovery (2026-10-30)

The owner's reset link failed with **Reset Invalid**. Production D1 was inspected read-only:

- two reset rows existed for the owner account, both created 2026-10-30 19:03 UTC;
- both had a 60-minute expiry (20:03 UTC) and neither had been used;
- the inspection happened after that expiry, so the tokens were **expired**, not consumed and not
  from another environment;
- both rows were marked used and the outstanding count is now zero. The reset token shown in the
  owner's screenshot is therefore invalid.

The production console now has a self-service **Forgot Password?** flow: generic responses that do
not reveal account existence, 30-minute single-use hashed tokens, per-IP and per-address rate
limits, same-origin checks, session revocation after a successful reset, and a branded Resend email
that links straight to the password-setting page. Password rules are owner-directed: **at least 8
characters and one special character**, with no other complexity requirement. See
`docs/operations/ADMIN-USER-GUIDE.md`.

## Outstanding work

- Admin code is deployed; production `/api/admin/auth` reports `configured: true` and
  `setupRequired: false`, confirming the `DB` binding. The owner account
  `owner@sparkling-standard.com` is enrolled with the owner role. The owner must personally set the
  final password through the new Forgot Password flow; no developer-generated password exists.
  MFA enrollment remains owner-controlled in Settings.
- Remote D1 contains two backfilled pending booking requests with their original references and
  locations. No customer, lead, gift or completed payment record existed in R2 to import.
- Run Stripe test-mode verification without live money after a rotated test-mode key is available
  locally (`npm run stripe:sandbox`). No test key is present today.
- Run the live Google Calendar write lifecycle with `node scripts/booking-live-test.mjs` from an
  owner terminal (masked token prompt, typed confirmation, synthetic event, automatic cleanup).
  Read/availability verification is complete; write verification is not.
- Record live Resend delivery to an owner-controlled address (the reset flow will do this).
- Backfill/reconcile R2 historical customer/lead/payment data only after export and review.
- Enable live administrative Stripe gates only after test-mode authorization/consent validation.

## Safe verification commands

```powershell
npx wrangler whoami
npx wrangler d1 list
npx wrangler pages secret list --project-name sparkling-standard-cleaning
npx wrangler d1 migrations list sparkling-standard-operations --remote --config wrangler.remote.toml
```

Read-only production health checks:

```powershell
Invoke-RestMethod https://sparkling-standard.com/api/booking-status
Invoke-RestMethod https://sparkling-standard.com/api/admin/auth
```

`/api/admin/auth` must be checked only after the admin deployment.

## Deployment and rollback

1. Verify `git status`, current `main`, and `origin/main`.
2. Run `npm run verify`, `npm test`, and `npm run test:browser`.
3. Export D1 before any migration: `npx wrangler d1 export sparkling-standard-operations --remote --config wrangler.remote.toml --output <private-file>`.
4. Apply only committed migrations: `npx wrangler d1 migrations apply sparkling-standard-operations --remote --config wrangler.remote.toml`.
5. Verify migrations, table count, branches and `PRAGMA foreign_key_check`.
6. Deploy through the existing GitHub `main` integration; do not create a competing Pages project.
7. Roll back application code by reverting to the prior production commit; do not reset or destroy D1 data.
8. Restore data only from the pre-change export after preserving the failed state for investigation.

## Do not repeat

Do not ask the owner to create another D1 database, add the `DB` binding again, create another Google
calendar, recreate Stripe, Resend or Cloudflare accounts, or re-upload already-present secrets.

## 2026-10-30 operations expansion

- **Remote D1 migrations 0011 and 0012 applied** after a verified pre-migration export to a private
  temporary location. They add booking notification/decline/proposal fields and the employee
  timekeeping tables (team pay rates, rate history, time events, intervals, correction requests and
  correction history). Both are additive. Production now has **12 migrations**; no foreign-key
  violations were introduced.
- **Stripe sandbox verification passed 23/23 against the real test API** using the rotated test-mode
  key in the ignored local `.env`: test customer, attached test card, invoice finalisation/payment,
  invoice refund, SetupIntent/saved card, off-session charge and refund, the repository's own
  checkout-link/reconciliation/refund helpers, duplicate-delivery idempotency, webhook signature
  acceptance and tamper rejection, missing-authorization rejection and cleanup. No live money moved.
- **Booking request management** now opens every request, links or creates a verified customer,
  flags possible duplicates, and supports confirm/propose/decline/reschedule/cancel with branded
  customer emails and per-request delivery history.
- **Admin gift management** exposes ledger details, search/filter and invoice-linked partial
  redemption. The R2 ledger remains authoritative; the invoice payment uses provider `external`
  with gift metadata and a retry-safe reference.
- **Employee portal** at `/employee/` uses the existing account/session/role system, links to the
  existing team-member roster, and enforces the three-day job window and one-open-interval rule on
  the server. A completed real gift Checkout, a live gift webhook and a live Google Calendar write
  remain unverified; see the relevant operation documents.
