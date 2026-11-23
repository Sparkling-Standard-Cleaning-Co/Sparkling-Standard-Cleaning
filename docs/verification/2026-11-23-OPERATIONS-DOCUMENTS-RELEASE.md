# Operations & Documents Combined Release — 2026-11-23

**Branch:** `production-safe`
**Base HEAD:** `3fb0b8b666ea85a1e10f11254c090cf2c2007dcf`
**Status at implementation:** verified locally; release evidence is appended after
deployment.

## Document branding (completed before this session, preserved and reverified)

The shared brand layer (`src/lib/documents/branding.ts`, `brand-logo.ts`),
branded editor frame, shared admin/customer renderer, embedded PDF logo, branded
footer and page numbers, and legacy Markdown table support are all retained.
Admin preview, packet preview, customer signing and executed PDFs now share the
same presentation. No historical executed agreement, signature, price snapshot,
approved template or signing request was rewritten.

Evidence: `docs/verification/2026-11-23-DOCUMENT-BRANDING.md` and
`docs/verification/2026-11-23-document-branding/`.

## Reservation action defect — root cause and correction

The deployed bulk reservation controls were nonfunctional because
`functions/api/admin/requests.ts` required a singular `requestId` for **every**
POST before it reached the `action === 'bulk'` branch. The browser test mocked
`/api/admin/requests`, so it never executed the real handler and reported the
controls as passing.

Corrections:

- Bulk actions are handled before the singular request lookup.
- The server returns a non-mutating eligibility preview (`bulk_preview`) with
  selected, eligible and protected counts and per-record reasons.
- The console shows a confirmation dialog with the eligible/ineligible counts
  and reasons, executes only the confirmed operation, reports per-record
  failures, refreshes the list, and preserves audit history.
- Active requests with held or confirmed appointments cannot be archived without
  first closing or cancelling them.
- Permanent deletion remains owner-only, limited to marked test records with no
  financial, appointment, signing, payment or commitment evidence.

Regression evidence executes the real handler against a migrated SQLite D1
shape in `tests/admin.test.ts` (no route mocking).

## Customer deletion as reversible archiving

- **Delete Customer** now shows a simple confirmation: the customer moves to the
  archive and historical records are preserved.
- The dialog lists active obligations (upcoming appointments, recurring plans,
  invoice balances, unsigned agreements) and states that archiving does not
  cancel them.
- Archived customers are excluded from routine active-customer selectors and
  cannot be used to create a new booking until restored.
- Restore remains idempotent and returns the customer to active operations.
- Irreversible privacy erasure remains a separate owner-only workflow with its
  original typed confirmation. Legal holds and retained financial/signed history
  protections are unchanged.

## Interactive seven-day calendar

- Every day always shows **Morning** and **Afternoon** sections, including empty
  sections.
- Multiple appointments show the earliest card and a `+N more` control; hovering
  or focusing reveals the section list and tapping/clicking cycles the visible
  appointment.
- Times and date grouping use the appointment’s branch timezone
  (`America/Chicago` Pensacola, `America/New_York` Tampa). Mixed-branch views
  label each card with CT/ET.
- Cards expose Open Booking, Customer, Reschedule, Cancel, Documents and Invoice.
- Drag-and-drop is a proposal: the drop prefills a new date, requires an exact
  start time, shows the affected crew/branch, and saves only after server
  validation and explicit confirmation. The Reschedule button is the accessible
  non-drag equivalent.
- Recurring appointments offer **This appointment only** or **This appointment
  and future cleanings**. The server validates availability with the existing
  crew resources, preserves historical/completed visits, and reports generated
  and superseded future visits. Whole-plan cancellation remains a separate,
  explicitly confirmed option.
- Cancellation from the calendar never emails the customer unless the admin
  selects the email checkbox.

## Multi-cleaner dispatch

The unassigned dispatch board now offers a checklist of dispatch-ready employees,
shows role and working hours, accepts the full crew set, and sends the exact set
to the existing server evaluator. The server continues to validate
qualifications, transport, branch, travel, time and calendar feasibility before
saving. Established assignments are not silently changed.

## Admin-assisted booking, agreements and invoicing

- New Booking can create a customer inline without losing estimate state. The
  server rejects duplicate email/phone contacts, and new customers are assigned
  to the branch resolved from the service ZIP.
- New Booking now offers **Save Booking**, **Book & Send Agreements**,
  **Book, Send Agreements & Invoice**, and **Book & Confirm**.
- Sending actions show a confirmation with customer, recipient, property,
  branch, service, date/time, price, required documents and the exact
  communication/invoice action.
- Invoices are created from the agreed estimate price, are idempotent per
  booking request, are not emailed and do not charge a card. Sending remains an
  explicit Finance action.
- Signing-request creation suppresses duplicates for an active booking and
  directs the admin to the existing resend workflow instead of sending a second
  invitation.
- Repeating the same manual booking submission returns the existing pending
  booking instead of creating a duplicate.
- Reservation detail now shows crew, branch timezone, invoice status/balance,
  document state, notification history and audit trail, with Create Invoice and
  Open in Finance actions.

## Verification (this combined release)

- Unit suite: **1,081 tests (1,080 pass, 1 pre-existing skip)**.
- Browser suite: **267/267 pass** (includes new interactive calendar, multi-
  cleaner, inline customer, combined booking, real bulk-handler and reservation
  lifecycle coverage).
- `astro check`: **0 errors, 0 warnings** (10 pre-existing hints).
- Production build: **40 pages**.
- Validation: **2,569 internal links**, SEO, QR/marketing registry, GTM imports,
  internal checklist leak checks all pass.
- Smoke: **21 pages**.
- No new database migration is required; all behavior uses existing schema.
- Tests never contact Resend, Stripe or Google Calendar. Browser tests use
  mocked routes; the no-live-email guard covers unit tests.

## Protected boundaries

- No historical agreement, executed PDF, signature, template version or signing
  request was modified.
- No template was republished.
- No live customer email, Stripe charge/refund, Google Calendar write or
  destructive production mutation was performed by verification.
- Tampa public booking remains inactive.
- Automated Google review email activation remains disabled.

## Deployment evidence

Appended after the authorized production release.
