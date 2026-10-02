# Estimator release checklist — owner review

Prepared 2026-10-01 for branch `feat/estimator-location-config`.
Code state at preparation: commit `bdebb54` (before this checklist commit; see `git log -1` for the tip).
Nothing here merges or deploys anything; production remains untouched.

## How to run the local preview

Static preview (works with mocked/offline providers — the form delivery notice is expected):

```powershell
npm install
npm run build
npm run preview        # http://localhost:4321
```

Live provider preview (real MapMap geocoding/routing + Cloudflare Functions):

```powershell
# .dev.vars (gitignored) with the branch secrets, nothing else:
#   ROUTES_API_KEY=<MapMap key>
#   TRAVEL_ORIGIN=<private lat,lng>          # never printed, never client-side
#   # ROUTES_PROVIDER=mapmap is optional: mapmap is inferred when only the key is set
npx wrangler pages dev dist --port 4401
```

Then open http://localhost:4401/estimate/ and walk: service → address → map pin →
home → condition → extras → timing → proposed price → Reserve/Call/Text.

Evidence bundle: `%USERPROFILE%\.config\opencode\review\sparkling-standard-estimator\`
(12 mocked screenshots, desktop + mobile, plus the live-provider run).

## 1. Proven through automated tests (no live providers needed)

| Area | Evidence |
| --- | --- |
| Address autocomplete (debounced, ARIA, keyboard), manual fallback, unit field, map-pin confirmation, ZIP autofill | `tests/browser/journey.test.mjs` |
| Confirmed pin coordinates reach `/api/travel`; ZIP centroid never replaces a confirmed pin | journey + `tests/location.test.ts` |
| Travel failure degrades to an honest preliminary estimate | journey |
| Proposed price (Option C $42/$50), margin floor, minimum, rounding, reference | `tests/quote.test.ts`, `tests/estimator.test.ts` |
| Exact-match verified rule, confirmed-pin requirement, driving-duration requirement, server-issued validity (no customer expiry claims) | `tests/verify-quote.test.ts` |
| Paid providers (Google/Mapbox) hard-disabled; only MapMap + free fallbacks can be activated | `tests/api.test.ts` |
| Travel lookup rate-limited per IP + daily cap so the free allowance cannot be drained | `tests/api.test.ts` |
| Extras change the price; reservation carries every answer | journey |
| Server-side verification: match/preliminary/mismatch/unverifiable, forged price/coordinates/reference/date/config/scope | `tests/verify-quote.test.ts`, `tests/api-verification.test.ts` |
| Moved/displaced destination pin: a manually dragged pin is never fully verified; the server computes its own address and flags `adjusted`/`divergent` pins | `tests/verify-quote.test.ts`, real marker-drag browser regression in `tests/browser/journey.test.mjs` |
| Call/Text hrefs, receipt honesty (no implied acceptance), no redirect on unverified receipts | journey, `tests/verification-copy.test.ts` |
| No origin/keys/payment credentials in any built client file | journey security scan over `dist/` |
| Existing contact form still works | journey |
| Static structure (7 steps, address/reservation markup, 17 pages) | `npm run smoke`, `npm run verify` |
| Six-step navigator (shared `ESTIMATE_STEPS`), revisit-completed-steps, locked future steps, fresh-start on visit/reload/back-forward | `tests/browser/wizard.test.mjs` |
| Transparent add-on pricing from the ONE labor-hour model, reconciliation of base + extras + rounding = total, specialty “Custom quote” | `tests/pricing-breakdown.test.ts`, `tests/browser/journey.test.mjs` |
| Multi-add-on incentive math (single tier, cap, minimum/base safeguards) | `tests/pricing-breakdown.test.ts`, `npm run estimate:discount-impact` |
| Owner notification breakdown (base, extras with charges, discount, rounding, labor hours, category rate, receipt timestamp, verdict labels) | `tests/api-verification.test.ts` |
| Public copy: “unique circumstances”, no “the owner” service promises, no server/algorithm language | `npm run smoke` copy guards, journey |
| Desktop header: six aligned items + About, no overlap with logo/phone/CTA at 1024–1680 | `tests/browser/header-about.test.mjs` |
| About page: founder story preserved, heritage section, estimate CTAs | `tests/browser/header-about.test.mjs` |
| “After you send” timeline: three stages, heading separated from the first marker | journey timeline regression |

Current counts: **178 unit tests**, **39 browser tests** (including accessibility, header alignment,
the moved-pin drag regression, six-step navigation, fresh-start behavior and add-on pricing),
`astro check` 0 errors, `npm run verify` (build + links + SEO) green.

## 1a. Production smoke-test checklist (run only after owner authorization)

Preconditions: production Pages project variables match the expected configuration —
`TRAVEL_ORIGIN` (Secret), `ROUTES_API_KEY` (Secret), optional `ROUTES_PROVIDER=mapmap`,
`WEB3FORMS_ACCESS_KEY` (Secret), `PUBLIC_WEB3FORMS_ACCESS_KEY`, optional `TURNSTILE_SECRET_KEY`,
`PUBLIC_TURNSTILE_SITE_KEY`, `PUBLIC_SITE_URL`. `PUBLIC_PREVIEW_MODE` must NOT be set on production.

1. Functions answer on the deployed preview: `POST /api/travel` with a public ZIP returns
   `200` with `provider`/`method`/`verified` and **no origin or key material**.
2. `POST /api/geocode` returns suggestions (with coordinates) and resolves an address.
3. Paid-provider guard: temporarily set `ROUTES_PROVIDER=google` on a preview deployment and
   confirm `/api/travel` still returns `straight_line_estimate` and never calls a paid endpoint.
4. Run the full journey on the preview (desktop + mobile): address suggestions → pin confirmation
   → proposed price → reservation request; confirm Call/Text links and the privacy page.
5. Submit one **marked test reservation** (subject clearly marked "TEST — internal") with a
   synthetic name and the owner's own email. After owner authorization, verify the owner inbox
   receives it with the server fields: `quote_verified`, `verified_price`/`client_price`,
   `server_config_version`, `pin_check`, `quote_valid_through`, and a plain-language
   `verification_note`.
6. Repeat once with a deliberately different `quoted_price` (devtools) to confirm the email shows
   `quote_verified=mismatch` and the customer receipt shows the price-check warning.
7. Confirm the built bundle contains no `TRAVEL_ORIGIN`, `ROUTES_API_KEY`/`MAPMAP_API_KEY` names
   or values, and no payment credentials (`npm run test:browser` security scan covers this).
8. Only after steps 1–7 pass: request production approval. Binding instant prices remain disabled
   (`instantQuote.binding=false`); no payment or booking endpoint may be enabled in this release.

## 2. Demonstrated with actual live providers (2026-10-01, `$0` tier)

| Capability | Live result |
| --- | --- |
| MapMap `/geocode/suggest` | HTTP 200, 5 rows/query with embedded coordinates; public Pensacola bias returns Florida first for Pace/Cantonment |
| MapMap `/geocode` (forward) | HTTP 200 with a match for Pensacola, Cantonment, Pace, Atmore |
| MapMap `/route/v1/driving` | HTTP 200 `code: Ok`: Pensacola→Cantonment 22.7 min, →Pace 17.8 min, →Atmore 56.2 min |
| Our `/api/travel` | `method: route, verified: true` (ZIP 32503: 14 mi / 16 min) |
| Full journey against real functions | suggestions → pin → verified travel → `$280` → quote reference → Call/Text |
| Key/quota state | key `verified`, monthly quota available; free tier refuses instead of billing |

Gateway limitation (not ours): `/geocode/retrieve` is HTTP 501 on the hosted gateway
(first-party index not enabled); the UI no longer depends on it and uses the suggestion's own
coordinates. No quota, credit or coverage blocker was found.

## 3. Awaiting owner approval

- The 60-minute normal boundary and 15-minute manual-review band values.
- The proposed-price formula sign-off (reference-quote impact report).
- **Proposed multi-add-on incentive** (unpublished until approved):
  - Two eligible add-ons: **5% off the eligible add-on subtotal**.
  - Three or more eligible add-ons: **8% off the eligible add-on subtotal**.
  - Single tier only, never stacked; excludes base cleaning, travel, the minimum job price
    and custom-quoted specialty work; internal cap $75.
  - Before/after reference quotes: `npm run estimate:discount-impact` (all safeguard checks pass).
  - Owner must approve the tier percentages and the cap before `pricing.addonIncentive.enabled`
    is flipped.
- **Proposed one-hour response guarantee** (unpublished until approved):
  - “Hear from Sparkling Standard within one business hour—or receive 25% off your first
    eligible cleaning.”
  - Clock: one business hour during published business hours, Central Time; requests received
    outside business hours start when business hours resume.
  - A substantive personal response is required; automatic acknowledgments do not count.
  - Credit: 25% off the first eligible cleaning, maximum **$50**, no stacking with other
    promotions, applied after the cleaning is confirmed.
  - Requires documented receipt (`received_at` server timestamp in the owner notification) and
    documented personal response time. Do not publish until the operation can consistently meet it.
  - Owner must approve `pricing.responseGuarantee` terms before `enabled` is flipped.
- Setting `ROUTES_PROVIDER=mapmap` (or relying on the key-present inference) on the production
  Pages project when this branch is approved.

## 4. Must remain disabled until verification is reliable and approved

- **Binding instant quotes** (`pricing.instantQuote.binding` stays `false`): every reservation is
  a request that the owner confirms; nothing is auto-accepted or charged.
- **Auto-booking / payment capture**: no booking or payment endpoint exists.
- **`instantQuote.enabled`** may stay `true` for the proposed-price display because every quote
  is either server-verified or explicitly labeled preliminary; it must stay coupled to
  `binding=false`.

## 5. Price reconciliation ($250 reference vs $280 live demo)

Both are the same 3/2, 1,600 sqft, maintained, one-time standard clean at the $50/labor-hour
Option-C rate. The difference is the oven extra, not a defect:

| Step | $250 reference | $280 live demo |
| --- | --- | --- |
| Base labor (1600 sqft, 3bd/2ba) | 4.91 h | 4.91 h |
| Inside-oven extra | — | +0.60 h |
| Total labor-hours | 4.91 h | 5.51 h |
| × $50 gross revenue/labor-hour | $245.50 | $275.50 |
| Travel (15 included one-way miles) | zone, $0 | verified 15.3 mi, +$0.15 |
| Minimum job ($125) / rounding ($5, up) | not applied / → $250 | not applied / → **$280** |

Control runs (same extras with zone travel, and no extras with verified travel) both reproduce
their expected prices, so travel is not inflating the demo price.

## 6. Launch recommendation

**Yes — the customer experience can safely launch with preliminary prices and personal
confirmation, even if reliable road routing were unavailable**, because:

1. Every reservation is a REQUEST; the owner confirms scope, date and price before booking.
2. The server recalculates each quote and labels it `verified | preliminary | mismatch |
   unverifiable`; only a live route to the server-geocoded address with a matching config
   version may be called verified.
3. A mismatch is never presented as accepted: the customer sees a warning and stays on the page,
   and the owner notification carries both the client price and the server price.
4. When travel is approximate or ZIP-based, the copy and the owner notification say so; no
   guaranteed travel-inclusive price is issued from an unverified route.
5. MapMap coverage is live-verified for the territory, but the Census + straight-line + zone
   fallbacks remain, so a provider outage degrades honestly instead of blocking requests.

Keep binding instant quotes disabled until (a) the owner approves the formula/impact report and
(b) accurate travel verification remains continuously available.

Do not merge or deploy from this checklist; it is review material only.
