# Platform status register

The **single authoritative place for current external-platform status**. Update it only from
owner confirmation or direct external verification, and date every change. Never convert an
owner-reported setting into a code-verified fact. Historical records stay historical.

Last reviewed: **2026-10-03** (production release deployed, GA4 completion, attribution repair,
marketing consolidation).

**Release status:** production serves GitHub `main`. `origin/main` is **`62a1a46`** — the
owner-authorized 2026-10-03 release set (the five-commit release `8b8dde4`…`5a4a024`, the
documentation closeout `7a51efa`, the six-profile social integration `cdc4971`, the
deployment-closeout `6ebc3fb` and the logo-only Follow Us redesign `62a1a46`) deployed through
Cloudflare Pages after green GitHub Actions runs. Live acceptance checks passed: pages load,
`/brand-preview/` removed, GA4 consent-controlled with one Google tag, gift-certificate/reservation
behavior unchanged, sitemap and navigation correct, a labeled attribution acceptance submission
delivered with correct first/latest fields, and all eight Follow Us profiles rendering as 52px
circular logo-only buttons (one row desktop/tablet, two rows of four on phones, no overflow at
320px). Evidence: `docs/verification/VERIFICATION.md`. Any later local documentation follow-up
stays unpublished until the owner authorizes another push.

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
| Cloudflare Pages project | **live (verified)** | `sparkling-standard-cleaning` is Git-connected: every `main` push produces a Cloudflare Pages deployment; custom domain serving. Production commit at the start of the 2026-10-02 review was `1287a763` (owner-stated) | None | `docs/deployment/DEPLOYMENT.md` |
| Production website | **live (verified)** | `https://sparkling-standard.com` — all 18 pages return 200 with correct canonicals; mobile-throttled LCP 1.26–1.65 s, CLS ≤ 0.038; axe 0 violations (2026-10-01) | None | `docs/verification/VERIFICATION.md` |
| Production release (deployed) | **live — `origin/main` `62a1a46`** | The deployed production tree includes the address-reliability rebuild, recurring-conversion homepage sections, licensed representative imagery, the prepared-disabled promotion engine, the advance-reservation + gift-certificate (request-only) experience, the owner-published GTM/GA4 configuration (account-side), the attribution repair with first/latest lead-notification labels, the six-profile social integration, and the compact logo-only Follow Us redesign (eight 52px circular buttons with official brand marks). Live acceptance checks passed 2026-10-03. Preview environments, Preview secrets and Cloudflare Access are **not used** by owner decision; production deploys from `main` only | Maintain; decisions outstanding in `docs/launch/PROMOTION-PROPOSALS.md` and `docs/launch/OWNER-INPUT-REQUIRED.md` (M2–M7) | `docs/operations/ESTIMATOR-LOCATION-ENGINE.md`, `docs/verification/VERIFICATION.md` |
| Indexing status | **live — owner-approved** | Owner explicitly approves public search-engine indexing (2026-10-01). `robots.txt` = `Allow: /` + sitemap; every page meta robots = `index, follow`; `PUBLIC_PREVIEW_MODE` is NOT set | Maintain. Never introduce noindex/disallow, and never enable indexing on intentionally excluded utility pages | `docs/deployment/DEPLOYMENT.md` §11 |
| Domain registration | **owner-confirmed** | Registered via Squarespace following Google Workspace purchase | None | — |
| Google Workspace email | **owner-confirmed** | `owner@sparkling-standard.com` operational; MX/SPF/DKIM imported. Do **not** modify or enable Email Routing | None | `docs/deployment/DEPLOYMENT.md` |
| Web3Forms | **live (verified)** | 2026-10-01: public key present in the deployed bundle; `/api/lead` returns `200 {"ok":true}`; one marked test per funnel (residential, estimate, commercial, STR) accepted by the provider — **all four arrived in the owner inbox (owner-confirmed)**. Lead delivery is operational | Maintain; re-test after any form change | `docs/verification/VERIFICATION.md` |
| Resend (customer confirmation email) | **owner setup complete — pending deployment + live test** | Owner-confirmed 2026-10-08: `RESEND_API_KEY` is set in Cloudflare as a runtime Secret and `sparkling-standard.com` is verified in Resend (DNS complete; no `PUBLIC_RESEND_*` variable exists). Code path: `functions/api/lead.ts` → `src/lib/forms/customer-email.ts` sends the branded confirmation after the owner notification is accepted | Deploy this build, then run the one controlled live test and confirm both emails arrive (`docs/deployment/DEPLOYMENT.md` §4a) | `docs/operations/CUSTOMER-CONFIRMATION-EMAIL.md`, `docs/deployment/DEPLOYMENT.md` §4a |
| Stripe | **owner-confirmed** | Account established; enabled payment methods **unconfirmed** (site lists cards, Apple Pay, Google Pay, ACH) | Confirm enabled methods | `docs/launch/OWNER-INPUT-REQUIRED.md` #4 |
| GTM / GA4 | **live (owner-confirmed external verification, 2026-10-03)** | Container `GTM-KSQ26HMG` is the configured default (`business.ts` `analytics.gtm.containerId`; `PUBLIC_GTM_CONTAINER_ID` overrides) and loads exactly once, only after an explicit analytics consent choice. Owner-published **GTM Version 3**: one Google tag, twelve custom event tags, twelve triggers, seven data-layer variables. GA4 `G-LG222LQRQ2` received page views, `estimate_start` and all three inquiry events end-to-end (site confirmation + owner email + GA4 event); the three primary key events are configured; Enhanced Measurement form interactions are disabled; consent tests passed | Never republish/overwrite the owner's container or add a second Google tag; keep the website event taxonomy unchanged; optionally add an internal-traffic filter | `docs/analytics/ANALYTICS-SETUP.md`, `docs/analytics/GTM-CONTAINER-SETUP.md` |
| Umami | **not started** | Architecture implemented and consent-gated; no website ID configured | Provide website ID when created | `docs/analytics/ANALYTICS-SETUP.md` |
| Google Business Profile | **verified — profile + review links captured (owner-supplied 2026-10-08)** | The profile is verified by Google and publicly visible. The exact public profile URL is configured in `business.socials.googleProfile` / `business.reviews.profileUrl`; the exact "Ask for reviews" link is configured in `business.reviews.submissionUrl` (`https://g.page/r/CXAcv1Pp7OI2ECE/review`). Never modify, shorten or substitute them; the `/leave-review/` page is live | Paste the four tracked GBP links (`gbp_home`, `gbp_estimate`, `gbp_deep_clean`, `gbp_gift_post`); begin the weekly GBP rhythm and review requests (`docs/marketing/WEEKLY-EXECUTION-PLAYBOOK.md`) | `docs/marketing/PLATFORM-REGISTER.md`, `docs/marketing/LOCAL-AUTHORITY.md`, `docs/marketing/REVIEW-GROWTH-SYSTEM.md` |
| Bing Places | **pending owner** | No listing yet; imports from Google Business — **GBP is verified, so creation is unblocked** | Create/import from Google Business; use the tracked Bing Places link | `docs/marketing/PLATFORM-REGISTER.md` |
| Search Console / Bing | **owner-confirmed** | Property set up; `sitemap-index.xml` (15 URLs) + `robots.txt` verified reachable and correct from production (2026-10-02). The earlier GSC "couldn't fetch" was transient | Re-submit the existing sitemap in Search Console | `docs/operations/SEARCH-CONSOLE-SETUP.md` |
| Social profiles (complete inventory) | **partially live (owner-confirmed 2026-10-03; GBP added 2026-10-08)** | Nine profiles render in the Follow Us section as logo-only circular buttons — Google Business Profile (verified; exact owner-supplied URL) plus Facebook (`profile.php?id=61595026949584`), Nextdoor (`nextdoor.com/page/sparkling-standard-cleaning-co/`), TikTok (`tiktok.com/@sparkling_standard`), Pinterest (`pinterest.com/SparklingStandard/`), Rumble (`rumble.com/user/SparklingStandard`), Gab (`gab.com/Sparkling_Standard`), Parler (`app.parler.com/Sparkling-Standard`) and Locals (`sparkling-standards.locals.com`) — all owner-supplied and configured in `business.ts` (social URLs returned HTTP 200 on 2026-10-03; destination reachable, not independent identity verification). **The owner confirms the basic tracked UTM links are placed on the eight social profiles** (registry entries active). **Instagram is undergoing verification** (URL not supplied/published); **YouTube is deferred** by new Google Workspace account eligibility (not abandoned); X, Threads, LinkedIn, Alignable, Reddit, Yelp and Bing Places are prepared and never render | Paste the tracked GBP links; wait for Instagram verification (never publish an unconfirmed URL); revisit YouTube when Workspace eligibility allows (no paid workarounds) | `docs/marketing/PLATFORM-REGISTER.md`, `docs/marketing/SOCIAL-ACCOUNT-SETUP.md` |
| SMS (text messaging) | **live (owner-confirmed)** | `business.flags.smsEnabled=true`; owner confirmed the business number receives SMS and authorized text contact (2026-10-01) | Maintain; keep the CTAs behind the flag | `docs/launch/OWNER-INPUT-REQUIRED.md` #12 |
| Cloudflare Turnstile | **not started (optional)** | Forms rely on honeypot + timing until configured | Optional | `docs/deployment/DEPLOYMENT.md` §4 |
| Routing provider (Google Routes / Mapbox / MapMap) | **live (verified, production)** | MapMap adapter + address geocoding proxy are live on `main`: `/api/travel` returns `method: route, verified: true` and `/api/geocode` answers `suggest`/`resolve`/`reverse` (production-verified 2026-10-02, including a real reverse lookup from Molino coordinates). Private `TRAVEL_ORIGIN` and the key live only as Cloudflare environment secrets. Free tier refuses at quota — no charge risk. Census + straight-line/zone fallbacks remain | None (maintain quota awareness; 50,000 free calls/month, routing is Standard-class and refused at quota rather than billed) | `docs/operations/ESTIMATOR-LOCATION-ENGINE.md` |
| EIA fuel price feed | **not started (optional)** | Configured reference price used until an EIA key is set | Optional | `docs/operations/ESTIMATOR-CALIBRATION.md` |
| IndexNow | **not started (post-launch)** | Script exists; no key or workflow configured | Optional after launch | `docs/launch/OWNER-INPUT-REQUIRED.md` #25 |
| Legal entity spelling/suffix | **pending owner** | Registered as "Sparkling Standard Cleaning Co."; exact spelling/suffix unverified; unpublished | Verify with registration documents | `docs/launch/OWNER-INPUT-REQUIRED.md` #6 |
| Insurance / bonding / licensing | **pending owner** | Never claimed until real documentation exists | Supply only when genuine | `docs/launch/OWNER-INPUT-REQUIRED.md` #21/#22 |

## MapMap provider evaluation (2026-10-01) — now live on production

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
