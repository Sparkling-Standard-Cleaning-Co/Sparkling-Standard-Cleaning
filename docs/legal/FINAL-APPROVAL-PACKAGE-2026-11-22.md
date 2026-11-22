# Final Approval Package — 2026-11-22

**Status:** Owner review package. No document is approved, effective, imported
into D1 or included in a live signing packet.

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
`public/brand/sparkling-standard-circular-logo-1024.png`, rendered from the
approved `logo-primary.svg` circular mark. The old stylized S raster
`approved-icon-master-1024.png` is obsolete and is not embedded in the corrected
documents. `docs/brand/LOGO-AUTHORITY.md` records the correction, and
`tests/legal-document-quality.test.ts` fails if the old mark or the old
insurance-target wording is reintroduced.

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

Open `06-REPORTS\OWNER-APPROVAL-QUEUE-2026-11-22.xlsx`. For each document:

1. Read its comparison PDF in `05-COMPARISONS`.
2. Confirm the correct title, version and SHA-256 in the queue.
3. Record **Approved exact version**, **Rejected** or **Deferred**.
4. Initial and date the row.
5. Do not approve an archived, superseded or consolidated document for live use.

Approval is valid only for the exact DOCX version and hash in the queue. A
changed file, regenerated PDF or later edit invalidates approval.
