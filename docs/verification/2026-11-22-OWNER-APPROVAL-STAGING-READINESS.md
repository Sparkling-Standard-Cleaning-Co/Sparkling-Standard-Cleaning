# Owner Approval, Staging Import and Admin Signing Readiness — 2026-11-22

**Status:** Pensacola release candidate. **No production import, activation,
deployment, merge, live charge or customer signing link was created.**

## 1. Persisted owner approvals

The authoritative Legal Registry data file was reloaded through the local
registry server, not the browser's standalone localStorage.

| Item | Result |
|---|---:|
| Active documents | 27 |
| Owner-approved exact versions | **27** |
| Awaiting final decision | **0** |
| Archived/consolidated records | 3, excluded |
| Approvals matching the current corrected DOCX SHA-256 | **27/27** |
| Approvals referencing a pre-logo-correction hash | **0** |

Approval timestamps span `2026-11-22T17:52:49Z` to `2026-11-22T18:00:58Z`.
The owner comments and decision history remain preserved.

## 2. Immutable approval records

| Record | Path | SHA-256 |
|---|---|---|
| Approved-version manifest | `00 START HERE\LEGAL-REVIEW\APPROVED\APPROVED-VERSION-MANIFEST-2026-11-22.json` | `c435456eb740bbdfa3e9ad83b0c62986bb3814f02b968804f3c8f25e9e8e1453` |
| Approval snapshot (records, history, comments) | `00 START HERE\LEGAL-REVIEW\APPROVED\APPROVAL-SNAPSHOT-2026-11-22.json` | `46b04611cdafff79edcab329d67c753a306ddf20078feaf3b0bde4324640b15e` |
| Checksums | `00 START HERE\LEGAL-REVIEW\APPROVED\SHA256SUMS.txt` | — |

Every active approval names the exact DOCX version and SHA-256. Archived records
are excluded. Approval is not carried forward to a changed file.

## 3. Descriptive Word/PDF library

**Location:**
`C:\Users\thoma\Downloads\SPARKLING STANDARD - MASTER\FINAL-APPROVAL-PACKAGE-2026-11-22\10-APPROVED-LIBRARY\`

- `Customer\` — descriptive `.docx` and matching `.pdf` for each customer
  agreement.
- `Employee\` — descriptive `.docx` and matching `.pdf` for each employee
  document.
- `APPROVED-LIBRARY-INDEX.json` — document ID, version, filename and SHA-256.
- `README.md` — human-readable index.

Example filenames: `Core Cleaning Service Terms.docx`,
`Core Cleaning Service Terms.pdf`, `Residential Deep Cleaning Agreement.docx`,
`Property Manager - Real Estate Master Service Agreement.pdf`.

The original package ZIP-style identifiers remain in `01-CUSTOMER-DOCX`,
`02-CUSTOMER-PDF`, `03-EMPLOYEE-DOCX`, `04-EMPLOYEE-PDF`, the manifest and the
registry. The descriptive library is the owner-facing copy.

## 4. Staging import verification

An isolated SQLite/D1 staging database was created from all repository
migrations. Only the 27 approved templates were inserted. No archive document
was inserted.

**Staging evidence:**
`FINAL-APPROVAL-PACKAGE-2026-11-22\11-STAGING-VERIFICATION\`

| Packet | Documents | Required | Dynamic variables | Completed PDF |
|---|---:|---:|---|---|
| Residential Deep / One-Time | 9 | 6 | All resolved | Yes |
| Residential Agreement fallback | 9 | 6 | All resolved | Yes |
| Recurring Residential | 11 | 7 | All resolved | Yes |
| Move-In / Move-Out | 8 | 5 | All resolved | Yes |
| Short-Term Rental | 8 | 5 | All resolved | Yes |
| Commercial | 7 | 4 | All resolved | Yes |
| Church / Facility | 7 | 4 | All resolved | Yes |
| Property Management / Real Estate | 9 | 5 | All resolved | Yes |
| Specialty / Add-On | 5 | 5 | All resolved | Yes |
| Employee Onboarding | 10 | 9 | All resolved | Yes |

- Staging templates: **27 approved**.
- Active non-system packets: **10**.
- Archived templates imported: **0**.
- Missing variables across all packets: **0**.
- Completed customer-readable PDFs generated: **9 customer packets + 1 employee
  packet**.
- End-to-end staging signature request: **signed**.
- Executed combined PDF generated: `deep-executed-signed.pdf`,
  SHA-256 `f7041cc773bd8b55854deab3408d17a95b26bc1f872a1b8065ab0e3fe497b0b4`.

This proves the existing template/signing engine can resolve approved documents,
build every service packet, populate dynamic values and generate a completed
PDF. It does **not** prove a production D1/R2 import; that remains owner-gated.

## 5. Admin Document Composer

The existing Documents & Agreements admin was extended; no duplicate system was
created.

Implemented:

- Admin-selected packet and service context.
- Existing customer/property/employee identifiers; new customers continue to be
  created in the existing Customers view.
- Admin-entered scope, additions, exclusions, service date, arrival window,
  price summary, line items, tax, discount, payment terms and cancellation
  terms.
- Backend allow-list and length limits for admin-editable variables. Company
  identity and approved clauses are not editable.
- **Live paper-style preview** in a resizable split-screen pane.
- Section navigation, zoom (80–150%), full-screen preview and print/save-to-PDF.
- Unresolved-variable blocking before a link can be created.
- **Save draft link** (creates the signing request without sending email).
- Create-and-send signing link.
- Existing request tracking: pending/partially signed/signed/expired/void,
  signature status, executed-copy download and signature download.
- Existing customer admin history and portal document history remain the
  retrieval paths.
- Live signing is server-gated: `createSigningRequest` fails closed with
  `electronic_signing_not_activated` until the owner-authorized activation flag
  is deployed. The checkout document gate is bypassed while signing is inactive.

The packet builder browser test now additionally verifies the live preview,
admin-entered variables, draft control, zoom control and iframe rendering.

## 6. Executed-document immutability

- Executed PDFs remain private in R2 under `documents/executed/…`.
- A re-signed request no longer silently overwrites an earlier executed PDF: if
  the existing artifact hash differs, the new artifact is stored under a
  versioned key that includes the executed SHA-256.
- Signature rows, exact document versions, content hashes, signer, consent
  version and timestamps remain immutable evidence.
- The signing page downloads the combined executed PDF only after every required
  document is signed.
- The customer portal already lists signing requests, executed documents and
  signature records for the authenticated customer.

## 7. Stripe payment evidence

A real live **$5 invoice payment** exists and was verified from production D1:
payment `payment_439a2b1e-a925-4e5d-a8ce-d79cfcde5323`, succeeded, invoice
`INV-20261119-1106A9` paid with zero balance, one payment for the session, zero
reconciliation issues, and a webhook-created `invoice.stripe_paid` audit entry.
Full evidence and limitations:
`docs/verification/2026-11-22-STRIPE-5-DOLLAR-VERIFICATION.md`.

It proves live invoice payment, webhook processing and invoice reconciliation.
It does **not** prove estimate → hold → agreement → signature → payment →
booking, because it has no booking request, no signing request and no
post-payment receipt row. The new signing/payment/booking path is covered by
automated integration/browser tests and a staging signing execution.

Test mode is **not** a mandatory release gate. No new charge or test transaction
was made. The newly configured Cloudflare `STRIPE_TEST_SECRET` is present but
write-only; its value is not available in this local environment, so a real
sandbox E2E run remains blocked by secret-value access. See
`docs/verification/2026-11-22-STRIPE-SANDBOX-ACCESS.md`.

## 8. Backup and restore

New archive after approvals and staging:

- `08 BACKUPS & ARCHIVE\SCHEDULED\sparkling-standard-backup-2026-11-22T19-02-57.ssbk`
- SHA-256 `b89c5ed91e2a3d2a4f1912b1c32f6953ca758303ddd5b9f1d2066302e4eeda75`
- 2,352 files; 393,904,973 plain bytes.
- Fresh D1 export: 50 migrations, 95 tables, 0 foreign-key violations.
- Isolated restore: **2,352 files**, same byte count.
- Restored D1 verification: migrations **50**, tables **95**, foreign-key
  violations **0**.
- Confirmed included in restore: approval snapshot, approved manifest/library,
  staging report.

OneDrive upload, round-trip and retention were skipped for this local proof.
The prior independently downloaded OneDrive archive remains preserved. Cloud
upload and live alert delivery remain owner actions.

## 9. Verification results

| Check | Result |
|---|---|
| `astro check` | **0 errors** (2 pre-existing hints) |
| Focused legal/signing tests | 5/5 pass |
| Focused signing/payment/checkout tests | 48/48 pass |
| Full unit suite | **1,016 tests — 1,015 pass, 1 pre-existing skip, 0 fail** |
| Full browser suite | **248/248 pass** |
| Build | **40 pages** |
| `validate` | 2,558 links, SEO, QR, GTM, checklist checks pass |
| `smoke` | 21 pages pass |
| Staging import | 27 templates, 10 packets, 0 missing variables, 0 errors |

The first full browser run had one address-autocomplete timing flake; the test
passed 5/5 in isolation and the complete suite then passed 248/248.

## 10. Remaining production blockers

1. **Production template/packet import** — staging is proven; production D1/R2
   import requires separate owner authorization.
2. **Production signing activation** — no customer signing link has been issued.
3. **Real signing → payment → booking charge** — the existing $5 transaction is
   invoice-only. A real end-to-end paid signed booking remains an optional
   owner-authorized acceptance step; it is not a mandatory gate and no new charge
   was made.
4. **Merge/deploy** — no commit, push, merge or Cloudflare deployment was
   performed.
5. **Cloud backup upload/round-trip/retention/live alerts** — not verified in
   this run.
6. Production migration `0051` remains unapplied by design.

## 11. Controlled release plan

1. Owner authorizes production template/packet import.
2. Import the 27 approved templates and activate the 10 packets in production.
3. Run one synthetic production signing request, then delete/void the test
   record according to the approved procedure.
4. Optionally authorize one real end-to-end paid signed booking as production
   acceptance; the existing $5 invoice transaction is not a mandatory gate.
5. Commit the release branch, open/update PR #1 against `production-safe`, and
   require green CI.
6. Deploy with Cloudflare Pages rollback to the current production deployment
   `edc50a01` (or the immediately preceding verified deployment) if any gate
   fails.
7. Re-test the live site without creating a live charge.

## 12. Admin organization

The admin navigation is now grouped by department: Overview, Operations, Sales
& Marketing, Finance, Documents & Compliance, and System & Security. All prior
admin screens remain available. The planned Marketing Center is documented in
`docs/marketing/ADMIN-MARKETING-CENTER-PLAN.md`; no separate marketing rebuild
or UTM replacement was started.

No production activation is inferred from this document.
