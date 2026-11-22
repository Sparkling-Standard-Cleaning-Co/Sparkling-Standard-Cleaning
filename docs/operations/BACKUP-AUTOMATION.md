# Backup Automation — 2026-11-22

This document records the automated encrypted backup path, its dependencies and
the exact recovery procedure. It contains credential **names**, never values.

## Current automation

| Control | Schedule | What it does |
|---|---|---|
| `Sparkling Standard Encrypted Backup - Daily` | Daily 02:30 local | Fresh D1 export when wrangler is authorized; encrypted archive of legal registry, I-9 controls/records and website source; local verify; OneDrive upload; retention (7 daily / 4 weekly / 6 monthly) |
| `Sparkling Standard Encrypted Backup - Weekly Restore Test` | Sunday 03:30 | Same archive/upload plus independent OneDrive download, hash comparison, verify and isolated restore + D1 verification |
| `Sparkling Standard Backup Health Check` | Every 6 hours | Reads the last status; writes `HEALTH.json` and a visible `BACKUP-ALERT-*.txt` when missing, failed or older than 26 hours; exits non-zero so Task Scheduler records failure |
| GitHub Actions `backup.yml` | Disabled schedule on `main`; manual or scheduler Worker | Cloud D1 + optional application R2 + metadata, R2/OneDrive round trip, restore verification and `backup_runs` reporting once secrets are configured |
| `workers/backup-scheduler/` | Prepared | Dispatches `backup.yml` on `production-safe`; not deployed |

Scripts:

- `scripts/backup/local-scheduled.ps1`
- `scripts/backup/check-health.ps1`
- existing `create.mjs`, `verify.mjs`, `restore.mjs`, `onedrive.mjs`,
  `retention.mjs`, `verify-d1-export.mjs`

## Credentials and where they live

Do not commit or paste any of these values.

| Dependency | Where it lives | Owner action |
|---|---|---|
| `BACKUP_ENCRYPTION_KEY` | DPAPI-protected file `08 BACKUPS & ARCHIVE\keys\d1-backup-key-dpapi.txt`; decrypted only inside the backup process | Keep an independent password-manager copy; losing it makes archives unrecoverable |
| OneDrive refresh token | DPAPI cache `%USERPROFILE%\.config\sparkling-standard\onedrive-token.dpapi` | Reauthorize with `npm run backup:onedrive -- auth-start` / `auth-finish` if Microsoft invalidates it |
| Cloudflare D1 access | Wrangler OAuth session on this machine | Reauthorize `npx wrangler login` if the scheduled D1 export fails; the wrapper falls back to the newest cached verified export and marks it `cached` |
| OneDrive folder | `Sparkling-Standard-Encrypted-Backups` | Keep it private; do not share a link |
| Optional email alert | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `OWNER_NOTIFICATION_EMAIL` in the user/process environment | Configure only if owner email alerts are desired |
| GitHub Actions cloud backup | Repository secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_NAME`, `BACKUP_ENCRYPTION_KEY`, `BACKUP_R2_ENDPOINT`, `BACKUP_R2_BUCKET`, `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`, `ONEDRIVE_CLIENT_ID`, `ONEDRIVE_REFRESH_TOKEN`, `OPS_ALERT_URL`, `OPS_ALERT_TOKEN` | Owner must add them; the workflow remains dormant until then |

## Current verified evidence

- Archive: `08 BACKUPS & ARCHIVE\SCHEDULED\sparkling-standard-backup-2026-11-22T05-58-55.ssbk`
- SHA-256: `4a65c30648564cb3b9a930d2ae6bb781dc396233c2e468df820bf3b45e028708`
- 1,868 files / 263,313,055 plain bytes
- Fresh D1 export SHA-256:
  `480a7f47c1a97c4db9b7dee125e589c77218034d3867a98500736e86db04d625`
- Local verify: passed; D1 integrity ok, 96 tables
- OneDrive upload: accepted; independent download hash matched
- Independent restore: passed; restored D1 50 migrations, 95 data tables,
  0 foreign-key violations
- Retention applied once: newest archive and 2026-11-21 D1 archive kept; two
  same-day superseded cloud copies removed. Local copies remain.

## Recovery procedure

Do not restore over production. Use an isolated directory or a reviewed
nonproduction environment.

```powershell
# 1. Decrypt the key only inside the shell (never echo it)
$keyFile = 'C:\Users\thoma\Downloads\SPARKLING STANDARD - MASTER\08 BACKUPS & ARCHIVE\keys\d1-backup-key-dpapi.txt'
$secure = Get-Content -LiteralPath $keyFile | ConvertTo-SecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $env:BACKUP_ENCRYPTION_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }

# 2. Verify and restore an independently downloaded copy
npm run backup:verify -- C:\path\to\archive.ssbk
npm run backup:restore -- C:\path\to\archive.ssbk --out C:\Temp\ss-restore-20261122
npm run backup:verify-d1-export -- C:\Temp\ss-restore-20261122\database\d1-*.sql

# 3. Clear the key from the shell
Remove-Item Env:BACKUP_ENCRYPTION_KEY
```

For a production recovery, use a separately reviewed runbook, take a fresh
backup of the target first, and never copy an unverified archive over
production D1 or R2.

## What is not yet automated or proven

- The GitHub Actions workflow is not scheduled on the default branch and its
  repository secrets are not all configured.
- Live backup email alerts are not proven. The local health check produces
  visible files and Task Scheduler failures; the production monitor still needs
  Resend credentials.
- The full media/master workspace archive is not part of the daily task; the
  current task covers legal, I-9, website source and D1.
- Recovery-key independence and a production D1/R2 re-import drill remain owner
  actions.
- Two older tasks point at `_PRIVATE_BACKUPS\bin\...` from the pre-consolidation
  workspace. They were not deleted. Review and retire them after confirming the
  new tasks.
