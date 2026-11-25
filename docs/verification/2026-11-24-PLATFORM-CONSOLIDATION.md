# Platform consolidation release - 2026-11-24

## Release identity

| Item | Value |
| --- | --- |
| Start HEAD | `eeeb505` |
| Application commit | `2a95955` |
| Documentation commits | `132c54e`, `1a81631` |
| Branch | `production-safe` |
| Cloudflare Pages deployment | `103a481a-b6aa-4162-b2f1-e1654c964c55` |
| Deployment source | `2a95955` |
| Live site | `https://sparkling-standard.com` |
| Verified served admin asset | `/_astro/index.astro_astro_type_script_index_0_lang.alIZjPxx.js` |
| Production migration | `0058_document_library_review_state.sql` |
| GitHub CI | `45504337889` - validate and browser jobs passed |

## What changed

### Document Library

- Normal library shows one current approved version per document family.
- Production has 27 families, 27 approved versions, 3 draft revisions and 28
  retired versions. The default library therefore shows 27 current documents,
  not 58 rows.
- Drafts are in a separate workspace. Retired versions and family archiving are
  in History & archive.
- Archive is refused while a family is used by an active packet.
- Only unreferenced drafts can be permanently deleted.
- Publishing a revision moves packet items, retires the previous approved
  version and approves the draft in one D1 batch when available.

### Customer-level review suppression

- New `customer_review_state` table, one row per customer.
- Statuses: never invited, queued, sent, failed, unknown, confirmed reviewed,
  do-not-ask and opted out.
- Automatic and owner-initiated invitations fail closed for reviewed,
  do-not-ask, opted-out and unknown relationships, and for recent invitations.
- Delivery failure can be retried explicitly.
- Review state reads and changes are branch-scoped for non-owner managers.
- Invoice, invoice email and invoice PDF no longer include a review invitation
  after a prior invitation or suppression.
- Review automation remains disabled for both branches.

### Customer File

- Review relationship card.
- Quick actions for New Booking, Record Completed Cleaning, New Estimate, Create
  Invoice, Send Agreement, Email and Call. Each opens the existing workflow with
  the customer context selected.

### Lead workspace

- Default view now shows active inquiries only and excludes archived, lost and
  converted records unless the owner explicitly selects them.
- Added explicit Lost and All records options.

## Verification

| Check | Result |
| --- | --- |
| `npm run check` | 0 errors, 0 warnings (11 hints) |
| Unit suite | 1,114 tests; 1,113 pass; 0 fail; 1 pre-existing skip |
| Browser suite (local) | 278/278 pass |
| GitHub CI `45504337889` | validate passed; browser passed |
| Build | 41 pages |
| Validation | 2,631 internal links, SEO, marketing registry, QR decode, checklist leak checks passed |
| Smoke | 21 pages |
| Production FK check | 0 violations before and after migration |
| Production orphan checks | 0 orphan properties/appointments/invoices/signatures/reviews/packet items |
| Duplicate invoices per appointment | 0 |
| Duplicate invoice numbers | 0 |

Production record counts before and after migration were unchanged:

| Record | Count |
| --- | ---: |
| Customers | 12 |
| Properties | 14 |
| Appointments | 21 |
| Invoices | 3 |
| Signing requests | 6 |
| Review requests | 1 |
| Document templates | 58 |
| Packet items | 83 |

Fresh production D1 export before migration: restore-verified into in-memory
SQLite, 57 migrations, 101 tables, 0 foreign-key violations.

## Live verification

- `https://sparkling-standard.com/` - 200.
- `https://sparkling-standard.com/estimate/residential/` - 200.
- `https://sparkling-standard.com/sitemap-index.xml` - 200.
- `https://sparkling-standard.com/admin/` - 200, `X-Robots-Tag: noindex, nofollow`,
  `Cache-Control: no-store`.
- Served admin bundle contains the new library, draft, family archive, customer
  quick-action and review-suppression code.
- `/api/admin/documents?view=library` and `/api/admin/reviews?view=state`
  return `401` without an authenticated session, not `500`, confirming the new
  functions are deployed and fail closed.
- Deployment `c8503fed` serves the `alIZjPxx.js` admin bundle containing the
  document library, draft, history, review suppression, customer quick-action
  and active-lead code.
- The earlier `82327071` deployment was verified during propagation; the final
  verified deployment is `c8503fed` on source `2a95955`.

## Not performed

- No live customer email, review invitation, invoice email or receipt was sent.
- No charge, refund, credit or payment link was created.
- No production customer, property, appointment, invoice, signature, document or
  lead record was modified.
- Review automation was not enabled.
- The production backup workflow was not executed because it is not registered
  on the default branch and the encryption key was unavailable in the session.
- No branch was merged, renamed or deleted.
- No master-folder file was moved or deleted.

## Open owner decisions

1. Approve `main` cutover so the backup workflow becomes schedulable.
2. Approve or amend the master-workspace archive manifest.
3. Supply/confirm the backup key and authorize a controlled backup run.
4. Decide whether review automation should be enabled.
5. Prioritize change orders and the unified customer timeline.

Evidence reports: `docs/audit/2026-11-24/`.
