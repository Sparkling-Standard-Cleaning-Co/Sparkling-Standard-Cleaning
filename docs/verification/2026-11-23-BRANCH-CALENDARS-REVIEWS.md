# Branch Calendars and Google Review Requests — 2026-11-23

Status: **implemented locally, not committed or deployed.** Production remains on the
2026-11-23 runtime deployment. Migrations `0053`, `0054` and `0055` are **not applied**.

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

## Owner setup still required

1. Apply migrations `0053`, `0054` and `0055` to production D1 in order.
2. Set `GOOGLE_CALENDAR_ID_TAMPA` in Cloudflare to the dedicated Tampa calendar.
3. Confirm the Pensacola calendar ID in `GOOGLE_CALENDAR_ID_PENSACOLA` (or keep the legacy
   `GOOGLE_CALENDAR_ID`).
4. Supply Tampa's official Google review URL before enabling Tampa review requests.
5. Leave `review_requests_enabled` off until the owner approves the review email policy.
6. Authorize Tampa public booking only after staffing, licensing, insurance, tax, capacity,
   pricing, payment and fulfillment are verified.

## Verification

- `npm run check`: 0 errors.
- `npm test`: 1,075 tests, 1,074 pass, 1 pre-existing skip.
- `npm run test:browser`: 260/260 pass.
- `npm run verify`: build 40 pages, 2,567 internal links, validation passed.
- Migration `0055` test: additive, columns/table present, Pensacola review URL populated,
  Tampa blank, automation disabled, integrity and foreign keys clean.
- No live Resend send, no live Google Calendar write, no migration applied, no charge,
  refund or customer message.
