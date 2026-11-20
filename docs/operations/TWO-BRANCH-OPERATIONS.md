# Two-branch operations

**Status:** Implemented in the repository; production migration `0040` is pending
safe application and deployment. Pensacola remains the only live/public branch.

## 1. Decision record

- **One legal entity:** Sparkling Standard LLC.
- **Two stable operating branches:** `branch_pensacola` (live) and
  `branch_tampa` (prelaunch/setup).
- **One application, one core database, one Stripe account, one corporate
  reporting view.** Branch isolation is enforced by data ownership, server
  authorization, branch-scoped pricing and branch-scoped configuration, not by
  duplicating the site or estimator.
- **No second branch identity may be invented in UI code.** The canonical IDs
  live in `src/config/branches.ts`.
- **Tampa is not a second website.** The shared domain exposes a prelaunch
  information page only; it is noindex and has no booking, payment or local GBP
  claim until the launch gates pass.

### Lifecycle

`draft` -> `setup` -> `internally_testable` -> `approved_to_launch` -> `live`
-> `paused`/`retired`.

Only `live` is publicly bookable/payable. `branch_tampa` is `setup`.
`branch_pensacola` is `live`. Lifecycle changes are owner-only, audited and
saved through `functions/api/admin/branches.ts`.

## 2. Current vs target topology

| Area | Current | Target / next gate |
| --- | --- | --- |
| Branch rows | Pensacola active; Tampa inactive | Same IDs; lifecycle controls public behavior |
| Branch config | `branches` setup columns + immutable `branch_config_versions` | Owner edits through Branches & Launch |
| Pricing | One immutable price book per branch in `pricing_versions.branch_id` | Pensacola remains source baseline; Tampa draft only |
| Pricing publication | Pensacola publishable; Tampa blocked while prelaunch | Owner advances lifecycle only after readiness |
| Public pricing API | `/api/pricing` serves only a bookable branch; Tampa returns 404 | Tampa only after launch gate |
| Admin branch view | Owner All/Pensacola/Tampa cookie; server scopes existing admin queries through `actor.branchId` | Staff remain fixed to their assigned branch |
| Leads/customers/properties | `branch_id`/`primary_branch_id` columns already exist; new website leads resolve server-side | Legacy NULL rows are not guessed; owner review remains |
| Documents/signing | Branch column on signing requests; templates remain corporate | Branch appendices only after counsel approval |
| Finance | Branch columns on invoices/payments/gifts/refunds via payment | Branch P&L from actual ledger |
| Marketing | One brand/domain; existing UTM registry | Add branch-specific collateral and attribution as approved |
| Tampa | Prelaunch page only | Staffing, licensing, insurance, tax and capacity review |

## 3. Data ownership and authorization

- Persistent branch columns already exist on customers (`primary_branch_id`),
  properties, leads, estimates, requests, appointments, recurring plans,
  invoices, payments, gifts, team members, audit and quick estimates.
- A customer may have properties/jobs in both branches. The customer identity is
  shared; the service context and history stay branch-specific.
- Managers are scoped by `admin_users.branch_id`. The owner has no fixed branch
  and may choose All/Pensacola/Tampa. That selection is a narrowing cookie
  (`ss_branch_view`) and never grants a staff member broader access.
- Exports, documents, R2 links, notifications and financial views must retain
  branch scope. Existing endpoints that already use `actor.branchId` inherit the
  owner's selected view; endpoints that do not are tracked as remaining work.
- A public form never activates a branch. The server resolves the branch from a
  verified service address/ZIP or a validated request context; transactional
  requests fail closed when the resolved branch is not bookable.

### Legacy branch backfill

Existing records with `NULL` branch IDs are **not** assigned by guessed city.
The safe process is:

1. Count NULL rows by table and date range.
2. Infer only from a recorded service address/property with a verified ZIP and
   an unambiguous branch.
3. Put ambiguous rows into an owner review queue.
4. Apply idempotent updates with an audit record and a reversible export.
5. Never rewrite historical invoices, payments or signed documents silently.

No production backfill was executed as part of this change.

## 4. Pricing and cost model

- The calculation algorithms are shared across branches. Branch-specific
  published snapshots are loaded by branch ID.
- Every quote/estimate stores `branch_id` and the pricing fingerprint/version
  already present in `pricing_version`.
- Pensacola's published values are unchanged. The source baseline remains the
  fallback when no version is published.
- Tampa's draft starts from the source baseline as a reference, not as a
  market-clearing Tampa price. It must be reviewed against real Tampa labor,
  travel, parking/tolls, density, minimums, overhead and margin before launch.
- The Code does not contain an arbitrary city multiplier. Branch-level changes
  must be made through the pricing catalog and published only after owner
  review.
- Commercial/church Tier A/B/C rules and the church 10% entitlement are shared
  and unchanged. Tier C remains a personal walkthrough review.
- No price was published by this work.

## 5. Tax and licensing audit (do not guess)

Current code behavior:

- Florida residential cleaning: not taxable.
- Florida nonresidential cleaning (commercial/church): taxable at the state
  rate plus the applicable county surtax, calculated from the confirmed service
  address at checkout.
- Church exemption: only with a current Florida DR-14 certificate and direct
  payment by the exempt organization; otherwise tax applies.
- STR cleaning billed to the host: treated as non-taxable residential cleaning;
  a host's mandatory guest cleaning fee is the host's transient-rental issue.
- Alabama: the engine returns a review/fail-closed result rather than inventing
  a rate.
- No tax rate, county surtax or exemption policy was changed by this work.

Open owner/accountant questions:

1. Confirm each real service county and current DR-15DSS surtax effective dates.
2. Confirm whether any `str_turnover` scope is billed as commercial rather than
   residential.
3. Confirm church/DR-14 evidence workflow and record retention.
4. Confirm Alabama registration/nexus and the correct tax treatment before any
   Alabama commercial job is accepted.
5. Confirm whether Tampa operations require a separate local business tax
   receipt, occupational license or county filing.
6. Confirm insurance coverage for both territories and any client certificate
   requirements.

Official references: FDOR GT-800015, Rule 12A-1.0091, FDOR surtax rates,
Sunbiz fictitious-name registration, Hillsborough Tax Collector business tax.
These are research references, not legal advice.

## 6. Google Business Profile

- **Pensacola:** verified profile retained exactly; no change to its URL,
  reviews or owner control.
- **Tampa Bay:** not created. A second service-area profile is only eligible
  with a genuine staffed operating presence and a distinct service area. No
  virtual office, PO box, borrowed address, fake signage or ranking-only
  listing will be used.
- The Branches & Launch screen tracks `gbp_status` (`not_created`,
  `eligibility_review`, `prepared`, `submitted`, `verified`, `paused`) and a
  URL field, but saving a URL does not create or verify a profile.
- Do not migrate Pensacola reviews or imply pooled reviews.

## 7. Admin branch operations

- Owner: use **Branch view: All branches / Pensacola / Tampa Bay** in the admin
  header. The selection is a server-side scope cookie, not a UI-only filter.
- Staff: the assigned branch remains authoritative; staff cannot switch.
- Branches & Launch: owner edits public identity, service availability, service
  ZIPs, contact and GBP status. Live launch requires a public phone, public
  email, service area and at least one enabled service.
- Pricing & Estimator Control: select the branch. Pensacola may publish; Tampa
  is draft/locked while prelaunch.
- New records should carry the selected/assigned branch. Do not create a
  customer in one branch and attach a property/invoice to another accidentally.
- Tampa prelaunch leads are interest records only; no booking or payment.

## 8. Backup, restore and rollback

- Before migration `0040`: take a fresh encrypted D1 export and verify it.
- `0040` is additive except for rebuilding `pricing_versions` to replace the
  global unique `version` constraint with per-branch uniqueness. The rebuild
  copies every existing row to `branch_pensacola`.
- Rollback: the prior D1 export is the authoritative rollback. The migration
  does not delete business records.
- Application rollback: deploy the previous commit; the old code ignores the new
  branch config columns and uses the global pricing table. Do not point old code
  at a schema with a published Tampa version if that old code cannot isolate it.
- Application R2 documents/photos remain outside the encrypted D1 archive. The
  owner must supply a bucket-scoped R2 S3 key for full object backup.
- The independent recovery key copy and a secondary off-site destination remain
  owner actions.

## 9. Verification and remaining gates

Implemented and unit tested:

- branch migration and lifecycle;
- branch-scoped pricing isolation;
- Tampa public pricing denial;
- server-owned branch resolution and Tampa non-bookability;
- branch settings validation and immutable version history;
- owner branch-view cookie and existing manager scoping;
- lead persistence branch assignment;
- public Pensacola/Tampa pages and noindex;
- admin Branches & Launch screen and pricing branch selector.

Owner-gated:

- apply migration `0040` to production after a verified backup;
- deploy and smoke test;
- review Tampa labor/travel/tax assumptions;
- confirm insurance/licensing/local registrations;
- decide whether/when Tampa is eligible for a GBP;
- run a real authenticated owner walkthrough of branch switching, Quick
  Estimate and packet signing.
