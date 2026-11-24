# Consolidation and cleanup manifest - 2026-11-24

No file in either master workspace was moved, renamed or deleted during this
audit. This is a reviewed manifest and a reversible proposal, as required before
mass cleanup.

## 1. Actual roots found

| Root | Files | Size | Latest activity | Classification |
| --- | --- | ---: | --- | --- |
| `C:\Users\thoma\Documents\Sparkling-Standard-Master` | 24,190 (including build output) | about 1.25 GB | 2026-11-24 | **Active master** - contains the live checkout |
| `C:\Users\thoma\Downloads\Sparkling-Standard-Master` | 21,401 (excluding private backups) | about 1.7 GB | 2026-11-23 | **Legacy/duplicate master** - contains a stale checkout and older archive tree |

The active repository is `Documents\Sparkling-Standard-Master\01-Website-Repository`.
The Downloads tree still contains an older `01_WEBSITE_REPOSITORY` last modified
2026-11-07, which is not the deployed checkout.

## 2. Duplicate analysis

Method: SHA-256 hashes for 7,506 files after excluding `.git`, `node_modules`,
`.astro`, `dist`, generated output folders and `_PRIVATE_BACKUPS`.

| Measure | Result |
| --- | ---: |
| Exact duplicate hash groups | 1,985 |
| Files participating in duplicate groups | 6,247 |
| Estimated duplicate bytes | about 1.03 GB |

Largest duplicate families:

- Door-knocking and print-stage review artwork repeated across
  `Downloads\07_ARCHIVE_AND_REVIEW`, `Documents\04-Marketing-and-Social` and
  `Documents\05-Business-Operations\Business HQ\99_ARCHIVE`.
- Pricing audit CSVs repeated inside
  `Documents\PRICING-AUDIT-2026-10-30` and the Downloads business-operations tree.
- Website verification images and white-tile icons repeated between the old
  Downloads checkout, `02_BRANDING_AND_DESIGN` and the active repository.
- Helpers such as `src/lib/admin/auth.ts` present in both checkout copies.

Full hash inventory for this audit was generated outside the product repository
and is not committed because it contains local file paths.

## 3. Active resources (keep in place)

| Resource | Reason |
| --- | --- |
| `Documents\...\01-Website-Repository` | Live Git checkout and deployment source. |
| `Documents\...\08-Backups` | Protected backup material (110 MB). Never delete from this audit. |
| `Documents\...\09_VERIFICATION_EVIDENCE` | Current release evidence. |
| `Documents\...\backups\2026-11-10-reconciliation` | Contains encrypted production backup material and recovery notes. Protected. |
| `Downloads\_PRIVATE_BACKUPS` | Protected private recovery material. Never delete from this audit. |
| `Downloads\09_BACKUPS_AND_EXPORTS` | Older backup/export copies. Protected until restore verification and retention policy are confirmed. |
| Legal, formation, insurance, financial and executed-document files in both trees | Business-critical. Preserve. |

## 4. Superseded or duplicate material (proposal only)

| Candidate | Evidence | Proposed action |
| --- | --- | --- |
| `Downloads\01_WEBSITE_REPOSITORY` | Stale checkout last modified 2026-11-07; live checkout is in Documents | Archive, not delete. Verify no unique untracked owner files first. |
| `Downloads\00_START_HERE` | Navigation for the older layout | Replace with a pointer to the active master start page, then archive. |
| `Downloads\07_ARCHIVE_AND_REVIEW` | 290 MB, largely duplicated in the active master | Deduplicate exact hashes; keep one archive copy. |
| `Documents\PRICING-AUDIT-2026-10-30` | 49 MB; duplicated audit CSVs inside itself and Downloads | Keep one canonical copy in the archive section. |
| `Documents\99-Archive-For-Review` | 404 files, 10 MB | Keep as archive; do not mix into active folders. |
| Empty directories listed below | No files | Safe to remove after approval. |

### Empty directories observed (examples)

- `Documents\...\05-Business-Operations\Business HQ\01_BUSINESS_ADMIN\Licensing_and_Insurance`
- Several `Previous_Versions`, `Blank_Agreements`, `Customer_Communication_Templates`, `Customer_Intake_Forms`, `Residential_Sales`, `Deep_Cleaning`, `Move_In_Move_Out`, `Quality_Control`, `Residential_Cleaning`, `Safety_and_Procedures`, onboarding and growth subfolders.
- `Downloads\...\_PRIVATE_BACKUPS\work\...` staging folders after completed backups.

## 5. Proposed shallow target organization

Do not create another numbered maze. Use the existing active master and a
single explicit archive:

```text
Documents\Sparkling-Standard-Master\
  01-Website-Repository\        (active code and docs)
  Brand\                        (current approved brand masters)
  Marketing\                    (current marketing source assets)
  Operations\                   (current procedures, templates, employee material)
  Legal-and-Finance\            (current legal, formation, insurance, financial records)
  Evidence\                     (current verification evidence)
  Backups\                      (protected, never mixed with working files)
  Archive-2026-11-24\           (superseded material with a manifest)
```

Moving to this layout is **not authorized by this audit**. The owner should
approve the specific move list first.

## 6. Reversal plan

Because no move or deletion was performed, rollback is currently a no-op.

If the proposal is approved:

1. Record `git status` and close the repository checkout.
2. Copy (do not move) the approved candidates to
   `Documents\Sparkling-Standard-Master\Archive-2026-11-24` preserving relative
   paths.
3. Hash-verify each copied file against the source.
4. Update `START-HERE` links and shortcuts.
5. Only then remove the source duplicates, retaining a CSV move manifest with
   old path, new path, size and SHA-256.
6. Keep `Downloads\_PRIVATE_BACKUPS`, `Downloads\09_BACKUPS_AND_EXPORTS` and all
   legal/financial/executed records untouched.

## 7. Protected records - never delete in cleanup

- Executed agreements, signatures, signing evidence and hash manifests.
- Invoices, receipts, payments, refunds, gift ledgers and tax records.
- Formation documents, insurance, licenses, I-9 and employee records.
- Encrypted backups and their keys.
- Customer photos under legal hold.
- Any file whose owner or legal retention requirement is unknown.
