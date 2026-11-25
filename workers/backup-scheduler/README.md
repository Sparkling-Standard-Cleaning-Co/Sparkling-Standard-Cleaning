# Backup control Worker

This Worker is the server-side bridge between the owner-only Admin → Data &
Storage backup control center and GitHub Actions. The owner never needs to open
GitHub, Cloudflare or OneDrive for routine backup work.

It provides:

- owner-initiated complete/database backup dispatch;
- background status and history backed by D1;
- configurable schedule and retention (cron checks every 15 minutes);
- encrypted archive listing and short-lived owner download links;
- private application R2 object streaming for complete backups;
- independent verify/restore-test workflow dispatch;
- callback recording of R2/OneDrive verification and isolated restore results;
- one-active-job duplicate prevention.

## Required Worker secrets

- `GITHUB_DISPATCH_TOKEN` — fine-grained GitHub token with Actions: write on this repository.
- `BACKUP_CONTROL_TOKEN` — random shared secret used by Pages and the workflow callback.

## Required bindings

- D1 `DB` (production operations database).
- R2 `BACKUP_BUCKET` (`sparkling-standard-backups`).
- R2 `DOCUMENTS_BUCKET` (`sparkling-standard-documents`).
- R2 `PHOTOS_BUCKET` (`sparkling-standard-lead-photos`).

The example config shows the bindings. Never commit real secret values or the
production D1 database id.

## Owner interface

Open Admin → Data & Storage. The Backup control center supports start,
monitor, verify, download and restore-test operations. The Worker's cron trigger
dispatches scheduled backups according to the saved schedule; GitHub schedule
triggers are no longer required.

A dispatch is not proof that a backup is usable. The admin history records the
independent R2 and OneDrive verification and the isolated restore result.
