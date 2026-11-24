# Admin operations Releases B and C

**Date:** 2026-11-24
**Branch:** `production-safe`
**Base:** admin Release A (`e970ce0`) and evidence commit (`cf63691`)

## Release B — Storage, photos, retention and backup truth

Implemented:

- Added an owner-only photo inventory at `GET /api/admin/storage?view=photos`.
  It lists real R2 customer-photo keys with linked lead/customer/property context,
  received time, size, category and legal-hold protection. It never exposes photo
  bytes through the admin JSON.
- Added `photo_delete`: a verified owner can permanently delete one displayed
  photo and its metadata sidecar. Deletion is CSRF/step-up protected, audited and
  fails closed when the bucket is unavailable or legal holds cannot be read.
- Reworked the 30-day cleanup so held photos are skipped individually instead of
  blocking every cleanup. Unavailable ownership/hold data aborts deletion.
- Replaced the technical Data & Storage presentation with owner-facing sections:
  storage summary, customer photos, business-record exports, backup health,
  retention policies, legal holds and cleanup history.
- Legal-hold subjects are now selected from real active customers, properties and
  bookings instead of typed internal IDs. Hold lists show the real record label.
- Retention policies use familiar record types and plain-English guidance.
- Backup health now reports the last successful heartbeat and says precisely when
  none exists. Production has no `backup_runs` record and no repository backup
  secrets, so the scheduled encrypted workflow has not produced a heartbeat. The
  old `backup_stale` incident is shown as an open incident; no success is invented.
- Removed native confirmation prompts from photo deletion, cleanup, legal-hold
  release and the reservation archive/close/duplicate/reopen actions.
- Photos are verified at desktop and 390 px without horizontal overflow.

No production photo, customer, property, booking, invoice, document or hold was
deleted or altered during verification.

## Release C — Communications editor and guidance

Implemented:

- Replaced the raw template textarea and raw subject placeholder syntax with a
  structured editor. Automatic fields render as labeled chips in both subject and
  message and serialize back to approved template variables on save.
- Added a field picker, “Insert field”, template guidance, available-field labels
  and “Load approved wording” from the existing defaults endpoint.
- Template selection uses owner-facing labels from canonical template metadata.
- Preview remains server-rendered with sample values.
- Validation failures now show readable field-level explanations instead of only
  a generic error; raw `{{variable}}` syntax is translated to a field name.
- The controlled delivery test uses the branded confirmation dialog. Provider
  acceptance is still described as acceptance, not inbox delivery proof.
- Reservation close, duplicate, archive and reopen use branded confirmations.
- Restored 240 corrupted punctuation sequences in the admin client (separators,
  dashes, date ranges, arrows, ellipses, the minus sign and the remove glyph) to
  correct Unicode so owner-facing text no longer renders mojibake.
- Existing routing, CSRF, owner-only saving and delivery health are unchanged.

## Customer file and job lifecycle

- Added `docs/operations/CUSTOMER-FILE-JOB-LIFECYCLE.md` with the canonical model,
  current schema audit, traceability matrix, integration already completed and
  explicitly deferred work.
- Release A/B/C changes use canonical request, customer, invoice, job, document and
  review records; no parallel identity or CRM store was introduced.
- No primary-invoice constraint or change-order table was invented during this
  release. Those remain Phase D work with additive migrations.

## Verification

- Unit suite: **1,106 tests — 1,105 pass, 1 pre-existing skip, 0 fail**.
- Browser suite: **277/277 pass**, including dedicated Release B and customer-binding tests.
- `astro check`: 0 errors, 0 warnings (11 pre-existing hints).
- Build: 41 pages.
- Validation: 2,631 internal links across 41 pages resolve; SEO, marketing/QR,
  GTM artifacts and internal-checklist checks pass.
- Smoke: 21 pages.
- No live email, charge, refund, customer message, calendar event, photo deletion,
  legal hold or destructive production mutation was performed by verification.

## Deployment

Pending at the time this evidence file was created. Final deployment ID, asset and
live checks are recorded after the GitHub-connected Cloudflare Pages deployment.
