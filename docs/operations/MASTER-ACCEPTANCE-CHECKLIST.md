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
