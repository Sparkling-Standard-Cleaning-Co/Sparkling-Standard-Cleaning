# Pensacola Legal Signing Release Runbook

**Release candidate:** `release/2026-11-22-legal-signing-acceptance`  
**PR:** #1 → `production-safe`  
**Status:** release candidate verified. **Do not merge, deploy, apply production
migrations or activate live signing without separate owner authorization.**

## Preconditions

- Owner has approved the exact 27 document versions in the Legal Registry.
- Approved manifest and snapshot verified.
- PR #1 is green and targets `production-safe`, not `main`.
- A fresh encrypted D1/R2/master backup has passed an isolated restore.
- Production has no active legal templates or signing packets before import.
- Stripe live configuration and the webhook endpoint are already operational.
- No customer signing link, live charge or production import has been issued.

## Approved artifacts

| Artifact | Location |
|---|---|
| Approved manifest | `00 START HERE\LEGAL-REVIEW\APPROVED\APPROVED-VERSION-MANIFEST-2026-11-22.json` |
| Approval snapshot | `00 START HERE\LEGAL-REVIEW\APPROVED\APPROVAL-SNAPSHOT-2026-11-22.json` |
| Word/PDF library | `FINAL-APPROVAL-PACKAGE-2026-11-22\10-APPROVED-LIBRARY\` |
| Staging import data | `FINAL-APPROVAL-PACKAGE-2026-11-22\09-MANIFEST\STAGING-IMPORT-2026-11-22.json` |
| Staging proof | `FINAL-APPROVAL-PACKAGE-2026-11-22\11-STAGING-VERIFICATION\` |

## Current schema / migration state

- Repository migration files: **51** (`0001`–`0051`).
- Production D1 export: **50 migrations**, 95 tables.
- `0051_legal_collections.sql` is **not applied** and is not part of this release.
- No new migration is required for the legal document import. Templates and
  packets are D1 rows created through the owner-controlled workflow.

## Production import sequence

Run only after explicit owner authorization. Never point the SQLite staging
script at production.

1. **Freeze and back up**
   - Stop admin changes and close any open signing requests.
   - Export production D1 and record its SHA-256.
   - Create and verify an encrypted archive of D1, R2 application objects, the
     legal registry and the approved library.
   - Record the current Pages deployment ID and commit.

2. **Verify the approved source**
   - Recompute SHA-256 for every DOCX/PDF in the descriptive library.
   - Require 27/27 exact matches to the approved manifest.
   - Confirm the manifest/snapshot checksums.
   - Confirm the 3 archived records are not in the import set.

3. **Prepare and import approved templates**
   - Run `node scripts/legal/prepare-production-import.mjs` with the approved
     staging import, the approved manifest, the production owner admin ID and
     an output SQL path. It verifies 27/27 manifest records, exact versions,
     DOCX hashes in packet notes and staging text hashes, then applies the
     owner-approved enforcement policy.
   - Review the generated SQL (`git diff --no-index` or file hash) before it is
     executed.
   - Execute it only through the authenticated owner Wrangler session:
     `npx wrangler d1 execute sparkling-standard-operations --remote --file <sql>`.
   - The script is idempotent for identical content and never updates a
     template to different wording. Do not import archived/consolidated records.
   - Verify: 27 approved templates, 0 draft candidates from this import, 0
     archived records, and audit records for every template and packet.

4. **Build the 10 packets**
   - The same import creates:
     `customer.deep`, `customer.residential`, `customer.recurring`,
     `customer.move_in_out`, `customer.str`, `customer.commercial`,
     `customer.church`, `customer.property_management`,
     `customer.specialty_addons` and `employee.onboarding`.
   - Required customer items are `before_payment`. Booking-specific agreements
     and schedules are `per_booking = 1`; general acknowledgments remain
     reusable. This is implemented in `scripts/legal/packet-policy.mjs` and
     enforced again at runtime in `activeRequirements`.
   - Only `customer.deep`, `customer.residential`, `customer.recurring` and
     `customer.move_in_out` are active in the residential release. The other
     packets are imported inactive until their own acceptance run.
   - Verify: 27 approved templates, 10 imported packets, 4 active residential
     packets and the expected item counts.

5. **Preview verification**
   - For each customer service, run `preview_packet` with a synthetic customer,
     property, scope, date, arrival window, price, tax, discount, payment and
     cancellation values.
   - Require zero missing variables and the correct document IDs.
   - Verify no archived or retired document appears in any packet.

6. **Activation flags**
   - The residential release requires
     `src/config/legal-policy.ts` (`electronicSigning: true`,
     `productionLegalDocuments: true`) in the deployed commit.
   - Keep both flags false in any build where the approved library has not been
     imported and verified. The runtime fails closed with
     `electronic_signing_not_activated` when signing is disabled.
   - A rollback setting both flags false and redeploying immediately restores
     the previous no-document-gate behavior.

7. **Controlled signing test**
   - After activation, create one synthetic signing request through the admin
     composer.
   - Sign it with a synthetic recipient, verify the executed combined PDF and
     SHA-256, verify customer/admin retrieval, then void the test request and
     retain the audit evidence.
   - Do not send a signing link to a real customer during this step.

8. **Payment/booking verification**
   - The existing $5 transaction proves live invoice payment, webhook and
     reconciliation only.
   - A real signed booking payment is optional and requires separate owner
     authorization. Do not create a charge as part of the standard release.

## Rollback sequence

If any gate fails:

1. Set `electronicSigning` and `productionLegalDocuments` back to `false` in a
   reviewed commit and redeploy.
2. Set the affected packets to `inactive` through the admin workflow.
3. Retire the imported templates through the existing retirement action; do not
   delete audit records.
4. Void open/partially signed test requests and invalidate their tokens:
   `UPDATE signing_requests SET status='void', token_hash=NULL WHERE status IN
   ('pending','partially_signed')`.
5. Restore production D1 from the pre-import archive if schema/data rollback is
   required.
6. Restore R2 application objects only from the verified archive; never delete
   executed customer documents.
7. Roll back Cloudflare Pages to the recorded prior deployment.
8. Re-run medical checks: admin login, documents view, checkout readiness,
   portal, and the public site.

## Verification commands

```powershell
npm run check
npm test
npm run build
npm run validate
npm run smoke
npm run test:browser
gh pr checks 1
```

## Go / no-go

**GO** for the release branch and PR #1: approvals, hashes, packets, staging
signing, tests, CI, and local backup/restore are verified.

The owner authorized the controlled Pensacola residential release on
2026-11-22. The release is complete only after:

- a fresh encrypted pre-release backup and isolated restore verification;
- required `before_payment`/`per_booking` enforcement and the Terms/Privacy
  modal fix are in the deployed candidate;
- full unit, browser, build and validation checks pass;
- production import reports 27 approved templates and the expected packets;
- one synthetic production signing request is signed and retrieved, then
  voided;
- live prices, holds, checkout readiness, webhook and calendar configuration
  are verified without a new live charge or customer message.

No live charge is created by the standard release procedure.
