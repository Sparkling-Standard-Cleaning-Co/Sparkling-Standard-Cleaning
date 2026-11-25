# Completed-Service Booking, Custom Pricing and Invoice Service Dates — 2026-11-23 Hotfix

**Branch:** `production-safe`
**Base at start:** `46994ea` (optional tipping release)
**Status:** verified locally; production evidence appended after deployment.

## Root cause

Admin → New Booking only accepted estimator-priced, future/available-slot
appointments. The create path always required a priced estimator quote plus an
available calendar slot, so a cleaning already performed (including today) could
not be recorded or invoiced. The invoice form also used a hardcoded three-option
service list and had no service-performed date.

## Implemented

### Custom price and discounts

- Added Pricing adjustments directly below Extras & Add-ons:
  - calculated estimator price or custom agreed price
  - percentage or fixed customer discount
  - optional reason
  - live base/discount/final service amount before tax
- The server, not the browser, calculates and persists the custom price and
  discount. Invalid/negative prices, >100% discounts, and stacking an admin
  discount onto an existing promotion/entitlement are rejected.
- Custom pricing skips automatic promotion/entitlement discounts so existing
  stacking rules are preserved.
- The agreed price, pricing method, discount type/value/reason and discount
  cents are persisted in the estimate snapshot and audit detail.

### Record completed cleaning

- Added Appointment type: **Schedule a cleaning** / **Record completed cleaning**.
- Completed mode:
  - accepts a past date or today
  - requires a custom agreed price and at least one actual cleaner
  - requires no available slot and performs no availability lookup
  - creates a Completed appointment with no booking-request reservation,
    no Google Calendar event and no automatic signing packet
  - records actual crew in `appointment_resources`
  - can link an existing signed agreement by setting only its appointment link
  - provides **Save Completed Job** and **Save & Create Invoice**
- Completed records are excluded from active reservation/approval semantics by
  source/status and are not future appointments.

### Invoice integration

- Added a job invoice path from the completed appointment (`invoice_job`) using
  the agreed estimate total, not a fresh estimator price.
- Invoice creation is idempotent per appointment and per booking request.
- Added `invoices.service_code`, `service_label` and `service_date` (migration
  `0057_invoice_service_date.sql`) so the selected service and actual performed
  date survive into the invoice, PDF, email, receipt and customer payment page.
- The admin invoice form now loads the active canonical service catalog and
  includes explicit Move-Out Cleaning and Move-In Cleaning choices, a service
  performed date, an optional description (defaults to the service name) and
  direct agreed amount entry.
- Existing invoices and financial records are preserved; no historical invoice
  is rewritten.

## Targeted tests

- `tests/manual-booking.test.ts`:
  - custom $275 with percentage and fixed discounts persisted server-side
  - invalid negative price and >100% discount rejected
  - scheduled custom booking persists the agreed total/discount snapshot
  - completed service today saves with no availability/calendar link
  - past completed date saves and links signed evidence without altering it
  - future completed date rejected
  - invoice created once at $275 and retry returns the same invoice
  - invoice stores Move-Out service label/code and service date
- `tests/browser/admin-manual-booking.test.mjs`:
  - completed mode exposes custom price/date/crew and hides future scheduling
  - Save & Create Invoice sends the completed job and invoice actions
- `tests/browser/admin-invoice-services.test.mjs`:
  - invoice form exposes Move-Out/Move-In and canonical service catalog
  - service label/date are sent and the amount is direct.

Full regression: unit **1,098 tests (1,097 pass, 1 pre-existing skip)**; browser
**272/272**; `astro check` 0 errors/0 warnings; build 41 pages; validation 2,631
links; smoke 21 pages.

## Production migration and backup

- Pre-hotfix D1 export:
  `C:\Users\thoma\AppData\Local\Temp\opencode\sparkling-pre-hotfix-20261123-192434.sql`
  (2,001,550 bytes, SHA-256
  `680FF2B51100B604DC22856EA0F134A66178CC4EDF973084FCDCB03A876D6814`).
- `0057_invoice_service_date.sql` applied remotely; production now has 57
  migrations. `PRAGMA foreign_key_check` returned no violations.

## Rendered evidence

- `docs/verification/2026-11-23-hotfix-completed-service/completed-service-custom-price.png`
- `docs/verification/2026-11-23-hotfix-completed-service/invoice-service-date-form.png`

## Deployment evidence

- Deployed application commit: `ae6ac57` on `production-safe`.
- Cloudflare Pages production deployment: `ef5ec9e2-47ba-4a6c-bf53-16381216835f`.
- GitHub Actions `validate` + `browser`: run `45299825684` succeeded
  (`validate` 1m13s, `browser` 6m14s).
- Served production admin asset:
  `/_astro/index.astro_astro_type_script_index_0_lang.DAZVnrlk.js`.
- Live `/admin/` contains Record completed cleaning, Pricing adjustments,
  Custom agreed price, canonical invoice-service options and Service performed
  date.
- Production `/api/admin/auth` is configured and unauthenticated; estimate
  checkout is enabled in live mode; booking status reports a connected calendar.
- 57 production migrations; no foreign-key violations.
- The live invoice-payment endpoint still returns the existing invoices with
  default gratuity $0.00 and correct tip-only behavior.
- No production customer record, invoice, payment, appointment, email, calendar
  event or signing evidence was created, altered or deleted by verification.


## Not performed

No live customer invoice, message, payment, appointment, calendar event or
destructive mutation was created by verification. Francesca's records were not
modified.
