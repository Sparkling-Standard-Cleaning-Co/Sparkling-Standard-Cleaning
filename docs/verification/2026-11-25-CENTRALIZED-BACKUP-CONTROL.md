# Centralized Backup and Disaster Recovery Control — 2026-11-25

## Release identity

- Starting HEAD: `2f7e96d`
- Application HEAD: `3881a8f`; final HEAD: `cf75d0b` (documentation only)
- Branch: `production-safe` (and `main`, identical at `cf75d0b`)
- Cloudflare Pages application deployment: `9b6f5cd7` (production, source `3881a8f`); final docs deployment: `83bdb913` (source `cf75d0b`)
- Backup Worker: `https://sparkling-standard-backup-scheduler.owner-e75.workers.dev`
- Worker code version: `4824f6f4-0f37-4ce8-853d-04e4ef45877d`
- CI: `45688412800` (validate + browser, green)

## What was built

The existing Admin → Data & Storage screen is now the centralized backup control center. The owner does not need to open GitHub Actions, Cloudflare or OneDrive for routine backup work.

- Owner-only, CSRF-protected and MFA step-up-protected admin API.
- Start complete (D1 + application R2 objects) or database-only backups.
- Background execution remains in GitHub Actions, so closing the admin page does not stop a job.
- Live status, operation/scope, timestamps, actual result, integrity evidence and actionable failures.
- Separate complete and database archive names and retention streams.
- Encrypted archive download through a short-lived signed owner link; the browser never receives the R2/GitHub/control credentials.
- Independent R2 and OneDrive verification.
- Isolated restore testing through the admin screen, using the existing encrypted archive and D1 verifier.
- Configurable daily/weekly/monthly schedule and retention in UTC through the Worker cron.
- Duplicate execution prevention: one partial unique D1 index allows only one queued/running job.

## Remaining infrastructure configuration

The seven existing repository secrets were preserved and were not overwritten.

Additional GitHub configuration set securely without printing values:

- Secret `BACKUP_ENCRYPTION_KEY` — reused the established owner DPAPI key.
- Secret `ONEDRIVE_CLIENT_ID`, `ONEDRIVE_REFRESH_TOKEN`, `ONEDRIVE_FOLDER`, `ONEDRIVE_CAPACITY_BYTES`.
- Secret `BACKUP_CONTROL_TOKEN` — shared only by the Worker, Pages and workflow callback.
- Variable `ONEDRIVE_TARGET_MODE=existing`.
- Variable `BACKUP_CONTROL_URL`.
- Variable `R2_APP_BACKUP=true` (legacy compatibility; the workflow now receives the scope explicitly).

Worker configuration:

- Secret `GITHUB_DISPATCH_TOKEN` — existing owner GitHub authorization, supplied without printing.
- Secret `BACKUP_CONTROL_TOKEN`.
- Bindings: production D1, `sparkling-standard-backups`, `sparkling-standard-documents`, `sparkling-standard-lead-photos`.

Pages configuration:

- Secret `BACKUP_CONTROL_URL`.
- Secret `BACKUP_CONTROL_TOKEN`.

Application R2 coverage initially failed with the existing `CLOUDFLARE_API_TOKEN` (`HTTP 403` while listing `sparkling-standard-documents`). It now runs through the Worker's private R2 bindings, so a broader Cloudflare token was not introduced. The successful complete run staged 227 files.

`OPS_ALERT_URL` / `OPS_ALERT_TOKEN` remain optional and unset. They affect external backup alerting, not the admin control center or job history.

**Security hardening:** the Worker currently uses the owner’s authenticated GitHub CLI token with repository/workflow access. For least privilege, rotate it to a fine-grained token limited to Actions on this repository. This is recommended hardening, not a routine-operation blocker.

## Acceptance evidence

A controlled temporary owner session was used to operate the live admin screen and was deleted immediately afterward. No owner password or permanent alternate login exists.

1. **Authenticated administrator initiated a database backup through Admin → Data & Storage.** The job completed successfully.
2. **Monitored completion through the admin screen.** History showed success, R2 verified, OneDrive verified, isolated restore passed and 106 tables integrity-checked.
3. **Downloaded the archive through the admin screen.** The complete application archive was 10,788,325 bytes and began with the encrypted `SSBA1` header, not plaintext SQL. The database archive was 2,896,443 bytes.
4. **Ran an isolated restoration test through the admin screen.** The restore job succeeded and remains visible with integrity evidence.
5. **Complete application backup.** GitHub run `45688502584` succeeded; archive
   `sparkling-standard-backup-2026-11-25T19-47-42-complete.ssbk`, 10,788,325 bytes, 227 files, SHA-256
   `3562dfb2d2bd56abb3d0cde6f0184007d39156591a58b251619006601c1799cd`; R2 and OneDrive independently verified; isolated restore passed at 106 tables and 60 migrations.
6. **Retention correction.** The first controlled complete archive was superseded by the old same-day retention rule before the fix. No business records were lost and the pre-existing 2026-11-21 archive remains. Complete and database backups now retain independently, and a fresh complete archive was created after the correction.

Screenshots:

- `backup-control-before.png`
- `backup-control-complete.png`
- `backup-control-restore-tested.png`

## Verification

| Check | Result |
| --- | --- |
| Unit (`npm test`) | 1,125 tests, 1,124 pass, 0 fail, 1 pre-existing skip |
| Browser (`npm run test:browser`) | 282/282 pass |
| `astro check` / build / validate | 0 errors, 41 pages, 2,631 links |
| Smoke | 21 pages |
| Live Worker overview | configured, archive list and schedule returned |
| Admin schedule form | live save succeeded and returned `Backup schedule saved.` |
| Live complete backup | success, R2 + OneDrive verified, isolated restore passed |
| Live restore test | success, 106 tables, 60 migrations |
| Production D1 | 62 migrations, 107 tables, foreign-key check clean |

## 2026-11-25 reconciliation and fresh archive

The earlier complete archive reported 106 tables / 60 migrations; production
reported 107 tables / 62 migrations. The backup verifier excludes SQLite
internal tables (`sqlite_%`), so 106 is the application-table count and the
manifest's 107 includes `sqlite_sequence`. The 60-migration count was captured
before migrations `0061` and `0062` were recorded.

A fresh complete backup (GitHub run `45706016953`) supersedes the earlier
complete archive for current recoverability evidence:

- `sparkling-standard-backup-2026-11-25T21-38-15-complete.ssbk`
- 10,793,311 bytes, 227 files, SHA-256 `6cff79a3214dbd0cf0165b3816afa213f01ba12761045e411dc8ef0fc7dd5db8`
- D1 export SHA-256 `83db19c826c0a7b0d54601e96191dab2db9e9af36e042549159106803aa10b53`
- 62 migrations, 106 application tables (107 manifest tables), 0 FK violations
- R2 and OneDrive round-trip verified; isolated restore 106 tables / 62 migrations
- Restored business counts: 12 customers, 14 properties, 21 appointments,
  3 invoices, 45 leads, 0 career applications, 9 signing requests
- Retention was not applied during the run; no archive was deleted

`scripts/backup/verify-r2-references.mjs` now verifies that document, signature,
job-media and customer-photo references in the D1 export each have a staged
application object. The read-only `backup-audit.yml` workflow runs that audit
without uploading an archive or applying retention.

## Branch consolidation and preserving records

- `main` and `production-safe` are now identical at `cf75d0b` with **zero divergence**.
- Main was merged with production-safe using a merge commit; no history was rewritten and no branch was force-pushed.
- `production-safe` remains the Cloudflare production branch as a rollback reference. Changing that setting is a separate dashboard decision.
- All existing business records and the pre-existing backup archive remain. No production records were deleted, anonymized or overwritten.
- No customer email, charge, refund or live booking was created during verification.
