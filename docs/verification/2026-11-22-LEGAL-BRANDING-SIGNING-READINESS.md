> **Update 2026-11-22 18:01:** all 27 active candidates were owner-approved as
> exact versions. See `docs/verification/2026-11-22-OWNER-APPROVAL-STAGING-READINESS.md`.
> Statements below describing zero approvals are superseded.

# Legal Branding, Signing and Release Readiness — 2026-11-22

**Status:** working-tree release candidate. **No legal document is approved,
imported, activated or deployed. No Stripe charge was made. No merge or
production deployment was performed.**

## Repository state

| Item | Value |
|---|---|
| Branch | `release/2026-11-22-legal-signing-acceptance` |
| Starting HEAD | `66d392bcc68f07a03eb71f094376cf1c22334e44` |
| `production-safe` baseline | `459383d5618a304f56390bb542de77e7a332aed6` |
| Pull request | https://github.com/Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning/pull/1 — OPEN, MERGEABLE, head `66d392b` |
| Merge/deploy | Not performed; owner authorization required |

## Branding correction

The prior legal-package raster was a **fallback-font render**: the SVG text was
rasterized without the approved Great Vibes/Fraunces fonts. The official vector
and fonts were correct. The raster was re-rendered directly from the approved
vector with the embedded brand fonts.

| Item | Exact path / value |
|---|---|
| Official vector master used | `public/brand/logo-primary.svg` (SHA-256 `f4f0860e6a708b690a119b56ba931c2c9afe63f4f9c946a48c2d8480fbd09a4a`) |
| Official script font | `public/fonts/great-vibes-normal-latin.woff2` |
| Official wordmark font | `public/fonts/fraunces-normal-latin.woff2` |
| Corrected raster | `public/brand/sparkling-standard-circular-logo-1024.png` — SHA-256 `0253b65fba7a90e63325b00bda5dfb15fb6d08f049e3f680c0a75895518ba237` |
| Incorrect asset replaced | the same `sparkling-standard-circular-logo-1024.png` at SHA-256 `eb143b389efb54d304f70467ea16ce9383d8350f362814b00158bd95f68e1175`; its embedded lettering was fallback, not the approved brand lettering |
| Owner archive | `02 BRANDING & DESIGN\Brand Assets\02_Logos_and_Identity\Approved-Brand-Assets\sparkling-standard-circular-logo-1024.png` now carries the corrected hash |
| Fallback copy preserved | private `revision-backups\LOGO-CORRECTION-20261122-110140\sparkling-standard-circular-logo-1024-FALLBACK-FONT.png` |
| Old stylized S mark | `public/brand/approved-icon-master-1024.png` — still obsolete; never embedded |
| Candidate not approved | `Elegant Gold S Floral Emblem.png` moved out of the product repo to the owner archive |

### Branded outputs corrected

- **30/30 legal DOCX masters** now embed the corrected raster.
- **30/30 review PDFs** now display the corrected mark.
- **4 sample packets + 8 cover/schedule components + 4 execution records** now
  display the corrected mark and refreshed hashes.
- **Contact sheet PDF/PNG** regenerated from the corrected review PDFs.
- **27 registry review PDFs** synchronized; **27 comparison links** synchronized.
- **1 comparison PDF** (`LEG-AB060020`) regenerated for the owner-comment wording
  correction; the other comparisons contain no logo image.

### Branding verification

- DOCX image hash: **30/30** equal the corrected raster.
- Reviewed PDF logo crops: **30/30** closer to the corrected mark than the
  fallback mark; no PDF failed.
- Sample PDFs (packets, covers, schedules, executions): **16/16** passed the same
  visual comparison.
- A full-page render of the corrected mark matches the already-issued
  `icon-512.png` lettering (Great Vibes script, Fraunces STANDARD).
- Wording was not changed by the branding correction except two identification
  clarifications: the E-Sign Addendum now names Sparkling Standard LLC d/b/a
  Sparkling Standard Cleaning Co.; the I-9 procedure now names the employer.

## Document package

- **27 active documents** (17 customer/business, 10 employee).
- **3 archived/consolidated records** retained for history; not approvable.
- **37 owner comments** preserved across 12 documents; none discarded.
- **27 original-vs-revised comparisons** present.
- **4 populated sample execution packets** (Deep, Recurring, Commercial, Church).
- **Corrected package path:**
  `C:\Users\thoma\Downloads\SPARKLING STANDARD - MASTER\FINAL-APPROVAL-PACKAGE-2026-11-22\`
- **Packet matrix:** `docs/legal/PACKET-MATRIX-2026-11-22.md`.

## Owner approval

**0 of 27 approved. 27 remain unapproved. 0 imported. 0 active.**

Owner interface:

`C:\Users\thoma\Downloads\SPARKLING STANDARD - MASTER\00 START HERE\LEGAL-REVIEW\OPEN-LEGAL-REGISTRY.cmd`

Workflow: click **Final approval queue** → review the PDF → open **Comparison**
→ confirm exact version and DOCX SHA-256 → **Approve as written**, **Approve with
revisions**, **Reject** or **Defer** → save. Approval is exact-version/hash only.

The registry was verified in Chromium: 27 candidates in 10 service groups, 0
approved, 27 awaiting decision, no page errors.

## Signing and payment path

Implemented and preserved:

- Server-resolved agreement variables and unresolved-variable fail-closed.
- Template/version/hash snapshot at signing time.
- Executed combined PDF stored privately in R2 after signing.
- New: the signing page can **download the executed combined PDF** once every
  required document is signed. Executed download requires all required
  signatures; individual template PDFs remain available while in progress.
- New: the signing page discloses hardware/software requirements, paper-copy
  request, withdrawal of future consent, and contact-update obligations.
- New: property-management service codes resolve to the property-management
  packet and scope instead of residential.
- Signature record preserves signer, email, consent version, document version,
  content hash, timestamp, typed signature and execution evidence.

Still owner-gated:

- Approved-template import into D1.
- Packet/bundle activation and issuance of real signing links.
- Live cancellation/late/interest/collection notices (activation flags remain
  `false`).
- Production application of migration `0051` (development-only collections
  tables).

## Verification results

| Check | Result |
|---|---|
| Focused legal/signing tests | 24/24 pass |
| Full unit suite | **1,013 tests — 1,012 pass, 1 pre-existing skip, 0 fail** |
| Browser suite | **248/248 pass** |
| `astro check` | **0 errors**, 0 warnings, 2 pre-existing hints |
| Build | **40 pages** built successfully |
| `npm run validate` | 2,558 internal links, SEO, QR, GTM, checklist leak checks pass |
| `npm run smoke` | 21 pages pass |

## Stripe test-mode

`npm run stripe:checkout-sandbox` refused to run because no test-mode key is
configured:

```
MISSING STRIPE TEST KEY
Add a ROTATED test-mode key to .env: STRIPE_SECRET_KEY=sk_test_...
Nothing was sent. Never paste a live key here.
exit=2
```

No test Checkout Session, payment, webhook, refund or live charge was made. The
script correctly refuses live keys. Gate D is **blocked on owner-supplied
test-mode secrets**; do not paste secrets in chat.

## Backup and restore

The scheduled backup working-directory bug was found and fixed
(`scripts/backup/local-scheduled.ps1` now runs from the repository root).

New verified archive:

- `08 BACKUPS & ARCHIVE\SCHEDULED\sparkling-standard-backup-2026-11-22T17-34-27.ssbk`
- SHA-256 `a5a28060c6107cafd987392ce98b876e993b6ce830092804cad9e147a94dbb24`
- 2,275 files; 379,577,513 plain bytes.
- Fresh D1 export: 50 migrations, 95 tables, 0 foreign-key violations;
  11 customers, 10 properties, 15 appointments, 2 invoices, 36 leads,
  0 career applications, 0 signing requests.
- Isolated restore: **2,275 files**, same byte count, D1 verification `ok: true`.
- OneDrive upload was **skipped** for this local proof; cloud upload, round-trip,
  retention and live alert delivery remain owner actions.
- Prior verified archives remain preserved, including
  `sparkling-standard-backup-2026-11-22T07-24-41.ssbk`
  (SHA-256 `69236a1c…`) with an independently downloaded OneDrive copy and
  restore evidence.

## Migrations

- Repository migration files: **51** (`0001`–`0051`).
- Production D1 export in the new archive: **50 migrations**, 95 tables.
- `0051_legal_collections.sql` is **not applied**; it remains development-only.
- No new migration is required for the legal document package. Approved
  templates and packets are D1 rows created through the owner-controlled admin
  workflow, not schema migrations.

## Pensacola production readiness

The website and application code pass all required validation. The legal packet
is **not active**, so the production signing/packet path remains off. No merge or
deployment occurred. Pensacola is release-ready only after the owner approves the
exact document versions, the approved templates are imported, and the signing
packet is activated and tested.

## Tampa integration next steps

Tampa remains off. Before activation:

1. Complete branch identity, public phone/service description and pricing.
2. Configure a real Tampa travel origin and service area.
3. Add a branch-aware public estimator and scheduling path.
4. Enable scheduling, payments and fulfillment for the branch.
5. Re-run the visibility gate, estimator calibration and browser tests.
6. Owner authorization for production activation.

## Exact remaining owner actions

1. Approve/reject/defer the 27 exact document versions in the Legal Registry.
2. Supply rotated Stripe **test-mode** secrets locally and authorize the
   test-mode checkout/webhook run.
3. Authorize approved-template import and packet activation.
4. Authorize merge/deploy after acceptance.
5. Verify the commercial general liability certificate internally.
6. Confirm church-discount eligibility/stacking and the protected-activity
   carve-out remain approved.
7. Confirm the I-9 custodian in writing.
8. Complete a role schedule before using the noncompetition agreement.
9. Approve the paper-copy/withdrawal contact process.
10. Configure cloud backup upload, round-trip, retention and live alert delivery.

## Git status at report time

Modified: branding authority/doc references, two legal master clarifications, the
Core Terms owner-comment correction, signing endpoint/UI, property-management
service mapping, backup scheduler, logo generator and legal tests.
New: `docs/legal/PACKET-MATRIX-2026-11-22.md`,
`src/lib/documents/signing-download.ts`,
`tests/document-signing-download.test.ts`.
No commit, push, merge or deployment was performed.
