# Workforce Intelligence and Intelligent Dispatch

## Purpose

Intelligent Dispatch is the owner-controlled staffing layer inside **Admin -> Jobs & Team**.
It evaluates eligible unassigned appointments using employee qualifications, availability, transport,
equipment, travel, workload and customer continuity. It is not a second booking system and it never
changes customer appointment times.

## Authority boundaries

- Automatic initial assignment: allowed only for an unassigned, confirmed appointment and only after
  the owner enables automatic assignment for that branch.
- Existing assignments: never replaced automatically. The optimizer may create a recommendation;
  the owner must approve it.
- Customer appointment rescheduling: recommendation-only and disabled in the current release.
- Emergency pause: stops new automatic work immediately. It does not delete or undo valid assignments.
- Manual assignment remains available in Jobs & Team when automation is paused.

## Data model

Migration `0041_workforce_dispatch.sql` adds:

- `team_members` dispatch profile fields for approved services, equipment, transport, vehicle
  capacity, equipment transport, weekly hours, overtime approval, private dispatch origin and
  alternate origin.
- `dispatch_shift_overrides` for temporary daily availability changes.
- `dispatch_settings` per branch with mode, owner activation, pause, minimum saving, candidate cap,
  weights and travel cost assumptions.
- `dispatch_decisions` with candidate summaries, constraints, score, reason, schedule version,
  calendar status and actor.

Existing appointments, appointment resources, recurring plans, timekeeping, document gates and
Google Calendar links remain authoritative.

## Eligibility rules

A crew is infeasible when any of the following applies:

- employee is inactive or not bookable;
- employee branch does not match the job branch;
- service category, equipment or crew role is missing;
- weekly hour limit would be exceeded without approved overtime;
- employee is off, outside a shift or has a conflicting appointment;
- origin or existing job coordinates are unusable;
- a verified route is unavailable;
- shared transport has no capable driver or enough seats;
- required employee documents are incomplete;
- the job is not confirmed or no longer unassigned at commit time.

When no crew is feasible, the job stays unassigned and a coverage exception is recorded.

## Optimization

Hard constraints are checked first. Feasible crews are ranked by a deterministic weighted score:

- travel minutes and miles;
- labor cost, optional compensable travel and optional vehicle cost;
- weekly workload;
- customer continuity;
- optional shared-transport weight.

The owner can edit the weights and minimum worthwhile saving. The optimizer does not invent wages,
mileage costs, availability, home addresses or travel data. Missing data produces a reviewable
exception rather than a fabricated assignment.

## Transport

Both approved models are supported:

- **Independent transport:** each crew member travels from their own dispatch origin.
- **Shared crew transport:** a capable driver with enough seats picks up passengers and travels to the
  job. Passenger pickup is included in travel feasibility and crew assembly time.

Private origins are returned only to the owner. Managers receive an `originConfigured` flag and no
address or coordinates.

## Automatic commit safety

- One branch dispatch lock prevents simultaneous automatic runs.
- The appointment is conditionally claimed with its current `updated_at` and the requirement that no
  appointment resource exists.
- Resource inserts and the decision update are committed only after the claim succeeds.
- Audit records use a nullable system actor for scheduled runs.
- Calendar synchronization failure does not erase the assignment; the decision records
  `calendar_status = failed` and the owner can retry from the dispatch log.
- Existing assignments and appointment start/end values are never modified by automatic assignment.

## Daily automation

The existing protected recurring-replenishment worker now runs a dispatch pass for every branch whose
owner settings have automatic assignment enabled, not paused and mode `automatic_unassigned`.
The owner can also run read-only analysis or an immediate automatic pass from the dashboard.
Recurring occurrences and newly confirmed jobs are evaluated on the next pass.

## Owner activation checklist

1. Open **Admin -> Jobs & Team -> Intelligent Dispatch**.
2. Complete each employee's dispatch profile: approved services, equipment, transport, driver/seat
   capability, weekly hours, regular workdays/shift and a verified private dispatch origin.
3. Add temporary time off where needed.
4. Run **Run read-only analysis** and review exceptions/recommendations.
5. Select **Automatically staff unassigned jobs**, enable the setting and clear **Emergency pause**.
6. Save controls, then run automatic assignment and review the decision log.

Production defaults are analysis-only and paused. Migration 0041 does not activate automation.

## Remaining limitations

- Alternate dispatch origins and equipment pickup are stored but only the primary origin is currently
  used by the travel calculation.
- Google Route Optimization API and a route matrix are not introduced. Dispatch uses the existing
  verified route resolver with batching/caching and fails closed when a route is unavailable.
- Customer rescheduling remains recommendation-only and disabled.
- Full-day route optimization evaluates each candidate against the employee's existing day, but does
  not globally reorder already assigned days.
- The dashboard uses bounded API limits, not full server-side pagination.
