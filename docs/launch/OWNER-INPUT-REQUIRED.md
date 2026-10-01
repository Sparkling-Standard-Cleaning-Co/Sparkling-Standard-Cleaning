# Owner input required

The site is fully built and can be reviewed in preview today. Production deployment is blocked
until the **BLOCKS PRODUCTION** items are resolved and verified. This is the single authoritative
list — do not scatter TODOs elsewhere.

**How to resolve:** facts are entered in `src/config/business.ts` (or the matching `.env` /
Cloudflare environment value), then run `npm run verify` and `npm run validate:production`.

## Resolved (October 2026)

| Item | Value |
| --- | --- |
| Final company name | **Sparkling Standard Cleaning Co.** (public brand: "Sparkling Standard") — in `src/config/business.ts` |
| Final domain | **https://sparkling-standard.com** — in `src/config/business.ts` + `astro.config.mjs` default |
| Public phone | **(850) 246-8479** — in `src/config/business.ts` |
| Public email | **owner@sparkling-standard.com** — in `src/config/business.ts` |
| Founder identity | **Hayli** — approved founder background in `business.founder` |
| Service territory (broad) | About one hour of actual driving time from the Cantonment-area origin |
| Payment processor | Stripe (enabled methods still to confirm — see #4) |
| Hosting | Dedicated Cloudflare account; domain active on Cloudflare DNS |
| Repository | `Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning` |

## BLOCKS PRODUCTION

| # | Item | Where | Notes |
| --- | --- | --- | --- |
| 1 | **Web3Forms access key** | `WEB3FORMS_ACCESS_KEY` + `PUBLIC_WEB3FORMS_ACCESS_KEY` | The owner-created account already has a key. Enter it in `.env` locally and in the Cloudflare Pages environment variables. Never paste it into documentation or commits. |
| 2 | **Operating origin** | `TRAVEL_ORIGIN` ("lat,lng") | Private Cantonment-area location near Highway 97. Server-side only — never published on the site, in schema, in the repository or in marketing material. |
| 3 | **Live form-delivery test** | after deployment | One authorized submission per category (residential, estimate, commercial, STR) must arrive at `owner@sparkling-standard.com`. |
| 4 | **Stripe enabled methods** | `business.payments` | Confirm which methods are actually enabled in the Stripe account (cards / Apple Pay / Google Pay / ACH). The site currently lists cards, Apple Pay, Google Pay and ACH. |
| 5 | **Owner launch approval** | `business.launch.productionApproved = true` | Deliberate, reviewable code change after this list is cleared. |

## IMPORTANT BEFORE LAUNCH

| # | Item | Where | Notes |
| --- | --- | --- | --- |
| 6 | Legal entity spelling / suffix | `PUBLIC_BUSINESS_LEGAL_NAME` | Registered as "Sparkling Standard Cleaning Co."; verify the precise legal spelling and entity suffix before publishing. Stays unpublished (and omitted from schema) until confirmed. |
| 7 | Exact service-zone review | `src/config/geography.ts` | Zones are provisional ZIP centroids around the one-hour driving boundary. Confirm the final list after the origin coordinates are entered. |
| 8 | Pricing matrix approval | `docs/launch/PRICING-PROPOSAL.md` | Market research + proposed rates. Production rates do NOT change until the owner approves. |
| 9 | Review link (Google profile) | `business.reviews.submissionUrl` | Needed for the review system; create the Google Business Profile, then supply the links. |
| 10 | Real social profile URLs | `business.socials` | Footer/schema render only configured profiles. |
| 11 | Analytics IDs | `PUBLIC_UMAMI_WEBSITE_ID`, `PUBLIC_GTM_CONTAINER_ID` | Consent UI appears only when configured. Accounts must be unique to this business — never reuse another company's IDs. |
| 12 | SMS capability | `business.flags.smsEnabled` | Text CTAs stay hidden until a real text message has been sent to and received from (850) 246-8479. A mobile-style number is not proof. |
| 13 | Final cancellation percentages | `src/config/pricing.ts` cancellation | Currently provisional; public copy intentionally avoids numbers until approved. |
| 14 | Turnstile keys (recommended) | `PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Otherwise forms rely on honeypot + timing. |
| 15 | EIA API key (optional) | `EIA_API_KEY` | Live Gulf Coast gas reference; fallback price works without it. |
| 16 | Browser/device QA + Lighthouse + accessibility scan | local preview / production preview | Must be completed before public launch (see `docs/VERIFICATION.md`). |
| 17 | Owner legal review of `/terms/` and `/privacy/` | site pages | Drafted as honest operating terms, not legal advice. |

## CAN WAIT

| # | Item | Notes |
| --- | --- | --- |
| 18 | Final logo + real founder photos | Current design is complete without them; they make it stronger. Existing logo assets are placeholders pending the final identity. |
| 19 | Real proof entries (before/after) | `src/content/proof/` — homepage already shows the honest explainer. |
| 20 | Genuine reviews | `src/content/reviews/` — section appears automatically when entries exist. |
| 21 | Insurance/bonding details | Only publish when real; schema/claims currently omit them. |
| 22 | Licensed trade info (if any) | Same rule as above. |
| 23 | Referral program terms | `docs/marketing/REFERRAL-PROGRAM.md` — design ready, offer not active. |
| 24 | Photo upload support | Requires a storage provider decision; noted as a deliberate limitation. |
| 25 | IndexNow key | Optional post-launch indexing accelerator. |

## What was deliberately NOT decided by engineering

Legal entity suffix, insurance, bonding, licensing, price approval, final cancellation fees, review
and social links, analytics IDs, SMS availability and the private operating coordinates. None of
these appear as invented facts anywhere in the codebase.
