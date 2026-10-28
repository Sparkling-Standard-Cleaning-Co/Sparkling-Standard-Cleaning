# Platform status register

The **single authoritative place for current external-platform status**. Update it only from
owner confirmation or direct external verification, and date every change. Never convert an
owner-reported setting into a code-verified fact. Historical records stay historical.

Last reviewed: **2026-10-28** (Initiative 6.9 Pay Now deployed; Google Calendar booking connected and active in owner-approval mode; real availability/holds verified; gift sales remain disabled).

**Release status:** production serves GitHub `main`; **Initiative 6.8 is live at
`6e36c95` plus the HEIC test-stability fix `9fe8764`** (Cloudflare Pages deployments
`2a0d4f21-8eb8-49b0-b298-f086e3c7473b` and `4afab04f-9f97-47b5-bb2c-778aa7b6f745`; GitHub
`validate`, `browser` and Cloudflare checks passed). It hides prices through every preliminary
estimator step and reveals the finished estimate with a shared branded animation on the final step;
installs the owner-supplied two-of-four Competitive Pricing badge; equalizes the homepage service
cards; expands KJV scripture; requires a server-verified terms acceptance before reservation or
payment; and publishes the expanded terms/policy research. **Pay Now readiness is live mode with all
checks true.** Gift certificates remain in request mode and **live calendar booking is not
connected**; no fake availability is shown. No new cancellation/reassessment fee is active.
Initiative 6.7 is at `f111014`, 6.6 at `0b907d4`, 6.5 at `298c1df`, 6.4 at `685031d` and
earlier releases are historical.

**Customer photos are live:** production `/api/photo-upload` reports `enabled:true`; the private R2
bucket, `PHOTOS_BUCKET` binding and `PHOTO_OWNER_TOKEN` are active. Real JPEG and converted iPhone
HEIC uploads stored successfully, and `/api/lead` returned `photoDelivery:"attached"` after Resend
accepted owner emails with real MIME attachments. The owner confirmed actual customer-photo
attachments are reaching the business inbox (2026-10-25); provider acceptance and inbox receipt are
now both recorded.

**GTM/GA4:** the owner reports Version 5 published (20 tags, 19 triggers, 13 variables). Earlier
Version 3 receipt of page views, `estimate_start` and the three inquiry events was verified; live
receipt of the newer church/promotion events still needs DebugView/Realtime confirmation.

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
| Production website | **live (verified)** | `https://sparkling-standard.com` — 27 built pages served; current release routes and payment-success utility page return 200; mobile-throttled LCP 1.26–1.65 s, CLS ≤ 0.038; axe 0 violations (2026-10-01 baseline) | None | `docs/verification/VERIFICATION.md` |
| Production release (deployed) | **live - `1228140`** | Initiative 6.9 Pay Now/booking/gift code and Initiative 6.10 social activation; Cloudflare deployment `c84e974f-5e11-4ed3-9e4c-a723e29f58fd`; GitHub `validate`, `browser` and Cloudflare checks passed. Google Calendar booking is active in owner-approval mode; gift sales remain disabled. | Add real jobs to the calendar and run one owner-confirmation test; approve gift denominations | `docs/verification/VERIFICATION.md`, `docs/operations/GOOGLE-CALENDAR-SETUP.md` |
| Indexing status | **live — owner-approved** | Owner explicitly approves public search-engine indexing (2026-10-01). `robots.txt` = `Allow: /` + sitemap; every page meta robots = `index, follow`; `PUBLIC_PREVIEW_MODE` is NOT set | Maintain. Never introduce noindex/disallow, and never enable indexing on intentionally excluded utility pages | `docs/deployment/DEPLOYMENT.md` §11 |
| Domain registration | **owner-confirmed** | Registered via Squarespace following Google Workspace purchase | None | — |
| Google Workspace email | **owner-confirmed** | `owner@sparkling-standard.com` operational; MX/SPF/DKIM imported. Do **not** modify or enable Email Routing | None | `docs/deployment/DEPLOYMENT.md` |
| Web3Forms | **live (verified)** | 2026-10-01: public key present in the deployed bundle; `/api/lead` returns `200 {"ok":true}`; one marked test per funnel (residential, estimate, commercial, STR) accepted by the provider — **all four arrived in the owner inbox (owner-confirmed)**. Lead delivery is operational. **Re-verified 2026-10-08** by the controlled live estimate test: `200` with `verification.status: verified`, `travel_verified: true`, `travel_method: route`, `config_match: match` | Maintain; re-test after any form change | `docs/verification/VERIFICATION.md` |
| Resend (customer confirmation email) | **live (deployed) — controlled live test passed; inbox delivery owner-side** | Owner setup complete (2026-10-08): `RESEND_API_KEY` set in Cloudflare and `sparkling-standard.com` verified in Resend. Deployed with `c8a9723` (+ `f92719c`); the controlled production live test submitted a clearly marked request through the estimate wizard — submission accepted (`200`, server-verified quote), the customer-email send path exercised exactly once, no duplicate send, no console/page errors, thank-you summary and analytics events all correct. **Not yet claimed: inbox delivery** — the owner notification and the customer confirmation were both addressed to the owner inbox and their arrival must be confirmed by the owner (not verifiable from the repository) | Confirm the two emails arrived and check the Resend dashboard; report any failure | `docs/operations/CUSTOMER-CONFIRMATION-EMAIL.md`, `docs/deployment/DEPLOYMENT.md` §4a |
| Stripe | **live mode configured; checkout unverified** | Production `GET /api/estimate-checkout` returns `enabled:true`, `mode:"live"` with key, webhook secret/endpoint, notifier, ledger and mode checks true. No live card charge, Stripe test-mode purchase or webhook receipt has been performed in Initiative 6.9. | Owner-authorized Stripe test-mode checkout or controlled live test; verify paid webhook and owner notice | `docs/operations/ESTIMATE-PAYMENTS.md`, `docs/launch/OWNER-INPUT-REQUIRED.md` P1-P4 |
| Google Calendar booking | **live - owner approval** | Connected to **Sparkling Standard - Bookings** in `America/Chicago`; all five Google/owner secrets present, OAuth/event-read healthy. Real availability and R2 holds are active; overlapping holds return 409; customer picker verified desktop/mobile. Owner confirmation/event creation is implemented and mock-tested; one live confirmation test still requires the private owner token. Calendar currently has zero events. | Add real jobs with full addresses; run one token-authenticated confirmation and delete the test event | `docs/operations/GOOGLE-CALENDAR-SETUP.md`, `docs/operations/BOOKING-ARCHITECTURE.md` |
| Gift certificates | **implementation complete, sales disabled** | Durable R2 issuance/ledger, partial redemption, owner admin API, balance lookup and automatic branded purchaser/recipient email are implemented. No denominations are approved and no live Stripe test purchase/issuance/redemption has occurred; the public page remains request-only. | Approve $50/$100/$150/$200 (or another set), configure `GIFT_OWNER_TOKEN`, run a Stripe test-mode purchase, verify one issuance/delivery/redemption | `docs/operations/GIFT-CERTIFICATES.md` |
| GTM / GA4 | **owner-reported Version 5 published (2026-10-25); receipt verification incomplete** | Container `GTM-KSQ26HMG` loads exactly once and only after explicit analytics consent. The owner reports **Version 5** with 20 tags (one Google tag + 19 event tags), 19 triggers and 13 variables, including the church and promotion events. Earlier Version 3 receipt of page views, `estimate_start` and the three inquiry events was owner-confirmed. The new church/promotion event receipt is **not fully proven** in GA4 yet; verify in DebugView/Realtime | Do not reimport the old container or add a second Google tag; verify live event receipt for the new events; optionally add an internal-traffic filter | `docs/analytics/ANALYTICS-SETUP.md`, `docs/analytics/GTM-CONTAINER-SETUP.md` |
| Umami | **deferred by owner (2026-10-21)** | Not adding Umami; GA4/GTM remains the analytics stack. | None | `docs/analytics/ANALYTICS-SETUP.md` |
| Google Business Profile | **verified — profile + review links captured (owner-supplied 2026-10-08)** | The profile is verified by Google and publicly visible. The exact public profile URL is configured in `business.socials.googleProfile` / `business.reviews.profileUrl`; the exact "Ask for reviews" link is configured in `business.reviews.submissionUrl` (`https://g.page/r/CXAcv1Pp7OI2ECE/review`). Never modify, shorten or substitute them; the `/leave-review/` page is live | Paste the four tracked GBP links (`gbp_home`, `gbp_estimate`, `gbp_deep_clean`, `gbp_gift_post`); begin the weekly GBP rhythm and review requests (`docs/marketing/WEEKLY-EXECUTION-PLAYBOOK.md`) | `docs/marketing/PLATFORM-REGISTER.md`, `docs/marketing/LOCAL-AUTHORITY.md`, `docs/marketing/REVIEW-GROWTH-SYSTEM.md` |
| Bing Places | **pending owner** | No listing yet; imports from Google Business — **GBP is verified, so creation is unblocked** | Create/import from Google Business; use the tracked Bing Places link | `docs/marketing/PLATFORM-REGISTER.md` |
| Search Console / Bing | **owner-confirmed** | Property set up; `sitemap-index.xml` (21 canonical URLs) + `robots.txt` verified reachable and correct from production. The payment-success utility page is excluded. | Re-submit the existing sitemap in Search Console | `docs/operations/SEARCH-CONSOLE-SETUP.md` |
| Social profiles (complete inventory) | **live - twelve profiles (owner-confirmed 2026-10-27)** | Twelve profiles render in Follow Us as logo-only circular buttons: Google Business Profile (verified) plus Facebook, Nextdoor, Instagram (`instagram.com/sparkling_standard_cleaning/`), TikTok, YouTube (`youtube.com/@sparklingstandardcleaning`), Pinterest, Rumble, Gab, Parler, Locals and X (`x.com/SparklnStandard`). The owner confirms the tracked UTM links are placed on the original eight; Instagram, YouTube and X account URLs are live but their UTM placements remain **prepared, not placement-confirmed**. Bing Places, Yelp, Threads, LinkedIn, Alignable and Reddit remain pending and never render | Confirm UTM placement on Instagram, YouTube and X; paste the tracked GBP links | `docs/marketing/PLATFORM-REGISTER.md`, `docs/marketing/SOCIAL-ACCOUNT-SETUP.md` |
| SMS (text messaging) | **live (owner-confirmed)** | `business.flags.smsEnabled=true`; owner confirmed the business number receives SMS and authorized text contact (2026-10-01) | Maintain; keep the CTAs behind the flag | `docs/launch/OWNER-INPUT-REQUIRED.md` #12 |
| Cloudflare Turnstile | **not started (optional)** | Forms rely on honeypot + timing until configured | Optional | `docs/deployment/DEPLOYMENT.md` §4 |
| Routing provider (Google Routes / Mapbox / MapMap) | **live (verified, production)** | MapMap adapter + address geocoding proxy are live on `main`: `/api/travel` returns `method: route, verified: true` and `/api/geocode` answers `suggest`/`resolve`/`reverse` (production-verified 2026-10-02, including a real reverse lookup from Molino coordinates). Private `TRAVEL_ORIGIN` and the key live only as Cloudflare environment secrets. Free tier refuses at quota — no charge risk. Census + straight-line/zone fallbacks remain | None (maintain quota awareness; 50,000 free calls/month, routing is Standard-class and refused at quota rather than billed) | `docs/operations/ESTIMATOR-LOCATION-ENGINE.md` |
| EIA fuel price feed | **not started (optional)** | Configured reference price used until an EIA key is set | Optional | `docs/operations/ESTIMATOR-CALIBRATION.md` |
| IndexNow | **live (configured 2026-10-21)** | Key file in `public/`; `scripts/indexnow.mjs` submits only new/changed/removed canonical sitemap URLs and records local state. Production submission verified after deployment. A successful request is not a guarantee of indexing | Run `npm run indexnow` after a production build; `npm run indexnow:dry` previews | `docs/operations/PLATFORM-STATUS.md` (IndexNow section) |
| Legal entity spelling/suffix | **owner-confirmed (2026-10-21); certificate archived privately** | Registered legal name **Sparkling Standard LLC**; public brand **Sparkling Standard**. Florida Articles certificate dated 2026-10-21 is filed in the private master legal archive. | Retail abbreviated-brand use/legal review remains with counsel | `docs/launch/OWNER-INPUT-REQUIRED.md` #6 |
| Insurance / bonding / licensing | **owner-confirmed; documentation pending** | Owner confirms general liability and workers' compensation active. Policy limits, dates, classifications, bonding and licensing evidence outstanding; no specific claims published | Supply certificates/policy evidence | `docs/launch/OWNER-INPUT-REQUIRED.md` #21/#22 |

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

## IndexNow (2026-10-21)

- Public key file: `public/<key>.txt` (copied to the production root by the static build).
- `npm run indexnow` reads `dist/sitemap-0.xml`, hashes the built page for each canonical URL, and submits only new, changed or removed URLs to `https://api.indexnow.org/indexnow`.
- `npm run indexnow:dry` previews without submitting; `npm run indexnow:all` deliberately resubmits all canonical URLs.
- Local duplicate-suppression state lives in the git-ignored `indexnow-out/state.json`.
- A `200`/`202` response confirms the request was accepted; it does **not** guarantee indexing. Sitemap, robots, canonicals and Google Search Console remain the primary indexing controls.