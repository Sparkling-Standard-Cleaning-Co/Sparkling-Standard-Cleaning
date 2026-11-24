# Customer file and job lifecycle architecture

**Status:** requirements documented, current-state audit complete, integration started.
**Authority:** owner directive received 2026-11-24. This document is the canonical
reconciliation for the unified customer/job architecture.

## Required model

One canonical customer identity → multiple properties → multiple jobs → their
invoices, agreements, change orders, payments, tips, photos, communications,
assignments and audit events.

- Every distinct service occurrence is a job with a permanent internal ID, a
  unique human-readable reference, canonical customer/property/branch IDs, service
  date, completion status and an immutable agreed-price snapshot.
- Recurring visits are separate jobs. Retries and duplicate clicks must be
  idempotent.
- Every invoice has a permanent ID, unique number, canonical customer and job
  link where applicable. One primary invoice per job is the default; supplemental
  invoices, credits, refunds and replacements remain allowed and explicitly linked
  with an audited reason.
- A job has one authoritative original executed agreement packet. Existing valid
  coverage is reused; signed evidence is never overwritten. Material scope or price
  changes use a separately signed amendment/change order while the original remains
  intact.
- Material operational details must be reachable from customer, job, calendar,
  invoice, document and review entry points without creating duplicate records.
- Row access never implies field access. Employee, financial and private-note data
  remain governed by the existing authorization policy.

## Current canonical data

| Entity | Canonical table / ID | Existing relationships | Status |
| --- | --- | --- | --- |
| Customer | `customers.id` | Contacts, properties, invoices, payments, jobs, documents, reviews | Implemented |
| Property | `properties.id` | `customer_id`, branch, service history | Implemented |
| Job / occurrence | `appointments.id`, `reference` unique | `customer_id`, `property_id`, `branch_id`, `recurring_plan_id`, `estimate_id`, `booking_request_id`, calendar, resources | Mostly implemented |
| Invoice | `invoices.id`, `number` unique | `customer_id`, `property_id`, `appointment_id`, lines, payments, credits, refunds | Implemented |
| Payment / tip | `payments.id`, `tip_allocations.id` | customer, invoice, appointment, team member | Implemented |
| Agreement request | `signing_requests.id` | customer, property, appointment, booking request, recurring plan, signatures, executed SHA | Implemented |
| Document evidence | `document_signatures.id` | signing request, template version, signed hash and private copy | Implemented |
| Review request | `review_requests.id` | branch, customer, appointment, invoice, dedupe key | Implemented |
| Communication | `communications.id`, `notification_delivery_events.related_type/related_id` | customer, appointment; event delivery has a generic relation | Partially implemented |
| Photos | R2 `leads/...` keys; `job_media` | Request reference and optional job media; customer/job association is indirect | Gap |
| Audit | `admin_audit_log` | actor, entity type/id, timestamp | Implemented |
| Change order / amendment | — | — | Missing |
| Primary-invoice invariant | — | No database rule distinguishes primary from supplemental invoice | Missing |

Additional verified relationships:

- `invoices.appointment_id` and `payments.appointment_id` already provide the
  financial job link.
- `signing_requests.appointment_id`, `customer_id` and `property_id` already provide
  agreement coverage links.
- `review_requests.appointment_id` and `invoice_id` already provide verified
  completed-job review eligibility.
- `job_media` already supports before/after/issue/document evidence by job, but is
  not the customer photo-intake path.
- `notification_delivery_events` records delivery status and a related record, while
  `communications` records customer/appointment correspondence.

## Traceability matrix

| Requirement | Existing support | Gap / next action |
| --- | --- | --- |
| One customer identity | `customers.id` and FK use throughout | No new identity system |
| Multiple properties | `properties.customer_id` | Preserve; add stronger UI context |
| Unique job per occurrence | `appointments.reference` unique, recurring link | No duplicate-occurrence constraint yet |
| Job price snapshot | Booking request/estimate/invoice retain pricing | `appointments` has no immutable agreed-price columns |
| One primary invoice per job | Invoices link by `appointment_id` | No primary/supplemental discriminator or partial unique index |
| Supplemental invoices / credits | Invoice lines, credits, refunds exist | No parent invoice/change-order reason link |
| Original agreement reuse | Signing requests can link job/customer/property | No explicit coverage evaluation or duplicate-packet guard at job level |
| Amendments / change orders | Signed documents are versioned | No first-class change-order lifecycle or job scope ledger |
| Payment and gratuity accounting | Payments, refunds, `tip_allocations` | Preserve; expose in job/customer file |
| Photos tied to customer/job | `job_media`; request photo keys | Intake photos lack canonical customer/job columns |
| Communications timeline | `communications`, delivery events | No unified read model across delivery, documents, payments |
| Customer workspace | Customer CRUD, properties, history APIs | No single consolidated workspace |
| Job workspace | Calendar/job views, calendar invoice repair | No complete unified job detail |
| Cross-entry navigation | Several repaired links in Release A | Customer/job/invoice cross-links incomplete |
| Customer portal | Existing portal sessions and scoped data | Must reuse; no second account system |
| Audit attribution | Admin audit records | Extend to change orders and agreement coverage |

## Integration completed or in progress

- **Release A (deployed `e970ce0`):** alerts navigate to canonical signing-request
  and invoice details; reviews select real completed jobs instead of typed IDs;
  leads gain archive/restore/disposable deletion without duplicating customer
  identities.
- **Release B (in progress):** photo inventory links R2 objects to lead/customer
  context, protects legally held records, and deletes eligible photos; retention
  subjects use real customer/property/booking choices; backup health reports the
  missing heartbeat honestly.
- **Release C (in progress):** communications use labeled automatic-field chips
  and structured wording rather than raw template code; delivery subject records
  remain customer/job-linked where the underlying mailer provides them.

## Deferred implementation

1. Add immutable job pricing/completion fields and idempotent occurrence constraints.
2. Add primary/supplemental invoice classification and a partial unique index for
   one active primary invoice per job; preserve all existing invoices through a
   controlled migration.
3. Add change orders/amendments linked to customer, property, job, original
   agreement and original invoice.
4. Build the unified customer workspace and complete job file.
5. Link photo intake to canonical customer/property/job IDs while preserving R2
   privacy and retention.
6. Create a consolidated activity read model; never fabricate delivery evidence.
7. Reuse the existing portal and authorization model for customer visibility.

No production record has been modified to implement this documentation, and no
duplicate customer/job/invoice identity has been introduced.
