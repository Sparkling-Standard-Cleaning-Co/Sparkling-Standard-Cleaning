# Master audit report - 2026-11-24

## 1. Executive summary

Sparkling Standard is live and structurally sound. Production D1 has no
foreign-key violations and no orphaned customer, property, appointment,
invoice, signature, review-request or packet-item records. The prior customer
binding and completed-job invoice repairs are present at `eeeb505`.

The largest operational risks found were not data corruption. They were:

1. The daily encrypted backup workflow exists only on `production-safe`, while
   GitHub schedules workflows from the default branch (`main`). The workflow is
   therefore not registered and cannot be run manually (`HTTP 404`). The newest
   local encrypted backup is 2026-11-21.
2. The Document Library displayed every historical version of every document.
   This is now fixed: the normal library shows one current approved version per
   family, with separate drafts and history/archive workspaces.
3. Review eligibility was tracked per appointment, not per customer. Repeat
   cleanings could solicit a customer who had already reviewed or opted out.
   This is now fixed with a customer-level review relationship and suppression.
4. `main` is 125 commits behind `production-safe` with zero unique commits. This
   is the root cause of the backup workflow problem and an avoidable release
   ambiguity. The cutover plan is documented and awaits owner approval.
5. The two local master workspaces contain approximately 1.03 GB of exact
   duplicate content across 1,985 hash groups. A manifest and reversible
   proposal are provided; no mass move or deletion was performed.

No P0 data-integrity incident was found. The backup scheduling gap is classified
P1 because recoverable copies exist (2026-11-21 encrypted archive and a fresh
restore-verified D1 export) but automatic daily protection is not operating as
designed.

## 2. Verified baseline

| Item | Verified value |
| --- | --- |
| Branch / application HEAD | `production-safe` / `eeeb505` |
| Worktree before changes | clean |
| Last live deployment | `2b9e98fa-10d4-4282-957c-6520facaf53e` (source `eeeb505`) |
| Cloudflare account | `e751c8bfeee06d7a530609f81ee79a12` |
| Production D1 | `sparkling-standard-operations` (`82af5623-e4a0-48c5-b5da-b3aea5e84105`) |
| Applied migrations | 57 before this release; 58 after |
| Production tables | 101 (restore-verified export) |
| Foreign-key violations | 0 |
| Public build | 41 pages, 2,631 links |
| Unit suite | 1,114 tests, 1,113 pass, 1 pre-existing skip |
| Browser suite | 278/278 pass |

Production records observed read-only:

| Record | Count |
| --- | --- |
| Customers | 12 (4 active, 8 archived) |
| Properties | 14 |
| Appointments | 21 (1 completed, 7 confirmed, 13 cancelled) |
| Invoices | 3 (1 open, 2 paid) |
| Signing requests | 6 (2 pending, 4 signed) |
| Leads | 42 (16 new, 26 archived) |
| Review requests | 1 (sent) |
| Document templates | 58 (27 approved, 3 draft, 28 retired) |
| Packet items | 83 |
| Career applications | 0 |

Branch `main` is an ancestor of `production-safe`: 0 commits ahead, 125 behind.
All remote branches are merged into `production-safe`. Nine commits exist only on
two local historical branches (`feat/admin-overhaul`,
`initiative-6.1-facility-pricing`); they predate and are superseded by the live
implementation.

## 3. Module inventory and status

Status meanings: **verified** = inspected and exercised by automated tests in
this milestone; **inspected** = code and production state read without a live
mutation; **partial** = some workflows exercised, others deferred; **blocked** =
external decision or credential required.

| Module | Status | Notes |
| --- | --- | --- |
| Public marketing pages and SEO | verified | 41 pages, 2,631 links, SEO/validation/smoke passed. |
| Estimator and four engines | verified | Full unit and browser suites pass; no pricing mathematics changed. |
| Lead capture and notifications | inspected | Release A lead management and delivery evidence present; the workspace now defaults to active records; no live lead mutation. |
| Secure checkout and payments | inspected | Existing checkout suite passes; no live charge or refund performed. |
| Document library | **rebuilt this release** | Active-only library, draft workspace, family history/archive, guarded draft deletion. |
| Agreement signing and executed evidence | verified | Existing signing tests pass; published revisions still move packets transactionally. |
| Google Reviews | **rebuilt this release** | Customer-level suppression, retry, manual status, invoice invitation suppression. |
| Customer file | **extended this release** | Review relationship card and quick actions for booking, completed service, estimate, invoice, agreement, contact. |
| Jobs and calendar | inspected | Completed-job invoice repair and calendar actions from prior release remain. |
| Finance and invoices | verified | Existing invoice tests pass; production has no duplicate invoice numbers or per-appointment duplicates. |
| Recurring plans | inspected | Existing suite passes; no production mutation. |
| Dispatch and team | inspected | Prior dispatch release remains analysis-only. |
| Communications center | inspected | No change; existing tests pass. |
| Storage, photos and retention | inspected | Prior Release B/C behavior remains; no photo deletion performed. |
| Backups | **blocked/risk** | Workflow absent from default branch; manual dispatch 404; latest encrypted backup 2026-11-21. |
| Branch topology and CI | **risk** | `main` 125 behind; Cloudflare production branch is `production-safe`. |
| Master workspace | **manifest only** | Two roots, heavy duplication, no moves without owner approval. |

## 4. P0-P3 findings

### P0 - production blockers or data-integrity risks

None found. Foreign-key checks, orphan checks and duplicate-invoice checks were
clean.

### P1 - broken essential workflows

| Finding | Evidence | Status |
| --- | --- | --- |
| Backup coverage was misreported as entirely dormant | The audit initially checked GitHub only. The local Windows daily backup was already active and produced a verified archive on 2026-11-24 07:30 UTC. The GitHub workflow was absent from `main`; it is now present (commit `0b9bcd7`) but its dispatch fails because no repository secrets exist. | **Corrected and partially resolved:** local schedule verified; GitHub cloud path blocked on owner-supplied secrets |
| Document Library displayed all versions | Production has 58 templates for 28 families; normal library showed retired and draft rows | Fixed in this release |
| Review invitations were per appointment | `review_requests` had no customer-level state; repeat completed jobs could be re-invited after the frequency window | Fixed in this release |

### P2 - significant usability, simplification or integration gaps

| Finding | Evidence | Status |
| --- | --- | --- |
| Two competing production branches | `main` 1 ahead / 133 behind; Cloudflare deploys `production-safe`; main's unique commit is the backup workflow visibility | Cutover merge plan documented; owner approval required |
| Master workspace duplication | 10,615 non-build files across three roots; 2,547 duplicate groups; 8,619 files in groups; about 2.4 GB duplicate | Legacy workspace renamed to dated archive; two duplicate tasks disabled; deletion manifest prepared; no files deleted |
| No first-class change-order workflow | Additional work after signing had no purpose-built amendment record | **Implemented 2026-11-24** with signature and supplemental invoice |
| Customer file is not one chronological timeline | Customer detail aggregated tables but did not merge events | **Implemented 2026-11-24** |
| Job view was not a full job file | No payments, photos, communications or change orders together | **Implemented 2026-11-24** |
| Admin client is a 9,700-line monolith | `src/scripts/admin.ts` | Documented maintainability risk; not refactored |
| Mojibake remains in several operating documents | e.g. older arrows in some docs | Fixed in documents touched by this release; other docs remain |
| Stale local branches | 2 local branches with 9 unique commits from October; superseded | Deletion candidate after owner approval |

### P3 - cosmetic and optional enhancements

- Document Library summary counts could later become a richer dashboard.
- Review queue could add bulk suppression controls.
- Master folder empty directories (47) are listed and left for owner review.

## 5. Corrective actions completed in this milestone

- Active-only document library with current approved version per family.
- Drafts workspace separated from normal operations.
- History and archive workspace with per-version signature/packet usage.
- Family archive/restore with active-packet protection.
- Guarded permanent deletion of unreferenced drafts only.
- Transactional batch publish when D1 batch is available.
- Customer-level review state and suppression.
- Invoice/PDF review invitations suppressed after a prior invitation or any
  reviewed/do-not-ask/opted-out state.
- Review delivery retry and manual status controls.
- Customer File quick actions with customer context carried into booking,
  estimate, invoice and agreement flows.
- Active-first Leads workspace: archived, lost and converted records are hidden
  by default and remain available through the explicit All or status filters.
- Backup health corrected: latest scheduled archive verified, isolated restore
  passed, `backup_runs` heartbeat recorded and stale incident resolved; GitHub
  workflow exposed on `main` with an explicit missing-secret failure.
- Master workspace reconciled: stale unspaced Downloads workspace renamed to a
  dated legacy archive; two obsolete scheduled tasks disabled; start page and
  README corrected; duplicate manifest generated. No files deleted.
- Customer File now includes jobs, payments, communications and one
  chronological activity timeline with source links.
- Job File now includes crew, finance (primary + supplemental), payments, photos,
  communications, change orders and timeline.
- Signed change orders implemented through the approved Additional Service and
  Add-On Authorization template with one explicit supplemental invoice.
- One primary invoice per job enforced with migration `0059` and a partial unique
  index; supplemental invoices are explicitly linked.
- Signing requests can be revoked, default to active, and tolerate missing or
  renamed packet associations without crashing.
- Fresh production D1 export restore-verified (57 migrations, 101 tables, 0 FK
  violations) before applying migration 0058.

## 6. Remaining decisions for the owner

1. Approve the `main` cutover plan in `BRANCH-CONSOLIDATION-PLAN.md`.
2. Approve or amend the master-folder archive proposal in
   `CONSOLIDATION-CLEANUP-MANIFEST.md`.
3. Supply or confirm the backup encryption key location and repository secrets
   after the default-branch cutover, then authorize one controlled backup run.
4. Decide whether to implement change orders and the unified chronological
   customer timeline next.
5. Confirm whether review automation should be enabled per branch. It remains
   disabled in production and this release did not enable it.
