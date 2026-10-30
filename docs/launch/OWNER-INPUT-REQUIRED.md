# Owner input required

> **2026-10-30 owner actions after the recovery release (`5525cd5`):**
>
> 1. **Set your own password.** Open <https://sparkling-standard.com/admin/>, choose **Forgot
>    Password?**, enter `owner@sparkling-standard.com`, and use the emailed single-use link within
>    30 minutes. Password rule: at least 8 characters including one special character. The previous
>    link expired unused and has been invalidated. Nobody else sets this password for you.
> 2. **Stripe sandbox (optional, to finish financial verification).** Create or rotate a Stripe
>    **test-mode** secret key, then paste it into
>    `C:\Users\thoma\Downloads\Sparkling-Standard-Master\01_WEBSITE_REPOSITORY\.env`
>    on the line `STRIPE_SECRET_KEY=` and run `npm run stripe:sandbox`. The key is ignored by Git and
>    never printed. No live key is accepted. Details: `docs/operations/STRIPE-SANDBOX-VERIFICATION.md`.
> 3. **Calendar write verification (optional, one command).** In a terminal at
>    `C:\Users\thoma\Downloads\Sparkling-Standard-Master\01_WEBSITE_REPOSITORY`, run
>    `node scripts/booking-live-test.mjs`. Paste the `BOOKING_OWNER_TOKEN` at the hidden prompt
>    (never in chat), type `YES`, and the script creates, verifies and cancels one synthetic calendar
>    event. It cannot create a customer booking, notification or charge.
> 4. **Agreement review.** Read the drafts in
>    `C:\Users\thoma\Downloads\Sparkling-Standard-Master\05_AGREEMENTS_AND_LEGAL\REVIEW_REQUIRED\`
>    and complete `10_OWNER_REVIEW_CHECKLIST`. Nothing is active until you approve it and counsel
>    reviews it.

> **2026-10-21 owner decision pass:** all 46 decisions are recorded in `Business HQ\00_START_HERE\MASTER_OWNER_DECISIONS.xlsx`. Remaining items below are evidence or professional review, not unanswered decisions. The workbook's `VERIFICATION_REGISTER` is the authoritative remaining-work list.

**The site is live at `https://sparkling-standard.com`** and its pipeline is verified operational.
All 46 decisions are recorded; the remaining items are evidence and professional review. `business.launch.productionApproved` remains the formal checklist gate and does not describe deployment state.

**How to resolve:** facts are entered in `src/config/business.ts` (or the matching `.env` /
Cloudflare environment value), then run `npm run verify` and `npm run validate:production`.

## Resolved (October 2026)

| Item | Value |
| --- | --- |
| Registered legal name | **Sparkling Standard LLC**; public brand **Sparkling Standard** — owner-confirmed 2026-10-21; Florida Articles certificate dated 2026-10-21 filed in the private master legal archive |
| Official slogan | **Standards That Make Your Space Sparkle.** |
| Final domain | **https://sparkling-standard.com** — in `src/config/business.ts` + `astro.config.mjs` default |
| Public phone | **(850) 426-8479** — in `src/config/business.ts` (owner-corrected 2026-10-02; the earlier `(850) 246-8479` was a typo) |
| Public email | **owner@sparkling-standard.com** — in `src/config/business.ts` |
| Founder identity | **Hayli** — approved founder background in `business.founder` |
| Service territory (broad) | About one hour of actual driving time from the Cantonment-area origin |
| Payment processor | Stripe; owner confirms cards, Apple Pay, Google Pay and ACH enabled (2026-10-21); dashboard evidence pending |
| Hosting | Dedicated Cloudflare account; domain active on Cloudflare DNS |
| Repository | `Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning` |
| Travel origin + routing | Private Cantonment-area origin configured as a Cloudflare secret; `/api/travel` verified live `method: route, verified: true` (2026-10-02) |
| MapMap address/routing key | Configured as a Cloudflare secret; `/api/geocode` suggest/resolve/reverse live and verified (2026-10-02) |
| SMS | `business.flags.smsEnabled: true` (owner-verified); Call/Text actions live |
| Social profiles | **Twelve active profiles in `business.socials`:** Google Business Profile (verified, owner-supplied 2026-10-08), Facebook, Nextdoor, TikTok, Pinterest, Rumble, Gab, Parler and Locals (2026-10-03), plus Instagram, YouTube and X (owner-confirmed active 2026-10-27). The original eight have tracked UTM links placed; the three new accounts render but their UTM placements are still pending owner confirmation. Bing Places, Yelp, Threads, LinkedIn, Alignable and Reddit stay PENDING |
| GTM / GA4 analytics | **Owner reports Version 5 published 2026-10-25:** `GTM-KSQ26HMG` consent-gated and installed; GA4 `G-LG222LQRQ2`; 1 Google tag, 19 event tags, 19 triggers, 13 variables, including church and promotion events. Page views, `estimate_start` and the three inquiry key events were verified end-to-end under Version 3. New church/promotion event receipt still needs GA4 DebugView/Realtime confirmation. Umami still has no ID (optional) |
| Brand icons | Owner-approved favicon/PWA icon kit installed (2026-10-02) |
| Google Business Profile | **Verified — profile + review links captured (owner-supplied 2026-10-08)** — the profile is publicly visible and the exact URLs are configured in `business.ts` (see #9). Remaining: paste the four tracked GBP links |

## BLOCKS PRODUCTION

| # | Item | Where | Notes |
| --- | --- | --- | --- |
| 1 | **Web3Forms access key** | `WEB3FORMS_ACCESS_KEY` (Secret) + `PUBLIC_WEB3FORMS_ACCESS_KEY` (Text) in Cloudflare | **Done 2026-10-01.** Owner-confirmed: all four marked test inquiries (residential, estimate, commercial, STR) arrived in the inbox. Lead delivery is operational. |
| 2 | **Operating origin** | `TRAVEL_ORIGIN` ("lat,lng", Cloudflare Secret) | **Done 2026-10-02** — configured and verified live (`/api/travel` returns `method: route, verified: true`). Server-side only — never published on the site, in schema, in the repository or in marketing material. |
| 3 | **Live form-delivery test** | after deployment | **Done 2026-10-01** — one marked test per category, all four owner-confirmed in the inbox. Re-run after any future form change. |
| 4 | **Stripe enabled methods** | `business.payments` | **Owner confirmed 2026-10-21:** cards, Apple Pay, Google Pay and ACH are enabled. Retain dashboard/checkout evidence. |
| 5 | **Owner launch approval** | `business.launch.productionApproved = true` | Deliberate, reviewable code change after this list is cleared. |

## IMPORTANT BEFORE LAUNCH

| # | Item | Where | Notes |
| --- | --- | --- | --- |
| 6 | ~~Legal entity spelling / suffix~~ **Resolved 2026-10-21** | `business.legalName` | **Sparkling Standard LLC** configured and published in schema/formal disclosures. Florida Articles certificate received and archived privately; confirm abbreviated-brand use with counsel. |
| 7 | Exact service-zone review | `src/config/geography.ts` | Zones are provisional ZIP centroids around the one-hour driving boundary. Confirm the final list after the origin coordinates are entered. |
| 8 | ~~Pricing matrix approval~~ **Resolved 2026-10-21** | `src/config/estimators/pricing-values.ts` | Owner approved **$55 per productive cleaning labor-hour** as the internal billing target. Customers receive job-specific quotes; no public hourly rate. |
| 9 | ~~Review link + profile URL (Google)~~ **Done 2026-10-08** | `business.reviews.submissionUrl`, `business.reviews.profileUrl`, `business.socials.googleProfile` | **Resolved:** the exact owner-supplied URLs are configured (see the Resolved table); the `/leave-review/` page is live and review requests are unblocked. Never modify, shorten or hand-build the URLs. |
| 10 | Remaining platform profile URLs | `business.socials` | **Twelve profiles now live:** the original eight plus Google Business Profile, Instagram, YouTube and X (owner-confirmed active 2026-10-27). Instagram, YouTube and X UTM placements are **prepared but not placement-confirmed**. Bing Places, Yelp, Threads, LinkedIn, Alignable and Reddit remain PENDING and never render. Full actions: `docs/marketing/PLATFORM-REGISTER.md`. |
| 11 | Analytics IDs | `PUBLIC_UMAMI_WEBSITE_ID`, `PUBLIC_GTM_CONTAINER_ID` | **GA4 done (owner-confirmed 2026-10-03):** `GTM-KSQ26HMG` / `G-LG222LQRQ2` operational with all three key events verified. Umami remains optional with no website ID; the privacy page names only configured services. Accounts must be unique to this business. |
| 12 | SMS capability | `business.flags.smsEnabled` | **Done 2026-10-01.** Owner-confirmed: the business number receives SMS and text contact is authorized; `business.flags.smsEnabled` is true and the Call/Text reservation actions are live. |
| 13 | ~~Final cancellation percentages~~ **Resolved 2026-10-21** | `src/config/pricing.ts` | 24 hours' notice requested; no standard fee initially; repeated cancellations or access problems may lead to declining future bookings. |
| 14 | Turnstile keys (recommended) | `PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Otherwise forms rely on honeypot + timing. |
| 15 | EIA API key (optional) | `EIA_API_KEY` | Live Gulf Coast gas reference; fallback price works without it. |
| 16 | Browser/device QA + Lighthouse + accessibility scan | local preview / production preview | **Owner accepts completed launch testing (2026-10-21).** Additional Lighthouse/device testing is optional unless a new change causes a problem; regression testing continues. |
| 17 | Owner legal review of `/terms/` and `/privacy/` | site pages | **Expanded 2026-10-27** with Florida cancellation/gift research and owner-approval gates. Still not legal advice; a Florida-licensed attorney must review before new fees or gift sales activate. See `docs/legal/TERMS-RESEARCH.md`. |

## MARKETING LAUNCH — owner approvals and actions (grouped in execution order)

The full schedule is `docs/marketing/90-DAY-LAUNCH-PLAN.md`; account setup is
`docs/marketing/SOCIAL-ACCOUNT-SETUP.md`; content concepts are
`docs/marketing/CONTENT-PRODUCTION-SYSTEM.md` (proposed until approved).

| # | Action | Notes |
| --- | --- | --- |
| M1 | ~~Review and authorize the software release~~ **Done 2026-10-03** | Owner-authorized pushes deployed `5a4a024`, `cdc4971` (social integration) and `62a1a46` (logo-only Follow Us redesign); live acceptance checks passed (`docs/verification/VERIFICATION.md`). Later documentation follow-ups stay local until separately authorized |
| M2 | ~~Confirm the Google Business Profile verification result~~ **Done 2026-10-08** — GBP is verified; the exact profile/review links are captured (#9) and review requests are unblocked. Instagram, YouTube and X are owner-confirmed active (2026-10-27). |
| M3 | Priority social accounts and placements | **Done 2026-10-03:** eight profiles live; the owner confirms the basic tracked UTM links are placed on all eight (registry active). **Added 2026-10-27:** Instagram, YouTube and X are live and render. **Remaining:** confirm UTM placement on those three profiles. |
| M4 | Approve the content concepts and schedule | The "30 Days. 30 Details." title, the four-week plan and the founder introduction are proposals until approved; owner approves the facts the founder content may state. **Immediate priority: filming.** |
| M5 | Film the opening content (immediate priority) | Hayli's founder introduction (long + short edit) and the first cleaning videos; customer footage requires permission. Acquiring local recurring customers is the business outcome this content serves |
| M6 | Optional: add a GA4 internal-traffic filter for owner devices | Keeps test visits out of reports |
| M7 | 30-day review (end of week 4) | Compare channels by inquiries, confirmed bookings, completed jobs and recurring customers — not views |

## CUSTOMER CONFIRMATION EMAIL — owner setup (Resend)

The code path is implemented and tested. **Owner-confirmed 2026-10-08: R1 and R2 are complete**
(`RESEND_API_KEY` set in Cloudflare; `sparkling-standard.com` verified in Resend with DNS
complete). Remaining: deploy the current build and run the one controlled live test (R4).
Exact steps: `docs/deployment/DEPLOYMENT.md` §4a; architecture:
`docs/operations/CUSTOMER-CONFIRMATION-EMAIL.md`.

| # | Item | Where | Notes |
| --- | --- | --- | --- |
| R1 | Resend account + API key | Cloudflare **Secret** `RESEND_API_KEY` | **Done (owner-confirmed 2026-10-08).** Server-side only; never a `PUBLIC_*` variable, never committed. The lead flow works without it — only the customer email is skipped |
| R2 | Sender-domain verification | Resend → Domains → `sparkling-standard.com` | **Done (owner-confirmed 2026-10-08):** domain verified, DNS complete. The exact records were added DNS-only; Google Workspace MX/SPF/DKIM untouched |
| R3 | Optional sender overrides | Cloudflare Text `RESEND_FROM_EMAIL`, `RESEND_REPLY_TO` | Defaults: `Sparkling Standard <notifications@sparkling-standard.com>` and `owner@sparkling-standard.com`. Only change to another verified sender |
| R4 | One controlled live test | Owner-controlled email address | **Owner confirmed 2026-10-21:** the expected inquiry emails arrived. Continue normal delivery/error monitoring and retain dashboard evidence. |

## GIFT CERTIFICATES — owner decisions before sales activate

Online sales are **disabled** (`src/config/gift-certificates.ts` `enabled: false`); the page takes
requests only. Full workflow: `docs/operations/GIFT-CERTIFICATES.md`.

| # | Item | Where | Notes |
| --- | --- | --- | --- |
| G1 | Approved denominations (or custom-only) | `giftCertificateConfig.denominations`, `allowCustomAmount`, bounds | No amount may be advertised until approved. |
| G2 | Public terms: coverage wording, redemption steps, refunds | `giftCertificateConfig` + the certificate template | **2026-10-27:** purchased certificates are now published as non-expiring with no post-sale fees (Fla. Stat. § 501.95). Review the remaining redemption/refund wording with counsel. |
| G3 | Florida (and Alabama where relevant) gift-certificate requirement review | owner/advisor | Required before public sales. The 60-day reservation window is NOT a certificate validity period. |
| G4 | Stripe activation | Cloudflare production secrets `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; webhook endpoint `/api/stripe-webhook` for `checkout.session.completed`; Stripe email receipts on | Confirm enabled payment methods before advertising them. |
| G5 | One live end-to-end test purchase (smallest denomination) | Stripe + owner inbox | Verify webhook alert, certificate generation, delivery, redemption, ledger. |

## PAY NOW — owner setup before live payment

| # | Item | Where | Notes |
| --- | --- | --- | --- |
| P1 | Stripe Pay Now secrets | Cloudflare runtime secrets `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | The code is ready; the button stays hidden until the secret exists. |
| P2 | Webhook endpoint | Stripe → `https://sparkling-standard.com/api/stripe-webhook` → `checkout.session.completed` | The same endpoint handles estimate payments and approved gift certificates. |
| P3 | Test-mode checkout | Stripe test mode + a controlled request | Confirm the normal lead and the separate **PAID estimate** owner notice before enabling live payment. No live charge is authorized by engineering. |
| P4 | Payment/refund terms | Owner-approved policy | The site does not invent a refund or cancellation promise. Existing terms govern. |

## BOOKING / LIVE AVAILABILITY — blocked on owner configuration

The website still collects a **preferred date and arrival window** as a request. It does not display
live slots because no calendar, job schedule, crew roster or travel-time source is connected.
Initiative 6.8 deliberately did not fabricate availability. Full architecture:
`docs/operations/BOOKING-ARCHITECTURE.md`.

| # | Item | Where | Notes |
| --- | --- | --- | --- |
| B1 | Choose the calendar/scheduling provider | Owner decision | **Done:** Google Calendar selected and connected to **Sparkling Standard - Bookings** in `America/Chicago`. |
| B2 | Provide calendar authorization | Owner-controlled OAuth / calendar ID | **Done 2026-10-28:** all five Cloudflare secrets present; OAuth refresh exchange and event read verified. Exact guide remains `docs/operations/GOOGLE-CALENDAR-SETUP.md`. |
| B3 | Import existing jobs | Owner calendar | **Owner action:** the calendar currently has zero jobs. Add each confirmed job with start/end and full address in the location field. Jobs without locations block availability. |
| B4 | Approve scheduling rules | `src/config/booking.ts` | **Active:** one crew, 8:00 a.m.–6:00 p.m. Central, seven days, 24-hour notice, 60-day window, 15-minute travel/job buffers, 20-minute holds. Change only with owner approval. |
| B5 | Approve booking confirmation policy | Owner decision | **Active:** `owner_approval`; `autoConfirmAllowed:false`. A held slot is never advertised as confirmed. |
| B6 | Test concurrency, timezone and cancellation | Live/controlled test | **Partial:** real availability, live holds, overlap 409 and DST logic verified. Owner confirmation/event creation and cancellation are mock-tested; run one live test with the private token, then delete the test event. |

## CAN WAIT

| # | Item | Notes |
| --- | --- | --- |
| 18 | Final logo + real founder photos | **Logo done 2026-10-19:** the owner-approved circular logo replaces the old crest/descriptor/tagline lockup, with regenerated favicon/PWA/social assets. Genuine founder/project photography is still outstanding; licensed representative interiors are registered in `docs/design/IMAGE-SOURCE-REGISTER.md` and replaced when real photos arrive. |
| 19 | Real proof entries (before/after) | `src/content/proof/` — the homepage proof section was removed in the 2026-10-19 audit; proof stays internal until genuine entries exist. |
| 20 | Genuine reviews | `src/content/reviews/` — section appears automatically when entries exist. |
| 21 | Insurance/bonding details | Only publish when real; schema/claims currently omit them. |
| 22 | Licensed trade info (if any) | Same rule as above. |
| 23 | Referral program terms | `docs/marketing/REFERRAL-PROGRAM.md` — design ready, offer not active. |
| 24 | Photo upload support | Requires a storage provider decision; noted as a deliberate limitation. |
| 25 | ~~IndexNow key~~ **Implemented 2026-10-21** | Production key file, change-only submission script and canonical URL submission are configured; indexing is never guaranteed. |

## What was deliberately NOT decided by engineering

Insurance, bonding, licensing, price approval, final cancellation fees, the
remaining social profile links (Instagram/YouTube and the lower-priority platforms), the Umami
analytics ID, genuine photography and public business claim wording. None of these appear as
invented facts anywhere in the codebase. The private operating coordinates exist only as a
Cloudflare secret — supplied by the owner, never committed, never rendered and never logged.
