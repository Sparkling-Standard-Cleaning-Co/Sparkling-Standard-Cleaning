# Customer File and job lifecycle specification - 2026-11-24

This document records the current implementation and the remaining work. It
extends `docs/operations/CUSTOMER-FILE-JOB-LIFECYCLE.md`; where they differ, this
document reflects the code at this release.

## 1. Canonical lifecycle

```text
Lead -> Customer -> Property -> Estimate/Booking -> Agreements -> Job
     -> Completion -> Invoice -> Payment -> Receipt -> Follow-up / Review
```

Every record keeps its permanent reference:

| Record | Permanent reference |
| --- | --- |
| Customer | `customers.id` plus contact rows |
| Property | `properties.id` |
| Appointment/job | `appointments.reference` |
| Invoice | `invoices.number` |
| Agreement packet | `signing_requests.id` and executed SHA-256 |
| Payment | provider payment id recorded in the ledger/webhook |
| Review request | `review_requests.id` with deterministic dedupe key |

## 2. Current implementation

### Customer File (Admin -> Customers)

The detail view already aggregates:

- Contact information and status.
- Properties with saved characteristics, access, parking and internal notes.
- Leads, estimates, appointments, recurring plans and invoices.
- Gift certificates and Quick Estimates.
- Discounts and benefits.
- Signing requests and payment authorizations.
- Notes and privacy erasure.
- **New:** customer-level review relationship.
- **New:** quick actions that open the relevant workflow with the customer
  already selected:
  - New Booking
  - Record Completed Cleaning
  - New Estimate
  - Create Invoice
  - Send Agreement
  - Email Customer / Call Customer

Quick actions reuse the existing screens; they do not create a second booking,
invoice or document pipeline. Customer context is carried by setting the
existing customer selector and firing its normal change handler.

### Jobs

- Completed-job detail and invoice creation are present from the prior release.
- Calendar actions Open / Customer / Docs / Invoice work for jobs without a
  booking request.
- Job status, crew assignment and checklist remain in Jobs & Team.

### Agreements

- One authoritative packet per booking reference is enforced by duplicate
  suppression in the send path.
- Executed evidence is immutable; publishing a revision moves packet items and
  retires the previous version without touching executed copies.

### Finance

- One primary invoice per appointment is the intended default.
- Production has 3 invoices, no duplicate numbers and no per-appointment
  duplicates.
- Manual invoices retain the canonical service and performed date.

## 3. Verified integrity

At audit time, production had:

- 0 foreign-key violations.
- 0 orphan properties, appointments, invoices, signatures, review requests or
  packet items.
- 0 duplicate invoice numbers.
- 0 duplicate primary invoices per appointment.
- 0 duplicate active signing requests per booking reference.

## 4. Remaining gaps

| Gap | Priority | Status |
| --- | --- | --- |
| Change-order/amendment workflow | P2 | **Implemented 2026-11-24**: owner/admin creates a change order from the job, approves it, signs through the approved Additional Service template, and creates one explicit supplemental invoice. Employee-initiated requests are not yet exposed. |
| Single chronological activity timeline | P2 | **Implemented 2026-11-24**: customer and job timelines merge appointments, invoices, payments, tips, agreements, review invitations, communications, photos and notes with links to source records. |
| Job detail is not a full job file | P2 | **Implemented 2026-11-24**: job view shows reference, customer/property, service, price, crew, photos, invoices, supplemental invoices, payments, documents, communications, change orders and timeline. |
| Cross-module deep links | P2 | Customer, job, invoice and agreement links added in the new timeline and job file. Some legacy list views still use text-only references. |
| One primary invoice per job | P3 | **Implemented 2026-11-24**: migration `0059` adds `invoice_role` and a partial unique index for one primary invoice per appointment. Supplemental invoices link to the primary and are supported by the API. |
| Change order invoice adjustment | P2 | **Implemented 2026-11-24**: signed change orders create a supplemental invoice for the adjustment. Negative adjustments are intentionally blocked and must use refunds/credits instead. |

## 5. Signed change orders (implemented 2026-11-24)

Workflow:

1. Open a job file and create a change order with original scope, revised scope,
   adjustment amount, reason and effective date.
2. Owner/manager approves it (step-up required).
3. **Send for signature** creates a single-use packet from the approved
   **Additional Service and Add-On Authorization** template, creates a signing
   request linked to the job, deactivates the temporary packet, and can email the
   signing link.
4. Captured signatures remain immutable. The original agreement and primary
   invoice are never rewritten.
5. After signing, **Create supplemental invoice** creates an explicit
   `invoice_role = 'supplemental'` invoice linked to the primary invoice and the
   job, and records the change order as billed.
6. Negative adjustments are not invoiced; use the existing refund/credit path.

Tables: `service_change_orders`, plus `invoices.invoice_role` and
`invoices.related_invoice_id`. Tests: `tests/change-orders.test.ts`,
`tests/migration-0059.test.ts`, `tests/customer-timeline.test.ts`, and the
browser customer/job file test.

Not implemented: employee-initiated change requests and a customer-facing
self-service amendment portal. The owner/staff workflow is complete.

## 6. Recommended phases

### Phase 1 (next)

- Add a merged customer activity query/read model (no schema change required):
  leads, appointments, invoices, payments, signing requests, review events,
  communications and photos, ordered by timestamp.
- Add job-file links for crew time, photos, communications and payments.

### Phase 2

- Add amendment/change-order records linked to the original signing request and
  job, with approval and optional signature snapshots.
- Add invoice adjustment references for change orders and credits.

### Phase 3

- Evaluate a partial unique index for primary invoices per appointment after
  confirming how supplements are represented.
- Consolidate customer detail rendering into smaller typed modules instead of
  extending the admin monolith.

## 6. Safety rules

- Never rewrite an executed agreement, payment or financial record.
- A change order supplements the original; it never replaces it.
- Customer context must be server-validated; a client-selected customer or
  property is never authorization.
- Archived customers remain recoverable and are excluded from routine lists.
- Deleting a customer in normal operations is archiving, not erasure. Privacy
  erasure remains a separate owner-only action.
