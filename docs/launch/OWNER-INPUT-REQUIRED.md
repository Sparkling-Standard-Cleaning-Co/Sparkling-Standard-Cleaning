# Owner input required

**The site is live at `https://sparkling-standard.com`** and its pipeline is verified operational.
The formal owner checklist below — legal entity spelling, claims, review/profile links, final
cancellation percentages — is still outstanding and keeps
`business.launch.productionApproved = false`. That flag is the formal sign-off gate; it does **not**
describe deployment state. This is the single authoritative list — do not scatter TODOs elsewhere.

**How to resolve:** facts are entered in `src/config/business.ts` (or the matching `.env` /
Cloudflare environment value), then run `npm run verify` and `npm run validate:production`.

## Resolved (October 2026)

| Item | Value |
| --- | --- |
| Final company name | **Sparkling Standard Cleaning Co.** (public brand: "Sparkling Standard") — in `src/config/business.ts` |
| Final domain | **https://sparkling-standard.com** — in `src/config/business.ts` + `astro.config.mjs` default |
| Public phone | **(850) 426-8479** — in `src/config/business.ts` (owner-corrected 2026-10-02; the earlier `(850) 246-8479` was a typo) |
| Public email | **owner@sparkling-standard.com** — in `src/config/business.ts` |
| Founder identity | **Hayli** — approved founder background in `business.founder` |
| Service territory (broad) | About one hour of actual driving time from the Cantonment-area origin |
| Payment processor | Stripe (enabled methods still to confirm — see #4) |
| Hosting | Dedicated Cloudflare account; domain active on Cloudflare DNS |
| Repository | `Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning` |
| Travel origin + routing | Private Cantonment-area origin configured as a Cloudflare secret; `/api/travel` verified live `method: route, verified: true` (2026-10-02) |
| MapMap address/routing key | Configured as a Cloudflare secret; `/api/geocode` suggest/resolve/reverse live and verified (2026-10-02) |
| SMS | `business.flags.smsEnabled: true` (owner-verified); Call/Text actions live |
| Facebook + Nextdoor | Confirmed profile URLs in `business.socials`; other platforms remain PENDING |
| GTM / GA4 analytics | `GTM-KSQ26HMG` consent-gated and installed; GA4 measurement ID `G-LG222LQRQ2` confirmed. The container was found empty (zero tags) 2026-10-03 — owner must import the prepared files and publish (`docs/analytics/GTM-CONTAINER-SETUP.md`). Umami still has no ID |
| Brand icons | Owner-approved favicon/PWA icon kit installed (2026-10-02) |

## BLOCKS PRODUCTION

| # | Item | Where | Notes |
| --- | --- | --- | --- |
| 1 | **Web3Forms access key** | `WEB3FORMS_ACCESS_KEY` (Secret) + `PUBLIC_WEB3FORMS_ACCESS_KEY` (Text) in Cloudflare | **Done 2026-10-01.** Owner-confirmed: all four marked test inquiries (residential, estimate, commercial, STR) arrived in the inbox. Lead delivery is operational. |
| 2 | **Operating origin** | `TRAVEL_ORIGIN` ("lat,lng", Cloudflare Secret) | **Done 2026-10-02** — configured and verified live (`/api/travel` returns `method: route, verified: true`). Server-side only — never published on the site, in schema, in the repository or in marketing material. |
| 3 | **Live form-delivery test** | after deployment | **Done 2026-10-01** — one marked test per category, all four owner-confirmed in the inbox. Re-run after any future form change. |
| 4 | **Stripe enabled methods** | `business.payments` | Confirm which methods are actually enabled in the Stripe account (cards / Apple Pay / Google Pay / ACH). The site currently lists cards, Apple Pay, Google Pay and ACH. |
| 5 | **Owner launch approval** | `business.launch.productionApproved = true` | Deliberate, reviewable code change after this list is cleared. |

## IMPORTANT BEFORE LAUNCH

| # | Item | Where | Notes |
| --- | --- | --- | --- |
| 6 | Legal entity spelling / suffix | `PUBLIC_BUSINESS_LEGAL_NAME` | Registered as "Sparkling Standard Cleaning Co."; verify the precise legal spelling and entity suffix before publishing. Stays unpublished (and omitted from schema) until confirmed. |
| 7 | Exact service-zone review | `src/config/geography.ts` | Zones are provisional ZIP centroids around the one-hour driving boundary. Confirm the final list after the origin coordinates are entered. |
| 8 | Pricing matrix approval | `docs/launch/PRICING-PROPOSAL.md` | Market research + proposed rates. Production rates do NOT change until the owner approves. |
| 9 | Review link (Google profile) | `business.reviews.submissionUrl` | Needed for the review system; create the Google Business Profile, then supply the links. |
| 10 | Remaining platform profile URLs | `business.socials` | **Partially done:** Facebook and Nextdoor confirmed and rendering. Google Business Profile is created with verification processing and its URL intentionally unpublished. Bing Places, Yelp, Instagram, TikTok, YouTube, Pinterest, Rumble, Gab, Parler, X, Threads, LinkedIn, Alignable and Reddit are prepared as PENDING and never render until supplied. Full actions: `docs/marketing/PLATFORM-REGISTER.md`. |
| 11 | Analytics IDs | `PUBLIC_UMAMI_WEBSITE_ID`, `PUBLIC_GTM_CONTAINER_ID` | **Partially done.** `GTM-KSQ26HMG` is consent-gated and installed; GA4 stream confirmed (`G-LG222LQRQ2`). The owner's GTM workspace showed **zero tags** on 2026-10-03 — import `docs/analytics/gtm-import/*.json`, verify in Preview/DebugView and publish (`docs/analytics/GTM-CONTAINER-SETUP.md`). Umami still has no website ID; the privacy page names only configured services. Accounts must be unique to this business. |
| 12 | SMS capability | `business.flags.smsEnabled` | **Done 2026-10-01.** Owner-confirmed: the business number receives SMS and text contact is authorized; `business.flags.smsEnabled` is true and the Call/Text reservation actions are live. |
| 13 | Final cancellation percentages | `src/config/pricing.ts` cancellation | Currently provisional; public copy intentionally avoids numbers until approved. |
| 14 | Turnstile keys (recommended) | `PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Otherwise forms rely on honeypot + timing. |
| 15 | EIA API key (optional) | `EIA_API_KEY` | Live Gulf Coast gas reference; fallback price works without it. |
| 16 | Browser/device QA + Lighthouse + accessibility scan | local preview / production preview | **Partially done:** browser regression suites and axe WCAG 2.2 AA scans pass in Chromium and are recorded in `docs/verification/VERIFICATION.md`. Physical-device smoke and a Lighthouse/PSI run remain owner-side. |
| 17 | Owner legal review of `/terms/` and `/privacy/` | site pages | Drafted as honest operating terms, not legal advice. |

## GIFT CERTIFICATES — owner decisions before sales activate

Online sales are **disabled** (`src/config/gift-certificates.ts` `enabled: false`); the page takes
requests only. Full workflow: `docs/operations/GIFT-CERTIFICATES.md`.

| # | Item | Where | Notes |
| --- | --- | --- | --- |
| G1 | Approved denominations (or custom-only) | `giftCertificateConfig.denominations`, `allowCustomAmount`, bounds | No amount may be advertised until approved. |
| G2 | Public terms: coverage wording, redemption steps, expiry (or none), refunds | `giftCertificateConfig` + the certificate template | Do **not** invent restrictive expiry periods or fees. |
| G3 | Florida (and Alabama where relevant) gift-certificate requirement review | owner/advisor | Required before public sales. The 60-day reservation window is NOT a certificate validity period. |
| G4 | Stripe activation | Cloudflare production secrets `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; webhook endpoint `/api/stripe-webhook` for `checkout.session.completed`; Stripe email receipts on | Confirm enabled payment methods before advertising them. |
| G5 | One live end-to-end test purchase (smallest denomination) | Stripe + owner inbox | Verify webhook alert, certificate generation, delivery, redemption, ledger. |

## CAN WAIT

| # | Item | Notes |
| --- | --- | --- |
| 18 | Final logo + real founder photos | **Icon kit done 2026-10-02:** the owner-approved favicon/PWA icon kit replaces the old placeholders. Genuine founder/project photography is still outstanding; licensed representative interiors are registered in `docs/design/IMAGE-SOURCE-REGISTER.md` and replaced when real photos arrive. |
| 19 | Real proof entries (before/after) | `src/content/proof/` — homepage already shows the honest explainer. |
| 20 | Genuine reviews | `src/content/reviews/` — section appears automatically when entries exist. |
| 21 | Insurance/bonding details | Only publish when real; schema/claims currently omit them. |
| 22 | Licensed trade info (if any) | Same rule as above. |
| 23 | Referral program terms | `docs/marketing/REFERRAL-PROGRAM.md` — design ready, offer not active. |
| 24 | Photo upload support | Requires a storage provider decision; noted as a deliberate limitation. |
| 25 | IndexNow key | Optional post-launch indexing accelerator. |

## What was deliberately NOT decided by engineering

Legal entity suffix, insurance, bonding, licensing, price approval, final cancellation fees, the
remaining social and review links, the Umami analytics ID, genuine photography and public business
claim wording. None of these appear as invented facts anywhere in the codebase. The private
operating coordinates exist only as a Cloudflare secret — supplied by the owner, never committed,
never rendered and never logged.
