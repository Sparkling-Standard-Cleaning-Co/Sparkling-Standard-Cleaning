# Platform status register

The **single authoritative place for current external-platform status**. Update it only from
owner confirmation or direct external verification, and date every change. Never convert an
owner-reported setting into a code-verified fact. Historical records stay historical.

Last reviewed: **2026-10-01** (live production audit).

Status vocabulary:

- **live (verified)** — externally verified working.
- **owner-confirmed** — the owner reports it set up; not independently verified from the repo.
- **pending owner** — action required from the owner.
- **not started** — no setup exists yet.
- **configured, unverified** — code/config exists but the live service is not tested.

| Platform | Status | Evidence / notes | Owner action | Documentation |
| --- | --- | --- | --- | --- |
| GitHub repository | **live (verified)** | `Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning`, `main` pushed; SHA verified against local HEAD | None | `docs/deployment/DEPLOYMENT.md` |
| Cloudflare account | **owner-confirmed** | Dedicated account for this business; separate from any other company | None | `docs/deployment/DEPLOYMENT.md` |
| Cloudflare DNS for the domain | **owner-confirmed** | Domain active on Cloudflare nameservers (owner screenshots, Oct 2026) | None | `docs/deployment/DEPLOYMENT.md` |
| Cloudflare Pages project | **live (verified)** | `sparkling-standard-cleaning` is Git-connected: commit `edac89e` shows a successful "Cloudflare Pages" check-run and the deployed bundle hashes match the pushed build; custom domain serving | None | `docs/deployment/DEPLOYMENT.md` |
| Production website | **live (verified)** | `https://sparkling-standard.com` — all 18 pages return 200 with correct canonicals; mobile-throttled LCP 1.26–1.65 s, CLS ≤ 0.038; axe 0 violations (2026-10-01). Production deployment `6afe7a1` verified (Cloudflare Pages check-run success, fresh bundle hashes) | None | `docs/verification/VERIFICATION.md` |
| Indexing status | **live — owner-approved** | Owner explicitly approves public search-engine indexing (2026-10-01). `robots.txt` = `Allow: /` + sitemap; every page meta robots = `index, follow`; `PUBLIC_PREVIEW_MODE` is NOT set | Maintain. Never introduce noindex/disallow, and never enable indexing on intentionally excluded utility pages | `docs/deployment/DEPLOYMENT.md` §11 |
| Domain registration | **owner-confirmed** | Registered via Squarespace following Google Workspace purchase | None | — |
| Google Workspace email | **owner-confirmed** | `owner@sparkling-standard.com` operational; MX/SPF/DKIM imported. Do **not** modify or enable Email Routing | None | `docs/deployment/DEPLOYMENT.md` |
| Web3Forms | **live (verified)** | 2026-10-01: public key present in the deployed bundle; `/api/lead` returns `200 {"ok":true}`; one marked test per funnel (residential, estimate, commercial, STR) accepted by the provider — **all four arrived in the owner inbox (owner-confirmed)**. Lead delivery is operational | Maintain; re-test after any form change | `docs/verification/VERIFICATION.md` |
| Stripe | **owner-confirmed** | Account established; enabled payment methods **unconfirmed** (site lists cards, Apple Pay, Google Pay, ACH) | Confirm enabled methods | `docs/launch/OWNER-INPUT-REQUIRED.md` #4 |
| GTM / GA4 | **not started** | Architecture implemented and consent-gated; no container ID configured | Provide container ID when created | `docs/analytics/ANALYTICS-SETUP.md` |
| Umami | **not started** | Architecture implemented and consent-gated; no website ID configured | Provide website ID when created | `docs/analytics/ANALYTICS-SETUP.md` |
| Google Business Profile | **not started** | No profile exists; review links pending | Create after launch | `docs/marketing/REVIEW-GROWTH-SYSTEM.md` |
| Search Console / Bing | **not started** | Post-launch indexing work | After launch | `docs/seo/SEO-STRATEGY.md` |
| Social profiles (Facebook, Instagram, Nextdoor, etc.) | **not started** | All profile URLs are `PENDING` in `business.ts`; footer renders none | Create profiles, supply URLs | `docs/marketing/CONTENT-OPERATING-SYSTEM.md` |
| SMS (text messaging) | **pending owner** | `business.flags.smsEnabled=false`; text CTAs hidden until a real text is sent and received | Verify SMS capability | `docs/launch/OWNER-INPUT-REQUIRED.md` #12 |
| Cloudflare Turnstile | **not started (optional)** | Forms rely on honeypot + timing until configured | Optional | `docs/deployment/DEPLOYMENT.md` §4 |
| Routing provider (Google Routes / Mapbox / MapMap) | **live (verified, branch)** | Production `main` still returns `503 origin_not_configured`; branch `feat/estimator-location-config` adds the MapMap adapter + address geocoding proxy. Live verification 2026-10-01: routes OK for Pensacola→Cantonment 22.7 min, →Pace 17.8 min, →Atmore 56.2 min; `/api/travel` returns `method: route, verified: true`. Key state `verified`; no charge risk (free tier refuses at quota) | Set `ROUTES_PROVIDER=mapmap` (or leave unset with the key present — inference applies) on the production Pages project after branch approval | `docs/operations/ESTIMATOR-LOCATION-ENGINE.md` |
| EIA fuel price feed | **not started (optional)** | Configured reference price used until an EIA key is set | Optional | `docs/operations/ESTIMATOR-CALIBRATION.md` |
| IndexNow | **not started (post-launch)** | Script exists; no key or workflow configured | Optional after launch | `docs/launch/OWNER-INPUT-REQUIRED.md` #25 |
| Legal entity spelling/suffix | **pending owner** | Registered as "Sparkling Standard Cleaning Co."; exact spelling/suffix unverified; unpublished | Verify with registration documents | `docs/launch/OWNER-INPUT-REQUIRED.md` #6 |
| Insurance / bonding / licensing | **pending owner** | Never claimed until real documentation exists | Supply only when genuine | `docs/launch/OWNER-INPUT-REQUIRED.md` #21/#22 |

## MapMap provider evaluation (2026-10-01) — activated on the branch, not on production

Public terms verified from `mapmap.ai/pricing`, `/terms`, `/docs/quickstart`, `/docs/api`:

- Free tier: **50,000 calls/month** after email verification; provisional key (1,000 calls / 72 h)
  needs **no card**; commercial use explicitly allowed; **no post-paid overage** — requests are
  refused (HTTP 402/429) when quota and prepaid credit are exhausted, so charges cannot occur.
- Endpoints fit our architecture: `GET /route/v1/{profile}/{lon,lat;lon,lat}` (OSRM-compatible:
  distance metres + duration seconds), `GET /geocode/suggest` (first 5,000/day unbilled; response
  is `{ suggestions: [...] }` with embedded `lat`/`lon`), `GET /geocode` (1 call each). Bearer
  auth (`Authorization: Bearer snk_…`). Rate limit 60 req/min. `/geocode/retrieve` requires a
  first-party index and is 501 on the hosted gateway today (see live verification below).
- Attribution required: "© OpenStreetMap contributors". Hosted calls are recorded in a
  de-identified demand log (coordinates coarsened to ~5 km cells); exclusion available on request.
- **Implementation on the branch:** `functions/api/travel.ts` supports `ROUTES_PROVIDER=mapmap`
  with duration + distance parsing and quota-failure fallback (mocked tests pass). The API key is
  a Cloudflare secret only; when only the key is configured the provider defaults to mapmap.
- **Resolved gaps:** U.S. routing coverage **is now verified live** for Pensacola → Cantonment,
  Pace and Atmore, and forward geocoding matches all four; the remaining caveat is that the
  vendor is early-stage with no free-tier SLA, so the Census Geocoder + straight-line/zone
  fallbacks stay as non-single-point-of-failure paths.
- Privacy: once activated, customer addresses/coordinates are necessarily sent to MapMap for
  routing; the privacy page must disclose this (done on the branch). The private operating origin
  remains a Cloudflare secret and is never exposed to the client, maps or responses.

**Live provider verification on branch `feat/estimator-location-config` (2026-10-01):** direct
gateway diagnosis (key state `verified`; `/health` 200) followed by re-verification through our
Pages Functions. Routing: HTTP 200 `code: Ok` for Pensacola → Cantonment (28.7 km / 22.7 min),
→ Pace (23.5 km / 17.8 min) and → Atmore (79.2 km / 56.2 min); `/api/travel` now returns
`method: route, verified: true`. Suggest: `/geocode/suggest` returns
`{ suggestions: [{ id, name, context, kind, lat, lon }] }` (5 rows per query, embedded
coordinates); a public Pensacola-centre `bias` puts the local result first. The earlier
"zero suggestions" was our proxy parsing Photon `features` instead of `suggestions`, and the
earlier "routing fallback" was a missing `ROUTES_PROVIDER` value — both are fixed on the branch.
`/geocode/retrieve` is **501 on this gateway** ("search-as-you-type is not enabled … needs
`SN_GEOCODE_DIR`"); the UI no longer depends on it and uses the suggestion's own coordinates.
Forward geocoding matches all four territory towns. No quota, credit or coverage blocker was
found, and no key or origin appeared in any response. `Suggest` free allowance: first 5,000/day
per identity; routing is Standard-class, refused at quota rather than billed.

## How to update this register

1. Change a row only when the owner confirms it or an external check proves it.
2. Update the "Last reviewed" date.
3. Put new owner actions in `docs/launch/OWNER-INPUT-REQUIRED.md`, not here; this register
   points to the checklist rather than duplicating it.
4. Do not record credentials, keys, customer data or the private operating coordinates here.
