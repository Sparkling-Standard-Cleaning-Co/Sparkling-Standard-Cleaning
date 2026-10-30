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
- Verified production release at this checkpoint: `48930a0`; deployment
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

`BOOKING_OWNER_TOKEN`, `GIFT_ADMIN_SETUP_CODE`, `GOOGLE_CALENDAR_ID`, `GOOGLE_CLIENT_ID`,
`GOOGLE_REFRESH_TOKEN`, `MFA_ENCRYPTION_KEY`, `PHOTO_OWNER_TOKEN`, `RESEND_API_KEY`, `ROUTES_API_KEY`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TRAVEL_ORIGIN`, `WEB3FORMS_ACCESS_KEY`.

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

## Outstanding work

- Admin code is deployed; first-owner enrollment via the server setup code is the remaining account step.
- Verify the production `DB` binding through `/api/admin/auth`.
- Run Stripe test-mode verification without live money after a test-mode key is available locally.
- Test real Google Calendar writes only against an isolated test calendar or after explicit owner
  approval; current verification is read-only.
- Record live Resend delivery to an owner-controlled address.
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
