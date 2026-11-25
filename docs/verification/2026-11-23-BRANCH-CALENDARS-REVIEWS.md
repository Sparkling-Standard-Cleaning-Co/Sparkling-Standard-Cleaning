# Branch Calendars and Google Review Requests — 2026-11-23

Status: **deployed to production 2026-11-23.** Release commit
`1b6efba2c45a8c9a528b5f64a92c698d5286aa37`; Cloudflare Pages deployment
`0566590a-f5a8-4d6f-abff-5a26c06783dd` on `production-safe`. Migrations `0051`-`0055`
are applied; production D1 is at 55 migrations. Tampa remains non-bookable and review
automation remains disabled.

## Implemented

- Branch resolution now uses the service ZIP, a reverse-geocoded ZIP, or a conservative
  coordinate fallback. An unknown ZIP/state is an out-of-area inquiry and never silently
  becomes Pensacola. A client-requested branch cannot override a known Pensacola/Tampa ZIP.
- Tampa ZIP coverage now includes Spring Hill `34609`; `33602`, `33701` and the existing
  Tampa list resolve to `branch_tampa`. Orlando `32801` is out of area.
- Branch-specific Google Calendar selection:
  - `GOOGLE_CALENDAR_ID_PENSACOLA` (falls back to legacy `GOOGLE_CALENDAR_ID`).
  - `GOOGLE_CALENDAR_ID_TAMPA` (no Pensacola fallback).
  - Optional owner-entered branch `calendar_id` overrides the environment value.
  - Availability, holds, auto-confirm and commitment paths use the branch calendar and
    branch timezone (`America/Chicago` / `America/New_York`).
- Migration `0055_branch_calendars_reviews.sql` adds branch calendar/review columns and a
  `review_requests` table. Review automation is disabled by default for every branch.
- Review requests:
  - Only a verified completed appointment is eligible.
  - Test/preview records, missing emails, missing official review links, disabled branches
    and frequency caps are suppressed.
  - Deduplication prevents repeated requests for the same appointment.
  - The owner can queue/cancel requests and send a queued request with an explicit action.
  - No incentives, positive-only screening, satisfaction gates or mandatory reviews.
- Invoice, invoice email and invoice PDF include an optional review invitation only when
  the linked appointment is completed and the branch has an official HTTPS review link.
  Tampa has no review link, so no Tampa review action is shown.
- Admin **Branches & Launch** now exposes the branch calendar ID/name, official review URL
  and review delay/frequency controls.
- Admin **Google Reviews** lists queued/sent/suppressed requests and supports queue/cancel.

## Applied production configuration

1. Migrations `0051`-`0055` are applied. `0052` was already present in production and its
   migration record was reconciled only after verifying its column and index existed.
2. `GOOGLE_CALENDAR_ID_TAMPA` is configured as a production Pages secret. The Pensacola
   `GOOGLE_CALENDAR_ID` secret was not changed.
3. Pensacola's existing official review URL remains
   `https://g.page/r/CXAcv1Pp7OI2ECE/review`.
4. Tampa review URL remains blank, so Tampa review invitations are suppressed.
5. `review_requests_enabled` remains `0` for both branches.
6. Tampa public booking remains disabled (`branch_tampa` lifecycle `setup`, status
   `inactive`).

## Remaining owner actions

- Supply Tampa's official Google review URL before enabling Tampa review requests.
- Approve the review email policy before enabling automation.
- Authorize Tampa public booking only after staffing, licensing, insurance, tax, capacity,
  pricing, payment and fulfillment are verified.

## Verification

- `npm run check`: 0 errors.
- `npm test`: 1,075 tests, 1,074 pass, 1 pre-existing skip.
- `npm run test:browser`: 260/260 pass.
- `npm run verify`: build 40 pages, 2,567 internal links, validation passed.
- Migration `0055` test: additive, columns/table present, Pensacola review URL populated,
  Tampa blank, automation disabled, integrity and foreign keys clean.
- Production D1 backup before migrations: 1,983,689 bytes, SHA-256
  `c46819f8f078c3fc19f11ecda67c39c1cbc3496d6e275bb8dab011ee26e4205e`, restored in memory
  with 50 migrations, 95 tables and 0 foreign-key violations. Post-migration backup:
  1,992,845 bytes, SHA-256 `b948e3eba2d6aaaeeb6ca92100683e6ff9916339e9b0ef183e588aa0a3a16cb5`,
  55 migrations, 100 tables, 0 foreign-key violations.
- Production data preserved: 12 customers, 14 properties, 15 appointments, 2 invoices,
  5 signing requests, 14 pending requests, 15 calendar links, 5 upcoming confirmed
  appointments and 2 pending signatures.
- Production Pensacola availability returned `enabled: true`, `America/Chicago`, 35 slots.
  Tampa returned `enabled: false`, `branch_not_bookable`.
- Production `/api/estimate-checkout` readiness is `enabled: true`, `mode: live`, all checks
  true. `/api/lead-readiness` is ready. Homepage and admin return 200; admin is noindex.
- Production responsive smoke at 390px and 1280px showed 0 horizontal overflow and 0 page
  errors on the homepage, admin, and residential estimator.
- Review requests in production: 0 queued, 0 sent. No review worker exists. No synthetic
  review email, calendar write, charge, refund or customer message was created.
- No live Resend send, no live Google Calendar write, no charge, refund or customer message.
