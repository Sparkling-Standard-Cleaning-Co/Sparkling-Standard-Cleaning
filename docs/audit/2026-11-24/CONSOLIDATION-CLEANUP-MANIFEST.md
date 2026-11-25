# Consolidation and cleanup manifest - 2026-11-24

The workspace was reconciled on 2026-11-24. A reversible cleanup was performed;
no file was deleted.

**Executed reversible actions:**

1. Disabled two obsolete scheduled tasks that pointed at the old unspaced
   Downloads workspace.
2. Renamed `Downloads\Sparkling-Standard-Master` to
   `Downloads\Sparkling-Standard-Master-LEGACY-ARCHIVE-2026-11-24`.
3. Updated its `OPEN BUSINESS WORKSPACE.lnk` target.
4. Moved the obsolete `ARCHIVED-READ-ONLY.md` claim into the cleanup archive.
5. Updated the active business start page and the Documents README.
6. Generated a complete duplicate-file manifest in the cleanup archive.

## 1. Actual roots found and final roles

| Root | Files (non-build, non-backup) | Unique files | Final role |
| --- | ---: | ---: | --- |
| `C:\Users\thoma\Documents\Sparkling-Standard-Master` | 3,528 | 703 (32.8 MB) | **Active website/engineering workspace** - live Git checkout |
| `C:\Users\thoma\Downloads\SPARKLING STANDARD - MASTER` | 3,108 | 963 (512.4 MB) | **Active business, legal and employee master** - owner start page and scheduled backup source |
| `C:\Users\thoma\Downloads\Sparkling-Standard-Master-LEGACY-ARCHIVE-2026-11-24` | 3,979 | 330 (20.9 MB) | **Legacy archive** - previous unspaced workspace, preserved |

The active live repository is
`Documents\Sparkling-Standard-Master\01-Website-Repository`. The spaced
Downloads master holds the largest unique legal/employee set and must not be
merged or deleted blindly.

## 2. Duplicate analysis

Method: SHA-256 hashes for 10,615 files across the three roots after excluding
`.git`, `node_modules`, `.astro`, `dist`, generated output folders, backup
archives and `_PRIVATE_BACKUPS`.

| Measure | Result |
| --- | ---: |
| Exact duplicate hash groups | 2,547 |
| Files participating in duplicate groups | 8,619 |
| Duplicate copies beyond the retained path | 6,072 |
| Estimated duplicate bytes | about 2.4 GB |

Detailed retained-path manifest:
`Documents\Sparkling-Standard-Master\99-Archive-For-Review\2026-11-24-MASTER-CLEANUP\DUPLICATE-FILES-2026-11-24.csv`.

Largest duplicate families:

- Door-knocking and print-stage review artwork repeated across
  `Downloads\07_ARCHIVE_AND_REVIEW`, `Documents\04-Marketing-and-Social` and
  `Documents\05-Business-Operations\Business HQ\99_ARCHIVE`.
- Pricing audit CSVs repeated inside
  `Documents\PRICING-AUDIT-2026-10-30` and the Downloads business-operations tree.
- Website verification images and white-tile icons repeated between the old
  Downloads checkout, `02_BRANDING_AND_DESIGN` and the active repository.
- Helpers such as `src/lib/admin/auth.ts` present in both checkout copies.

The detailed retained-path manifest is stored in the cleanup archive at
`Documents\Sparkling-Standard-Master\99-Archive-For-Review\2026-11-24-MASTER-CLEANUP\DUPLICATE-FILES-2026-11-24.csv`.

## 3. Active resources (keep in place)

| Resource | Reason |
| --- | --- |
| `Documents\...\01-Website-Repository` | Live Git checkout and deployment source. |
| `Documents\...\08-Backups` | Protected backup material (110 MB). Never delete from this audit. |
| `Documents\...\09_VERIFICATION_EVIDENCE` | Current release evidence. |
| `Documents\...\backups\2026-11-10-reconciliation` | Contains encrypted production backup material and recovery notes. Protected. |
| `Downloads\Sparkling-Standard-Master-LEGACY-ARCHIVE-2026-11-24\_PRIVATE_BACKUPS` | Protected private recovery material. Never delete from this audit. |
| `Downloads\Sparkling-Standard-Master-LEGACY-ARCHIVE-2026-11-24\09_BACKUPS_AND_EXPORTS` | Older backup/export copies. Protected until restore verification and retention policy are confirmed. |
| Legal, formation, insurance, financial and executed-document files in all trees | Business-critical. Preserve. |

## 4. Executed cleanup and remaining candidates

| Candidate | Evidence | Action taken or proposed |
| --- | --- | --- |
| Old unspaced Downloads workspace | 3,979 files, 330 unique; not used by current tasks after the two duplicate tasks were disabled | **Renamed to the dated legacy archive.** No deletion. |
| Two old scheduled backup tasks | Pointed into the legacy `_PRIVATE_BACKUPS\bin` | **Disabled.** Current daily/weekly/health tasks remain active. |
| 6,072 redundant duplicate copies | About 2.4 GB; retained paths recorded in the manifest | **Proposed deletion only.** Owner approval required. |
| 47 empty directories | `EMPTY-DIRECTORIES.txt` | Left for owner review. |
| `Documents\99-Archive-For-Review` | Historical archive | Keep as archive; do not mix into active folders. |

## 5. Reversal plan for executed actions

1. Rename `Downloads\Sparkling-Standard-Master-LEGACY-ARCHIVE-2026-11-24`
   back to `Downloads\Sparkling-Standard-Master`.
2. Re-enable the two historical scheduled tasks only if restoring the old
   workspace.
3. Restore the old `OPEN BUSINESS WORKSPACE.lnk` target if needed.
4. Move `SUPERSEDED-ARCHIVED-READ-ONLY-2026-10-30.md` back only to correct the
   historical record.
5. No business record, backup or executed document was deleted, so no data
   restoration is required for this cleanup.

## 6. Deletion approval boundary

No duplicate file may be permanently deleted until the owner reviews
`DUPLICATE-FILES-2026-11-24.csv` and approves the retained paths. The manifest
retains one copy under the priority: active Documents workspace, active spaced
business master, legacy archive.

## 7. Protected records - never delete in cleanup

- Executed agreements, signatures, signing evidence and hash manifests.
- Invoices, receipts, payments, refunds, gift ledgers and tax records.
- Formation documents, insurance, licenses, I-9 and employee records.
- Encrypted backups and their keys.
- Customer photos under legal hold.
- Any file whose owner or legal retention requirement is unknown.
