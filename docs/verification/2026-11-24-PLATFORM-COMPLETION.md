# Platform completion and stabilization - 2026-11-24/25

## Release identity

| Item | Value |
| --- | --- |
| Start HEAD | `b65cafd` |
| Application commit | `aaa4c83` |
| Branch | `production-safe` |
| Cloudflare Pages deployment | `9cea2813-c777-4dd6-97ab-f8e62c2ea845` |
| Live site | `https://sparkling-standard.com` |
| Served admin asset | `/_astro/index.astro_astro_type_script_index_0_lang.DLPf6bre.js` |
| Production migrations | 60 (`0059`, `0060` added) |
| GitHub CI | `45518441282` - validate and browser passed |

## A. Backup restoration

**Status: local encrypted scheduling operational and verified; GitHub cloud path blocked on owner secrets.**

- The previous audit incorrectly concluded backups were entirely dormant because
  it checked GitHub only. The Windows scheduled tasks were already active and
  healthy.
- Latest full weekly verification: **2026-11-25 14:46-15:02 UTC**.
- Archive: `sparkling-standard-backup-2026-11-25T14-46-33.ssbk`,
  421,622,405 bytes, 2,595 files, SHA-256
  `aeb732fffdd951a9d6c2984e8cf2b9b84acb39ac4042a513ca09f21e885afa03`.
- Archive verification: passed; D1 integrity `ok`, 104 tables.
- Independent OneDrive download: hash and archive verification passed.
- Isolated restore rehearsal: passed; restored D1 export
  `5886df4d75e0e29a8bc516d57955dd7367f80c946a30e155fad5cd98157ddfd0`,
  60 migrations, 104 tables, 0 foreign-key violations.
- Dashboard heartbeat: weekly success recorded in `backup_runs`; stale
  `backup_stale` incident resolved.
- Daily run 2026-11-24 07:30 UTC remains verified (2,572 files, D1 102 tables).
- Two backup-tool defects were fixed during verification: large OneDrive
  uploads were not confirming finalization, and large downloads timed out after
  60 seconds. Uploads now verify the stored item and size; downloads stream to
  disk with a 30-minute limit. Task battery stop conditions were removed.
- Two obsolete tasks pointing at the old unspaced workspace were disabled.
- `backup.yml` is now visible on default branch `main` (commit `0b9bcd7`) and
  dispatch is possible. Controlled run `45513633447` failed fast because the
  repository has **zero Actions secrets or variables**. Exact missing first
  secret: `CLOUDFLARE_API_TOKEN`; the full set is listed in
  `docs/operations/OFFSITE-BACKUPS.md`.
- **D1 coverage:** full SQL export in each daily archive.
- **Local files:** legal registry, I-9 controls/records and website source.
- **R2 application objects:** not covered by the daily local archive; requires a
  bucket-scoped R2 S3 token and a controlled backup run.
- **Remaining risk:** backups depend on the owner's Windows machine and its
  Wrangler OAuth/OneDrive sessions until the GitHub path is configured.

## B. Branch consolidation

**Status: plan prepared and verified; production branch not switched.**

- `main`: 1 unique workflow-visibility commit (`0b9bcd7`), 133 behind
  `production-safe`.
- `production-safe`: live production branch; all application work.
- Fast-forward is no longer possible; cutover requires one merge commit.
- Expected conflict is limited to `.github/workflows/backup.yml`; keep the
  default-branch version and change its checkout ref to `main`.
- Rollback: point Cloudflare back to `production-safe` and its last verified
  deployment.
- No branch was merged, renamed or deleted. Owner approval is required.

## C. Master folder

**Status: reversible cleanup executed; permanent duplicate deletion awaits owner review.**

- Active code: `Documents\Sparkling-Standard-Master\01-Website-Repository`.
- Active business/legal records: `Downloads\SPARKLING STANDARD - MASTER`.
- Legacy unspaced workspace renamed to
  `Downloads\Sparkling-Standard-Master-LEGACY-ARCHIVE-2026-11-24`.
- Two old duplicate scheduled tasks disabled.
- The archive shortcut was updated; the start page and Documents README now
  describe the real roles.
- Duplicate scan: 10,615 files, 2,547 groups, 8,619 files in groups, 6,072
  redundant copies, about 2.4 GB.
- Detailed retained-path manifest:
  `Documents\Sparkling-Standard-Master\99-Archive-For-Review\2026-11-24-MASTER-CLEANUP\DUPLICATE-FILES-2026-11-24.csv`.
- No file was deleted. 47 empty directories are listed and left for review.

## D. Customer and job lifecycle

**Status: implemented and tested.**

- Customer File now includes Jobs, Payments, Communications and one
  chronological Activity timeline with links to jobs, invoices, agreements and
  inquiries.
- Job File now includes reference, customer/property, service, price, crew,
  photos, primary and supplemental invoices, payments, documents,
  communications, change orders and timeline.
- Migration `0059` adds `invoice_role` and a partial unique index enforcing one
  primary invoice per appointment. Supplemental invoices link to the primary.
- Tests: `customer-timeline.test.ts`, `migration-0059.test.ts`,
  `admin-customer-file.test.mjs`.

## E. Change orders

**Status: implemented and tested; no production change order created.**

- Migration `0060` adds `service_change_orders`.
- Workflow: create from job, owner approval, signing through the approved
  **Additional Service and Add-On Authorization** template, then one explicit
  supplemental invoice.
- Original agreement, signatures and primary invoice are never rewritten.
- Negative adjustments are blocked from invoicing and must use refunds/credits.
- Tests: `change-orders.test.ts`, including a signed amendment and supplemental
  invoice, plus the browser job-file change-order UI.
- Not implemented: employee-initiated change requests and customer self-service.

## F. Google Reviews

**Status: suppression implemented; automation not activated.**

- Customer-level state and suppression are live.
- Reviewed, do-not-ask, opted-out, unknown and recently invited customers are
  not solicited again.
- Invoice/PDF invitations are suppressed accordingly; failed deliveries retry.
- Automation remains off for Pensacola and Tampa.
- `workers/review-requests` is implemented and tested but not deployed; it lacks
  a Cloudflare D1 binding and Resend secret. No review email was sent.
- One historical review request exists (`sent`); no state rows were created by
  this release because no invitation was sent.

## G. Administrative cleanup

- Fixed the signing-request crash caused by missing/renamed packet associations;
  request detail now fails gracefully and packet-family data is null-safe.
- Added signing request revocation for pending/partially signed requests; the
  link is invalidated, signatures are preserved, and the action is audited.
- Signing Requests defaults to active requests; completed/void history remains
  available through the filter.
- Alert navigation and prior Release A link repairs remain in place.
- No dead button or "request not found" defect was found in the tested paths.

## H. Final quality evidence

| Check | Result |
| --- | --- |
| `astro check` | 0 errors, 0 warnings (11 hints) |
| Unit suite | 1,118 tests; 1,117 pass; 0 fail; 1 pre-existing skip |
| Browser suite | 279/279 pass |
| Build | 41 pages |
| Validation | 2,631 links, SEO, QRs, checklist leak checks pass |
| Smoke | 21 pages |
| CI `45518441282` | validate and browser passed |
| Production migrations | 60; 0 foreign-key violations |
| Production counts | 12 customers, 14 properties, 21 appointments, 3 invoices, 6 signing requests, 58 templates, 1 review request |
| Invoice integrity | 0 duplicate numbers, 0 duplicate primary invoices per appointment |
| Live admin | 200, noindex, new asset, change-order/job APIs return 401 unauthenticated |
| Backup restore | Latest archive verified and restored in isolation |

## Not performed

- No live customer email, review invitation, invoice email or receipt.
- No charge, refund, credit or payment link.
- No production customer, property, appointment, invoice, signature, document or
  lead mutation.
- No branch cutover, branch deletion or factory reset.
- No permanent master-folder deletion.
- No authenticated live end-to-end mutation test; authenticated flows were
  covered by isolated integration and browser tests.

## Owner decisions required

1. Approve the merge-based `main` cutover.
2. Add GitHub backup secrets and choose the primary backup path.
3. Approve or amend the duplicate deletion manifest.
4. Authorize review-worker deployment and automated review activation.
5. Prioritize any remaining employee-initiated change-order or self-service work.
