# Estimator refinements and gift promotion support (2026-11-11)

## Release

- Application code: `99db643`
- Branch: `production-safe` (with `main` synchronized on the same commit)
- Cloudflare Pages production deployment: `bef7159b-f0bf-4daf-b651-13c4852e7008` (source `99db643`).
- Documentation closeout: `9efccb2`, deployed as `eb3a396e-6b54-43f5-8970-fde1cb9cabcc` with no
  application-code change.
- GitHub `validate` (including the browser job) passed on both `main` and `production-safe`
  (runs `43065361764` and `43065355063`).
- Migration `0034_promotion_scope.sql` applied to production D1 before the code deployment.

## Implemented

### Promotions control

- The owner Promotions & Discounts table now lists every offer in force, not only
  database rows:
  - database promotions (including THANKS75);
  - the static SPARKLE15 welcome campaign and its historical SPARKLE100 claim code;
  - the three automatic add-on bundles;
  - the Community Support 10% eligibility discount;
  - the church 10% discount.
- Static, bundle and eligibility offers are clearly marked as code-managed and
  are not editable from the database table.
- Migration `0034` adds `scope` (`cleaning`, `gift`, `both`) with existing rows
  defaulting to `cleaning`. The admin form exposes the scope and a
  gift-certificate purchase service option.
- The promotion evaluator rejects a cleaning offer presented to the gift flow
  and a gift offer presented to a cleaning quote (`promotion_scope_ineligible`).
- The estimator promo input placeholder is now the neutral
  `Enter promo code (optional)`; no promotion code is pre-filled.

### Gift certificate promotions

- The gift-certificate page has an optional promo-code field and Apply action.
- Gift codes are validated server-side for the gift scope. A valid code reduces
  the checkout purchase price; the certificate face value is unchanged and the
  recipient receives the full approved value.
- The discounted amount is sent to Stripe, recorded in checkout metadata and in
  the durable gift ledger (`purchaseAmountCents`, `promotionCode`,
  `promotionDiscountCents`).
- A redemption is reserved after the checkout claim, redeemed only by the paid
  webhook, and released on checkout failure or session expiry.
- Cleaning promotions (THANKS75, SPARKLE15, SPARKLE100) cannot discount gift
  purchases. A gift purchase cannot discount cleaning.

### Estimator presentation

- Final-step appointment card:
  - eyebrow: **Your appointment for**;
  - time line: the selected time or **Time to be confirmed**;
  - action: **Reschedule** (returns to date and time selection without losing
    answers).
- The final price breakdown always shows an **Add-ons** row, `$0.00` when none
  are selected. Selected extras appear as readable detail under that row; they
  are not duplicated elsewhere.
- Every wizard transition now scrolls the active step to the top of the content
  area below the sticky header. Initial page load is never moved. This removes
  the reverse-scroll behavior on mobile where earlier steps were positioned
  too low.

## Verification

- `npm run check`: 0 errors, 0 warnings, 1 pre-existing hint.
- `npm test`: 852 tests, 851 pass, 1 pre-existing skip.
- `npm run build`: success (35 pages).
- `npm run validate`: success.
- `npm run smoke`: success (21 pages).
- `npm run test:browser`: 209 tests, all pass.
- Focused promotion tests: 13 tests, all pass (including gift/cleaning scope
  separation and THANKS75 eligibility).
- Live production checks after deployment:
  - `/estimate/residential/` serves the neutral promo placeholder, the
    **Your appointment for** card and **Reschedule**;
  - `/gift-certificates/` serves the optional gift promo field;
  - `/admin/` serves the scope selector and gift-certificate service option;
  - the deployed estimator bundle contains the Add-ons breakdown.
- THANKS75 remains active with its approved terms and deadlines. No live card
  charge, gift purchase, refund or promotion redemption was created during
  verification.

## Still outstanding from the wider admin directive

- Global admin branch selector and legacy NULL-branch backfill preview.
- Documents screen redesign and Word-document conversion.
- Customer-facing recurring autopay consent/SetupIntent flow.
- One-click complete encrypted D1+R2 archive (the encrypted CLI backup remains
  the supported complete backup).
- Owner-approved legal templates and live Stripe/Calendar write verification.
