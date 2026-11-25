# Infrastructure closeout and communications expansion — 2026-11-25

## Infrastructure discrepancies resolved

### Backup alert URL source

`backup.yml` read `secrets.OPS_ALERT_URL` while the value was stored as a
repository variable, so both success and failure delivery steps were skipped.
The workflow now reads `vars.OPS_ALERT_URL`. Both the success and failure steps
use the same variable.

### Controlled notification test

The internal endpoint was called with a synthetic failure and recovery run:

- Failure: `monitor.status = failed`, `action = alerted_admin_and_owner`.
- Recovery: `monitor.status = healthy`, `action = resolved_recovery`.
- Provider records: admin and owner delivery events both `sent` with no error.
- Incident reopened and resolved correctly.

The first test exposed a real production defect: `operations_incidents` has a
unique `incident_key`, so after the first resolved backup incident every later
failure failed the insert and no alert was sent. The monitor now reopens the
existing incident row with an upsert and links notifications to the durable row
id. A regression test covers reopening a resolved incident. A synthetic
`backup_runs` row used by the test was removed after verification; the resolved
incident remains as truthful history.

The 23:00 UTC scheduled backup then reported success through the configured
repository variable, proving the GitHub → `/api/internal/backup-status` path
with the corrected URL source (run `45717896707`).

### Backup Worker reference

The Worker was redeployed from the repository source with `GITHUB_REF=main`
(version `1d4b178d-9d5f-4ea3-9d40-2374ce10d975`). Secrets were preserved, the
cron trigger `*/15 * * * *` remains, and the 23:00 UTC scheduled job dispatched
from `main`.

### Automatic scheduled execution

The saved schedule was temporarily moved to 23:00 UTC for a controlled live
test, then restored to the owner setting **daily 08:30 UTC**, complete scope,
30/12/12 retention.

Automatic evidence:

- Job `bj_31f04050-d695-4b15-a69c-87097dbc6fa5`, `source = schedule`, success.
- GitHub run `45717896707`, dispatched from `main`.
- Archive `sparkling-standard-backup-2026-11-25T23-01-23-complete.ssbk`,
  10,798,443 bytes, 227 files, SHA-256
  `a6bfa4eb0d25142deb55ea71a2a7dd22dbfa87494b15fc5335e835a87f87e7fa`.
- R2 and OneDrive round-trip verified; isolated restore 106 application tables,
  63 migrations, 0 foreign-key violations; 0 missing database→R2 references.

### Least-privilege GitHub authorization

The Worker still uses the existing GitHub dispatch token. A fine-grained PAT
limited to **Actions: write** on this repository cannot be created through the
GitHub API; it requires the owner to create it in GitHub **Settings → Developer
settings → Personal access tokens → Fine-grained tokens**. Replace the Worker
secret `GITHUB_DISPATCH_TOKEN` with that token and verify `/health` plus one
manual backup. This is the only remaining infrastructure owner action.

## Communications event coverage

The Communications center now supports these operational events, in addition to
the existing set:

| Event | Default routing | Critical |
| --- | --- | --- |
| Mandatory additional staffing | admin, owner | yes |
| Customer cancellation | bookings, customer service, owner | no |
| Appointment reschedule | bookings, owner | no |
| Refund or credit issued | billing, owner | no |
| Commercial or church inquiry | bookings, owner | no |
| Commercial agreement executed | admin, owner | no |
| Customer complaint | admin, owner | yes |
| Employee callout | bookings, admin | no |
| Employee late arrival | bookings | no |
| Critical operational failure | admin, owner | yes |

Behavior wired in this package:

- Staffing-pending pay-later and paid-confirmation notices now use the
  dedicated critical event instead of the generic escalation event.
- Contact-form complaints (new explicit option) alert admin and owner.
- Contact-form commercial/church inquiries and facility estimator submissions
  route to the commercial inquiry recipients.
- Cancellation and reschedule internal notices use their dedicated events.
- Every notice may carry a branch context. Owners can set per-branch recipient
  overrides in **Communications → Branch-specific routing**; a branch override
  can never redirect a critical event away from admin and owner.
- Settings saved before these events existed remain valid and adopt the new
  approved defaults.

Validation: `tests/communications.test.ts` (defaults, critical tamper,
branch overrides, resolved-incident reopen), `tests/lead-routing.test.ts`
(complaint/commercial/contact/booking selection), and the authenticated
communications browser suite. Unit **1,140** (1,139 pass, 1 pre-existing skip),
`astro check` 0 errors, 41 pages, validate 2,636 links.

## Still outstanding in the communications phase

- A general administrator-initiated retry for failed rendered emails is not
  added; existing booking/email actions remain retryable through their original
  records.
- Provider usage/cost reporting remains delivery-count based, not billing
  reconciliation.
- Branch-manager identities do not yet exist as a separate role; branch routing
  is configured by the owner and delivered through the approved department
  inboxes.
