# Legal Document Quality Remediation â€” 2026-11-22

**Status:** Corrected owner-review package. No document is approved, effective,
imported into D1 or included in a live signing packet.

## 1. Documents reviewed and rewritten

- **27 active documents** rewritten as full-length masters:
  - 1 Core Terms (12 pages, 36,000+ characters; prior abbreviated candidate was
    approximately 3,600 characters).
  - 8 customer service-specific agreements/schedules (Deep, Deep Scope, Recurring,
    Move-In/Move-Out, STR, Commercial, Church, Property Management).
  - 7 customer addenda/authorizations (Access, Cancellation, Photo Consent,
    Recurring Payment, Saved Payment Method, E-Signature, Add-On, Commercial Key
    Custody).
  - 11 employee documents/forms (Handbook, Confidentiality, Timekeeping,
    Employee Information, Payroll, Conduct, Nonsolicitation, Noncompetition,
    Property Return, I-9 procedure).
- **3 archived/consolidated records:** the historical one-time draft, the
  historical residential key authorization, and the duplicate employee
  confidentiality candidate consolidated into `LEG-37752488`.
- **30-row approval queue.**
- **27 full original-vs-revised comparison PDFs.**
- **4 fully populated sample execution packets** (Deep, Recurring, Commercial,
  Church).

## 2. Major deficiencies corrected

- Restored substantive contractual protections and procedures from the original
  agreements; the Core Terms again contain 29 numbered sections covering
  authority, scope, scheduling, access, no-key policy, commercial custody,
  customer responsibilities, unsafe work, reassessment, privacy, pricing, tax,
  payment, late payment, cancellation, satisfaction, damage, insurance,
  termination, e-signature, disputes, notices, amendments, general provisions and
  execution.
- Removed internal drafting commentary and hypothetical "target" language from
  customer-facing documents.
- Corrected the insurance representation to the owner-confirmed **$1,000,000 per
  occurrence / $2,000,000 general aggregate** language.
- Replaced the old broad governing-law section with a narrow Florida law/venue
  clause; no arbitration or class-action waiver was added.
- Restored the residential no-key rule and created a detailed Commercial Key
  Custody and Access Authorization.
- Restored the mandatory separately priced initial Deep Cleaning for recurring
  residential service.
- Preserved the 10% church discount, subject to the confirmed discount
  configuration.
- Rebuilt payment authorizations to distinguish current payment, recurring
  authorization, after-service charge, overdue invoice and added work.
- Corrected the employee handbook and timekeeping documents: **travel between
  job sites during the workday is compensable** and must not be hidden by clocking
  out.
- Kept the protected-activity carve-out in employee confidentiality and the
  separate role-specific restrictive-covenant structure.
- Corrected the logo throughout the package.

## 3. Logo correction

- Correct asset: `public/brand/sparkling-standard-circular-logo-1024.png`,
  rendered from the approved vector `public/brand/logo-primary.svg`.
- SHA-256: `0253b65fba7a90e63325b00bda5dfb15fb6d08f049e3f680c0a75895518ba237`.
- Later correction: the earlier `eb143b389efb54d304f70467ea16ce9383d8350f362814b00158bd95f68e1175` raster had fallback lettering. The corrected raster uses the approved Great Vibes/Fraunces lettering from `logo-primary.svg`.
- Obsolete mark: `public/brand/approved-icon-master-1024.png` (old stylized S).
  It is retained only as history and is not embedded in the corrected documents.
- Every corrected DOCX was checked for the correct embedded image hash; every
  review PDF was rendered with the correct circular mark.
- `docs/brand/LOGO-AUTHORITY.md` now records the correction, and
  `tests/legal-document-quality.test.ts` fails if the old mark or old
  insurance-target wording is reintroduced.

## 4. Clause coverage and comments

- Core Terms: all 18 original top-level sections accounted for; 15 retained and
  expanded, 1 with FRIENDS15 removed by owner decision, 1 insurance replaced with
  confirmed wording, 1 governing-law section replaced with a narrow clause.
- Service documents: **118 original sections retained/rewritten**; 11 documents
  with unstructured source text are covered by full-text comparison and marked
  for manual review rather than falsely claimed as automatically covered.
- **37 owner comments** are accounted for in
  `06-REPORTS/OWNER-COMMENT-DISPOSITION.md`.
- No original section row is flagged as an unexplained omission.

## 5. QA results

- Banned/internal phrase scan: **0** findings.
- Unresolved variables in PDFs: **0**.
- Correct logo in every DOCX: **yes**.
- Cross-document checks passed: insurance limits, no residential keys, mandatory
  initial Deep Cleaning, $40 cancellation ceiling, 15% simple late interest,
  church discount, e-signature, compensable travel.
- Contact sheet: `08-CONTACT-SHEET/LEGAL-DOCUMENT-COVERS.png` and `.pdf`.
- Sample packets:
  - `07-SAMPLES/DEEP-CLEANING-SAMPLE-PACKET.pdf` (21 pages)
  - `07-SAMPLES/RECURRING-SAMPLE-PACKET.pdf` (24 pages)
  - `07-SAMPLES/COMMERCIAL-SAMPLE-PACKET.pdf` (20 pages)
  - `07-SAMPLES/CHURCH-SAMPLE-PACKET.pdf` (18 pages)
- Each sample has a fully populated schedule, the complete agreement packet and
  a typed electronic-signature execution record with document hashes.

## 6. Legal/factual exceptions

See `06-REPORTS/EXCEPTION-REPORT.md` and
`06-REPORTS/LEGAL-QUALITY-REPORT.md`. Material open items:

- Insurance certificate verification.
- Church discount eligibility/exclusions/stacking confirmation.
- Commercial key custody approval and site-specific procedure.
- Property-manager authority and responsible payer for each property.
- Role-specific noncompetition schedule, territory, consideration and Florida
  CHOICE Act analysis; separate Alabama review.
- Live signing UI disclosure parity and paper-copy request path.
- Payroll/timekeeping configuration for compensable travel.
- Florida counsel review of high-risk fee, interest and cancellation language
  before activation.

## 7. Locations

`C:\Users\thoma\Downloads\SPARKLING STANDARD - MASTER\FINAL-APPROVAL-PACKAGE-2026-11-22\`

- `01-CUSTOMER-DOCX/`, `02-CUSTOMER-PDF/`
- `03-EMPLOYEE-DOCX/`, `04-EMPLOYEE-PDF/`
- `05-COMPARISONS/`
- `06-REPORTS/` (approval queue, coverage, comments, legal quality, exceptions,
  QA)
- `07-SAMPLES/`
- `08-CONTACT-SHEET/`
- `09-MANIFEST/VERSION-HASH-MANIFEST.json`
- `ARCHIVE-PRIOR-CANDIDATES-2026-11-22/`

Repo masters: `docs/legal/templates-v3/`, `docs/legal/employee-v3/`.

## 8. Approval instruction

Open `06-REPORTS/OWNER-APPROVAL-QUEUE-2026-11-22.xlsx`. For each active row,
read the exact comparison PDF, confirm the version and SHA-256, then record
**Approved exact version**, **Rejected** or **Deferred**, with initials and date.
Do not approve an archived/consolidated record for live use. No packet becomes
active until the exact version is approved and loaded into the production
template system.

## 9. Release branch and verification

- Branch: `release/2026-11-22-legal-signing-acceptance`
- Remediation commit: `72974f313497489ead55df9f187a236a7d34da68`
- PR: https://github.com/Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning/pull/1 (open; not merged)
- No merge, deployment, production migration or legal-packet activation.

Verification on the final tree:

- `npm test`: **1,006 tests — 1,005 pass, 1 pre-existing skip, 0 fail**
- `npm run test:browser`: **248 pass**
- `npm run check`: **0 errors**, 2 pre-existing hints
- `npm run build`: **40 pages**
- `npm run validate` and `npm run smoke`: passed
- Legal document quality guard: **5 pass**, including obsolete-logo and
  insurance-target reintroduction checks
- QA report: 0 banned phrases, 0 unresolved PDF variables, correct logo in every
  DOCX, all cross-document policy checks pass
