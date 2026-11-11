# Admin enhancements - promotions and data controls (2026-11-10)

## Promotions & Discount Codes

Implemented:

- Migration `0032_promotions_and_redemptions.sql` adds `promotions` and
  `promotion_redemptions` (74 application tables total).
- Owner-only admin **Promotions & Discounts** screen: create, edit, duplicate,
  activate/deactivate, schedule, service/branch eligibility, fixed or percentage
  discounts, minimum purchase, maximum discount, redemption caps, per-customer
  limits, new-customer/recurring/first-visit restrictions, combinability,
  status and redemption/revenue reporting.
- Public **Have a promo code?** field on the residential/STR estimator final
  step with server validation through `POST /api/promotion`.
- Checkout applies the discount server-side before tax, adds a receipt line,
  stores the promotion in the checkout ledger and Stripe metadata, reserves a
  redemption only after checkout is claimed, redeems only on paid webhook
  completion (or gift-covered completion), and releases on expiry/failure.
- The Thanksgiving Deep Clean Special is seeded as a **draft** (THANKS75, $75
  fixed, Deep Cleaning, Pensacola, expires 2026-11-25). It is **not active** and
  does not appear to customers until the owner reviews and activates it.
- No base cleaning-price formula was changed.

Important checks for the owner before activation:

- minimum eligible price and any maximum-discount cap;
- booking/service deadline interpretation (the seeded expiration is
  2026-11-25 23:59:59 UTC; adjust to the intended Central-time end if needed);
- redemption cap and per-customer limit;
- non-stacking: the checkout rejects a dynamic promotion when an existing
  discount is present and the promotion is not combinable.

## Data & Storage

Implemented owner-only **Data & Storage** tab:

- D1 configured/size (when reported by D1) and business-record counts.
- R2 binding presence and sampled object counts (never a fabricated total).
- Backup/storage status records from `admin_settings`.
- CSV exports for customers, properties, appointments and invoices; owner
  authenticated and audit-recorded.
- Photo-cleanup preview and safe run using the 30-day retention rule; only
  server-generated `leads/` photo/sidecar keys can match.
- The previously deployed daily R2 Worker remains the automatic cleanup path.

Not implemented in this release:

- a one-click **complete encrypted D1+R2 ZIP** inside a single Worker request
  (the existing encrypted CLI backup/restore is the supported complete backup);
- object-level R2 archive without S3 credentials/destination;
- a general storage wipe (intentionally not provided).

## Production release

- Application code: `f8d57c7`
- Cloudflare Pages deployment: `1d521862-6a5d-42f1-92d0-4b0aeae84550`
- GitHub `validate`/`browser`: green on `main` and `production-safe`

## Verification

- Unit suite: 845 tests (844 pass, 1 pre-existing skip).
- Browser suite: 208 pass.
- Migration 0032 applied to production D1; post-migration encrypted backup restored with 74 tables, integrity `ok`, 0 foreign-key violations.

## Still outstanding from the master directive

- Global admin branch selector and legacy NULL-branch backfill preview/approval.
- Documents screen section redesign and Word document conversion.
- Customer-facing recurring autopay consent/SetupIntent flow.
- Owner-approved legal templates and live Stripe/Calendar write verification.
