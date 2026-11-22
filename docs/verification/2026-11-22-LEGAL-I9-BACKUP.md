# 2026-11-22 Legal, I-9, Dynamic Agreement and Backup Evidence

> **Superseded for the legal-document set by
> `docs/verification/2026-11-22-LEGAL-REMEDIATION.md`.** The owner rejected the
> abbreviated candidates as final deliverables; the corrected package is
> `FINAL-APPROVAL-PACKAGE-2026-11-22`. The I-9, dynamic signing and backup
> evidence in this document remains historically accurate for its release point.

**Branch:** `production-safe`
**Start/final HEAD:** `459383d5618a304f56390bb542de77e7a332aed6` (no commit, no push, no deploy)
**Working tree:** intentionally uncommitted session work; pre-existing untracked files preserved.

## 1. Official Form I-9 integration

| Check | Result |
|---|---|
| File supplied | `C:\Users\thoma\Downloads\i-9.pdf` |
| Official USCIS form | Yes - title, author and subject metadata match Form I-9; OMB No. 1615-0047 |
| Edition | **01/20/25** |
| Expiration | **05/31/2027** |
| Pages | 4 - Section 1/2, Lists of Acceptable Documents, Supplement A, Supplement B |
| SHA-256 | `780f348c34df694bb0b4dbbfaf9f22b99b9757b80d16a37ba89aadf069597281` |
| Employee personal information | None - blank; four State fields contain only whitespace |
| Altered/unofficial substitute | No |
| Official instructions | Downloaded from USCIS: 8 pages, edition 01/20/25, SHA-256 `c66c3818fbecbfb87b5f0560f4dfd4086905daf72ca29dba15ce4c8d49dc4ca3` |

Integrated locations:

- `05 EMPLOYEES & TRAINING\Employee Policies\I-9\OFFICIAL-USCIS-FORMS\i-9.pdf` (unmodified)
- `05 EMPLOYEES & TRAINING\Employee Policies\I-9\OFFICIAL-USCIS-FORMS\i-9-instructions.pdf` (unmodified)
- `05 EMPLOYEES & TRAINING\Employee Policies\I-9\I-9-COMPLETION-PROCEDURE-2026-11-22.docx` / `.pdf`
- `05 EMPLOYEES & TRAINING\Employee Policies\I-9\I-9-TRACKER-2026-11-22.xlsx`
- `05 EMPLOYEES & TRAINING\Employee Policies\I-9\I-9-INTEGRATION-RECORD-2026-11-22.md` / `.json`
- `05 EMPLOYEES & TRAINING\Employee Records\I-9\RESTRICTED-COMPLETED\` (empty, restricted)
- `05 EMPLOYEES & TRAINING\Employee Records\I-9\ACCESS-LOG\I-9-ACCESS-LOG-2026-11-22.xlsx`

The procedure states explicitly that the Sparkling Standard electronic-signature portal is **not** a DHS-compliant electronic I-9 system. It requires the paper form, handwritten signatures, in-person examination, restricted storage, an access log, retention of three years after hire or one year after separation (whichever is later), and no destruction during a legal hold.

## 2. Legal Registry reconciliation

Current persistent registry (read, not overwritten):

| Metric | Current |
|---|---:|
| Unique documents | 221 |
| Owner-decision documents | 55 |
| Required | 44 |
| Optional | 11 |
| Reference only | 166 |
| Historically approved | 2 |
| Revision requests | 17 |
| Rejected | 2 |
| Not reviewed | 34 |

The supplied baseline said 43 required / 12 optional. The actual inventory is 44 / 11; the difference is recorded rather than normalized.

- **29 candidate DOCX/PDF pairs** exist and all 29 pairs are complete.
- **37 owner comments** across 12 documents are reconciled comment-by-comment in `RECONCILIATION-2026-11-22.md` and `VERIFIED-MANIFEST-2026-11-22.json`.
- Every comment has a disposition: applied, applied_by_replacement, applied_with_clarification, applied_pending_policy_verification, superseded_by_later_owner_directive, modified_for_legal_compliance, or unresolved_owner_decision_required.
- One unresolved owner decision remains: the employee confidentiality protected-activity carve-out. It is retained because deleting it creates overbreadth/enforceability risk.
- Session corrections: added a Notices section with `admin@sparkling-standard.com` to the Core Terms; restored the 10% church discount wording; updated the I-9 candidate to reference the controlled official edition.
- No candidate contains FRIENDS15 or the legacy `owner@` address.
- All 34 unreviewed documents are triaged in the reconciliation report.

Organized without duplicating the underlying files:

- `00 START HERE\LEGAL-REVIEW\PACKETS-BY-SERVICE\` - packet indexes by service, with exact hashes.
- `00 START HERE\LEGAL-REVIEW\APPROVED\` - reserved; empty until exact owner approval.
- `00 START HERE\LEGAL-REVIEW\SIGNING-PACKET-TEMPLATES\` - reserved.
- `00 START HERE\LEGAL-REVIEW\ARCHIVE-SUPERSEDED\` - reserved/indexed.
- `00 START HERE\LEGAL-REVIEW\RECONCILIATION-2026-11-22.md`
- `00 START HERE\LEGAL-REVIEW\VERIFIED-MANIFEST-2026-11-22.json`

## 3. Dynamic agreement engine

Implemented in the working tree:

- **Variable expansion** - `DOCUMENT_VARIABLE_KEYS` now includes customer legal name, scope, additions, exclusions, service date, arrival window, price summary, line items, tax, discount, payment terms, cancellation terms, agreement version/effective date and signature name.
- **Server-owned values** - `src/lib/documents/agreement-variables.ts` derives values from the stored, server-verified `booking_requests.payload_json`, service type and confirmed schedule. Browser price/scope fields are not re-read at signing time.
- **Fail closed** - unresolved variables still throw `document_variables_missing`; checkout now returns a structured `document_template_incomplete` instead of a 500.
- **Production PDF** - `src/lib/documents/agreement-pdf.ts` renders an executed agreement PDF using the existing dependency-free PDF primitives (no Chromium, LibreOffice or paid service). It includes document hashes, signer identity, typed signature, status, consent version and audit record.
- **Executed artifact storage** - after a fully signed request, the PDF is stored in private R2 and linked from the text-template signature records. Original uploaded PDF templates keep their original key.
- **Pre-payment resume** - when checkout requires a signature, a durable 60-minute checkout intent is stored in the private ledger with only the resume-token hash. The signing page offers **Continue to secure payment**; `/estimate/payment-resume/` re-enters checkout. The server re-verifies the quote and document gate.
- **Post-payment confirmation** - after a paid booking's documents are signed, the signing endpoint calls `autoConfirmPaidBooking`. A paid booking no longer stays pending solely because the customer signed after payment.
- **Branch scoping** - admin signature download and verify/reject actions now enforce the signing request's branch.
- **Facility handling** - commercial/church checkout now forwards `documents_required` to the signing page instead of dead-ending.

Activation remains off: production has zero approved templates, zero signing requests and zero signatures. No candidate was imported, approved or published.

## 4. Verification executed

| Check | Result |
|---|---|
| `npm run check` | 0 errors, 0 warnings, 2 pre-existing hints |
| `npm test` | **1,000 tests: 999 pass, 1 pre-existing skip, 0 fail** |
| New focused tests | 7 pass (6 in `tests/document-agreement.test.ts`; 1 full sign-to-resume Stripe-session test in `tests/estimate-checkout.test.ts`) |
| `npm run build` | 40 pages built |
| `npm run validate` | 2,558 internal links, SEO, marketing registry, QR, checklist leak checks passed |
| `npm run smoke` | 21 pages passed |
| `npm run test:browser` | **248 browser tests pass** |

The focused tests prove: variable population from the stored request, no unresolved placeholders, real `%PDF-1.4` executed output, resume intent creation, signature unlock, branch/gate fail-closed behavior, missing-variable rejection, and a complete synthetic checkout that blocks before signing, resumes after signing, creates exactly one Stripe session, and reuses it on a repeated resume.

## 5. Backup and restore evidence

### Existing current D1 archive

- Archive: `08-Backups\2026-11-21\sparkling-standard-backup-2026-11-21T21-10-15.ssbk`
- SHA-256: `393525B4953C89540E1472BA0053CA5EA8EE72B00872949E938C48C7D62EE866`
- `backup:verify`: ok, 2 files, 802,060 bytes, D1 integrity `ok`, 96 tables.
- Isolated restore to a fresh temporary directory: ok.
- Restored D1 verification: 50 migrations, 95 data tables, 0 foreign-key violations; 11 customers, 10 properties, 15 appointments, 2 invoices, 36 leads, 0 career applications, 0 signing requests.

### R2 application archive

- Archive: `OneDrive\Sparkling Standard Backups\2026-11-20\sparkling-standard-backup-2026-11-20T15-21-43.ssbk`
- SHA-256: `379EAFE327140D066670EDFA1DC57B396E4C46C55316B798EA43F5000037E2B9`
- Verify: ok, 89 files, 8,444,359 bytes. Isolated restore: 89 files, including the private R2 application objects.

### New current legal/I-9/source archive

- Archive: `08 BACKUPS & ARCHIVE\SCHEDULED\sparkling-standard-backup-2026-11-22T07-24-41.ssbk`
- SHA-256: `69236a1cd11ef42c0834ed396cd0fdcfd2bbbec682d328adbbe09db457bdba3e`
- Contents: fresh 2026-11-22 D1 export, current legal registry and all 29 candidates, the owner approval queue and full comparisons, the official I-9 and procedure/tracker, the restricted I-9 records folder, and the current website source. 2,162 files / 345,434,131 bytes.
- Excluded: `.env`, `.dev.vars`, `.wrangler`, `secrets.env`. Only example files remain.
- Local verify: ok, D1 integrity `ok`, 96 tables.
- Local isolated restore: 2,162 files; fresh D1, I-9 form, reconciliation, owner queue and comparisons present.
- Uploaded to OneDrive `Sparkling-Standard-Encrypted-Backups`; upload SHA-256 matched.
- Independently downloaded from OneDrive: SHA-256 matched exactly.
- Independently downloaded archive verified and restored to a fresh temporary directory: 2,162 files; D1 verification 50 migrations, 95 tables, 0 foreign-key violations.
- Fresh D1 export SHA-256: `784b2b1cd67152550dd07887fd178f9d3207a73f0a8aa2d2f8d43d8cb7795057`.

OneDrive retention (7 daily / 4 weekly / 6 monthly) removed the earlier 2026-11-22 05:13 and 05:31 cloud copies after this archive was verified; the local copies remain. The initial archive created during this session that accidentally included `.env` and `.wrangler` was deleted after the clean archive was verified. No completed employee I-9 exists in production or in these archives.

## 6. Residual gaps

1. No approved document templates exist in production; the legal packet is not active.
2. The 29 candidates are owner-review redrafts, not clause-by-clause redlines; owner approval is still required.
3. The commercial packet still needs a separate Commercial Key Custody and Access Authorization.
4. The insurance certificate still needs verification before publishing $1M/$2M.
5. The scheduled backup workflow is not on `main`; no `backup_runs` heartbeat was created by the manual archives.
6. Live backup alert delivery remains unproven; the monitor's Resend credentials are not established.
7. The full 2.5 GB master workspace archive from 2026-11-19 was not re-created in this session; the new archive covers legal, I-9, source and D1, not all media.
8. No Stripe test-mode transaction, live charge or customer message was performed. No production migration was applied.
9. No commit, push, merge or deploy was performed.

## 7. Owner actions required

1. Decide the employee-confidentiality protected-activity carve-out.
2. Approve or reject each exact candidate version and hash.
3. Verify the commercial general liability certificate.
4. Confirm whether the 10% church discount wording is final.
5. Designate the I-9 custodian and confirm E-Verify applicability.
6. Provide/authorize the remaining backup workflow secrets and default-branch placement if the scheduled backup is to run.
7. Authorize any commit, deployment, migration or live payment test separately.
