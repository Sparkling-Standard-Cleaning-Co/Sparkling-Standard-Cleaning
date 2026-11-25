# Final Approval Package — 2026-11-22

**Status:** 27 active documents owner-approved as exact versions on 2026-11-22.
They remain unimported into production D1 and inactive in live signing packets.
The 3 archived/consolidated records remain excluded.

## Approved records

- Approved manifest: `00 START HERE\LEGAL-REVIEW\APPROVED\APPROVED-VERSION-MANIFEST-2026-11-22.json`
- Approval snapshot: `00 START HERE\LEGAL-REVIEW\APPROVED\APPROVAL-SNAPSHOT-2026-11-22.json`
- Word/PDF library: `FINAL-APPROVAL-PACKAGE-2026-11-22\10-APPROVED-LIBRARY\`

## Location

`C:\Users\thoma\Downloads\SPARKLING STANDARD - MASTER\FINAL-APPROVAL-PACKAGE-2026-11-22\`

## Contents

| Folder | Contents |
|---|---|
| `01-CUSTOMER-DOCX` | Corrected customer/business DOCX masters with dynamic fields |
| `02-CUSTOMER-PDF` | Matching review PDFs with sample data and the correct circular logo |
| `03-EMPLOYEE-DOCX` | Corrected employee DOCX masters |
| `04-EMPLOYEE-PDF` | Matching employee review PDFs |
| `05-COMPARISONS` | Full original-vs-revised comparison PDFs |
| `06-REPORTS` | Clause coverage, comment disposition, legal quality, exceptions, QA and approval queue |
| `07-SAMPLES` | Fully populated sample execution packets for Deep Cleaning, Recurring, Commercial and Church |
| `08-CONTACT-SHEET` | Visual cover sheet of every active document |
| `09-MANIFEST` | Version and SHA-256 manifest |
| `ARCHIVE-PRIOR-CANDIDATES-2026-11-22` | The superseded abbreviated candidates, retained for history |

## Branding

The correct asset is
`public/brand/sparkling-standard-circular-logo-1024.png` (SHA-256
`0253b65fba7a90e63325b00bda5dfb15fb6d08f049e3f680c0a75895518ba237`),
rendered from the approved `logo-primary.svg` circular mark with the embedded
Great Vibes and Fraunces brand fonts. The old stylized S raster
`approved-icon-master-1024.png` is obsolete and is not embedded in the corrected
documents. `docs/brand/LOGO-AUTHORITY.md` records the correction, and
`tests/legal-document-quality.test.ts` fails if the old mark, fallback-font
raster, or the old insurance-target wording is reintroduced.

## Document hierarchy

1. Core Cleaning Service Terms.
2. Applicable service-specific agreement.
3. Customer-specific signed service schedule.
4. Signed additional-service or payment authorization.

The Core Terms control general rights and responsibilities. The service
agreement controls service-specific obligations. The signed schedule controls
the property, scope, date, price, discount, tax and payment timing. An additional
authorization controls only the work or payment it covers.

## Approval

Use the existing owner Legal Registry as the approval interface:

1. Double-click `C:\Users\thoma\Downloads\SPARKLING STANDARD - MASTER\00 START HERE\LEGAL-REVIEW\OPEN-LEGAL-REGISTRY.cmd`.
2. Click **Final approval queue** and review the 27 active candidates grouped by service.
3. Read the corrected PDF, open the **Comparison** link, and confirm the exact DOCX version and SHA-256.
4. Record **Approve as written** (exact version), **Approve with revisions**, **Reject** or **Defer**.
5. Do not approve an archived, superseded or consolidated document for live use.

The XLSX in `06-REPORTS` remains a printable backup inventory. Approval is valid
only for the exact DOCX version and SHA-256 displayed in the registry. A changed
file, regenerated PDF or later edit invalidates approval.
