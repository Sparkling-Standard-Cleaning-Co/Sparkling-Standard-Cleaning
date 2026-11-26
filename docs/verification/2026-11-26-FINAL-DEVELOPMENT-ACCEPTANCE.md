# Final development and operational acceptance - 2026-11-26

## Scope

This release closes the remaining authorized development work:

- Owner-requested checkout simplification.
- P0 payroll financial accuracy.
- P0 commercial invoice reconciliation.
- P1 commercial scheduling integration.
- Integrated acceptance verification, production verification and final backup.

No SMS activation, payroll disbursement, paid payroll service, public Tampa
activation or DEFEND change was introduced.

## Checkout simplification

Removed the three owner-specified explanatory paragraphs without replacement
wording:

1. The recorded-version / Florida three-business-day cancellation note beneath
   the Terms and Conditions acknowledgement.
2. The gift-certificate available-balance note beneath the gift code input.
3. The pay-now / pending-photos note above the promotion code area.

Preserved: Terms and Privacy checkbox and dialog links, consent recording and
version tracking, gift calculations, promotion and Community Support
calculations, photo collection and pending-photo booking status, Pay Now and
Pay Later, and the existing mobile sticky actions. The statutory cancellation
right remains in the Terms and Conditions at `/terms/#cancellation-rescheduling`.

Files: `src/components/TermsAcceptance.astro`,
`src/components/EstimateWizard.astro`,
`src/components/FacilityEstimateForm.astro`,
`src/scripts/estimate-wizard.ts`, `src/styles/global.css`.

Verification: browser test "checkout omits the three redundant paragraphs on
desktop and mobile" rendered the live checkout at 390 px and 1280 px and
asserted the absent text plus every preserved control.

## P0 payroll accuracy

`src/lib/employee/payroll.ts` was rebuilt around the FLSA workweek:

- Regular rate is the weighted average of all straight-time compensation in the
  workweek, including mixed regular/lead/solo rates, compensable travel, paid
  rest breaks and positive nondiscretionary travel/bonus/adjustment pay.
- Overtime hours receive an additional half-time premium at the weighted rate.
- Workweeks start Monday 00:00 in the employee's branch time zone. Pensacola
  uses America/Chicago; Tampa uses America/New_York.
- Complete workweeks are considered even when the pay period covers only part
  of a week; only in-period hours are paid.
- Intervals crossing midnight or a workweek boundary are split.
- Intervals without intervals but with multiple adjustments receive the sum of
  all adjustments (the previous code kept only the last one).
- Only paid, ended, closed or corrected intervals enter payroll.
- Exact duplicate and overlapping payroll periods are rejected; officers cannot
  create a second period for the same range even across branches.
- A calculation stores a SHA-256 source fingerprint. Adjustments invalidate the
  calculation, delete stale calculated entries and return the period to open.
- Approval rejects a changed source (`payroll_recalculation_required`) and
  cannot approve a stale calculation.
- Calculation, adjustment invalidation and approval use one D1 batch where
  available and lock approved periods against mutation.
- Payroll storage now carries `branch_id`; finance and branch managers are
  scoped server-side. Owner approval is required.
- CSV columns are labeled Regular Pay and Overtime Premium.

Travel is recorded through the existing time interval (`is_travel`) and can be
started/ended from the employee clock or marked by a manager correction.

Files: `src/lib/employee/payroll.ts`,
`src/lib/employee/timekeeping.ts`, `functions/api/employee/clock.ts`,
`functions/api/admin/timekeeping.ts`, `functions/api/admin/employees.ts`,
`src/pages/employee/index.astro`, `src/scripts/employee.ts`,
`src/pages/admin/index.astro`, `src/scripts/admin.ts`.

## P0 commercial invoice reconciliation

`src/lib/commercial/service.ts` now:

- Preserves the accepted proposal snapshot on the contract.
- Generates the first invoice with recurring tasks, one-time charges,
  nonrecurring add-ons, the approved discount and tax. It must equal the signed
  first-invoice total or generation fails closed.
- Generates subsequent invoices from recurring tasks, recurring add-ons and tax
  only.
- Advances `next_invoice_date` to the end of the invoiced period instead of
  skipping one period.
- Preserves a month-end day-of-month anchor (Jan 31 -> Feb 28 -> Mar 31).
- Applies approved payment terms (Net 15 by default) from the branch-local
  issue date.
- Rejects overlapping contract invoice periods and maps unique-constraint races
  to `contract_period_already_invoiced`.
- Commits the invoice, invoice lines, contract-period link, contract invoice
  pointer and next billing date in one D1 batch.
- Rejects a facility whose branch does not match the contract branch.

Migration `0067_financial_accuracy_and_commercial_scheduling.sql` adds the
snapshot/amount columns and the contract-period unique index.

## P1 commercial scheduling integration

New `src/lib/commercial/scheduling.ts` and admin actions:

- Preview structured schedule dates against real availability before approval.
- Approval creates one recurring plan and schedule per contract facility, then
  uses the existing recurring scheduler to create Job Files/appointments and
  Google Calendar events.
- Stores facility scope, customer access instructions and required crew
  qualifications on the schedule and recurring plan; appointment notes and
  calendar descriptions carry the same operational detail.
- Requires administrator-confirmed frequency, date, start time, duration,
  first-visit duration and crew size. Free-text proposal terms never invent a
  schedule.
- Rejects duplicate active schedules, cross-branch facilities and availability
  conflicts.
- Pause, resume and cancel flow through the existing recurring-plan lifecycle.
- Admin UI exposes Service schedule on each contract, preview/approve controls,
  schedule status actions and navigation to Job Files and Recurring Plans.

Tests cover preview, approval, monthly occurrence creation, plan/appointment
notes, timezone, duplicate prevention and pause.

## Verification results

| Check | Result |
| --- | --- |
| Unit `npm test` | 1,167 tests - 1,166 pass, 0 fail, 1 pre-existing skip |
| Browser `npm run test:browser` | 288/288 (see deployment closeout for final run) |
| `astro check` | 0 errors |
| Build | 41 pages |
| Validate | 2,636 links, SEO and checklist checks pass |
| Smoke | 21 pages |
| Migration | 0067 additive; applied before deployment |
| Live financial/customer actions | none created |

## Deployment closeout

Deployment identity, migration application, production verification and final
backup evidence are recorded in the final release report and updated in
`AGENTS.md`.

## Limitations

- Actual payroll disbursement, tax withholding and paid payroll filing remain
  deferred by owner direction.
- Public Tampa activation remains deferred.
- The backup Worker `GITHUB_DISPATCH_TOKEN` rotation remains an owner-only
  GitHub action.
- A paid Connect bank account and a live charge test were not performed.
