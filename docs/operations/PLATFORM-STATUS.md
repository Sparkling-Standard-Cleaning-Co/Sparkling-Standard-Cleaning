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
| Production website | **live (verified)** | `https://sparkling-standard.com` — all 18 pages return 200 with correct canonicals; mobile-throttled LCP 1.26–1.65 s, CLS ≤ 0.038; axe 0 violations (2026-10-01) | Owner launch authorization not recorded — indexing state must not change without it | `docs/verification/VERIFICATION.md` |
| Indexing status | **observed: indexable** | `robots.txt` = `Allow: /` + sitemap; every page meta robots = `index, follow` (verified 2026-10-01). `PUBLIC_PREVIEW_MODE` is NOT set in the deployed build | Owner: confirm final launch authorization (or restore noindex if not ready) | `docs/deployment/DEPLOYMENT.md` §6/§11 |
| Domain registration | **owner-confirmed** | Registered via Squarespace following Google Workspace purchase | None | — |
| Google Workspace email | **owner-confirmed** | `owner@sparkling-standard.com` operational; MX/SPF/DKIM imported. Do **not** modify or enable Email Routing | None | `docs/deployment/DEPLOYMENT.md` |
| Web3Forms | **blocked — pending owner** | Live verification 2026-10-01: `/api/lead` returns `503 not_configured` and the client key is empty in the deployed bundle — **no form can deliver a lead**. The honest failure message is live | Enter `WEB3FORMS_ACCESS_KEY` (Secret) and `PUBLIC_WEB3FORMS_ACCESS_KEY` (Text, same key) → redeploy → authorized live test | `docs/launch/REVENUE-READINESS-PLAN.md` §2 |
| Stripe | **owner-confirmed** | Account established; enabled payment methods **unconfirmed** (site lists cards, Apple Pay, Google Pay, ACH) | Confirm enabled methods | `docs/launch/OWNER-INPUT-REQUIRED.md` #4 |
| GTM / GA4 | **not started** | Architecture implemented and consent-gated; no container ID configured | Provide container ID when created | `docs/analytics/ANALYTICS-SETUP.md` |
| Umami | **not started** | Architecture implemented and consent-gated; no website ID configured | Provide website ID when created | `docs/analytics/ANALYTICS-SETUP.md` |
| Google Business Profile | **not started** | No profile exists; review links pending | Create after launch | `docs/marketing/REVIEW-GROWTH-SYSTEM.md` |
| Search Console / Bing | **not started** | Post-launch indexing work | After launch | `docs/seo/SEO-STRATEGY.md` |
| Social profiles (Facebook, Instagram, Nextdoor, etc.) | **not started** | All profile URLs are `PENDING` in `business.ts`; footer renders none | Create profiles, supply URLs | `docs/marketing/CONTENT-OPERATING-SYSTEM.md` |
| SMS (text messaging) | **pending owner** | `business.flags.smsEnabled=false`; text CTAs hidden until a real text is sent and received | Verify SMS capability | `docs/launch/OWNER-INPUT-REQUIRED.md` #12 |
| Cloudflare Turnstile | **not started (optional)** | Forms rely on honeypot + timing until configured | Optional | `docs/deployment/DEPLOYMENT.md` §4 |
| Routing provider (Google Routes / Mapbox) | **not started (optional)** | Live `/api/travel` returns `503 origin_not_configured` (verified 2026-10-01); estimator uses offline zone mode | Optional after `TRAVEL_ORIGIN` | `docs/operations/ESTIMATOR-CALIBRATION.md` |
| EIA fuel price feed | **not started (optional)** | Configured reference price used until an EIA key is set | Optional | `docs/operations/ESTIMATOR-CALIBRATION.md` |
| IndexNow | **not started (post-launch)** | Script exists; no key or workflow configured | Optional after launch | `docs/launch/OWNER-INPUT-REQUIRED.md` #25 |
| Legal entity spelling/suffix | **pending owner** | Registered as "Sparkling Standard Cleaning Co."; exact spelling/suffix unverified; unpublished | Verify with registration documents | `docs/launch/OWNER-INPUT-REQUIRED.md` #6 |
| Insurance / bonding / licensing | **pending owner** | Never claimed until real documentation exists | Supply only when genuine | `docs/launch/OWNER-INPUT-REQUIRED.md` #21/#22 |

## How to update this register

1. Change a row only when the owner confirms it or an external check proves it.
2. Update the "Last reviewed" date.
3. Put new owner actions in `docs/launch/OWNER-INPUT-REQUIRED.md`, not here; this register
   points to the checklist rather than duplicating it.
4. Do not record credentials, keys, customer data or the private operating coordinates here.
