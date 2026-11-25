# Execution reliability fixes - 2026-11-20

## Scope

Follow-up to the master reliability directive: verify the current production build,
fix review-card clipping/scroll behavior, configure Tampa coverage/pricing, diagnose
the failed November 23 checkout and recurring worker failures, and improve admin
diagnostics without weakening payment, privacy or authorization controls.

## Production baseline verified

- Application code `1a066d6` deployed to `production-safe`.
- Cloudflare Pages production deployment: `77452839-122e-4ae5-b552-8f0a9333231e`.
- GitHub CI for `1a066d6`: success.
- `GET https://sparkling-standard.com/api/estimate-checkout` returned
  `enabled: true`, `recurringScheduling: true`, `mode: live` and all readiness
  checks true.
- No live charge, refund, customer email or unsolicited message was performed.

## Review carousel

- Desktop cards are 35rem; phone cards are 33rem.
- The quote body scrolls inside the card with a thin visible scrollbar.
- Production inspection at 1440, 1280, 1024 and 390 px found no card-top
  clipping; visible cards had `scrollHeight === clientHeight`.
- On phone width the long review scrolls internally (`scrollHeight 404`,
  `clientHeight 302`, `overflow-y: auto`).
- Long text still opens the accessible full-review dialog.
- Screenshots: `docs/verification/2026-11-20-reviews-footer/reviews-final-*.png`.

## Tampa coverage and pricing

- Approved counties: Pasco, Pinellas and Hillsborough.
- 132 Census ZCTAs are registered in `src/config/branches.ts` and in the
  production Tampa branch row.
- Default one-way limit: 20 miles (Pensacola remains 45).
- Tampa pricing version 1 is published internally at fingerprint
  `2026-10-25.engine-calibration-supportive-tax.v1.49705bdc08ec90b4`.
- No origin coordinates were invented. Tampa public booking remains disabled
  until a real origin and branch-aware estimate/travel/scheduling path exist.

## Failed November 23 checkout

- Request: `lead_f44d6243-202b-4390-82bd-409a88cae600`.
- Quote: `SS-20261120-2VVDVY`; Pensacola; request-to-reserve; Nov 23 2026
  7:30 AM Central; biweekly; `HOLIDAY15`; photos outstanding.
- Stored server price was `$360.00` while the customer saw `$306.00` after the
  `HOLIDAY15` promotion. The server candidate was evaluated before the database
  promotion, so explicit acceptance of `$306.00` could be rejected as
  `quote_changed`, and recurring checkout was also gated by
  `RECURRING_SCHEDULING_ENABLED`.
- `RECURRING_SCHEDULING_ENABLED=true` is now set in the production Pages
  environment and reported by readiness.
- Database promotions are now applied to the candidate before explicit
  acceptance is compared. The accepted displayed total therefore matches the
  final server total. A regression test covers the `$306.00` acceptance case.
- A failed checkout is recorded on the request and shown in the admin payment
  card with the issue and time.
- Admin request times use the branch timezone: Pensacola Central, Tampa Eastern.
  The request now displays 7:30 AM, not 8:30 AM.
- The customer must retry the payment; no retry or charge was performed during
  verification.

## Recurring worker failures

- Production history: 11 failed daily worker runs and 3 completed runs.
- Only two recurring plans were affected:
  `rec_23aafd8b-afa9-4597-9e97-007dec0bb80e` and
  `rec_5a84cf72-e3d6-45b2-a8ca-0cacb26050ff`.
- Causes were classified as calendar authentication failures (Nov 10, 16, 17)
  and unavailable slots/holiday conflicts (including Dec 25, Jan 1, Jan 19 and
  Jan 8, 2027), not 11 independent plan failures.
- Admin Recurring Plans now lists worker runs with status, plan count, synced
  count, errors and a readable cause. The metric is labelled "Failed recurring
  runs", not "customers affected".
- No plans, occurrences or history were deleted.

## Admin presentation

- Recurring duration is rendered as minutes or hours and minutes.
- Long admin tables are bounded to 30rem with sticky headers and internal scroll.
- Request dates use branch-local time.
- This is bounded scrolling, not full server-side pagination.

## Tests

- `npm run check`: 0 errors, 0 warnings, 2 hints.
- Unit suite: 908 tests, 907 pass, 1 pre-existing skip; focused checkout file:
  28/28 pass including the new promotion-total regression.
- Browser suite: 228/228 pass after assigning unique preview ports to two admin
  test files that shared port 4436/4422.
- Build: 37 pages.
- Validation and fact audit: pass.

## Remaining gaps

- Tampa origin, branch-aware public estimator/travel/scheduling and real
  activation remain unimplemented.
- Documents admin workflow remains unrefined.
- Full server-side admin pagination is not implemented.
- Scheduled GitHub backup secrets, OneDrive cloud-sync confirmation and
  independent backup-key custody remain owner actions.
