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

| Gap | Priority | Notes |
| --- | --- | --- |
| No first-class change-order/amendment workflow | P2 | Additional work after signing must currently be handled as a manual document or a new request. Needs original agreement link, proposed change, price consequence, approval, optional signature and invoice adjustment. |
| No single chronological activity timeline | P2 | Customer detail lists record families, but does not merge communications, payments, photos and document events into one sorted feed. |
| Job detail is not a full job file | P2 | It links customer/docs/invoice but does not yet show crew time, photos, payments and communications together. |
| Cross-module deep links are partial | P2 | Calendar -> Job -> Customer -> Agreement -> Invoice -> Payment navigation exists in places but is not consistent. |
| One-invoice-per-job is convention, not a database constraint | P3 | Application idempotency protects known paths; a partial unique index would require a deliberate migration and handling of legitimate supplements. |

## 5. Recommended phases

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
