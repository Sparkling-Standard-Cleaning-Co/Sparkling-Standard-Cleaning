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
| Proposed price (Option C $42/$50), margin floor, minimum, rounding, reference, expiry | `tests/quote.test.ts`, `tests/estimator.test.ts` |
| Extras change the price; reservation carries every answer | journey |
| Server-side verification: match/preliminary/mismatch/unverifiable, forged price/coordinates/reference/date/config/scope | `tests/verify-quote.test.ts`, `tests/api-verification.test.ts` |
| Call/Text hrefs, receipt honesty (no implied acceptance), no redirect on unverified receipts | journey, `tests/verification-copy.test.ts` |
| No origin/keys/payment credentials in any built client file | journey security scan over `dist/` |
| Existing contact form still works | journey |
| Static structure (7 steps, address/reservation markup, 17 pages) | `npm run smoke`, `npm run verify` |

Current counts: **159 unit tests**, **22 browser tests**, `astro check` 0 errors,
`npm run verify` (build + links + SEO) green.

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
