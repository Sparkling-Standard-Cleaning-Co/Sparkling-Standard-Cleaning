# Address-first scheduling and estimator scroll correction (2026-11-17)

## Release

- Application code: `PENDING_CODE_SHA`
- Final HEAD: recorded after commit
- Cloudflare Pages production deployment: `PENDING_DEPLOYMENT_ID`
- No pricing, database, migration, payment, promotion or gift-certificate logic changed.

## Address first, scheduling second

The residential `When & Where` step now follows one required order:

1. Service address (GPS or manual).
2. Address resolution and service-area/travel validation.
3. Pin confirmation and the compact confirmed-address card.
4. Appointment calendar unlock: date, window, exact time.
5. Continue to Service & Home.

Changes:

- The address card is visible immediately and is the first Step 1 question.
- The availability gate is visible before confirmation; the calendar section is hidden.
- The calendar unlocks only after `onConfirm` for a confirmed destination.
- Editing or changing the address emits an unconfirmed state, immediately re-locks scheduling and
  clears the previously selected date/time through `BookingCalendar.reset()`.
- Step 1 validation does not evaluate the date/time until a location exists. An unresolved or
  unconfirmed address cannot reach scheduling or advance; the customer sees a specific address
  confirmation error.
- A confirmed street-level or approximate ZIP-area pin still unlocks scheduling using the existing
  address-finder behavior. The request remains honestly labeled by its existing precision fields.
- Other estimator fields, service selection, pricing and final booking behavior are unchanged.

## Scroll controller

The existing controller remains the only page-scroll authority:

- Address confirmation: after the fields collapse, scroll to the calendar intro heading below the
  sticky header.
- Date selection: scroll to the available appointment-times card.
- Period selection: the existing picker reveal now calls the shared controller instead of running
  its own `window.scrollTo`.
- Time selection: ensure the selected time and Continue are both in view; move up if a previous
  smooth scroll left the selected time above the header, and move down only when Continue is not
  reachable. No movement when both are already visible.
- Continue: scroll to the new step's primary heading (or the final-step reveal stage), never the
  decorative page top.
- Back: Step 1 targets its address question; later steps target their active heading.
- A scroll-intent counter cancels delayed settled passes when a newer scroll or step transition has
  taken over. Reduced-motion preference is respected.

## Tests

New `tests/browser/address-first-scheduling.test.mjs` exercises the full transition at
`360×800`, `390×844`, tablet and desktop:

- address is visible and scheduling is hidden on initial load;
- address details, resolve, map confirmation and compact card;
- scheduling heading is below the sticky header after confirmation;
- date → times → picker → time;
- selected time and Continue remain visible;
- Continue lands on the Step 2 heading;
- Back returns to the Step 1 address question;
- Change Address re-locks scheduling and clears the selected date.

Existing browser tests were updated for the new order. Full browser suite: **218 passing**.
Unit suite: **856 tests, 855 passing, 1 pre-existing skip**. `check`, build, validate and smoke pass.
The previous five-second final reveal is unchanged and remains covered by the existing reveal test.

## Exact files modified

- `src/components/EstimateWizard.astro`
- `src/scripts/estimate-wizard.ts`
- `src/scripts/booking-calendar.ts`
- `src/scripts/address-finder.ts`
- `src/styles/global.css`
- `tests/browser/address-first-scheduling.test.mjs` (new)
- `tests/browser/wizard.test.mjs`
- `tests/browser/estimate-ux-corrections.test.mjs`
- `tests/browser/estimator-ux-corrections.test.mjs`
- `tests/browser/journey.test.mjs`
- `tests/browser/gps-gtm.test.mjs`
- `tests/browser/hotfix-address-map.test.mjs`
- `tests/browser/accessibility.test.mjs`
- `tests/browser/analytics-events.test.mjs`
- `tests/browser/attribution.test.mjs`
- `tests/browser/initiative-6.6-content.test.mjs`
- `tests/browser/initiative-6.9-booking.test.mjs`
- `tests/browser/initiative-6.9-paynow.test.mjs`
- `tests/browser/service-matrix.test.mjs`
- `tests/helpers/estimator-step-one.mjs` (new shared test helper)
- `docs/operations/ESTIMATOR-ENGINES.md`
- `docs/operations/ESTIMATOR-LOCATION-ENGINE.md`
- `docs/verification/VERIFICATION.md`
- `AGENTS.md`

## Production verification

- Live `/estimate/residential/` will be checked after deployment for address-first markup, hidden
  scheduling gate and updated bundle behavior.
