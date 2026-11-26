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
- Proposals expire automatically after their expiration date; sending an expired proposal is rejected.
- Customer files now list the customer's commercial proposals and contracts with direct proposal navigation.
- Contracts are created only from accepted proposals, default to Net 15, and
  generate period invoices idempotently. Invoices use the existing ledger and
  invoice numbering. The next billing date advances only after creation.
- Facility contacts (billing/facility/manager/authorized) and walkthrough records
  are stored per property. Access instructions use the existing property record.
- Admin UI: **Commercial Accounts** — proposal list/editor, print preview, live server totals on
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
- Owners can record an employee callout, which creates the availability block and sends the employee-callout notice. Late clock-ins over 10 minutes send the employee-late notice and appear as late-arrival warnings in the timekeeping summary.
- Employees can receive an onboarding agreement packet through the existing document-signing system from their employee file.
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

## Deployment

- Production migrations 064-066 applied before code deployment; 66 migrations, 123 live tables (122 application tables plus _cf_KV), 0 foreign-key violations.
- Cloudflare Pages production deployment 372e67c4-96a4-4dee-b2d3-b6eda3e24cc8 from application code 90b7ab5; main and production-safe identical.
- Fresh complete backup after migration (run 45729049782): archive sparkling-standard-backup-2026-11-26T00-29-54-complete.ssbk, 10,813,677 bytes, 227 files, SHA-256 49b688bc035ba83fe3bad67cb01f19b603378a42951f93b7b13d86fbe28e1d14, R2 + OneDrive verified, isolated restore 122 application tables / 66 migrations, 0 FK violations, 0 missing R2 references.
- Unauthenticated /api/admin/commercial, /api/admin/employees and /api/employee/requests return 401.

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
| Deployment | 2ef5eebb from f03b36, live |

## Remaining owner action

- Rotate the backup Worker `GITHUB_DISPATCH_TOKEN` to a fine-grained Actions-only
  token (GitHub API cannot create fine-grained PATs).
- Public Tampa activation remains intentionally deferred.
