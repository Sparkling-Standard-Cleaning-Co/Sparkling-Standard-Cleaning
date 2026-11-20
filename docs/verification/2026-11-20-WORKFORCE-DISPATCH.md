# Workforce intelligence and intelligent dispatch - 2026-11-20

## Scope

Implemented the owner-authorized intelligent dispatch capability inside **Admin -> Jobs & Team**.
Automatic assignment is restricted to eligible unassigned confirmed jobs. Existing assignments and
customer appointment times are never changed automatically.

## Implemented

- Additive migration `0041_workforce_dispatch.sql` applied to production D1.
- Employee dispatch profiles: approved services, equipment, transport mode, driver/vehicle capacity,
  equipment transport, weekly hours, overtime approval, workday/shift, private dispatch origin and
  notes.
- Temporary time-off entry and branch-timezone conversion.
- Per-branch owner settings: analysis only / automatic unassigned, activation, emergency pause,
  minimum savings, candidate cap, optimizer weights, optional travel and vehicle cost assumptions.
- Feasibility engine for branch, service qualification, crew roles, equipment, availability,
  time off, existing schedule conflicts, verified travel, weekly hours, shared transport and
  employee document onboarding.
- Deterministic weighted ranking for travel time/miles, labor, workload, customer continuity and
  shared transport.
- Atomic unassigned-job claim, branch dispatch lock, duplicate-assignment prevention, decision
  audit, calendar status and retry.
- Existing-assignment recommendation cards; owner approval is required and revalidation happens
  before applying.
- Coverage exceptions with reasons when no feasible crew exists.
- Daily dispatch pass through the existing protected recurring worker when a branch owner enables
  automatic assignment.
- Admin dashboard: KPIs, unassigned queue, recommendations, exceptions, employee lanes, decision log,
  owner controls and employee profile editor.
- Manager view masks private employee origins and coordinates; only the owner receives them.

## Authority boundaries verified

- Automatic assignment only for unassigned confirmed appointments.
- Existing assignments remain unchanged unless the owner approves a recommendation.
- Customer appointment start/end are not modified by dispatch.
- Emergency pause blocks new automatic assignment without deleting existing assignments.
- No new customer message or charge path was added.

## Migration

Migration `0041_workforce_dispatch.sql` executed successfully on production D1:
28 commands, status applied.

## Tests

- `npm run check`: 0 errors, 0 warnings, 2 hints.
- Unit suite: 935 tests, 934 pass, 1 pre-existing skip.
- New dispatch engine tests: 17 pass.
- New dispatch service/D1 tests: 10 pass, including concurrency, paused automation, existing
  assignment protection, owner approval, time off and origin privacy.
- Browser suite: 232 pass, including 4 new dispatch admin tests.
- Build: 37 pages.
- Validation: pass.

## Production state

- Automatic assignment is deliberately **not activated** by the migration. Production defaults are
  analysis-only and paused until the owner completes employee dispatch profiles and enables the
  controls.
- Migration is applied; application code deployment and live dashboard checks are recorded below.

## Remaining limitations

- Alternate dispatch origins and equipment pickup are stored but the travel calculation currently
  uses the primary verified origin.
- No Google Route Optimization API or route matrix was introduced; the existing verified route
  resolver is used with caching and fails closed.
- Whole-day evaluation considers each employee's existing day and current weekly workload, but does
  not globally reorder confirmed days.
- Customer rescheduling recommendations remain disabled.
- True server-driven pagination for dispatch collections is not implemented; API limits are bounded.
- Owner must configure dispatch profiles before automatic assignment can produce candidates.
