# Data recovery, review design and backup closeout - 2026-11-20

## Baseline

- Start HEAD: `ae8b51d`.
- Final application code: `e011105`.
- Production deployment: `df9fa304-c87c-4812-a5ad-47018356f999`.
- Branch: `production-safe`.

## Recovered prospect data

| Dataset | Actual | Location | Status |
|---|---:|---|---|
| Residential addresses | 4,241 | `canvass-out/master_addresses.csv` | Recovered |
| Owner-occupied homes | 3,892 | same file (`Owner_Occupied`) | Recovered |
| Residential routes | 66 | `canvass-out/routes.csv`, `route_object.json` | Recovered |
| Target neighborhoods | 20 | `canvass-out/master_addresses.csv` | Recovered |
| Residential tracking | 4,241 rows | `canvass-out/performance_tracking.csv` | Recovered |
| Commercial prospects | 800 | `canvass-out/commercial-prospecting/all_prospects.csv` | Recovered |
| Commercial workbook | 800 records / 26 sheets | `Sparkling_Standard_800_Commercial_Prospects.xlsx` | Recovered |
| Commercial routes | 56 groups | `route_index.csv` | Recovered |
| Commercial call queue | 800 | `call_queue.csv` | Recovered |

- 192 commercial Priority A, 521 B, 87 C.
- 731 public phones, 591 public websites, 12 Alabama/conditional, 0 contacted.
- 57-page commercial route PDF verified.
- Historical repository duplicate key files have identical SHA-256 checksums.
- Protected copies:
  - `10 PENSACOLA OPERATIONS\PROSPECTING\RESIDENTIAL-CANVASSING-2026-10-20`
  - `09 BUSINESS & INSTITUTIONAL SALES\02_PROSPECT_LISTS_PENSACOLA_AND_TAMPA\RECOVERED-COMMERCIAL-PROSPECTING-2026-10-20`
- Each recovery folder has `RECOVERY-MANIFEST.json`.

## Master document index

- `00 START HERE\MASTER-DOCUMENT-INDEX.csv`
- `00 START HERE\MASTER-DOCUMENT-INDEX.html`
- `00 START HERE\MASTER-INVENTORY-SUMMARY.md`
- Inventory: **1,932 files**, 504 prospect-related, 974 duplicate checksum files.
- Links are local file links; no address-level prospect data was committed to the repository.

## Review carousel

- Seven owner-approved reviews: Christina, Richard, Laura, Dennis D, K V, S Ismail, Rob & Christi Moore.
- Bob, Amanda and Elizabeth excluded.
- Consistent 35rem desktop cards / 33rem mobile cards.
- Long text opens an accessible **Read full review** dialog when it overflows.
- Laura's five blank-line gaps collapsed without changing words or punctuation.
- Dennis's two couch photos and Laura's shower photo preserved.
- No summary or selected-review disclaimer above cards.
- Final live screenshot: `docs/verification/2026-11-20-reviews-footer/live-reviews-final-desktop.png`.

## Backup coverage

- Full encrypted archive: 1,913 files, 2,574,394,734 plaintext bytes, 80 D1 tables.
- SHA-256 `d37e8046468c43df4f3bbbca52832b1bbd08597f28eb0eaa04113a42a8074d13`.
- 10 parts uploaded to private R2, downloaded again, rejoined, checksum-matched and verified.
- Application R2 objects: 88 objects (documents 0, lead photos 88), encrypted archive 8,459,129 bytes, SHA-256 `379eafe327140d066670edfa1dc57b396e4c46c55316b798ea43f5000037e2b9`; uploaded, downloaded and isolated-restore-verified.
- Independent OneDrive copy: `%USERPROFILE%\OneDrive\Sparkling Standard Backups\2026-11-20`, 13 files / 2,583,214,519 bytes, local SHA-256 parts match.
- Master report: `08 BACKUPS & ARCHIVE\BACKUP-2026-11-20.md`.

## Tampa Bay

- Independent Tampa pricing-version space is prepared; publishing Tampa pricing remains internal until owner review.
- Full booking activation remains blocked by missing branch-aware public estimator, branch-specific travel origin and scheduling path. A decorative activation switch was not added.
- Tampa inquiry page remains live and noindex; inquiries create Tampa leads, not bookings.

## Validation

- `npm run check`: 0 errors, 0 warnings, 2 pre-existing hints.
- Build: 37 pages.
- `npm run validate`: pass.
- No-fabrication audit: pass.
- Unit: 907 tests, 906 pass, 1 pre-existing skip, 0 fail.
- Browser: 228 pass, 0 fail.
- GitHub CI on `e011105`: success.

## Remaining owner actions

- Confirm OneDrive synchronization and store the encryption key in the owner password manager plus an independent recovery location.
- Enable GitHub scheduled backup secrets.
- Approve a second independent provider if OneDrive is not sufficient.
- Complete Tampa's branch-aware booking/travel implementation before any public booking activation.
- Review Tampa pricing when published.
