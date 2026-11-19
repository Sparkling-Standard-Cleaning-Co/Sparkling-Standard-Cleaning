# Admin Promotion Selection — 2026-11-19

## Implemented

- New Booking now has a database-driven **Discounts & Promotions** selector.
- The list is loaded from the real owner promotion database; inactive promotions are excluded.
- The selection is carried into the manual estimate, booking, stored estimate total and subsequent
  invoice workflow.
- The same server eligibility rules used by the public checkout evaluate branch, service, customer,
  minimum purchase, deadlines, redemption limits and stacking.
- Choosing no promotion leaves the account-level FRIENDS15 benefit active.
- Choosing a one-time promotion suppresses the persistent benefit for that quote.
- Selecting a one-time promotion when another automatic discount is already present returns
  `promotion_not_combinable` rather than silently dropping either discount.
- Invalid or ineligible codes fail closed with the server reason.
- Customer detail now includes the owner-only **Discounts & Benefits** card with active benefit,
  preview, apply/remove and history.

## Verification

- Manual quote test: THANKS75 applies $75 to a synthetic deep-cleaning quote and is itemized.
- Persistent benefit tests: assignment, duplicate prevention, recurring price application,
  removal/restoration and manual quote application.
- Full unit suite: **875 tests — 874 pass, 1 pre-existing skip**.
- Browser suite: **221 pass**.
- Astro check/build/validate/smoke pass.
- The previously flaky Morning/Afternoon scroll assertion now waits for the settled reveal; it
  passed locally and in the complete browser suite.
- No live customer quote, charge, payment or customer email was created.

## Limitations

- Quick Estimate and New Booking share the same manual quote route; the selector is currently in
  New Booking. A separate Quick Estimate screen was not added.
- A selected one-time promotion and an automatic Community Support discount cannot both be applied
  in the manual quote; the server rejects the combination. THANKS75 + Community remains governed by
  the public checkout rules and remains pending end-to-end owner verification.
- Persistent FRIENDS15 recognition in the public estimator for a returning customer is not yet
  automatic; the existing public code-entry behavior remains.
- The public estimator's applied promo can still be removed/replaced by the customer.
