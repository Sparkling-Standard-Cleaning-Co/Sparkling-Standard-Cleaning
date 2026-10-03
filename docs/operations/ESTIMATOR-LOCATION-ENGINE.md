# Estimator location engine — investigation and design

Branch work only. Nothing in this document changes production behavior until the owner approves
the policy values and the change is merged deliberately. Reproduced against the deployed site and
the current source on 2026-10-01.

## Update 2026-10-02 — address reliability rebuild (branch `dev/owner-preview-2026-10-02`)

Owner testing after the first round of autocomplete fixes still failed, so the whole request path
was re-investigated against the live provider and the production function (read-only probes; see
`npm run address:check`, which runs the real `/api/geocode` module against the live provider with
public/synthetic addresses only). Verified root causes and the fixes now on this branch:

1. **State matching was full-name-only substring matching.** The ranking required the literal word
   "florida" (or "alabama") in the suggestion context; a supplier sending `FL`/`AL` would have
   every row silently dropped. Matching is now structural: comma-separated context parts are
   parsed as USPS codes or full state names, with a full-name fallback, and rows with no state
   signal fail closed. This also removed substring false positives (e.g. "Indiana Avenue,
   Florida" no longer matches "india").
2. **Street matching required exact token equality**, so a partially typed street never matched the
   provider's full word (`Bayl` could not match `Baylen`). Matching now accepts a safe prefix
   (3+ characters) but requires **every** distinctive requested token, so "Pine Forest" can never
   match "Pine Hollow" and an unrelated same-numbered street is still dropped.
3. **Ranking ignored distance.** Provider rows carried coordinates but ordering was provider order
   only, which is why a South Miami or Atlanta match could outrank the local street. Ranking now
   applies a proximity adjustment from the **public Pensacola city centre** (`SERVICE_CENTER`) —
   never the private operating origin. Proximity reorders; it never excludes, because address
   discovery is not service eligibility.
4. **Provider queries gave up too early.** Some complete-looking queries return nothing while the
   same street resolves without the house number, and suffix spelling changes results
   (`Ln` vs `Lane`). The proxy now tries up to four alternates, in order: direction/suffix
   expansion, numbered-road expansion, suffix abbreviation, and a house-numberless street-level
   fallback. Working addresses normally cost one provider call; unpromising input stops early.
5. **A street-level suggestion was a dead end.** Selecting a street match previously forced an
   exact-address resolve; when that failed the customer got an error with no way to continue.
   Now the resolver is still tried first (MapMap exact-only → free Census), and if it cannot find
   the house number the suggestion's own point becomes a pinnable **street-level destination**.
   The request carries `pin_precision: street` and the exact property is confirmed personally;
   no house number is ever fabricated and travel stays preliminary.
6. **Partial input fired useless provider calls** (a house number alone is not a search). The
   client now requires at least three letters before requesting suggestions.
7. **The known problematic test address was committed throughout the tests and source comments.**
   All fixtures now use public or clearly synthetic addresses (`4242 Maplewood Ln` style), so no
   private owner/customer address remains in the repository, docs or logs.

Live evidence (2026-10-02, `npm run address:check`, real provider key, no credit possible):
partial + city returned a Florida match and rejected Georgia; `Ave` and `Avenue` returned the same
three Alabama matches; `100 Main St` with FL selected returned only a Florida row; and
`100 S Baylen St, Pensacola, FL 32502` resolved precisely through Census. These are live
integration results, distinct from the mocked unit/browser suites.

## Implementation status (branch `feat/estimator-location-config`)

**Implemented and tested on this branch:**

- Shared travel economics + driving policy: `src/config/travel.ts` (single source for client and
  the Pages Function; pricing re-exports it, removing the duplicated constants).
- Real driving duration: `functions/api/travel.ts` requests `routes.duration` (Google) and reads
  MapMap/Mapbox `duration`; all return rounded `durationMinutes`. The function also accepts
  confirmed destination coordinates (`lat`/`lng`) from the address finder and labels live routes
  `method: 'route', verified: true` versus `straight_line_estimate` fallbacks.
- ZIP data deduplicated: the function imports `zipReference` from `src/config/geography.ts`.
- Client routing gate removed: every valid ZIP (and every confirmed pin) now calls `/api/travel`.
- Driving-time policy: `maxDrivingMinutes` (60) + `reviewBandMinutes` (15, pending approval);
  `within` = ordinary estimate, `review_band` = estimate flagged for personal confirmation,
  `beyond` = manual confirmation with honest "send a request anyway" copy. Routed trips without a
  duration keep the hard distance safety cap. Tests: `tests/travel-policy.test.ts`.
- **Street-address experience** (`src/components/EstimateWizard.astro`,
  `src/scripts/address-finder.ts`, `src/lib/location/`): debounced (350 ms) MapMap suggestions
  through `/api/geocode`, keyboard/ARIA suggestion selection, a separate apartment/unit field, a
  manual-entry fallback, and lazy-loaded MapLibre GL + OpenFreeMap pin confirmation (the heavy map
  JS/CSS loads only when an address is looked up). A confirmed pin is the only destination source;
  editing the address invalidates the route instantly.
- **Immediate price experience**: `src/lib/estimate/quote.ts` selects the offered price from the
  same calculation (`expected`, margin floor + minimum + round-up), carries the pricing
  configuration version and expiry. `pricing.instantQuote.enabled` is owner-directed ON for the
  proposed-price display; `pricing.instantQuote.binding` remains OFF.
- **Reservation experience**: order-style summary carrying every calculator answer, quote
  reference, call/text actions (SMS prefill behind `business.flags.smsEnabled`), and one primary
  "Reserve This Cleaning" request action. Reservations are requests, never confirmed bookings.
- **Authoritative server verification** (`src/lib/estimate/verify.ts` +
  `functions/api/lead.ts`): priced reservation requests are re-priced server-side from the
  structured fields; the server resolves the address itself (MapMap → Census → ZIP centroid),
  routes from the private origin, and emits `quote_verified: match | mismatch | unverifiable`
  plus the verified price, range, travel method and validity to the owner notification. Client
  price/coordinates/verification claims are ignored. Tests: `tests/verify-quote.test.ts`,
  `tests/api.test.ts`.
- Privacy policy updated for address processing, geocoding, maps and server verification.

**Live provider check (2026-10-01, `wrangler pages dev` with the branch `.env`):**

Diagnosis performed directly against `api.mapmap.ai` (18 metered/free calls, key state `verified`,
`/health` 200) and then re-verified through our own Pages Functions:

- **Road routing works across the territory.** Public pairs returned HTTP 200 `code: Ok`:
  Pensacola → Cantonment 28.7 km / 22.7 min, Pensacola → Pace 23.5 km / 17.8 min,
  Pensacola → Atmore 79.2 km / 56.2 min (UK control pair also OK). The earlier fallback was a
  configuration gap: `ROUTES_PROVIDER` was unset, so the provider branch was never attempted.
  `resolveRoute` now infers `mapmap` when only a MapMap key is present; re-verified through
  `/api/travel`: ZIP 32503 returned `method: route, verified: true, 14 mi / 16 min`.
- **Suggestions were a client-side schema bug, not a provider failure.** `/geocode/suggest`
  returns `{ suggestions: [{ id, name, context, kind, lat, lon }] }` (OpenAPI-confirmed); our
  proxy parsed Photon `features`, so it always answered with zero rows. The proxy now parses both
  shapes, applies the public Pensacola-centre `bias` (relevance verified: "Pace" and
  "Cantonment" return Florida first), and returns embedded coordinates. The UI plots those
  coordinates directly and enriches ZIP/city/state via forward geocoding.
- **`/geocode/retrieve` is HTTP 501 on this gateway** ("search-as-you-type is not enabled …
  needs `SN_GEOCODE_DIR`"), so the client no longer depends on it for suggestions; the id-only
  retrieve path remains as a fallback for gateways that support it.
- Forward geocoding returns a match for Pensacola, Cantonment, Pace and Atmore (HTTP 200), and
  the full customer journey now runs live: suggestions → pin → **verified route travel** →
  `$280` proposed price (oven extra included) → quote reference → call/text actions. Local
  submission correctly reports "message service is not connected" because the local `.env`
  carries no Web3Forms key; production has it configured.
- No quota/credit issue: key is `verified`, monthly quota available, and the MapMap free tier
  refuses rather than bills at quota. No key or private origin appeared in any response.

**Still awaiting owner approval before binding offers:**

- The 60-minute boundary and 15-minute review band values.
- The proposed-price formula sign-off (reference-quote impact report).
- Activating verified MapMap routing on production (set `ROUTES_PROVIDER=mapmap`, or leave it
  unset and the key-present inference applies). Coverage is verified live; the pricing/policy
  sign-off is what remains.

## 1. Reproduced behavior (offline zone mode, `TRAVEL_ORIGIN` unset)

Generated with the live engine (`npm run estimate:quotes`, 3/2 maintained baseline):

| ZIP | Location | Zone | Result | Travel mode |
| --- | --- | --- | --- | --- |
| 32533 | Cantonment | core | estimate $250–300 | zone |
| 32503 / 32505 / 32514 | Central / West / North Pensacola | core | estimate $250–300 | zone |
| 32571 | Pace | surrounding | estimate $260–320 | zone |
| 32570 | Milton | surrounding | estimate $260–320 | zone |
| 32566 | Navarre | surrounding | estimate $260–320 | zone |
| 32561 | Gulf Breeze | surrounding | estimate $260–320 | zone |
| **36502** | **Atmore, AL (~35–40 min)** | **extended** | **no estimate → manual confirmation** | zone, API never called |
| 36532 / 36561 | Fairhope / Orange Beach, AL | extended | no estimate → manual confirmation | zone, API never called |
| 30301 | Atlanta (valid, distant) | outside | "outside the current service area" → manual confirmation | zone, API never called |
| 99999 | unassigned ZIP | outside | same "outside" message | zone, API never called |

At the time of this analysis, `/api/travel` returned `503 origin_not_configured`, so even
core/surrounding ZIPs used the provisional zone math. **Since resolved:** MapMap routing is live
(`method: route, verified: true`, 2026-10-02) — see `docs/operations/PLATFORM-STATUS.md`.

## 2. Root causes

1. **Hardcoded provisional ZIP list.** `src/config/geography.ts` classifies coverage from a fixed
   list; any ZIP not in it is `outside` — regardless of actual distance. Unlisted nearby ZIPs
   therefore read as out of range.
2. **Alabama is hardcoded as non-instant.** `zonePolicy.extended.instantEstimate = false` — a
   policy that predates the current "about one hour of actual driving time" boundary. Atmore
   (~35–40 min) cannot receive an instant estimate even though it is inside the policy.
3. **The routing API is gated by the provisional classification.**
   `src/scripts/estimate-wizard.ts:263` returns early (no `/api/travel` call) unless the ZIP is
   `core` or `surrounding`. A configured routing provider can never upgrade an
   extended/outside classification, so real driving time never enters the decision.
4. **No driving duration anywhere.** `functions/api/travel.ts` requests and returns distance
   only (`X-Goog-FieldMask: routes.distanceMeters`; Mapbox `routes[0].distance`). The owner's
   policy is defined in minutes, and the code substitutes miles.
5. **`TRAVEL_ORIGIN` is not configured** (verified live), so routed travel is unavailable in
   every zone today.
6. **Rejection-flavored copy.** The `outside` message ("This ZIP is outside the current service
   area…") reads as a refusal even though the request is still accepted, and unknown-but-valid
   ZIPs are mapped to the same message. The request itself is not blocked, but the customer
   experience contradicts the actual policy.

## 3. Proposed location engine

**Policy (owner-editable, config):**

- `serviceArea.maxDrivingMinutes` — default **60**; instant estimate when a routed duration is at
  or under this.
- `serviceArea.manualReviewBufferMinutes` — default **15**; between max and max+buffer → estimate
  shown with "confirm personally" framing.
- Beyond max+buffer, and any case without a routed duration → **manual review**, never a hard
  rejection: the request is still accepted and the owner decides.
- Zone list becomes a **fallback**, not the arbiter: used only when routing is unavailable.

**Server (`functions/api/travel.ts`):**

- Return `durationMinutes` alongside `oneWayMiles`:
  - Google Routes: add `routes.duration` to the field mask; parse the ISO-8601 `"123s"` value.
  - Mapbox: parse `routes[0].duration` (seconds).
- Keep the existing fail-safe chain: provider → straight-line distance × 1.18 (labeled
  `straight_line_estimate`, no duration) → zone policy.
- Validate and clamp inputs; keep the per-isolate cache (add duration to the payload).

**Client (`src/scripts/estimate-wizard.ts` + estimator):**

- Call `/api/travel` for **every valid 5-digit ZIP** (remove the core/surrounding gate).
- When routed data is present, evaluate duration against the policy; when absent, fall back to
  zones. Distinguish the result flags so messaging can be honest:
  - `ROUTED_WITHIN_DRIVE_TIME` — real route, instant estimate.
  - `ROUTED_MANUAL_REVIEW` — real route beyond the boundary or within the buffer; request still
    accepted, owner confirms.
  - `ZIP_PRELIMINARY_ESTIMATE` — zone-based, explicitly labeled preliminary (ZIP centroid).
  - `SERVICE_AREA_CONFIRMATION` — cannot establish coverage; never phrased as a refusal.
- Keep the existing rule: no confirmed booking promise, requests only.

**Precision and privacy:**

- ZIP centroids are preliminary; the copy must say so when a routed duration is unavailable.
- The request flow already collects a service address/notes for the owner; a precise route is
  calculated **before the owner confirms the final price**, never published as a live claim.
- No address or ZIP is sent to analytics (verify the allowlisted event payloads during
  implementation); routing coordinates live only in the server function.

**Shared configuration (removes the duplicated-constant defect):**

- Create one shared travel-economics module (e.g. `src/config/travel.ts`) consumed by **both**
  the client estimator and the Pages Function (Functions are bundled from source at deploy, so a
  shared TS module works).
- `TRAVEL_ORIGIN` and provider keys remain server-only environment values; the shared module
  carries non-secret economics (mpg, wear/mile, included miles, buffer, cache seconds).
- `.env.example` values that are currently **not consumed** (`VEHICLE_MPG`,
  `INCLUDED_ONE_WAY_MILES`, `MAX_INSTANT_ESTIMATE_DISTANCE`) are either wired into the shared
  module or relabeled informational — no misleading settings remain.

## 4. Test plan (mocked providers; no guessed live times)

| Scenario | Expected |
| --- | --- |
| Mocked routed duration 30 min (Cantonment/Atmore) | instant estimate, `ROUTED_WITHIN_DRIVE_TIME` |
| Mocked routed duration 55 min | instant estimate |
| Mocked routed duration 61 min | manual review (`ROUTED_MANUAL_REVIEW`) |
| Mocked routed duration 80 min (Orange Beach/Gulf Shores) | manual review, honest copy |
| Provider returns an error | fall back to straight-line distance, labeled estimate |
| Missing `ROUTES_API_KEY` / `TRAVEL_ORIGIN` | zone fallback; request still accepted |
| Unknown-but-valid ZIP | manual review with request acceptance — never a refusal |
| Malformed ZIP | validation error (unchanged) |
| Fuel feed down | configured reference price (unchanged) |
| Browser: extended ZIP now calls `/api/travel` | request observed in the network log |
| Browser: final step still one primary action | unchanged contract |

Live routing results (with `TRAVEL_ORIGIN` and a provider configured) are documented separately
from mocked threshold tests; no expected driving times are hard-coded from guesses.

## 5. Additional credentials / approvals actually required

- **`TRAVEL_ORIGIN`** (owner, Secret) — blocking for any routed travel.
- **Optional:** `ROUTES_PROVIDER` + `ROUTES_API_KEY` (Google Routes or Mapbox) for real driving
  durations. Without a provider the engine still improves (gate removed, honest messaging) but
  duration-based policy cannot apply.
- **Owner approval:** the default policy values (60-minute boundary, +15 minute buffer) and the
  customer-facing wording for manual-review results.

## 6. Safe implementation and deployment plan

1. Branch `feat/estimator-location-config` (this branch): docs + validation tests + quote tooling
   only — **no behavior change**.
2. Next increment on the same branch: shared travel module + server duration support + mocked
   threshold tests (no client gate change yet).
3. Next: remove the client gate and add the new flags/messaging; browser tests for every
   boundary scenario; run `npm run estimate:quotes` before/after for a configuration-impact
   report.
4. Owner reviews the impact report and approves policy values.
5. Merge to `main` only after approval; verify live with `npm run live:check`, then a marked
   end-to-end estimate for one in-boundary and one boundary ZIP.

No pricing change is part of this work.
