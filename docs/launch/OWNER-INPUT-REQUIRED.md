# Owner input required

The site is fully built and can be reviewed in preview today. Production deployment is blocked
until the **BLOCKS PRODUCTION** items are resolved and verified. This is the single authoritative
list — do not scatter TODOs elsewhere.

**How to resolve:** facts are entered in `src/config/business.ts` (or the matching `.env` value),
then run `npm run verify` and `npm run validate:production`.

## BLOCKS PRODUCTION

| # | Item | Where | Notes |
| --- | --- | --- | --- |
| 1 | **Final company name** | `PUBLIC_BUSINESS_NAME` in `.env` | Drives wordmark, titles, schema. No fake substitute ever shipped. |
| 2 | **Legal entity name** (if published) | `PUBLIC_BUSINESS_LEGAL_NAME` | Keep empty/unpublished until formed. |
| 3 | **Final domain** | `PUBLIC_SITE_URL` | Canonicals, sitemap, QR codes regenerate from this. |
| 4 | **Public phone number** | `PUBLIC_BUSINESS_PHONE` | Enables call/text actions everywhere + sticky bar. |
| 5 | **Public email address** | `PUBLIC_BUSINESS_EMAIL` | Enables email links + form fallback. |
| 6 | **Operating origin** | `TRAVEL_ORIGIN` ("lat,lng") | Required by the estimator's production gate. |
| 7 | **Final service territory** | `src/config/geography.ts` zones | Confirm/adjust the provisional ZIP zones. |
| 8 | **Form destination** | `WEB3FORMS_ACCESS_KEY` (server) and/or `PUBLIC_WEB3FORMS_ACCESS_KEY` | A verified live test submission must be received. |
| 9 | **Owner launch approval** | `business.launch.productionApproved = true` | Deliberate code change after this list is cleared. |

## IMPORTANT BEFORE LAUNCH

| # | Item | Where | Notes |
| --- | --- | --- | --- |
| 10 | Review link (Google profile) | `business.reviews.submissionUrl` | Needed for the review system; never invent one. |
| 11 | Real social profile URLs | `business.socials` | Footer/schema render only configured profiles. |
| 12 | Analytics IDs | `PUBLIC_UMAMI_WEBSITE_ID`, `PUBLIC_GTM_CONTAINER_ID` | Consent UI appears only when configured. |
| 13 | Payment processor decision | `business.payments.processor` | Accepted methods are already listed factually. |
| 14 | Final cancellation percentages | `src/config/pricing.ts` cancellation | Currently provisional; public copy intentionally avoids numbers until approved. |
| 15 | Turnstile keys (recommended) | `PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Otherwise forms rely on honeypot + timing. |
| 16 | EIA API key (optional) | `EIA_API_KEY` | Live Gulf Coast gas reference; fallback price works without it. |
| 17 | Prime the estimator calibration | `docs/operations/ESTIMATOR-CALIBRATION.md` | After the first ~10 jobs, lock the model. |
| 18 | Owner legal review of `/terms/` and `/privacy/` | site pages | Drafted as honest operating terms, not legal advice. |

## CAN WAIT

| # | Item | Notes |
| --- | --- | --- |
| 19 | Real founder photos | About page + brand. Current design is complete without them; they make it stronger. |
| 20 | Real proof entries (before/after) | `src/content/proof/` — homepage already shows the honest explainer. |
| 21 | Genuine reviews | `src/content/reviews/` — section appears automatically when entries exist. |
| 22 | Insurance/bonding details | Only publish when real; schema/claims currently omit them. |
| 23 | Licensed trade info (if any) | Same rule as above. |
| 24 | Referral program terms | `docs/marketing/REFERRAL-PROGRAM.md` — design ready, offer not active. |
| 25 | Photo upload support | Requires a storage provider decision; noted as a deliberate limitation. |
| 26 | IndexNow key | Optional post-launch indexing accelerator. |

## What was deliberately NOT decided by engineering

Final company name, legal entity, phone, email, domain, operating address/radius, insurance,
bonding, licensing, price approval, processor, final cancellation fees, review/social links and
analytics IDs. None of these appear as invented facts anywhere in the codebase.
