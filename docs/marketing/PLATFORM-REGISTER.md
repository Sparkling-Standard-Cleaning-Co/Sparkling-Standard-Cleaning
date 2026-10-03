# Platform register

The single inventory of every platform the owner intends to use. This document records reality:
a platform is **confirmed** only when the owner has supplied its real profile URL and it is
configured in `src/config/business.ts`. Nothing pending ever renders on the website, and no handle,
profile URL or account is ever invented.

**Registry links are not accounts.** The marketing-link registry (23 ready / 27 prepared) records
*links*, not platform presence — a "ready" link does not mean the account exists or the placement
is live. The owner checklist for creating the priority accounts is
`docs/marketing/SOCIAL-ACCOUNT-SETUP.md`; distribution priorities are in
`docs/marketing/MULTIPLATFORM-OPERATING-PLAN.md`.

Related: `docs/operations/PLATFORM-STATUS.md` (operational status), `src/components/SocialLinks.astro`
(public rendering order), `docs/marketing/UTM-MASTER-LINKS.md` (tracked inbound links).

## Status vocabulary

| Status | Meaning |
| --- | --- |
| **Confirmed** | Real URL supplied by the owner, configured, and rendering publicly. |
| **Created — verification pending** | The profile exists but is under review/not publicly visible. **Do not publish its URL or claim verification.** |
| **Pending** | Owner has not supplied a verified URL. Prepared in the registry, never rendered. |
| **Not used** | Deliberately excluded (no genuine business benefit at this stage). |

## Inventory

| Platform | Category | Priority | Status | Public URL | Owner action / notes |
| --- | --- | --- | --- | --- | --- |
| Google Business Profile | Local discovery | **1 — local acquisition** | **Created — verification pending** | Not published | Google management shows verification being reviewed. Do **not** mark verified or publish a URL until Google confirms. Then complete the GBP checklist in `docs/marketing/SOCIAL-ACCOUNT-SETUP.md`. |
| Instagram | Primary content | **2 — primary content** | Pending | — | Create the business/profile account, approved branding, tracked bio link. Checklist: `SOCIAL-ACCOUNT-SETUP.md`. Also feeds Threads. |
| TikTok | Primary content | **3 — primary content** | Pending | — | Create the account, tracked bio link, vertical detail videos. Checklist: `SOCIAL-ACCOUNT-SETUP.md`. |
| YouTube | Primary content | **4 — primary content** | Pending | — | Create a brand channel; tracked links section; Shorts + founder/process long-form. Checklist: `SOCIAL-ACCOUNT-SETUP.md`. |
| Facebook | Local discovery | Confirmed | **Confirmed** | `https://www.facebook.com/profile.php?id=61595026949584` | Locally relevant posts and selected videos; tracked Facebook links from the UTM master. |
| Nextdoor | Local discovery | Confirmed | **Confirmed** | `https://nextdoor.com/page/sparkling-standard-cleaning-co/` | Neighborhood posting is area-limited; local communication rather than every video; tracked Nextdoor link. |
| Bing Places | Local discovery | Later | Pending | — | Create/import from Google Business after GBP verifies; paste the tracked Bing Places UTM link as the website. |
| Pinterest | Adapted distribution | Later | Pending | — | Business profile with website claim; stills/pins from the weekly asset with tracked links. |
| Rumble | Adapted distribution | Later | Pending | — | Video mirror for YouTube uploads; channel link only. |
| X | Adapted distribution | Later | Pending | — | Profile bio link; reposts of short tips. |
| Threads | Adapted distribution | Later | Pending | — | Tied to the Instagram account; link in bio. |
| Gab | Adapted distribution | Later | Pending | — | Profile with a website field. No ad platform required. |
| Parler | Adapted distribution | Later | Pending | — | Profile with a website field. No ad platform required. |
| LinkedIn | Professional | Later | Pending | — | Company page; commercial/office outreach. |
| Alignable | Professional | Later | Pending | — | Local business network profile (business email required). |
| Reddit | Community | Later | Pending | — | Not a conventional business page: an account plus genuine participation in local subreddits. Follow each subreddit's self-promotion rules; never drop links without context. |
| Yelp | Directories | Later | Pending | — | Free business page; beware of paid upsells — zero-spend policy. |
| Apple Business Connect | Local discovery | Not used | Not used | — | Revisit only if iPhone/Maps discovery becomes a priority. |
| Advertising platforms (Google Ads, Meta Ads, etc.) | Paid | Not used | Not used | — | Zero additional spending; not authorized. |

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
