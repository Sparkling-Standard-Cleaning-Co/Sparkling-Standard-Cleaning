# Owner settings guide — what you can change and how

This guide covers every owner-editable business and estimating setting: what it controls, where it
lives, whether it is public or internal, whether it needs approval, and whether changing it
requires a rebuild. It is written for editing directly through GitHub (no local setup needed).

Read the safety rules in §0 first. All prices in this document are the **current provisional
values**; nothing here approves a price change.

## 0. How configuration works (read this first)

- **One source of truth per area.** Business facts live in `src/config/business.ts`, pricing and
  estimating in `src/config/pricing.ts`, service geography in `src/config/geography.ts`, campaign
  links in `src/config/marketing-links.ts`. Never edit component code or content files to change a
  business fact.
- **Everything here is version-controlled.** Every change is a commit; GitHub keeps the history,
  and the previous state can always be restored (revert).
- **The repository is public.** These files are readable by anyone. Internal pricing and
  estimating assumptions are **not confidential** just because the website does not display them.
  If genuine confidentiality is required (e.g. rate card vs competitors), that needs a separate
  server-side configuration design — not a promise that a public file stays secret.
- **Editing through GitHub:** open the file → pencil icon → change the value → "Commit changes"
  with a short message → the CI checks run and Cloudflare rebuilds the site. Wait for the
  Cloudflare deployment check to go green before assuming the change is live.
- **Before you change a number:** run `npm run estimate:quotes` locally (or ask an engineer to
  paste its output) to see the economic impact on representative homes. The command prints the
  current quotes with the active settings; run it again after the change to compare.
- **Configuration tests protect you.** `npm test` validates the structure (unique add-on ids,
  ordered multipliers, valid zones). A typo that would break quoting fails the tests instead of
  reaching customers.
- **Approval states.** Values are `provisional` (starting point, can change freely) or `approved`
  (owner-approved; do not change without a new approval). Every value carries a note explaining
  it. **Publication flags** (`pricing.publication.*`) decide whether a value may ever be shown
  publicly; they are off until the owner approves.
- **Rebuild rule.** All settings in these config files are compiled into the site — a change takes
  effect only after a new build (commit → push → Cloudflare deploy). Environment variables in
  Cloudflare follow the same rule; sending the change requires a redeployment.

## A. Labor and pricing — `src/config/pricing.ts`

| Setting (path) | Controls | Current value | Permitted range / notes | Public? | Approval to change | Affects |
| --- | --- | --- | --- | --- | --- | --- |
| `laborEconomics.targetGrossRevenuePerLaborHour` | Gross revenue per labor-hour used to build estimate ranges | **$55** | Any number > owner target; internal math only | Never displayed | Owner decision | Every estimate |
| `laborEconomics.ownerLaborTargetPerHour` | Founder pay floor before overhead | **$35** | Must stay below the gross rate | Never displayed | Owner decision | Margin sanity tests |
| `minimumJob` | Smallest job value applied silently | **$125** | > 0; not advertised while publication flag is off | Internal | Owner approval | Small jobs, add-on-only visits |
| `laborModel.baseHours.standard / deep / move_in_out / str_turnover` | Base labor hours per service type | 2.0 / 3.2 / 3.4 / 1.2 | > 0 | Internal | Owner approval | Labor hours, price |
| `laborModel.sqftHoursPerThousand` | Labor per 1,000 sq ft | 1.1 | > 0 | Internal | Owner approval | Size scaling |
| `laborModel.fullBathHours` / `halfBathHours` | Bathroom labor | 0.5 / 0.25 | > 0 | Internal | Owner approval | Bathroom scaling |
| `laborModel.bedroomHours` / `bedroomsIncludedInBase` | Bedroom labor beyond the first two | 0.15 / 2 | ≥ 0 / ≥ 0 | Internal | Owner approval | Bedroom scaling |
| `laborModel.strBathHours` / `strBedHours` / `strSqftHoursPerThousand` | STR turnover resets | 0.35 / 0.2 / 0.8 | > 0 | Internal | Owner approval | STR estimates |
| `conditionFactors.*` | Multiplier by home condition (maintained → severe) | 1.0 / 1.1 / 1.25 / 1.45 / 2.0 | ≥ 1, strictly increasing | Internal | Owner approval | Condition adjustment |
| `lastCleanFactors.*` | Multiplier by time since last professional clean | 1.0 → 1.2 | ≥ 1 | Internal | Owner approval | First-clean pricing |
| `frequencyFactors.weekly / biweekly / monthly / one_time` | Labor efficiency by frequency | 0.92 / 0.95 / 0.98 / 1.0 | (0, 1] | Internal | Owner approval | Recurring pricing |
| `recurringReset.flagWhenLastCleanIn` | Flags first recurring visits that may need a detailed reset | over_a_year, never_professional | Any of the last-clean values | Customer sees the flag message | Owner approval | Recurring onboarding |
| `range.lowFactor` / `highFactor` | The ± spread of the public range | 0.92 / 1.12 | low < 1 < high | Public (the range) | Owner approval | Displayed ranges |
| `rounding.toNearest` | Estimate rounding | **$5** | > 0 | Public effect | Owner approval | Displayed ranges |
| `customQuoteThresholds.*` | When a job routes to personal confirmation (size, baths, bedrooms, severe, custom add-ons, outside zone, unknown location) | 4500 sq ft / 4 baths / 5 beds | > 0 | Customer sees a confirmation message | Owner approval | Estimate eligibility |
| `publication.publishHourlyRates / publishAddonPrices / publishMinimumJob` | Whether internal numbers may ever be shown publicly | **all false** | Keep false unless owner explicitly approves publication | Public if ever true | Owner approval + code change | Website claims |

The founder's real-world anchors are encoded as tests (`tests/estimator.test.ts`): a maintained
3/2 lands at ≈4.5–5.0 labor-hours and a first clean ≈6. Changing the labor model must keep those
tests (or update them with owner approval).

## B. Service options and upsells — `src/config/pricing.ts` → `addons.items`

Current add-ons: inside refrigerator, inside oven, inside cabinets, interior windows,
ground-floor exterior windows, laundry, dishes, bed linen change, general/pantry/closet
organization, pet-hair intensive, detailed wall spot-cleaning, detailed baseboards, plus
custom-quote-only: carpet, upholstery, pressure washing, garage, patio.

Each entry supports: `id` (stable snake_case), `label`, `blurb`, `laborHours`, `customQuote`
(must have no price), `price` (internal, provisional), `category`.

| To do this | Edit |
| --- | --- |
| Change an add-on's labor hours | `laborHours` on that item (approval: owner) |
| Change an internal add-on price | `price` (stays invisible while `publishAddonPrices` is false) |
| Add a new instant add-on | Copy a similar item; give it a new unique `id`, a category, labor hours, a price, `customQuote: false` |
| Add a custom-quote add-on | Same, but `customQuote: true` and **no** `price` |
| Retire an add-on | Delete the item (takes effect at the next build) |

Structural rules enforced by tests: unique ids, snake_case, all fields present, custom-quote
items carry no price, instant items carry labor hours.

**Honest limitation:** availability windows, eligible-service-type filters and quantity limits are
**not implemented yet**; every listed add-on is offered for every service. Treat adding such
filters as a future extension, not a current setting. Until then, do not advertise an option that
should not be available — remove it from the list instead.

## C. Travel and vehicle economics

| Setting | Controls | Current value | Where | Public? | Notes |
| --- | --- | --- | --- | --- | --- |
| `pricing.travel.includedOneWayMiles` | Miles included before a travel adjustment | 15 | pricing.ts | Internal | Mirrors the server default; update together |
| `pricing.travel.perMileWearCost` | Vehicle wear allowance per mile | $0.12 | pricing.ts | Internal | Tires/oil/depreciation |
| `pricing.travel.fallbackGasPrice` | Fuel price used when the live feed is unavailable | $3.10 | pricing.ts | Internal | Gulf Coast reference |
| `pricing.travel.zoneAdjustments.core / surrounding` | Flat zone adjustments in offline mode | $0 / $15 | pricing.ts | Never itemized | Silently inside the total |
| `pricing.travel.clientDefaults.mpg / maxInstantDistanceMiles` | Client mirror of vehicle economics | 24 / 45 mi | pricing.ts | Internal | Mirrors Cloudflare values |
| `TRAVEL_ORIGIN` | Private operating coordinates | **not set** | Cloudflare secret | Never published | Required for routed travel |
| `ROUTES_PROVIDER` / `ROUTES_API_KEY` | Routing provider | not set | Cloudflare | Never published | Optional |
| `EIA_API_KEY` | Live fuel price feed | not set | Cloudflare secret | Never published | Optional |
| `REFERENCE_GAS_PRICE` / `TRAVEL_CACHE_SECONDS` | Runtime fuel fallback / cache | 3.1 / 21600 s | Cloudflare text vars | Internal | Optional |
| `VEHICLE_MPG`, `INCLUDED_ONE_WAY_MILES`, `MAX_INSTANT_ESTIMATE_DISTANCE` | Documented planning values | — | `.env.example` | Internal | **Currently not consumed by code** — informational only until the shared-config refactor (`ESTIMATOR-LOCATION-ENGINE.md`) wires or removes them |

The maximum automatic-estimate **driving time** policy (the "about one hour" rule) is designed but
not yet implemented; today the boundary is a provisional ZIP list. See
`docs/operations/ESTIMATOR-LOCATION-ENGINE.md`.

## D. Business hours and scheduling — `src/config/business.ts` → `hours`

| Setting | Controls | Current value | Customer-facing? |
| --- | --- | --- | --- |
| `residentialWindow` | Booking window | 8:00 AM – 6:00 PM | Yes, on contact/about/footer |
| `days` | Operating days | Seven days a week | Yes |
| `commercialNote` | Commercial after-hours availability | "day or evening… overnight when the facility needs it" | Commercial page |
| `firstAppointmentNote` | First-of-day exact arrival promise | exact arrival time | Contact/FAQ |
| `arrivalWindowNote` | Later appointments use a window | — | Contact/FAQ |
| `timezone` | Business timezone | America/Chicago | Internal/schema |
| `schema.opens / closes` | Structured data hours | 08:00 / 18:00 | Schema (public) |

Notes: a normal day may hold one substantial cleaning plus a smaller job. **Total labor-hours are
never reduced by bringing a helper** — a helper shortens elapsed time, not the labor cost used for
pricing. There is no confirmed-booking backend; the site only takes requests. Future-booking
restrictions, holiday exceptions, scheduling buffers, workload caps and helper-availability
assumptions are **not implemented**; add them to the roadmap rather than pretending they exist.

## E. Business policies

| Setting | Controls | Current value | Where | Public? | Approval |
| --- | --- | --- | --- | --- | --- |
| `pricing.cancellation.noticeHours / underNoticePercent / sameDayPercent` | Cancellation policy | 24 h / 25% / 50% — **provisional** | pricing.ts | Public copy avoids the numbers until approved | Owner must approve before publishing |
| `pricing.cancellation.discretionNote` | Founder discretion | — | pricing.ts | Yes | Owner approval |
| `pricing.satisfaction.statement` | Satisfaction process wording | "contact us promptly…" | pricing.ts | Yes | Owner approval |
| `pricing.satisfaction.notificationWindowHours` | Response window | not set | pricing.ts | Deliberately omitted | Owner approval |
| `business.payments.accepted / alternate` | Accepted payment methods | cards/Apple Pay/Google Pay/ACH + others | business.ts | Yes (terms) | Confirm what Stripe actually enables |
| `business.payments.residentialTiming` | Payment timing | after completion | business.ts | Yes | Owner approval |
| `business.products.*` | Supplies philosophy | our supplies; preferences accommodated | business.ts | Yes | Owner approval |
| `business.flags.publishProvisionalAddonPricing` | Show add-on prices | false | business.ts | Public if true | Owner approval + code change |
| `business.flags.instantBooking` | Booking promise | false | business.ts | Public if true | Requires a real booking backend |

Unapproved policy values must stay unapproved and must not become public promises. Promotion and
travel-exception settings do not exist yet; until they do, offers are communicated manually and
never advertised by the site.

## F. Configuration management

- **Files:** `src/config/business.ts`, `src/config/pricing.ts`, `src/config/geography.ts`,
  `src/config/marketing-links.ts`. Nothing else should contain business facts.
- **Generated documents are never hand-edited:** `docs/marketing/UTM-MASTER-LINKS.*` and the QR
  files come from `npm run marketing:links`.
- **Validation:** `npm test` (65 tests) checks structure, ranges and zone data;
  `npm run estimate:quotes` prints representative quotes for before/after comparison;
  `npm run verify` is the full pre-deploy bar.
- **Types and tests are the guardrails.** Every pricing value must carry a state and a note; the
  configuration tests fail a broken edit rather than letting it reach customers.
- **Rebuild requirements:** config files → rebuild (commit + push). `PUBLIC_*` Cloudflare
  variables → rebuild. Runtime secrets (`WEB3FORMS_ACCESS_KEY`, `TRAVEL_ORIGIN`, routing/EIA
  keys) → next deployment attaches them.
- **Confidentiality:** the repository is public. If the owner wants rate assumptions private,
  the proposal is a server-side configuration (estimator pricing computed/stored server-side, or
  a private repository for the economics module) — that requires a separate architecture
  decision. Do not treat today's public files as secret.
- **No admin portal** is planned at this stage; GitHub file editing is the maintenance surface.

## G. Common tasks, step by step

| Task | Steps |
| --- | --- |
| Change an estimate multiplier | GitHub → `src/config/pricing.ts` → edit the value → commit → wait for the Cloudflare check → run `npm run estimate:quotes` comparison (locally) |
| Add an add-on | Add an item under `addons.items` with a new id → commit → tests must pass |
| Change business hours | `src/config/business.ts` → `hours` → commit |
| Add a service-area ZIP (temporary, until the location engine ships) | `src/config/geography.ts` → add `{ city, state, zone, lat, lng }` → commit |
| Turn on the live fuel feed | Add `EIA_API_KEY` in Cloudflare → redeploy |
| Approve a published price | Requires an explicit decision; then flip the matching `pricing.publication` flag in a reviewed change |
