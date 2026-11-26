# Operations platform expansion — 2026-11-25

## Scope delivered

- Centralized communications retry, branch/manager scoping and Google review verification.
- Commercial accounts, custom multi-location proposals, agreement signing and contract billing.
- Employee profiles, onboarding, shifts, training, quality, performance and time-off approvals.
- Payroll calculation, approval, earnings records and CSV export.
- Tampa readiness checklist and activation gating.

Migrations `0064_commercial_operations.sql`, `0065_employee_operations.sql` and
`0066_notification_retry.sql` are additive. No SMS, no payroll disbursement,
no paid service and no public Tampa activation were introduced.

## Commercial operations

- `commercial_proposals` stores validated structured scope (locations → areas →
  tasks with individual frequencies and prices), one-time charges, add-ons,
  supplies/equipment, crew requirements, schedules and exclusions. Totals, tax
  and discounts are server-calculated; a discount can never exceed the subtotal.
- Proposal revisions are snapshotted on publish with a canonical snapshot and
  SHA-256 content hash. Published proposals get an approved one-document
  agreement packet and a standard signing request through the existing document
  system; a signed request is synchronized back to the proposal with signer name,
  email and timestamp.
- Contracts are created only from accepted proposals, default to Net 15, and
  generate period invoices idempotently. Invoices use the existing ledger and
  invoice numbering. The next billing date advances only after creation.
- Facility contacts (billing/facility/manager/authorized) and walkthrough records
  are stored per property. Access instructions use the existing property record.
- Admin UI: **Commercial Accounts** — proposal list/editor, live server totals on
  save, publish/send, revision, contract creation, invoice generation, facility
  contacts and walkthroughs. Printable/electronic agreement content is generated
  server-side from the same snapshot.

Tests: `tests/commercial.test.ts` (7 tests) covers structured totals, validation,
publish/hash/revision, signing request creation, acceptance synchronization,
contract creation, invoice idempotency, multi-location scope, contacts and
walkthroughs. Authenticated browser test `tests/browser/admin-commercial.test.mjs`
builds a location/area/task proposal and asserts the exact server payload.

## Employee operations

- Profile administration stores contact, emergency contact, hire date, status,
  bookability, qualifications, wage rates (regular/lead/solo), handbook
  acknowledgment, personnel notes and document expiration dates.
- Onboarding tasks, training modules/assignments, quality inspections,
  performance notes and time-off requests are implemented with management
  approval. Approved time off creates the scheduling block used by dispatch.
- Shift overrides are managed per employee and consumed by the existing dispatch
  engine. Scheduling/dispatch, multi-cleaner assignment, lead designation,
  conflicts, crew warnings and reassignment remain in the established Jobs &
  Team/dispatch flow.
- Payroll uses the approved timekeeping intervals' captured rate snapshots,
  computes overtime after 40 hours per Central workweek at 1.5×, includes
  adjustments (travel/bonus/deduction), requires calculation before owner
  approval, locks approved periods and exports CSV.
- Employee portal adds training (read + self-complete), published shifts,
  approved earnings, time-off request/cancel and the existing clock, jobs,
  documents, checklists and correction flows.

Tests: `tests/employee-admin.test.ts` (4), `tests/payroll.test.ts` (4) and
authenticated browser test `tests/browser/admin-employees.test.mjs` cover profile
updates, handbook, onboarding, training, quality, performance, time off,
overtime, approval locks, CSV and manager/owner restrictions.

## Communications limitations

- Provider failures now enqueue the exact rendered notice in
  `notification_retry_queue`. Owners can retry or discard from the Communications
  center; retries record attempts/provider acceptance and audit. Duplicate pending
  failures for the same event/recipient/related record are suppressed.
- Manager/branch-manager access is enforced server-side: employee administration
  requires owner/manager, payroll requires owner/finance and approval requires
  owner. Commercial reads require booking read with branch scoping.
- Google review automation verified live: Pensacola has an approved review URL,
  requests are disabled on both branches, Tampa has no review URL, no customer is
  marked solicited/do-not-ask, and one historical sent request exists. Automation
  code refuses disabled branches, missing URLs, incomplete jobs, test records,
  reviewed/do-not-ask/opted-out/unknown customers and old backlogs.

## Tampa readiness

`branchOperationalReadiness()` now returns a server-derived checklist covering
staffing, manager access, calendar, timezone, enabled services, commercial/church
capability, review destination, origin, travel limit and GBP verification.
Activation to live is blocked by the same operational checks, not only field
presence. `tests/branch-readiness.test.ts` verifies Tampa remains blocked until
staffing is configured and public activation stays owner-controlled.

## Verification

| Check | Result |
| --- | --- |
| Unit `npm test` | 1,158 tests — 1,157 pass, 0 fail, 1 pre-existing skip |
| Browser `npm run test:browser` | 287/287 |
| `astro check` | 0 errors |
| Build / validate | 41 pages, 2,636 links |
| Migrations | 0064-0066 additive, applied to production before deployment |
| Commercial signing | approved agreement template + signing request created in test |
| Payroll | calculated, approved, locked, exported |
| Reviews | live flags/URLs verified; no automation sends performed |
| Live financial/customer actions | none created |

## Remaining owner action

- Rotate the backup Worker `GITHUB_DISPATCH_TOKEN` to a fine-grained Actions-only
  token (GitHub API cannot create fine-grained PATs).
- Public Tampa activation remains intentionally deferred.
