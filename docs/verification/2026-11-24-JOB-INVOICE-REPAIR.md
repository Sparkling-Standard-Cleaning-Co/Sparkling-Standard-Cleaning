# Completed-Job → Invoice Repair — 2026-11-24 P0

**Branch:** `production-safe`
**Base:** `ae6ac57`
**Status:** verified locally; production deployment evidence appended after release.

## Production investigation

The existing completed appointment was found by its `HC-20261123-…` reference:

- status Completed
- source `admin_completed`
- customer and property linked
- estimate snapshot `27500` cents
- service `move_in_out`
- service label `Move-Out Cleaning`
- completed service date `2026-11-23`
- agreed price `275.00`
- **invoice count: 0**

The estimate and price snapshot are correct. The job is not an active
reservation, has a signed agreement link and no future slot. There was no
invoice, so this was not a Finance listing/filter failure.

A replay of the deployed `invoice_job` server handler against a copy of the
current production D1 database (including the actual job snapshot) succeeded and
produced a $275.00 invoice linked to the appointment. The server path itself
creates the invoice correctly.

## Root cause of the owner-facing failure

The completed job has **no `booking_request_id`**. The calendar Open, Docs and
Invoice handlers only understood request-linked appointments. For a completed
historical job they showed an explanation instead of performing the job action.
The Invoice button therefore never invoked `invoice_job` for Francesca's job.

In addition, retrying **Save & Create Invoice** on an already-created completed
job was rejected as a duplicate, which prevented that retry from reaching the
invoice step. The missing invoice is a UI/workflow and retry failure, not a
listing failure and not a bad $275 snapshot.

## Fixes

- Added authenticated `GET /api/admin/bookings?view=job&appointmentId=…` with
  branch scoping, canonical customer/property, estimate snapshot, linked invoice,
  crew and signed-document summary.
- Completed calendar jobs now have a real job detail view: Open displays the job,
  Customer opens the customer, Docs lists linked agreement records and executed
  copies, and Invoice opens an existing invoice or creates one from the recorded
  agreed price.
- The calendar Invoice action calls the existing idempotent `invoice_job`
  operation, then refreshes Finance and opens the invoice detail immediately.
- A repeated completed-service submission now returns the existing job instead of
  dead-ending, so Save & Create Invoice can resume safely and invoice exactly
  once.
- Move and Cancel are omitted for completed jobs; no dead clickable actions.
- No duplicate customer, appointment, agreement or invoice is created.

## Tests

- `tests/manual-booking.test.ts`:
  - real completed job create/invoice path
  - `view=job` returns no invoice before creation and the linked invoice after
  - second Invoice call returns the same invoice
  - repeated completed-service submission reuses the same appointment
  - production-snapshot replay of `invoice_job` succeeded at $275.00
- `tests/browser/calendar-job-invoice.test.mjs`:
  - completed calendar job Open shows real job details and linked agreement
  - completed jobs expose no Move/Cancel
  - Invoice confirmation creates exactly one $275 invoice and opens it in Finance
  - clicking Invoice again opens the existing invoice without a second POST
- Full regression: unit **1,099 tests (1,098 pass, 1 pre-existing skip)**;
  browser **273/273**; `astro check` 0 errors/0 warnings; build 41 pages;
  validation 2,631 links; smoke 21 pages.

## Boundaries

- No production invoice was created by verification.
- Francesca's job, customer, agreement, payment or calendar event was not
  modified.
- No email was sent and no card was charged.

## Deployment evidence

- Deployed application commit: `eb4d7a5` on `production-safe`.
- Cloudflare Pages production deployment:
  `ec52ed7b-4f72-41d0-9cee-812485e5d5d9`.
- GitHub Actions `validate` + `browser`: run `45306250368` succeeded
  (`validate` 1m9s, `browser` 7m0s).
- Served production admin asset:
  `/_astro/index.astro_astro_type_script_index_0_lang.BWs9qs_3.js`, matching the
  locally verified build.
- Production data check after deployment: `HC-20261123-0F3495` remains
  Completed with **0 invoices**; verification did not create Francesca's
  invoice or modify the job.
- The owner can now open the existing calendar job and click **Invoice** to
  create/open the $275 invoice; repeated clicks open the same invoice.

## Exact owner clicks

1. Admin → Calendar & Requests.
2. Monday, November 23 → Afternoon → Francesca's completed `HC-20261123-0F3495` card.
3. Click **Invoice**. If no invoice exists, confirm **Create $275.00 invoice**.
4. The invoice opens in Finance → Invoices & Payments; review it and send it.
5. Clicking **Invoice** again opens the same invoice; it never creates a duplicate.
   **Open** shows the job and linked executed agreement; **Docs** lists the agreement records; **Customer** opens Francesca's customer record.
