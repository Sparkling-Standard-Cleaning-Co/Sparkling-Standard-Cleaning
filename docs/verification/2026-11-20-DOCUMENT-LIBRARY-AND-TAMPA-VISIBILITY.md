# Document library branding and Tampa public visibility - 2026-11-20

## Baseline

- Starting HEAD: `3287870`; application code `6ea55d7`.
- Migration `0042_branch_origins.sql` applied.
- No owner origin values were invented.

## Document library

- Inspected all 18 residential forms RES-001 through RES-018.
- Every one embedded the same outdated gold-S floral PNG:
  SHA-256 `ecad7fff9e3c5a3c3768947e86487302f103e84c56b8a71e46533b450dae4b3d`.
- The approved current mark is the Sparkling STANDARD circular wordmark in
  `02 BRANDING & DESIGN/Brand Assets/02_Logos_and_Identity/Approved-Brand-Assets/icon-512.png`
  (used by `logo-primary.svg`). The untracked `public/brand/Elegant Gold S Floral Emblem.png`
  was not used and is not treated as approved.
- The old image was also present in employee, commercial, STR, sales, operations, SOP, checklist,
  job-packet and template Word files.
- Created an owner-review library at:
  `C:\Users\thoma\Downloads\SPARKLING STANDARD - MASTER\04 CUSTOMERS & OPERATIONS\DOCUMENT-LIBRARY-2026-11-20`
- Created the entry point:
  `C:\Users\thoma\Downloads\SPARKLING STANDARD - MASTER\00 START HERE\OPEN-DOCUMENT-LIBRARY.html`
- 183 editable Word documents were copied for review. 176 review copies had the old logo replaced
  with the approved wordmark; the remaining documents had no old-logo image.
- Original files were not modified. Review copies preserve original document content.
- Index: `DOCUMENT-LIBRARY-INDEX.csv` and `DOCUMENT-LIBRARY-INDEX.json`.
- Legal review topics: `LEGAL-REVIEW-NOTES.md`.
- Every document remains **owner review required**. No document was approved, uploaded or sent.

## Tampa public visibility

- Added a production-host-only middleware gate. Local preview and browser tests are unchanged.
- Tampa public page `/locations/tampa-bay/` returns 404 with `noindex` unless the persisted branch
  is `live` and `active`.
- Service-area HTML suppresses the Tampa card and uses the single-region heading when Tampa is off.
- When the persisted branch is live and active, the Tampa card and two-region heading are retained.
- The sitemap already excludes `/locations/tampa-bay`.
- No Tampa data is deleted by the visibility gate.
- Tampa cannot be made live until its readiness blockers are resolved; the gate therefore defaults
  to OFF in production.

## Tests

- Unit suite: **940 tests, 939 pass, 1 pre-existing skip**.
- New visibility tests: 5 pass.
- Browser suite: 232 pass.
- Build: 37 pages.
- Validation: pass.

## Deployment and live verification

- Final application HEAD: `397be7b`.
- Cloudflare Pages deployment: `144f1239-5fbc-44a9-b83b-c89d761b150e`.
- `https://sparkling-standard.com/locations/tampa-bay/` returns **404**.
- `/service-area/` contains the single-region heading and no Tampa card.
- Homepage contains no Tampa text and retains the approved residential/commercial title.

## Still incomplete

- Tampa estimator, booking, payments, scheduling and recurring customer workflow.
- Actual document approval, packet population and signature enforcement.
- Backup key independence, OneDrive remote verification and default-branch backup workflow.
- Full server-driven admin pagination.
- Dispatch profile completion and real production activation.
