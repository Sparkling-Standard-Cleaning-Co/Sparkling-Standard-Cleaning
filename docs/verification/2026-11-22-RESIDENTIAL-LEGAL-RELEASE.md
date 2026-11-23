# Pensacola Residential Legal Release — 2026-11-22

**Status:** deployed to production. The 27 owner-approved legal documents are
imported, the four verified residential packets are active, required customer
agreements are enforced before payment, and booking-specific agreements require
a new signature for each booking. Facility online payment remains closed. No
live charge, refund or customer message was created by this release.

## Repository and deployment

| Item | Value |
|---|---|
| Branch | `release/2026-11-22-legal-signing-acceptance` |
| Starting HEAD | `2cb2403097fc5c8dbbf7e4305b7d6368847a093d` |
| Enforcement and policy-viewer commit | `22abd43` |
| Document revision review commit | `704fb25` (wording fix `043f509`) |
| Facility payment gate commit | `0e91966` |
| Production branch | `production-safe` |
| Production HEAD | `5c4ac411a317556eccb740589b79a9c1c459f456` |
| Production deployment | `344ad883-c87a-4baf-b0f4-f34eef27988c` |
| Prior rollback deployment | `4ea44ba4-20e8-45ac-961c-e9ab3dbb8b73` (`717efe5`) |
| Pull requests | #1 enforcement/release, #2 document updates, #3 facility payment |

All three pull requests passed the `validate` and `browser` GitHub Actions
checks before merge.

## Legal library import

The controlled import used
`scripts/legal/prepare-production-import.mjs`, the approved manifest, the
staging import data and the production owner admin account. It verified 27/27
manifest records, exact versions, approved DOCX hashes in packet notes and
staging text hashes before generating SQL. The executed SQL SHA-256 was
`83cebffd45450edec0be7fc89183f89400ea21ab8ed16ca97f8db06ebe22f1d7`.

Production D1 result:

| Check | Result |
|---|---:|
| Approved templates | 27 |
| Draft templates from the import | 0 |
| Imported non-system packets | 10 |
| Bundle items | 83 |
| Active packets | 4 |
| Legal import audit records | 37 |
| Migration `0051` | **not applied** |

Active packets: `customer.deep`, `customer.residential`, `customer.recurring`,
`customer.move_in_out`. Imported inactive: STR, commercial, church, property
management, specialty/add-ons and employee onboarding.

Every required customer item is `before_payment`. Booking-specific items are
`per_booking = 1`. The runtime additionally corrects any required customer item
stored as `before_confirmation` to `before_payment`, so the gate cannot be
bypassed by imported configuration.

## Imported-data verification

An isolated local SQLite restore of the post-import production export was used
to exercise the actual service code without creating production customer records.

| Packet | Documents | Required | Per-booking | Missing variables |
|---|---:|---:|---:|---:|
| Residential Deep | 9 | 6 | 4 | 0 |
| Residential fallback | 9 | 6 | 4 | 0 |
| Recurring Residential | 11 | 7 | 5 | 0 |
| Move-In / Move-Out | 8 | 5 | 3 | 0 |
| Short-Term Rental | 8 | 5 | 3 | 0 |
| Commercial | 7 | 4 | 3 | 0 |
| Church / Facility | 7 | 4 | 3 | 0 |
| Property Management | 9 | 5 | 4 | 0 |
| Specialty / Add-Ons | 5 | 5 | 2 | 0 |
| Employee onboarding | 10 | 9 | 0 | 0 |

Deep Cleaning signing lifecycle on that restored data:

- checkout gate before signing: **not satisfied**;
- required documents: **6**;
- signing completed with all six typed signatures: **signed**;
- checkout gate after signing: **satisfied**;
- executed combined PDF: **120,007 bytes**, SHA-256
  `6f1f1e68c7265a582e1e5525a5e3f5098d12fad21d75445a3d5858ae020e17c1`;
- a different booking reference: gate **not satisfied**, no reusable request.

## Live production checks

| Check | Observed |
|---|---|
| Homepage | `200` |
| Residential estimator | `200` |
| Terms page | `200` |
| In-page policy viewer present on estimator and gift page | yes |
| `/api/estimate-checkout` readiness | `enabled: true`, mode `live`, all checks true |
| `/api/lead-readiness` | `ready: true` |
| Invalid signing token | `404 signing_link_invalid` |
| Unauthenticated admin documents API | `401 unauthorized` |
| Admin page contains Document Updates | yes |
| Direct facility checkout attempt | `409 facility_payment_not_activated` |
| Live signing requests | **1 owner-initiated recurring request, pending** (created by the owner after activation; not created, signed or messaged by this release) |
| Live charge / refund / customer message by this release | none |

The live owner-initiated request demonstrates that the production checkout gate
created a signing request instead of opening Stripe. It was not touched.

## Terms and privacy viewer

The checkout acknowledgment now opens the policy in a native accessible modal,
preserves the estimator state, leaves acceptance unchecked until the customer
checks it, supports Escape/close/focus restoration, offers a full-page new-tab
link, and works on desktop and phone. Browser coverage:
`tests/browser/legal-policy-dialog.test.mjs` (desktop and 390 px phone).

## Document revision review

**Admin → Documents & Agreements → Document Updates** now reports each revision,
the affected packets, executed customers, the re-signing queue, upcoming
appointments and owner acknowledgement (material vs formatting/nonmaterial).
Creating a revision records an owner notification in the audit trail and sends
an owner email when Resend and `OWNER_NOTIFICATION_EMAIL` are configured.
Nothing is sent to a customer automatically; **Use in composer** prefills the
existing composer.

No automated batch sending, scheduled re-signing reminders, or automatic legal
acceptance was added. Those remain a later controlled enhancement.

## Facility and specialty status

- Tier A/B preliminary facility numbers and the **Request to Reserve (Pay
  Later)** path remain available.
- Facility Pay Now is hidden in the browser and rejected server-side until the
  commercial/church packets and their payment workflows pass their own
  acceptance run.
- STR, property management, specialty and employee packets are imported but
  inactive.
- No claim is made that those automated checkout workflows are fully
  operational.

## Backup and rollback

| Item | Evidence |
|---|---|
| Pre-release D1 export | `d1-20261122-232315.sql`; SHA-256 `e6ffd7a255287b7952d0c871f6fefb570907ec726690de663f2ad9034c73ea6d`; 50 migrations, 95 tables, 0 FK violations; restored in memory |
| Encrypted archive | `sparkling-standard-backup-2026-11-22T23-23-31.ssbk`; SHA-256 `76518740c9e8b10c10d7b5ac9883cca64b77be8e1fd5bd6a544082f611ef9d33`; 2,370 files; integrity `ok` |
| Archive verification | `backup:verify` reported `ok: true`, D1 integrity `ok` |
| OneDrive upload | **failed with `fetch failed`** twice; the verified archive remains local. This is a residual off-site gap, not a production-data loss. |
| Rollback target | Pages deployment `4ea44ba4-20e8-45ac-961c-e9ab3dbb8b73` (`717efe5`) |
| Legal rollback | set `electronicSigning` and `productionLegalDocuments` false, redeploy; set residential packets inactive; retire imported templates rather than deleting audit/history |

## Verification results

| Check | Result |
|---|---|
| Full unit suite | **1,036 tests — 1,035 pass, 1 pre-existing skip, 0 fail** |
| Full browser suite | **252/252 pass** (final rerun; one unrelated admin manual-booking timing flake passed in isolation and on the final full rerun) |
| `astro check` | 0 errors, 0 warnings, 2 pre-existing hints |
| Build | 40 pages |
| `npm run validate` | 2,563 internal links plus SEO, marketing, QR, GTM and checklist checks pass |
| `npm run smoke` | 21 pages pass |
| No-fabrication audit | pass |
| CI on all three PRs | `validate` and `browser` pass |

## Residual gaps and next owner actions

1. **Facility acceptance:** import/activate the commercial and church packets
   only after their full signing + payment/invoice journey passes. Then set
   `facilityOnlinePaymentEnabled = true` in a reviewed deployment.
2. **STR, property management, specialty and employee packets** remain inactive
   until individually accepted.
3. **Document re-signing** remains owner-reviewed and manual; scheduled batch or
   reminder automation for re-signing is not implemented.
4. **Off-site backup:** OneDrive upload failed with a network `fetch failed`.
   Retry the encrypted upload and complete a cloud round-trip before relying on
   the off-site copy.
5. **Live synthetic signing test:** not performed in production to avoid creating
   a synthetic customer record. The exact production import was exercised end to
   end on an isolated restore, and one real owner-initiated request is pending.
6. **Marketing Center** was not started; the residential release and document
   lifecycle work were prioritized.
