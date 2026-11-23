# Controlled Release Runbook - 2026-11-23

**Release:** signing, document admin, mobile and notifications
**Branch:** `release/2026-11-22-legal-signing-acceptance`
**Release commit:** `12d6123`
**PR:** https://github.com/Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning/pull/5
**Target:** `production-safe`
**Status:** prepared only. No merge, production deployment or production migration has been performed.

## Current production baseline

- Live production deployment: `faaedb33-4588-413d-bba6-3bb85da88eac`
- Source commit: `3e48739`
- Runtime deployment still present: `344ad883-c87a-4baf-b0f4-f34eef27988c` (`5c4ac41`)
- Documented prior rollback deployment: `4ea44ba4-20e8-45ac-961c-e9ab3dbb8b73` (`717efe5`)

## CI

PR #5 checks on `12d6123`:

- `validate`: pass (run `45102493446`)
- `browser`: pass, 257/257 (run `45102493446`)

Local final verification also passed: 1,046 tests (1,045 pass, 1 pre-existing skip), 257/257 browser,
0 Astro errors, 40 pages, validation and 21-page smoke.

## Pre-deployment backup

Fresh encrypted archive (not uploaded to OneDrive in this pass):

`C:\Users\thoma\Downloads\SPARKLING STANDARD - MASTER\08 BACKUPS & ARCHIVE\PRE-DEPLOY-2026-11-23\sparkling-standard-backup-2026-11-23T02-59-46.ssbk`

- SHA-256: `48125041a1586fdf0b7fc5451917b127d07d1606682aaca2f3f5b068d5185d60`
- 2,382 files / 394,620,010 plain bytes
- AES-256-GCM with the DPAPI-protected backup key
- Fresh D1 export verified: integrity `ok`, 96 tables, 0 foreign-key violations, 1 signing request
- Archive verified and restored to an isolated temporary directory: 2,382 files
- Unencrypted D1 export deleted after verification
- Evidence: `08 BACKUPS & ARCHIVE\PRE-DEPLOY-2026-11-23.md`

Owner action if off-machine redundancy is required before deployment: run the existing OneDrive
upload with `scripts/backup/local-scheduled.ps1` or upload this archive manually. Do not weaken the
encryption requirement.

## Production email verification (already performed)

Production `admin_settings` has no stored Communications override, so approved default routing is
active. Controlled test messages were sent through the production Worker to:

- `booking@sparkling-standard.com`
- `admin@sparkling-standard.com`
- `owner@sparkling-standard.com`
- `customer-service@sparkling-standard.com`

All four returned HTTP 200 and were accepted by Resend with stored message IDs. No provider failure
or missing routing was observed. Bounce/delivered confirmation is not ingested by the application;
owner inbox confirmation remains required. The temporary test session was deleted.

## Migration 0052

`migrations/0052_signing_customer_fields.sql`:

- Adds `signing_requests.customer_fields_json TEXT NOT NULL DEFAULT '{}'`.
- Adds a non-unique supporting index.
- Contains no `DROP`, `DELETE`, `TRUNCATE`, backfill or destructive statement.
- Validated against an exported copy of production D1: all row counts unchanged; existing signing
  request and executed hash preserved; integrity `ok`; 0 foreign-key violations.
- Not applied to production.

Apply only inside the owner-authorized deployment window, after the pre-deployment backup:

```
npx wrangler@4 d1 execute sparkling-standard-operations --remote --file migrations/0052_signing_customer_fields.sql
```

Verify:

```
npx wrangler@4 d1 execute sparkling-standard-operations --remote --command "PRAGMA table_info(signing_requests);"
npx wrangler@4 d1 execute sparkling-standard-operations --remote --command "SELECT COUNT(*) AS signing_requests FROM signing_requests;"
```

## Deployment sequence

1. Obtain the owner's explicit authorization for this release and the `0052` migration window.
2. Record the current production deployment and confirm the pre-deployment backup hash.
3. If off-machine redundancy is required, upload the encrypted archive and verify the upload hash.
4. Apply migration `0052` and verify the new column/default/index.
5. Merge PR #5 into `production-safe` (no squash if the release history must preserve the reviewed
   commits; follow owner preference). This triggers the Cloudflare Pages production deployment.
6. Record the new production deployment ID and source commit from Cloudflare Pages.
7. Run the post-deployment checks below.
8. If a critical defect appears, roll back Cloudflare Pages to
   `faaedb33-4588-413d-bba6-3bb85da88eac`. The additive migration can remain in place; do not drop
   the column or restore D1 unless there is actual data corruption.

## Post-deployment checks

- `https://sparkling-standard.com/` loads; no preview/read-only gate on production.
- Admin sign-in works; Documents & Agreements shows the seven subviews.
- Send for Signature loads customer search and does not require raw IDs.
- Document Library and Packets show approved counts; empty packets are not selectable.
- A controlled Communications test reaches the selected department inbox (owner present).
- Public `/document-sign/` page loads; a real customer signing request is not sent without owner
  approval.
- Portal sign-in and dashboard load without horizontal overflow at 390px.
- Employee portal loads at 390px.
- No Stripe charge, refund, customer email or document request is created by the smoke checks.
- Cloudflare function errors, Resend failures and D1 errors are reviewed after the first 15 minutes.

## Rollback

- **Code:** Cloudflare Pages rollback to `faaedb33-4588-413d-bba6-3bb85da88eac`.
- **Migration:** no reverse migration. The added column is nullable-by-default `'{}'` and unused by
  the old code, so leaving it is safe. Do not drop it during an incident.
- **Data:** restore only from the verified encrypted archive and only under the documented recovery
  procedure. Never import an unverified archive over production.
- **Email:** if a routing defect is found, disable the affected department in Communications before
  retrying; critical Admin/Owner alerts cannot be disabled.

## Not authorized by this runbook

- Production deployment or merge.
- Applying migration `0052`.
- Live Stripe charges/refunds.
- Customer or bulk email.
- Commercial/facility packet activation or facility online payment.
- Tampa activation.
