# Internal Draft Notice Correction — 2026-11-23

**Status:** deployed and corrected
**Merge:** `d89b7f2`
**Runtime deployment:** `1d1be069-9b26-42f1-a6f8-6d6d9f96cfc3`
**Production-safe CI:** run `45111740726` (validate and browser passed)

## Root cause

All 27 owner-approved templates were imported with the internal status line:

`OWNER REVIEW DRAFT — NOT EFFECTIVE UNTIL APPROVED`

The imported text also carried the old internal version line. The executed-agreement PDF renderer printed the
stored template text directly, so the notice reached customer-facing PDFs. The approved Word masters
also carried the notice in their document body and running header, and the old version in the footer.

This was an import/rendering defect, not a substantive legal-clause change.

## Exact affected documents

All 27 approved templates were affected. Versions changed from
`2026-11-22.remediation.v1` to the release version below.

### Customer documents — new version `2026-11-23.customer-release.v1`

- Core Cleaning Service Terms (`LEG-AB060020`)
- Residential Deep Cleaning Agreement (`LEG-4A9FC934`)
- Deep Cleaning Scope and Terms (`LEG-633AE35B`)
- Residential Recurring Cleaning Agreement (`LEG-8EFF2E52`)
- Move-In / Move-Out Cleaning Agreement (`LEG-6C749FA3`)
- Vacation Rental / STR Turnover Agreement (`LEG-B329F61E`)
- Commercial Cleaning Service Agreement (`LEG-D25F29B4`)
- Church and Facility Cleaning Agreement (`LEG-9F30E030`)
- Property Manager / Real Estate Master Service Agreement (`LEG-PM-2026-11`)
- Residential Access Authorization (`LEG-A636DDB4`)
- Cancellation and Rescheduling Terms (`LEG-89D28996`)
- Customer Photo and Marketing Consent (`LEG-6467D94C`)
- Recurring Payment Authorization (`LEG-F99EEE42`)
- Saved Payment Method Authorization (After-Service Charges) (`LEG-55C03080`)
- Electronic Signature and Records Addendum (`LEG-0E4847B5`)
- Additional Service and Add-On Authorization (`LEG-75D90DBB`)
- Commercial Key Custody and Access Authorization (`SS-CUST-COM-KEY-2026-11`)

### Employee documents — new version `2026-11-23.employee-release.v1`

- Employee Handbook (`LEG-2E96A176`)
- Employee Confidentiality and Client Privacy Agreement (`LEG-37752488`)
- Employee Timekeeping and Location Acknowledgment (`LEG-03B75BAA`)
- Employee Information and Emergency Contact Form (`LEG-4E42F45A`)
- Payroll Direct Deposit Authorization (`LEG-1D7849C8`)
- Workplace Conduct and Professional Standards Policy (`SS-EMP-CONDUCT-2026-11`)
- Employee Customer and Employee Nonsolicitation Agreement (`SS-EMP-NONSOLICIT-2026-11`)
- Role-Specific Employee Noncompetition Agreement (`SS-EMP-NONCOMPETE-2026-11`)
- Employee Property, Key, Credential and Access Return Agreement (`SS-EMP-RETURN-2026-11`)
- Form I-9 Onboarding Procedure (Paper / PDF Workflow) (`SS-EMP-I9-2026-11`)

## Correction applied

- Created 27 new draft revisions through the owner-authorized revision workflow.
- Removed only the internal status notice and updated the version metadata.
- Converted approved content to the supported formatted document structure
  (title, section headings, paragraphs, bullets, metadata).
- Approved and published each revision through the app. The previous approved
  version was retired, not deleted.
- Moved every packet item from the previous template ID to the new approved ID.
- No substantive clause was silently replaced. The tests compare normalized
  clause text before and after, excluding the internal status/version metadata.
- The 2026-11-22 Word/PDF masters are preserved unchanged. A corrected versioned
  library was created at:
  `FINAL-APPROVAL-PACKAGE-2026-11-22\10-APPROVED-LIBRARY-2026-11-23\`
  with 27 Word masters, 27 regenerated PDFs and a new hash index.
- The corrected library's Word body, header and footer contain no internal
  notice. All 27 PDFs were text-extracted and checked: 0 draft notices, 27 with
  the new version.

## Production verification

- Approved templates: 27; approved templates containing a draft notice: **0**.
- Retired previous templates: 27 (preserved for history and existing signatures).
- Active packet references: every item points to an approved clean version;
  draft notices in active packets: **0**.
- Production packet preview for `customer.recurring`: 11 documents, 7 required,
  no missing variables, no content problems, no draft notice.
- Existing pending signing request `signreq_a5f2e220-3e1d-4024-8709-340067a9e7fd`
  still contains the old snapshot. It cannot be signed or resent: the API returns
  `document_content_internal_notice`. It must be reissued from the corrected
  templates if the owner still wants that signature.
- Production checkout readiness remains live and fully configured; no charge
  was created.
- Production mobile checks at 320/390/430 pass with no horizontal overflow or
  JS errors.

## Automated checks added

- Approval and revision publishing reject internal review notices.
- Signing request creation and signing reject internal notices.
- Signing page GET and resend reject old snapshots containing internal notices.
- PDF generation strips internal notices as a defense-in-depth guard.
- The customer-facing renderer hides Markdown markers and renders headings,
  paragraphs and bullets.
- The visual revision editor creates a new draft version, supports a live
  print-ready preview, comparison and Approve & Publish.
- Tests: `rich-text.test.ts`, `document-pdf-clean.test.ts`,
  `document-revision.test.ts` and the browser `admin-document-editor.test.mjs`.
