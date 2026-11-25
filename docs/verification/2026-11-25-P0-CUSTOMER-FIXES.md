# 2026-11-25 P0 Customer Fixes

## Release identity

- Repository: `Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning`
- Branch: `production-safe`
- Starting HEAD: `6af6224`
- Application commit: `ae77ac4` (`Fix public booking windows, first-clean pricing and signing contact`)
- Cloudflare Pages deployment: `53b472e6-7819-4da2-942e-bc5a0e91cede`
- Deployment source: `ae77ac4`
- Production URL: `https://sparkling-standard.com`
- CI run: `45653891203` (validate + browser, green)
- Database migrations added: none

## P0 1 - Morning/afternoon booking start times: FIXED

### Root cause

The production availability API returned the first bookable morning start at
`7:30 AM`, because crew travel from the private operating origin consumes
30 minutes before the 7:00 workday start. The old hour/minute selector then
hid unavailable hours and automatically selected the first available hour,
so `7:30 AM` appeared to be the public morning start.

### Fix

- Added the owner-defined public start windows to `src/config/booking.ts`:
  Morning 7:00-8:30 AM and Afternoon 12:30-2:30 PM (branch-local time).
- `/api/availability` now returns only starts inside those windows and reports
  `no_public_start_window` when the day has availability outside them.
- `/api/booking-hold` independently rejects any hold outside the windows with
  `slot_outside_public_window`.
- Replaced the ambiguous hour/minute selects with explicit 15-minute start
  buttons. Every public start is shown; unavailable starts are crossed out
  with an explanation instead of disappearing. There is no automatic time
  selection, and the selected time survives step navigation.
- The calendar uses the branch timezone returned by the availability API.

### Verified

- Live `GET https://sparkling-standard.com/api/availability?date=2026-11-30&durationMinutes=120&lat=30.4213&lng=-87.2169&zip=32502`
  returned 14 starts, all within `7:30 AM-8:30 AM` and `12:30 PM-2:30 PM`.
  `7:00 AM` was honestly absent because travel makes it unavailable; no
  outside-window time was returned.
- Live `POST /api/booking-hold` for a synthetic `9:00 AM` start returned
  HTTP `409` with `{"ok":false,"error":"slot_outside_public_window"}`. No hold
  was created.
- Browser coverage verifies every 15-minute option, disabled-state rendering,
  no stale availability after a rapid date change, selection persistence and
  mobile layout.
- Screenshots: `docs/verification/2026-11-25-p0-fixes/scheduling-desktop.png`
  and `scheduling-mobile.png`.

## P0 2 - First cleaning pricing and optional Deep Cleaning: FIXED for new recurring arrangements

### Root cause

The pricing engine already required a first-visit Deep Cleaning for every new
recurring arrangement and produced separate first-visit and ongoing prices.
The defect was presentational: the optional "Add a Deep Cleaning reset"
checkbox appeared before a frequency was chosen, making the required clean
look like an optional paid add-on.

### Fix

- The optional reset is now shown only after an explicit one-time residential
  choice. Recurring frequencies never show it.
- The recurring notice now states **Your First Cleaning**, explains that the
  first visit establishes the standard, and shows:
  - First Visit: Deep Cleaning - the calculated first-visit price.
  - Following Visits: the selected rhythm and calculated per-visit price.
- Values update from the same authoritative estimate as the final breakdown;
  placeholder text is shown until enough home details exist. The required
  first-visit acknowledgment remains unchanged and enforced.
- A one-time Deep Cleaning service does not receive a second optional reset.

### Verified

- Deterministic browser test showed a weekly new arrangement with
  `$335` first visit and `$245` weekly ongoing visits, with the required
  acknowledgment visible and no optional recurring reset.
- Unit coverage confirms the estimator already treats the first recurring
  visit as Deep Cleaning, carries `ongoing`, and never adds a second charge.
- Browser coverage confirms the optional reset is absent before a frequency,
  absent for recurring, present for one-time, and absent for a one-time Deep
  Cleaning service.
- Screenshots: `docs/verification/2026-11-25-p0-fixes/recurring-first-clean-desktop.png`
  and `recurring-first-clean-mobile.png`.

### Known limitation / owner decision

A returning recurring customer whose first Deep Cleaning is already complete
has no authenticated public-estimator identity. The estimator therefore
applies the new-arrangement first-clean policy to public recurring quotes.
No self-attestation switch was added, because it would allow a customer to
override a charging policy without authorization. This remains a policy
decision for the owner.

## P0 3 - Day-of-service contact on signing: FIXED

### Root cause

The signing page always rendered blank day-of-service contact name and phone
fields even though the customer and booking already held that information.

### Fix

- The signing access step now presents:
  - **Same as my booking contact** (default), showing the verified name and
    phone without retyping.
  - **Use a different day-of-service contact**, which requires a name and
    phone and does not overwrite the customer profile.
- The server derives the booking contact from the token-bound customer and
  applies "same" from server data. A client-supplied same-contact name or
  phone is discarded.
- A missing booking phone fails closed with a specific message and an
  actionable "different contact" path.
- The alternate contact layout is an equal-width grid on desktop and stacks
  on mobile.

### Verified

- Server-handler and end-to-end tests prove same-contact values are derived
  server-side, client values cannot spoof them, different-contact fields are
  required only for the alternate choice, and signed evidence contains the
  correct contact.
- Browser coverage verifies the summary, same/different switching, mobile
  stacking, focus, and submitted values.
- Screenshots: `signing-contact-same-{desktop,mobile}.png` and
  `signing-contact-different-{desktop,mobile}.png` in the same directory.
- The live served signing asset contains the same/different contact UI and
  the missing-phone guidance. A real production signing request was not
  accessed or modified; server proof uses isolated test databases and tokens.

## Validation

| Check | Result |
| --- | --- |
| `npm run check` | 0 errors |
| Unit tests (`npm test`) | 1121 tests, 1120 pass, 0 fail, 1 pre-existing skip |
| Browser tests (`npm run test:browser`) | 280/280 pass |
| `npm run verify` | `astro check` 0 errors, 41 pages, validate-site passed |
| Internal links | 2,631 links across 41 pages resolve |
| `npm run smoke` | 21 pages passed |
| CI `45653891203` | validate and browser jobs green |

The unit suite increased by three tests. The browser suite increased by one
test. The prior OneDrive ranged-upload test was corrected to actually exceed
one upload chunk and to supply the verification response; the production
upload implementation was not weakened.

## Safety

- No production migration was added or applied.
- No customer email, charge, refund, calendar event, confirmed booking or
  live signing request was created or modified.
- The only production booking-hold call used a synthetic out-of-window start
  and was rejected before a hold could be written.
- Screenshots use deterministic local fixtures. No customer data appears.
