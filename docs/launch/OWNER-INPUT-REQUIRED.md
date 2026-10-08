# Owner input required

**The site is live at `https://sparkling-standard.com`** and its pipeline is verified operational.
The formal owner checklist below — legal entity spelling, claims, final cancellation percentages —
is still outstanding and keeps `business.launch.productionApproved = false`. That flag is the formal
sign-off gate; it does **not** describe deployment state. This is the single authoritative list —
do not scatter TODOs elsewhere.

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
| Social profiles | Nine profile URLs in `business.socials` — Google Business Profile (verified, owner-supplied 2026-10-08), Facebook, Nextdoor, TikTok, Pinterest, Rumble, Gab, Parler, Locals (2026-10-03), all live; the eight social profiles have their tracked UTM links placed (owner-confirmed). Instagram verification is in progress; YouTube is deferred by Google Workspace eligibility; the remaining platforms stay PENDING |
| GTM / GA4 analytics | **Resolved 2026-10-03 (owner-confirmed):** `GTM-KSQ26HMG` consent-gated and installed; GA4 `G-LG222LQRQ2` operational via published GTM Version 3 (1 Google tag, 12 event tags, 12 triggers, 7 variables). Page views, `estimate_start` and the three inquiry key events verified end-to-end; Enhanced Measurement form interactions disabled. Umami still has no ID (optional) |
| Brand icons | Owner-approved favicon/PWA icon kit installed (2026-10-02) |
| Google Business Profile | **Verified — profile + review links captured (owner-supplied 2026-10-08)** — the profile is publicly visible and the exact URLs are configured in `business.ts` (see #9). Remaining: paste the four tracked GBP links |

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
| 9 | ~~Review link + profile URL (Google)~~ **Done 2026-10-08** | `business.reviews.submissionUrl`, `business.reviews.profileUrl`, `business.socials.googleProfile` | **Resolved:** the exact owner-supplied URLs are configured (see the Resolved table); the `/leave-review/` page is live and review requests are unblocked. Never modify, shorten or hand-build the URLs. |
| 10 | Remaining platform profile URLs | `business.socials` | **Mostly done (2026-10-03):** eight social profiles live and rendering — Facebook, Nextdoor, TikTok, Pinterest, Rumble, Gab, Parler and Locals — with their basic tracked UTM links placed (owner-confirmed). **Google Business Profile is verified with its profile + review links captured (owner-supplied 2026-10-08).** **Instagram is undergoing verification** (do not publish an unconfirmed URL). **YouTube is deferred** by new Google Workspace account eligibility — not abandoned, no paid workarounds. Bing Places, Yelp, X, Threads, LinkedIn, Alignable and Reddit are prepared as PENDING and never render until supplied. Full actions: `docs/marketing/PLATFORM-REGISTER.md`. |
| 11 | Analytics IDs | `PUBLIC_UMAMI_WEBSITE_ID`, `PUBLIC_GTM_CONTAINER_ID` | **GA4 done (owner-confirmed 2026-10-03):** `GTM-KSQ26HMG` / `G-LG222LQRQ2` operational with all three key events verified. Umami remains optional with no website ID; the privacy page names only configured services. Accounts must be unique to this business. |
| 12 | SMS capability | `business.flags.smsEnabled` | **Done 2026-10-01.** Owner-confirmed: the business number receives SMS and text contact is authorized; `business.flags.smsEnabled` is true and the Call/Text reservation actions are live. |
| 13 | Final cancellation percentages | `src/config/pricing.ts` cancellation | Currently provisional; public copy intentionally avoids numbers until approved. |
| 14 | Turnstile keys (recommended) | `PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Otherwise forms rely on honeypot + timing. |
| 15 | EIA API key (optional) | `EIA_API_KEY` | Live Gulf Coast gas reference; fallback price works without it. |
| 16 | Browser/device QA + Lighthouse + accessibility scan | local preview / production preview | **Partially done:** browser regression suites and axe WCAG 2.2 AA scans pass in Chromium and are recorded in `docs/verification/VERIFICATION.md`. Physical-device smoke and a Lighthouse/PSI run remain owner-side. |
| 17 | Owner legal review of `/terms/` and `/privacy/` | site pages | Drafted as honest operating terms, not legal advice. |

## MARKETING LAUNCH — owner approvals and actions (grouped in execution order)

The full schedule is `docs/marketing/90-DAY-LAUNCH-PLAN.md`; account setup is
`docs/marketing/SOCIAL-ACCOUNT-SETUP.md`; content concepts are
`docs/marketing/CONTENT-PRODUCTION-SYSTEM.md` (proposed until approved).

| # | Action | Notes |
| --- | --- | --- |
| M1 | ~~Review and authorize the software release~~ **Done 2026-10-03** | Owner-authorized pushes deployed `5a4a024`, `cdc4971` (social integration) and `62a1a46` (logo-only Follow Us redesign); live acceptance checks passed (`docs/verification/VERIFICATION.md`). Later documentation follow-ups stay local until separately authorized |
| M2 | ~~Confirm the Google Business Profile verification result~~ **Done 2026-10-08** — GBP is verified; the exact profile/review links are captured (#9) and review requests are unblocked. **Instagram verification remains in progress** — never claim it or publish its URL before confirmation |
| M3 | Priority social accounts and placements | **Done 2026-10-03:** eight profiles live; the owner confirms the basic tracked UTM links are placed on all eight (registry active). **Remaining:** wait for Instagram verification (URL not published); YouTube deferred by Google Workspace eligibility — no paid workarounds |
| M4 | Approve the content concepts and schedule | The "30 Days. 30 Details." title, the four-week plan and the founder introduction are proposals until approved; owner approves the facts the founder content may state. **Immediate priority: filming.** |
| M5 | Film the opening content (immediate priority) | Hayli's founder introduction (long + short edit) and the first cleaning videos; customer footage requires permission. Acquiring local recurring customers is the business outcome this content serves |
| M6 | Optional: add a GA4 internal-traffic filter for owner devices | Keeps test visits out of reports |
| M7 | 30-day review (end of week 4) | Compare channels by inquiries, confirmed bookings, completed jobs and recurring customers — not views |

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
remaining social profile links (Instagram/YouTube and the lower-priority platforms), the Umami
analytics ID, genuine photography and public business claim wording. None of these appear as
invented facts anywhere in the codebase. The private operating coordinates exist only as a
Cloudflare secret — supplied by the owner, never committed, never rendered and never logged.
