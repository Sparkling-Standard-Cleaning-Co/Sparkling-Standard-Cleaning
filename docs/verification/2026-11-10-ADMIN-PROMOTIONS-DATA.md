# Admin enhancements - promotions and data controls (2026-11-10)

## Promotions & Discount Codes

Implemented:

- Migration `0032_promotions_and_redemptions.sql` adds `promotions` and
  `promotion_redemptions` (74 application tables total).
- Owner-only admin **Promotions & Discounts** screen: create, edit, duplicate,
  activate/deactivate, schedule, service/branch eligibility, fixed or percentage
  discounts, minimum purchase, maximum discount, redemption caps, per-customer
  limits, new-customer/recurring/first-visit restrictions, combinability, status
  and redemption/revenue reporting.
- **2026-11-11 additions:** migration `0034` adds `scope` (`cleaning`, `gift`,
  `both`). The table also lists the static SPARKLE15/SPARKLE100 programs, the
  three add-on bundles and the Community Support and church eligibility
  discounts as read-only inventory. Gift-certificate purchases can use
  gift-scoped promotions; the face value is preserved and only the purchase
  price is reduced.
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

- Application code: `2265fa6`
- Cloudflare Pages deployment: `894430e4-a6c1-46dd-aeb6-1377ab8efe17`
- GitHub `validate`/`browser`: green on `main` and `production-safe` (runs `42942647125` and `42942646975`)

## Verification

- Unit suite: 851 tests (850 pass, 1 pre-existing skip).
- Browser suite: 208 pass.
- Migrations 0032 and 0033 applied to production D1; post-migration encrypted backup restored with 74 tables, integrity `ok`, 0 foreign-key violations.

## Still outstanding from the master directive

- Global admin branch selector and legacy NULL-branch backfill preview/approval.
- Documents screen section redesign and Word document conversion.
- Customer-facing recurring autopay consent/SetupIntent flow.
- Owner-approved legal templates and live Stripe/Calendar write verification.
## THANKS75 activation - 2026-11-10

**Status: ACTIVE.**

| Setting | Value |
| --- | --- |
| Name | Thanksgiving Deep Clean Special |
| Code | THANKS75 |
| Discount | $75.00 fixed |
| Branch | Pensacola |
| Eligible service | Deep Cleaning only |
| Minimum eligible subtotal | $200.00 before tax and before discount |
| Maximum discount | $75.00 |
| Total redemptions | 20 |
| Per customer | 1 |
| Combinability | Disabled |
| Booking deadline | 2026-11-23 23:59:59 America/Chicago |
| Service completion deadline | 2026-11-25 23:59:59 America/Chicago |
| Recurring | First eligible cleaning only; never applied to future visits |
| Terms version | `2026-11-10.thanks75.v1` |

Deadline policy: a checkout reservation created before the booking deadline may
finish payment afterward; the qualifying service date must still be on or before
November 25. A completed refund/cancellation does not restore redemption
capacity or reissue the discount; failed/abandoned checkouts release their
reservation, and unredeemed reservations stop counting after two hours.

### Financial review (read-only; base prices unchanged)

Default single-cleaner model, using the owner-approved $25/hour solo rate, the
22% operating-overhead allowance and $10 supplies:

| Scenario | Price | After $75 | Labour hours | Contribution margin |
| --- | --- | --- | --- | --- |
| Lowest realistic deep clean | $310 | $235 | 5.67 | **+$31.55** |
| Representative 3/2 deep clean | $365 | $290 | 6.72 | **+$48.20** |
| Larger deep clean | $525 | $450 | 9.55 | **+$102.25** |

A two-hired-cleaner crew at $22 + $18/hour produces a negative contribution on
the lower two scenarios (about -$53.50 and -$52.60). **Operational guard:** do
not assign two hired cleaners to a THANKS75 job; use the default solo cleaner or
an owner-led crew where the owner's compensation is the remaining margin. This
is a staffing control, not a change to the approved promotion terms.

### Verification

- Promotion exists exactly once and is active.
- Live `POST /api/promotion` returns a $75 discount for a qualifying $300 deep
  clean and rejects $199.99 with `promotion_minimum_not_met`.
- Unit tests cover fixed/percentage arithmetic, minimum, branch, service,
  stacking, booking/service deadlines, 20-cap concurrency, customer limit,
  reservation release and public-response privacy.
- The public estimator exposes the promo-code field and the false delivery
  warning remains absent.
- No base estimator price, fee, tax rate or wage assumption was changed.

### Customer advertising facts

- **$75 off** a qualifying **Deep Cleaning** in the **Pensacola** service area.
- Code: **THANKS75**
- Minimum eligible cleaning subtotal: **$200 before tax**.
- Book by **November 23, 2026, 11:59:59 PM Central**.
- Service must be completed by **November 25, 2026, 11:59:59 PM Central**.
- One redemption per customer; 20 total; cannot combine with SPARKLE15,
  SPARKLE100 or any other discount.
- Booking URL: **https://sparkling-standard.com/estimate/residential/?service=deep**

