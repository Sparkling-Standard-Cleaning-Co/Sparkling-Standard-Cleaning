# Executed Agreement Presentation Cleanup — 2026-11-23

**Status:** deployed
**Code commit:** `4fe7a64`
**Runtime deployment:** `05a8e6c3-e9bd-45ae-ad33-42aa821cae6b`

## Presentation rules applied

Customer-facing and employee-facing agreements no longer print:

- Request UUIDs or internal record IDs
- Template identifiers
- Version strings
- SHA-256 hashes or any document hash
- Consent-version codes
- Technical status or execution metadata
- Duplicate agreement headings

Retained:

- Document titles and complete substantive agreement text
- Customer/employee name, property, service
- Booking reference where applicable
- Execution date
- Signature attribution and typed signature
- Legally relevant electronic-signature statements
- Customer-provided access and instruction schedule
- Page numbers and confidential footer

## Surfaces changed

- Executed agreement PDFs
- Executed copy text (including email attachment)
- Executed-agreement owner email subject, body and attachment name
- Public signing page document headers and disclosures
- Admin customer-facing document preview
- Customer portal executed-document list
- Payment method authorization text
- New presentation-clean Word/PDF master library

## Backend retained

- Template versions and version history
- SHA-256 content hashes
- Signature evidence and consent versions
- Request IDs, template IDs and audit records
- Signature verification and integrity checks
- Immutable executed-copy hashes in D1/R2
- Previously executed PDFs unchanged

## Move-In / Move-Out live packet verification

Generated from the production `customer.move_in_out` packet (8 approved documents):

- **19 pages** (consistent with the owner's iPhone inspection)
- No internal IDs, actual template versions, 64-character hashes, consent codes,
  template metadata, signing-request IDs or bundle metadata
- Each of the 8 document titles appears exactly once as a heading
- Complete substantive text and execution/signature pages retained
- All 19 pages rendered at **390 px** phone width: 0 horizontal overflow,
  0 broken pages, every page present
- No unresolved `{{variables}}`

## Automated checks

- `tests/document-pdf-clean.test.ts` verifies no technical metadata, duplicate
  heading or Markdown markers in the generated PDF.
- `tests/document-notifications.test.ts` verifies the clean attachment name and
  no hash/consent/request metadata in the email.
- `tests/document-signing-e2e.test.ts` verifies the clean executed copy and
  portal retrieval.
- `tests/document-agreement.test.ts` verifies the backend still retains the
  signed content hash while the customer PDF does not print it.

## Verification summary

| Check | Result |
| --- | --- |
| Unit tests | 1,055 (1,054 pass, 1 pre-existing skip) |
| Browser tests | 258/258 |
| Astro check | 0 errors |
| Build | 40 pages |
| Move-In / Move-Out packet | 19 pages, all pages checked at 390 px |
| Internal metadata in packet | 0 |
| Duplicate document headings | 0 |
| Existing executed documents | unchanged |
