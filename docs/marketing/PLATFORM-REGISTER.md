# Platform register

The single inventory of every platform the owner intends to use. This document records reality:
a platform is **confirmed** only when the owner has supplied its real profile URL and it is
configured in `src/config/business.ts`. Nothing pending ever renders on the website, and no handle,
profile URL or account is ever invented.

**Registry links are not accounts.** The marketing-link registry (38 ready / 18 prepared) records
*links*, not platform presence. The owner checklist for creating the priority accounts is
`docs/marketing/SOCIAL-ACCOUNT-SETUP.md`; distribution priorities are in
`docs/marketing/MULTIPLATFORM-OPERATING-PLAN.md`.

**Owner-supplied profiles (2026-10-03):** the owner supplied six additional profile URLs
(Gab, Pinterest, Locals, Rumble, TikTok, Parler). They are classified **Confirmed (owner-supplied)**
— configured in `business.ts` and rendering publicly. Each URL returned HTTP 200 when checked on
2026-10-03; this confirms the destination resolves but is **not** independent identity
verification.

**Tracked-link placements (owner-confirmed 2026-10-03; GBP 2026-10-08):** the owner confirms the
basic UTM website/bio links have been placed on the eight existing profiles (Facebook, Nextdoor,
TikTok, Pinterest, Rumble, Gab, Parler, Locals). Their registry entries are therefore **active**
(`pending: false`). The Google Business Profile is **verified, and its public profile URL and
"Ask for reviews" link are captured** (owner-supplied 2026-10-08), so its four tracked links
(`gbp_home`, `gbp_estimate`, `gbp_deep_clean`, `gbp_gift_post`) are now also **ready to paste**
into the live profile. Placements on not-yet-created or unverified platforms (Instagram, YouTube,
X, Threads, LinkedIn, Alignable, Reddit, Yelp, Bing Places) remain **prepared** and are not
presented as live. Account existence, tracked-link placement and verification are three separate
statuses; this document keeps them distinct.

Related: `docs/operations/PLATFORM-STATUS.md` (operational status), `src/components/SocialLinks.astro`
(public rendering order), `docs/marketing/UTM-MASTER-LINKS.md` (tracked inbound links).

## Status vocabulary

| Status | Meaning |
| --- | --- |
| **Confirmed** | Real URL supplied by the owner, configured, and rendering publicly. |
| **Verified (owner-confirmed)** | The platform has confirmed the account/listing and the owner has supplied the exact URLs where applicable (e.g. Google Business Profile profile + review links, 2026-10-08). Never construct, modify or substitute a URL. |
| **Verification in progress** | The profile exists but is under review/not publicly visible. **Do not publish its URL or claim verification.** |
| **Pending** | Owner has not supplied a verified URL. Prepared in the registry, never rendered. |
| **Not used** | Deliberately excluded (no genuine business benefit at this stage). |

## Inventory

| Platform | Category | Priority | Status | Public URL | Owner action / notes |
| --- | --- | --- | --- | --- | --- |
| Google Business Profile | Local discovery | **1 — local acquisition** | **Verified — profile + review links captured (owner-confirmed 2026-10-08)** | `https://www.google.com/search?kgmid=/g/11zz5t1059&hl=en-US&q=Sparkling+Standard+Cleaning+Co.` | The profile is verified and publicly visible; the exact public profile URL and the "Ask for reviews" link are configured in `business.ts` (review link: `https://g.page/r/CXAcv1Pp7OI2ECE/review`). **Remaining owner action:** paste the four tracked GBP links (`gbp_home`, `gbp_estimate`, `gbp_deep_clean`, `gbp_gift_post`) and run the weekly rhythm (`docs/marketing/WEEKLY-EXECUTION-PLAYBOOK.md`, `docs/marketing/LOCAL-AUTHORITY.md`). |
| Instagram | Primary content | **2 — primary content** | **Verification in progress (owner-confirmed 2026-10-03)** | Not published | The account is undergoing verification. Do **not** mark it verified and do **not** publish an unconfirmed URL; the URL stays PENDING in `business.ts` until the owner supplies the verified profile. Tracked bio link is prepared (`instagram_profile`). Also feeds Threads. |
| TikTok | Primary content | **3 — primary content** | **Confirmed (owner-supplied 2026-10-03)** | `https://www.tiktok.com/@sparkling_standard?lang=en` | Account created; tracked bio link placed (owner-confirmed). Vertical detail videos. |
| YouTube | Primary content | **4 — primary content** | **Deferred (not abandoned) — Google Workspace eligibility** | — | Channel creation is temporarily blocked by new Google Workspace account eligibility. Revisit when eligible; do not purchase or add paid services to work around it. Tracked channel link stays prepared (`youtube_profile`). |
| Facebook | Local discovery | Confirmed | **Confirmed** | `https://www.facebook.com/profile.php?id=61595026949584` | Locally relevant posts and selected videos; tracked website link placed (owner-confirmed). |
| Nextdoor | Local discovery | Confirmed | **Confirmed** | `https://nextdoor.com/page/sparkling-standard-cleaning-co/` | Neighborhood posting is area-limited; local communication rather than every video; tracked website link placed (owner-confirmed). |
| Pinterest | Adapted distribution | Later | **Confirmed (owner-supplied 2026-10-03)** | `https://www.pinterest.com/SparklingStandard/` | Created; tracked profile link placed (owner-confirmed). Stills/pins from the weekly asset. |
| Rumble | Adapted distribution | Later | **Confirmed (owner-supplied 2026-10-03)** | `https://rumble.com/user/SparklingStandard` | Created; tracked channel link placed (owner-confirmed). Video mirror for YouTube uploads. |
| Gab | Adapted distribution | Later | **Confirmed (owner-supplied 2026-10-03)** | `https://gab.com/Sparkling_Standard` | Created; tracked profile link placed (owner-confirmed). Adapted reposts. |
| Parler | Adapted distribution | Later | **Confirmed (owner-supplied 2026-10-03)** | `https://app.parler.com/Sparkling-Standard` | Created; tracked profile link placed (owner-confirmed). Adapted reposts. |
| Locals | Additional distribution / community | Later | **Confirmed (owner-supplied 2026-10-03)** | `https://sparkling-standards.locals.com` | Created; tracked profile link placed (owner-confirmed). Proposed role: a secondary distribution/community channel for the same master content (adapted posts, not a separate production line). |
| Bing Places | Local discovery | Later | Pending | — | Create/import from Google Business (**GBP is verified**); paste the tracked Bing Places UTM link as the website. |
| X | Adapted distribution | Later | Pending | — | Profile bio link; reposts of short tips. |
| Threads | Adapted distribution | Later | Pending | — | Tied to the Instagram account; link in bio. |
| LinkedIn | Professional | Later | Pending | — | Company page; commercial/office outreach. |
| Alignable | Professional | Later | Pending | — | Local business network profile (business email required). |
| Reddit | Community | Later | Pending | — | Not a conventional business page: an account plus genuine participation in local subreddits. Follow each subreddit's self-promotion rules; never drop links without context. |
| Yelp | Directories | Later | Pending | — | Free business page; beware of paid upsells — zero-spend policy. |
| Apple Business Connect | Local discovery | Not used | Not used | — | Revisit only if iPhone/Maps discovery becomes a priority. |
| Advertising platforms (Google Ads, Meta Ads, etc.) | Paid | Not used | Not used | — | Zero additional spending; not authorized. |

Priority note: creating more accounts must not dilute production effort. **Immediate execution
priority is filming Hayli's founder introduction, producing the first cleaning videos and
acquiring local recurring customers.** Instagram (verification in progress), TikTok and YouTube
(deferred) remain the primary content channels; Pinterest, Rumble, Gab, Parler and Locals receive
adapted reposts of the same master content, and Facebook/Nextdoor receive locally relevant
communication. The weekly cadence and production plan are unchanged
(`docs/marketing/MULTIPLATFORM-OPERATING-PLAN.md`, `docs/marketing/CONTENT-PRODUCTION-SYSTEM.md`).

## Rendering rules (enforced in code)

1. `SocialLinks.astro` renders a platform **only** when `business.socials` holds a confirmed
   non-PENDING URL; pending platforms are filtered out.
2. Outbound profile links never carry UTM parameters (UTMs are for inbound campaign links only).
3. Profile links open in a new tab with `rel="noopener noreferrer"` and an accessible name.
4. Icons: official Simple Icons glyphs where available (CC0); platforms without an official glyph
   use a neutral monogram tile — never a counterfeit logo. The visible label always carries the
   platform name.
5. LinkedIn is no longer published in Simple Icons; its standard "in" mark is used.

## Adding a platform

1. Owner supplies the real profile URL.
2. Set it in `src/config/business.ts` `socials` (replace `PENDING`).
3. Add/confirm its tracked inbound link in `src/config/marketing-links.ts` and regenerate with
   `npm run marketing:links`.
4. Update this register and the test's confirmed list (`tests/browser/social-links.test.mjs`).
5. Run `npm run verify` and the browser suite; publish through the normal production workflow.

Never publish an account before it exists, and never mark verification complete before the
platform confirms it.
