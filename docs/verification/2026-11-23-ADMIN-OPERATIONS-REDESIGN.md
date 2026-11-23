# 2026-11-23 — Admin operations redesign

**Status:** implemented and verified locally; **not committed, merged, migrated, or deployed**.
**Branch:** `production-safe`
**Base:** `fa559ce`
**Production:** unchanged during this work.

This pass preserves the previous uncommitted checkout/signing/pricing/document-editor/Resend
isolation work and adds the owner-directed admin operations corrections.

## Preserved work

The following existing uncommitted changes were retained without reset, discard, or duplication:

- `0053_signing_pricing_snapshot.sql` and the persistent signing price snapshot.
- Signature boxes, adopted-signature reuse, signature progress, executed PDFs, direct payment
  transition and the payment-page status presentation.
- WYSIWYG document editor, rich HTML sanitization/PDF rendering, friendly document versions.
- Resend test isolation (`tests/helpers/no-live-email.mjs`, preloaded by `npm test`).
- Previous `Â€`/mojibake repair and related tests.

New additive migration: `0054_admin_operations.sql` (estimate numbers, test-request marking,
operational alert lifecycle). It is **not applied to production**.

## 1. Calendar and requests

- Replaced the seven-day summary table with a seven-day calendar grid.
- Week navigation (Previous / Today / Next), current-date highlighting, Central Time display,
  appointment cards positioned in chronological order, customer, service, start/end, assigned
  employee, property summary, status and human-readable reference.
- Employee, service, status and branch filters.
- Canceled appointments are hidden from the default active view and remain available under the
  Canceled filter.
- Recurring technical references (`RECURRING-rec_…`) are replaced by customer/service labels in
  routine appointment cards.
- Clicking an appointment opens its linked reservation request.
- Upcoming appointments default to confirmed + pending within 30 days, chronological, with
  confirmed/pending/canceled/completed/all views, date range, employee/service filters and
  pagination. Canceled occurrences no longer clutter the default schedule.

## 2. Reservation bulk operations

- Per-row checkboxes, select-all-visible, select-all-filtered, clear selection and a visible count.
- Bulk actions: Approve eligible, Archive, Restore, Deny (no email), Mark as test, Delete eligible
  test records.
- Bulk approval reuses the existing server confirmation path with customer email suppressed.
- Bulk denial is internal only; no customer email is sent.
- Bulk deletion is owner-only, requires the record to be marked as test, and refuses records with
  payments, appointments, executed agreements, invoices, payment events or commitments. Soft
  archive remains available for retained records.
- Partial failures are reported per record; successful updates are audited.

## 3. Admin overview alerts

Verified production counts at investigation time (2026-11-23):

| Alert | Count | Classification |
| --- | ---: | --- |
| Pending requests | 14 | Real requests plus internal/diagnostic test records |
| Unsigned agreement packets | 2 | Pending/partially signed signing requests |
| Outstanding invoices | 1 | Open balance |
| Recurring worker failures | 11 historical runs | **0 active**; the latest completed run is 2026-11-23, after the last failed run (2026-11-20) |
| Checkout failures/stale sessions | 11 | **3 failed** setup sessions and **8 abandoned** stale open sessions |

- Alerts now show plain-English explanation, first/last occurrence, root cause, operational impact,
  recommended action, affected-record links, recheck, acknowledge, investigating, resolve (with a
  required note) and owner-only dismiss.
- Alert lifecycle is persisted in `operational_alerts`; resolved/dismissed history remains
  inspectable. A recurring condition reopens as a new alert.
- Abandoned checkouts are separated from real failures and are not presented as critical outages.
- Historical recurring failures remain in the recurring operational history but no longer appear
  as an active emergency after a later successful run.

## 4. Customer directory

- Default view is Active customers only.
- Added Active / Archived / Deleted / All views.
- Anonymized “Deleted Customer” records are excluded from active and archived lists and appear only
  in the Deleted view.
- Anonymized records show no invented identity and do not offer a misleading restore.
- Archived, non-anonymized customers can be restored with an audit entry.
- Customer dropdowns and document recipient search request active customers only.

## 5. Estimates, time presentation and extras

- Quick Estimates now receive a stable human number (`EST-YYYY-NNNN`) stored with the estimate and
  shown in the result, saved list, admin detail and PDF context. Existing records are backfilled in
  the additive migration. The pricing engine fingerprint remains diagnostic only.
- Labor and on-site time are rounded to the 15-minute scheduling grid for presentation:
  `Estimated labor: 7 hours · Expected time on site: 7 hours` (or hours + minutes). Underlying
  pricing calculations are unchanged.
- New Booking and Quick Estimate extras use a collapsed, searchable, categorized selector with
  selected chips, descriptions, custom-quote labels and a selected count. Existing approved add-on
  IDs and calculations are unchanged.

## 6. Promotion allocation

- A claimed campaign now owns the eligible first-visit component for a new recurring arrangement.
- Community Support may apply to separately eligible ongoing visits, even when a campaign applied
  to the first visit; it never stacks on the same component.
- FRIENDS15/Community Support competition on the same component remains single-discount and the
  better valid offer wins; no silent replacement was introduced.
- The estimator displays the ongoing Community Support allocation explicitly.

## 7. Availability

- The public 7:00 AM start is already the configured workday start and the 15-minute grid includes
  7:00/7:15.
- Existing tests verify that 7:00 and 7:15 are offered when travel is zero, and that later starts
  are correct when actual origin travel or minimum notice makes them unavailable. No forced slot
  was introduced.

## 8. Recurring plans and dispatch

- Recurring plans default to active/paused, with Active only, Paused, Canceled and All views.
- Plan rows show customer, property, service, frequency, window/start, duration, price, next visit,
  assigned crew, friendly sync state and status; actions include save, view schedule, retry sync and
  open customer.
- Worker history is in an expandable operational-history section.
- Jobs & Team now has a tabbed workspace: Dispatch Board, Team Schedule, Coverage & Conflicts,
  Dispatch Settings and Operational History. Advanced optimizer settings are hidden under Dispatch
  Settings.
- Unassigned jobs now have a direct click-to-assign control using dispatch-ready employees. The
  server evaluates the requested cleaner, refuses infeasible assignments, preserves the customer
  appointment time, updates the calendar, and audits the decision.
- Existing confirmed assignments and customer times are never changed automatically.

## 9. Previous checkout work

- Pricing snapshot, signature ceremony, document editor, version labels and Resend isolation remain
  intact and pass the regression suite.
- The successful Pay Now → signing handoff no longer returns a payment-failure result, removing the
  brief red error flash while preserving real errors.

## 10. Verification

- `npm run check`: **0 errors**.
- `npm run build`: **40 pages**.
- Unit: **1,069 tests — 1,068 pass, 1 pre-existing skip, 0 fail**.
- Browser: **259/259 pass**.
- The admin overview and seven-day calendar were also checked in Playwright at 390px with no
  page-level horizontal overflow.
- `npm run validate`: 2,567 internal links across 40 pages; SEO, marketing/QR, GTM artifacts and
  checklist leak checks pass.
- `npm run smoke`: 21 pages pass.
- No live Resend test email, Stripe charge/refund, customer message, production migration or
  deployment was performed.
