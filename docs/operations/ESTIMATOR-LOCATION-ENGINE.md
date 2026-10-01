# Estimator location engine — investigation and design

Branch work only. Nothing in this document changes production behavior until the owner approves
the policy values and the change is merged deliberately. Reproduced against the deployed site and
the current source on 2026-10-01.

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

`/api/travel` returns `503 origin_not_configured` live, so even core/surrounding ZIPs use the
provisional zone math.

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
