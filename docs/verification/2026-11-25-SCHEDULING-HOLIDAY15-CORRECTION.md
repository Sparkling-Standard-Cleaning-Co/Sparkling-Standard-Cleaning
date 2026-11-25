# 2026-11-25 Urgent Scheduling and HOLIDAY15 Correction

## Release identity

- Branch: `production-safe`
- Starting HEAD: `1d1cb47`
- Application commits:
  - `bf2b81c` - Restore 7 AM booking and scope HOLIDAY15 with Community Support
  - `a0b94c8` - Align recurring benefit display with rounded customer rates
- Production deployment: `643d14b8-2b4b-457c-9221-e1cec3d158ba`
- Deployment source: `a0b94c8`
- Production URL: `https://sparkling-standard.com`
- CI: `45669420849` (`bf2b81c`) and `45672275769` (`a0b94c8`), both green
- Migration: `0061_booking_hours_1900.sql`, applied to production D1 (1 row:
  Hayli's resource end time updated from 6:00 PM to 7:00 PM)

## 1. Why 7:00 AM and 7:15 AM were disabled

The blocking rule was in `src/lib/booking/availability.ts`:

- For the first job of a day, the engine calculated
  `earliestStart = workdayStart + travelMinutes(private origin, destination)`.
- The configured private operating origin produced a 30-minute route to the
  verified Pensacola destination.
- Therefore 7:00 AM and 7:15 AM failed `candidateStart >= earliestStart`;
  7:30 AM was the first passing candidate.
- Branch hours and the bookable staff workday both started at 7:00 AM, so
  neither was the cause. There was no genuine early calendar conflict on
  2026-11-30; once the artificial first-job travel gate was removed, the live
  API returned 7:00 AM and 7:15 AM for that date.

The previous large button UI also hid unavailable starts and selected the
first available hour, which made 7:30 AM look like the morning start.

## 2. Scheduling correction

- A cleaner is considered ready at the start of their configured workday.
  Travel and job buffers now apply only after a genuine previous appointment,
  or before a real next appointment.
- The public start windows remain Morning 7:00-8:30 AM and Afternoon
  12:30-2:30 PM, in 15-minute increments.
- The compact hour-and-minute selector is restored. It shows valid 15-minute
  combinations, disables unavailable options, does not auto-select a time and
  preserves the customer's choice.
- Published operating hours are 7:00 AM-7:00 PM. Migration `0061` updates the
  existing bookable resource end time; public start windows still stop at
  2:30 PM.
- No genuine conflict can be bypassed: overlapping jobs, unavailable crew,
  time off and documented calendar blocks still prevent a slot.

### Live proof

On 2026-11-30, the live production availability API returned **16 slots**,
starting exactly:

- `7:00 AM`
- `7:15 AM`
- `7:30 AM`
- ... through `8:30 AM`
- `12:30 PM` through `2:30 PM`

The live production page shows the restored compact selector with `Hour 07`,
`Minute 00` or `15`, and `AM`; selecting them produced `7:00 AM` and
`7:15 AM` in the persisted selected time.

Screenshots:

- `docs/verification/2026-11-25-p0-fixes/live-scheduling-700-desktop.png`
- `docs/verification/2026-11-25-p0-fixes/live-scheduling-desktop.png` (7:15 AM)
- `docs/verification/2026-11-25-p0-fixes/scheduling-desktop.png`
- `docs/verification/2026-11-25-p0-fixes/scheduling-mobile.png`

## 3. HOLIDAY15 + Community Support root causes

1. The estimator treated Community Support as the same single-discount
   candidate on the first-visit Deep Cleaning. Selecting eligibility changed
   the first-visit quote and could make the 10% discount displace or compete
   with the 15% promotion.
2. The browser cleared an applied promo code whenever the estimate total
   changed. Selecting Community Support therefore removed HOLIDAY15 from the
   visible total even though it was still a valid first-visit benefit.
3. Checkout had a same-line `supportiveStackable` combination path. It could
   add both reductions to one charge instead of allocating them to different
   eligible service lines.

## 4. New pricing behavior

- Benefits are recorded as independently scoped allocations
  (`first_visit`, `ongoing_visit`, or `service`) in the pricing breakdown.
- A new recurring arrangement's first visit is the Deep Cleaning line.
  Community Support is **not** deducted from that line.
- The following recurring maintenance rate carries the 10% Community Support
  allocation.
- HOLIDAY15 is a first-visit promotion. It reduces only the first-visit
  charge. It is never compounded with Community Support on the same line.
- If the initial Deep Cleaning is the only charge at checkout, only HOLIDAY15
  is charged today; Community Support is stored for future maintenance.
- No future recurring visits are charged at checkout.
- Server verification sets `ongoing_regular_price_per_visit`,
  `ongoing_price_per_visit`, and the recurring benefit label/amount from its
  own calculation. The browser's values are not trusted.
- The recurring plan stores the discounted rate and its regular base price.
- The signing pricing snapshot, executed agreement text and signing page
  include the first-visit discounted total and the separately stated future
  recurring regular price, benefit and rate.
- Existing invoices and stored signing snapshots are not rewritten.

### Live proof

Live production, recurring weekly, HOLIDAY15 and Community Support both
selected, no booking or payment submitted:

- Initial Deep Cleaning regular price: `$336.05`
- Rounding: `-$1.05`
- HOLIDAY15: `-$50.25`
- First Visit Total: **$284.75**
- Recurring maintenance: `$245.00` regular
- Community Support discount (10%): `-$25.00`
- Weekly recurring rate: **$220.00** per visit

The live page displays both benefits separately. Screenshot:
`docs/verification/2026-11-25-p0-fixes/live-holiday15-community-desktop.png`.

## 5. Tests

| Check | Result |
| --- | --- |
| `npm run check` | 0 errors |
| Unit (`npm test`) | 1,124 tests, 1,123 pass, 0 fail, 1 pre-existing skip |
| Browser (`npm run test:browser`) | 282/282 pass |
| `npm run verify` | 41 pages, 2,631 links, validation passed |
| `npm run smoke` | 21 pages passed |
| CI `45672275769` | validate + browser green |

Focused coverage includes:

- free-day availability starts at 7:00 AM and includes 7:15 AM despite origin
  travel;
- 7:00 AM and 7:15 AM remain selectable in the compact UI when the server
  returns them;
- HOLIDAY15 with Community Support in both selection orders;
- removing Community Support leaves HOLIDAY15 intact;
- no same-line compounding;
- recurring first visit carries no Community Support discount while the
  recurring rate does;
- checkout applies only HOLIDAY15 to the first-visit charge;
- snapshot reconciliation and future recurring terms;
- genuine previous-job travel and conflict rules still block slots.

## 6. Safety

- No live booking, temporary hold, charge, refund, customer email or signed
  agreement was created or modified.
- No existing appointment, invoice or historical pricing record was changed.
- The only production data mutation was migration `0061`, updating the
  bookable resource's end time from 6:00 PM to 7:00 PM.
- DEFEND was not touched.
