# P0 residential checkout corrections — 2026-11-25

## Release identity

- Starting HEAD: `7e15e39` (`main` = `production-safe`, zero divergence)
- Release HEAD: `2fb4dc4`; `main` and `production-safe` identical
- Cloudflare Pages production deployment:
  `c33ce888-325d-4510-b227-b2a1ee510b8b` (source `2fb4dc4`), verified live
- Production schema: 63 migrations after `0063_staffing_pending.sql`; 106
  application tables in the D1 export, 107 live non-SQLite tables including
  Cloudflare's `_cf_KV`, 0 foreign-key violations
- Production complete backups before and after this work package:
  `sparkling-standard-backup-2026-11-25T21-38-15-complete.ssbk`
  (run `45706016953`, 62 migrations) and
  `sparkling-standard-backup-2026-11-25T22-12-12-complete.ssbk`
  (run `45711067126`, 63 migrations, 10,794,502 bytes, 227 files, SHA-256
  `7fb93022172eb44168d50b503937caa4e421565f8f0a70b9af1a426f55c3423e`)

## 1. Appointment window defaults

**Defect:** after choosing Morning or Afternoon, the customer was left with
empty Hour and Minute placeholders and could only proceed by guessing a start.

**Fix:** `src/scripts/booking-calendar.ts` now selects the owner-approved
default immediately:

- Morning: 7:00 AM.
- Afternoon: 12:30 PM.
- If the default is genuinely unavailable, the earliest real slot inside the
  same window is selected instead.
- A deliberate customer selection is preserved while it remains valid.
- The previously corrected first-job travel restriction remains removed.

Covered by browser test `booking-crew-pending.test.mjs` ("choosing an
appointment window defaults to its first available start"), which proves a
12:30 PM default and a 7:30 AM fallback when 7:00 AM is not offered.

## 2. Mandatory additional crew and staffing-pending reservations

### Root cause

The final booking step divided total person-hours by a fixed one-cleaner crew.
A 2:30 PM start with substantial add-ons therefore produced an end time after
the 7:00 PM operating close. The scheduler correctly refused that time, but the
business decision was wrong: the work needed a second cleaner. The customer saw
"That start time is no longer available with your final details." and lost the
selected time.

### Implementation

- **Crew planner** (`src/lib/booking/crew.ts`): converts total person-hours into
  the smallest crew that finishes before closing, with an owner-controlled
  additional-cleaner efficiency (`bookingConfig.crewEfficiency = 0.85`) and
  15-minute duration rounding. One cleaner remains the default whenever the
  work fits.
- **Dynamic availability** (`src/lib/booking/availability.ts`,
  `src/lib/booking/service.ts`): each candidate start is planned independently.
  The public calendar still uses the provisional preview; the final step sends
  the verified labor hours and gets the real crew/duration.
- **Hold creation** (`functions/api/booking-hold.ts`,
  `src/lib/booking/holds.ts`): stores the required crew, the assigned crew and
  a `staffingPending` flag. If the full crew is not free but the time is
  operationally feasible with an anchor cleaner, the time is still held and
  marked staffing-pending. The hold conservatively blocks all cleaning
  resources so another customer cannot double-book the window.
- **Confirmation** (`src/lib/booking/commitment.ts`): revalidates the assigned
  crew, creates/preserves the calendar event and appointment, and records
  `staffing_pending` + reason on the appointment. The assigned cleaners are
  added to `appointment_resources`.
- **Schema** (`migrations/0063_staffing_pending.sql`): additive columns on
  `appointments` (`staffing_pending`, `staffing_reason`) and an index. Old code
  ignores them; new code expects them, so apply the migration before deploying.
- **Resolution** (`src/lib/booking/staffing.ts`): assignment changes recompute
  the real crew count. The warning clears only when the assigned cleaners meet
  the required crew size.
- **Customer disclosure** (`src/components/EstimateWizard.astro`,
  `src/scripts/estimate-wizard.ts`): the final step shows a persistent notice
  that an additional cleaner is required, the time is held, and the crew will
  be confirmed before service. **Both Pay Now and Pay Later remain available.**
- **Critical notification** (`functions/api/lead.ts`,
  `src/lib/booking/commitment.ts`): the owner/admin inboxes receive an
  `owner_escalation` notice through the existing Communications routing for a
  staffing-pending pay-later request and for a paid confirmation. The notice
  includes reference, customer, appointment, labor hours, required/assigned
  crew, duration and reason. It is deduplicated with an idempotency key.
- **Admin visibility** (`functions/api/admin/overview.ts`,
  `functions/api/admin/requests.ts`, `functions/api/admin/bookings.ts`,
  `src/scripts/admin.ts`, `src/styles/admin.css`): a high-severity dashboard
  alert (`staffing.pending`), a "Staffing required" marker on calendar cards,
  a warning in the request detail and the Job File, and crew counts.
- **Customer receipt** (`functions/api/stripe-webhook.ts`): a paid
  staffing-pending booking explicitly states that the time is reserved, the
  additional crew is being confirmed, and a reschedule/refund option applies if
  it cannot be secured. It is never described as fully staffed.

### Acceptance evidence

- Unit: `tests/booking-crew.test.ts` — 6 labor hours at 2:30 PM plans two
  cleaners and ends 5:45 PM; the same work at 7:00 AM uses one cleaner; an
  impossible 10-hour afternoon job is withheld; a slot remains offered when
  only one cleaner is currently free; legacy fixed-duration behavior is
  unchanged.
- Unit: `tests/booking-staffing.test.ts` — the flag clears only when the real
  crew count reaches the requirement.
- Browser: `tests/browser/booking-crew-pending.test.mjs` — the staffing notice
  appears after the final hold, both payment paths remain, and Pay Now starts
  checkout exactly once.
- Existing scheduling regression suites remain green, including
  `booking-availability`, `booking-holds`, `booking-resources`,
  `paynow-arrival-windows` and the address-first scheduling tests.
- Live read-only production probe on 2026-12-15:
  - fixed 360-minute request returned afternoon starts only to 1:00 PM;
  - the same request with `laborHours=6` returned 1:15 PM through 2:30 PM;
  - the 2:30 PM start ends 5:45 PM, inside the 7:00 PM close. No hold,
    booking, payment or customer record was created.

## 3. Terms and Privacy modal email display

**Root cause:** the modal fetches the policy page HTML and removes scripts.
Cloudflare's Email Address Obfuscation had already replaced the address with an
encoded `.__cf_email__` placeholder and its decoder script, so removing the
script left the visible `[email protected]` placeholder.

**Fix:** `src/scripts/legal-policy-dialog.ts` decodes Cloudflare's own
`data-cfemail` payload locally and rebuilds a working `mailto:` link. Standalone
policy pages are unchanged. Unit coverage:
`tests/legal-policy-email.test.ts`. Browser coverage: a mocked
Cloudflare-obfuscated Terms response renders
`customer-service@sparkling-standard.com` with a real `mailto:` link and no
placeholder text (desktop and phone modal suites remain green).

The live Terms modal was verified against the production Cloudflare response:
the nested `data-cfemail` span now produces
`mailto:customer-service@sparkling-standard.com`, with no `[email protected]`
text.

## Deployment and live verification

| Check | Result |
| --- | --- |
| Commit | `2fb4dc4` on `main` and `production-safe` |
| Migration | `0063_staffing_pending.sql` applied; 63 migrations |
| Cloudflare Pages | `c33ce888-325d-4510-b227-b2a1ee510b8b`, source `2fb4dc4` |
| Live code | served `EstimateWizard` bundle contains the staffing notice and policy decoder |
| Live policy modal | real email and working mailto link |
| Live availability | 6-hour afternoon job now offers 2:30 PM ending 5:45 PM |
| Unit `npm test` | 1,137 tests, 1,136 pass, 0 fail, 1 pre-existing skip |
| Browser `npm run test:browser` | 285/285 pass |
| `astro check` | 0 errors |
| Build / validate | 41 pages, 2,636 internal links |
| Backup | final complete archive verified on R2 and OneDrive; isolated restore passed |

No live customer email, charge, refund, booking, hold or signed agreement was
created during verification.

## 4. Branding retirement

- `public/brand/approved-icon-master-1024.png` (the retired gold S monogram with
  floral imagery) was moved out of the served tree to
  `docs/brand/archive/retired-gold-s-monogram-1024.png`.
- `docs/brand/BRAND-ASSET-INVENTORY.md` is the authoritative active/retired
  inventory, with hashes, typography, tokens, generation command and reuse
  rules.
- `docs/brand/LOGO-AUTHORITY.md` now points to the archive and explains the
  misleading filename.
- Enforcement: `tests/legal-document-quality.test.ts` proves the retired file
  is absent from `public/brand`, the archived hash is exact, every served brand
  file is named in the inventory, and the legal renderer never references the
  retired asset. Historical executed agreements and financial records were not
  modified.

## 5. Backup reconciliation and infrastructure

### Table and migration reconciliation

The earlier archive reported 106 tables / 60 migrations while production
reported 107 tables / 62 migrations. The exact reconciliation is now verified
against live `sqlite_master` and a restored export:

- The D1 export contains **106 application tables** and all **63** migration
  records after `0063`; 0 foreign-key violations.
- Live `sqlite_master` contains 107 non-SQLite tables: the same 106 application
  tables plus Cloudflare's internal `_cf_KV` table, which D1 exports do not
  include.
- The encrypted archive manifest reports 107 tables because it also counts
  `sqlite_sequence` (106 application + 1).
- The earlier 60-migration archive was captured before migrations `0061` and
  `0062` were recorded, not because of a backup defect. The fresh archive
  (run `45711067126`) captures 63 migrations and supersedes it for current
  recoverability.

### Fresh complete backup after the migration

| Evidence | Value |
| --- | --- |
| Workflow run | `45711067126` (success) |
| Archive | `sparkling-standard-backup-2026-11-25T22-12-12-complete.ssbk` |
| Bytes | 10,794,502 |
| Files | 227 (database, metadata, application R2 objects) |
| SHA-256 | `7fb93022172eb44168d50b503937caa4e421565f8f0a70b9af1a426f55c3423e` |
| R2 round-trip | verified |
| OneDrive round-trip | verified |
| Isolated restore | passed; 106 application tables, 63 migrations, 0 FK violations |
| R2 reference audit in the workflow | passed; 224 staged objects, 0 missing references |
| Retention | not applied during this run (`apply_retention=false`); no archive deleted |

The immediately preceding complete backup (`45706016953`) captured the
pre-migration 62-migration state and remains a valid rollback archive. Both
archives remain in R2 and OneDrive.

### Recoverability audit for application R2 objects

`scripts/backup/verify-r2-references.mjs` restores the D1 export in memory and
proves every known database reference has a staged object: document template
keys, executed signature keys, job media keys, and customer photo keys recorded
on leads and booking requests. It is covered by
`tests/backup-r2-references.test.ts` and runs in the read-only
`backup-audit.yml` workflow (no backup upload, no retention, no mutation).

### Least-privilege GitHub authorization

The backup scheduler Worker currently uses an owner GitHub CLI token with
repository/workflow access. The required least-privilege replacement is a
fine-grained token limited to **Actions: write** on this repository, installed
as the Worker secret `GITHUB_DISPATCH_TOKEN`. Rotating that secret requires the
owner's Cloudflare Worker access and is recorded as an owner infrastructure
action; no secret value is displayed in this repository.

### Scheduled execution

The Worker has a `*/15 * * * *` cron trigger and a live saved schedule in
production D1: enabled, daily at 08:30 UTC, complete scope, retention
30 daily / 12 weekly / 12 monthly (saved 2026-11-25T20:22:33Z). The cron
dispatches the GitHub workflow when due, deduplicates per day and prevents
concurrent jobs. Scheduled-run history remains visible in Admin → Data &
Storage (`source = 'schedule'`). The first scheduled run after this release is
due 2026-11-26 08:30 UTC; live automatic-run evidence is pending that run,
while the dispatch logic is covered by `tests/backup-scheduler.test.ts`.

### Retention safety

Complete and database backups use separate retention streams. Retention runs
only after upload and verification, and the Git history for `retention.mjs`
keeps the newest archive in each stream. A dry run was used for this audit; no
retention deletion was performed. The pre-existing 2026-11-21 archive and the
2026-11-25 complete archives remain.

### Backup failure notification

The existing `/api/internal/backup-status` endpoint records the run heartbeat,
opens an incident and notifies admin@ and owner@ through the established
backup-monitor/Communications path when the workflow reports failure. On
2026-11-25 the final missing configuration was completed without exposing
values: GitHub variable `OPS_ALERT_URL=https://sparkling-standard.com`, a
new random `OPS_ALERT_TOKEN` stored as a GitHub secret and as the production
Pages secret. The workflow's success and failure steps now report to that
endpoint. A failure email was not deliberately triggered during this session
because that would create a false incident; the endpoint path and configured
secrets are in place.

## Remaining limitations

- Production deployment of this work package requires applying migration
  `0063` **before** the code that reads it. The controlled workflow
  `.github/workflows/d1-migrate.yml` requires typing `APPLY`.
- No live customer email, charge, refund, booking or hold was created during
  verification.
- The complete customer signing/payment journey was exercised through the
  automated unit and browser suites with mocked providers; a live Stripe
  transaction and live Resend customer mail remain owner-authorized activities.
- Tampa remains disabled; commercial proposal operations, centralized email
  notification controls, employee/payroll expansion and Tampa readiness are the
  next phases and were not part of this P0 package.
