# Master acceptance checklist — operations platform expansion

**Directive:** Master Context Handoff & Operations Platform Expansion
**Started:** 2026-11-25
**Rule:** An item is complete only when implemented, tested, verified and
deployed. External blockers are named explicitly.

## Delivered foundation

- [x] P0 appointment defaults, crew sizing, staffing-pending workflow, policy email
- [x] Branding retirement and authoritative brand inventory
- [x] Backup reconciliation, restore, R2 reference audit, failure alerts, main ref,
      automatic scheduled execution
- [x] Communications event expansion, complaint/commercial routing, branch overrides
- [x] Failed-email retry queue with owner retry/discard
- [x] Branch-manager/manager role scoping on employee/commercial/payroll views
- [x] Google review automation verified (flags off, URL/branch gating, no backlog)
- [ ] Rotate backup Worker GitHub token (owner-only fine-grained PAT)

## Phase 3 — commercial operations

- [x] 3.1 Commercial accounts: customers, multiple facilities, billing/facility
      contacts, addresses, access instructions, walkthroughs, facility documents,
      account history
- [x] 3.2 Custom proposal builder: locations, rooms/areas, tasks, frequencies,
      schedules, labor/crew, supplies/equipment, add-ons, one-time and recurring
      prices, tax, discounts, billing frequency, terms, conditions, exclusions,
      revisions, expiration, printable/electronic agreement content
- [x] 3.3 Proposal → agreement generation with populated customer/facility/scope/
      schedule/pricing/terms; preview, revise, approve, e-sign; version history,
      immutable executed agreement, pricing snapshot, signing evidence, hashes,
      customer copy, audit
- [x] 3.4 Contract execution: recurring commercial billing, facility Job Files,
      crew assignment/instr., monthly invoice generation, balances, inspections,
      change orders, account history; Net 15 default
- [x] 3.5 Church and multi-location commercial scenarios through the shared path

## Phase 4 — employee operations

- [x] 4.1 Profiles/onboarding: contact, emergency contact, status, branch,
      qualifications, wage rates, onboarding checklist, employee agreements,
      handbook acknowledgment, personnel files, document expirations, access limits
- [x] 4.2 Scheduling/dispatch: working hours, recurring availability, shifts,
      time off, multi-cleaner assignments, lead designation, branch restrictions,
      conflicts, qualifications, mandatory-crew warnings, reassignment
- [x] 4.3 Timekeeping: clock in/out, GPS arrival/departure, breaks, multiple jobs,
      correction requests, approval, overtime, missing-clock warnings, auditable
      adjustments
- [x] 4.4 Payroll calculation: regular/lead/solo rates, overtime, approved hours,
      adjustments (including compensable travel), periods, approval, earnings,
      summaries, CSV exports, historical records
- [x] 4.5 Training and quality: modules, materials, assessments, completion,
      procedures, job checklists, inspections, corrective actions, feedback,
      performance records
- [x] 4.6 Employee portal: assigned work, schedule, instructions, directions,
      checklists, clock, breaks, completion, training, documents, earnings,
      approved hours, time-off requests

## Phase 5 — Tampa readiness

- [x] Independent branch settings, staffing, managers, hours, timezone, calendar,
      pricing gates, services, review destination, communications
- [x] Actionable branch-readiness checklist with blockers/warnings
- [x] Public disabled until owner activation; cross-branch leakage tests
- [ ] Public Tampa activation (deferred by directive)

## Cross-cutting

- [x] No SMS, payroll disbursement, paid services or public Tampa activation
- [x] No DEFEND changes
- [x] Admin surfaces responsive/accessible with loading/error/empty states
- [x] Full unit/browser/check/build/validate and production verification
## Phase 6 — final development and operational acceptance (2026-11-26)

### Checkout simplification

- [x] Removed the three owner-specified explanatory paragraphs from checkout
      (terms version/Florida cancellation note, gift-balance note, pay-now/photos note)
- [x] Terms/Privacy checkbox, links, consent recording, gift calculations,
      promotions, Community Support, photo requirements, Pay Now and Pay Later preserved
- [x] Rendered checkout verified at desktop and mobile widths

### P0 payroll accuracy

- [x] Weighted-average regular-rate overtime for mixed regular/lead/solo workweeks
- [x] Compensable travel and paid rest breaks counted as hours worked
- [x] Nondiscretionary travel/bonus/adjustment compensation included in the regular rate
- [x] Branch time-zone workweek boundaries (Pensacola America/Chicago, Tampa America/New_York)
- [x] Partial pay periods use the complete workweek without paying out-of-period hours
- [x] Intervals crossing midnight and workweek boundaries split correctly
- [x] Multiple adjustments preserved for employees without intervals
- [x] Only finalized (closed/corrected) paid intervals enter payroll
- [x] Overlapping/duplicate payroll periods rejected atomically
- [x] Recalculation deletes stale calculated entries and invalidates prior totals
- [x] Calculation and approval are atomic; approval verifies a source fingerprint
- [x] Approved periods are locked against mutation
- [x] Earnings and CSV labels report regular pay and overtime premium accurately
- [x] Finance/owner payroll permissions and branch scope enforced server-side

### P0 commercial billing accuracy

- [x] First invoice includes recurring service, one-time charges, nonrecurring
      add-ons, approved discount and tax, and reconciles to the signed first-invoice total
- [x] Subsequent invoices include recurring service and tax only
- [x] Billing dates advance one period at a time with no skipped periods
- [x] Month-end billing preserves its day-of-month anchor
- [x] Net 15 / approved payment terms set branch-local due dates
- [x] Duplicate and overlapping contract invoices prevented (unique index + atomic linkage)
- [x] Invoice, lines, contract linkage and next billing date commit atomically
- [x] Contract preserves the immutable accepted proposal snapshot
- [x] Branch mismatch between contract and facility fails closed

### P1 commercial scheduling integration

- [x] Structured schedule preview from an accepted contract with availability conflicts
- [x] Approval creates the recurring plan, Job Files/appointments and calendar events
- [x] Facility scope, access instructions and required qualifications preserved on
      the schedule, plan, appointment notes and calendar description
- [x] Frequency, start time, duration, first-visit duration and crew size confirmed
- [x] Duplicate active schedules and cross-branch facilities rejected
- [x] Pause/resume/cancel managed through the existing recurring-plan system
- [x] Admin navigation from commercial contract to schedule, Job Files and recurring plans

### Final verification and infrastructure

- [ ] Final complete encrypted backup after the release (owner-triggered or admin control plane)
- [ ] Rotate backup Worker GITHUB_DISPATCH_TOKEN to a fine-grained Actions-only token (owner-only)
- [x] No SMS, payroll disbursement, paid service or public Tampa activation introduced
- [x] No DEFEND changes
