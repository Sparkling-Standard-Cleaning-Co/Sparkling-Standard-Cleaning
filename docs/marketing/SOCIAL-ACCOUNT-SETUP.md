# Social account setup — owner checklist

Owner-action guide for establishing the priority accounts. **Nothing here is done until the owner
does it and the account status is updated in `docs/marketing/PLATFORM-REGISTER.md`.** Account
creation, profile publishing and verification are all **pending** unless that register says
otherwise; never mark an account created, verified or linked before the owner confirms it.

**Status 2026-10-08:** **Google Business Profile is VERIFIED with its exact public profile URL and
"Ask for reviews" link captured (owner-supplied 2026-10-08)** — it is active operating
infrastructure and review requests are unblocked (§ Google Business Profile below). Nine profiles
render in the Follow Us section (Google Business Profile plus the eight below). The owner confirms
the **basic tracked UTM website/bio links are placed** on the eight social profiles, so their
registry entries are active (`pending: false`) and their tracked URLs are recorded below.
**Instagram is undergoing verification** (do not mark verified or publish an unconfirmed URL).
**YouTube creation is deferred** — temporarily blocked by new Google Workspace account
eligibility, not abandoned; do not add paid services to work around it.

**Immediate execution priority (owner direction):** film Hayli's founder introduction, produce the
first cleaning videos and acquire local recurring customers. Account setup is no longer the
bottleneck; production and local acquisition are.

Authoritative status: `docs/marketing/PLATFORM-REGISTER.md`. Distribution plan:
`docs/marketing/MULTIPLATFORM-OPERATING-PLAN.md`. Content: `docs/marketing/CONTENT-OPERATING-SYSTEM.md`
and `docs/marketing/CONTENT-PRODUCTION-SYSTEM.md`. Tracked links: generated
`docs/marketing/WHERE-TO-PASTE-UTM-LINKS.md` (never hand-edit generated files).

## Priority order

| Order | Platform | Current status | Role |
| --- | --- | --- | --- |
| 1 | Google Business Profile | **Verified (owner-confirmed 2026-10-08)** | Local discovery; reviews; high-intent search |
| 2 | Instagram | **Verification in progress (2026-10-03) — URL not published** | Primary content channel (Reels) |
| 3 | TikTok | **Confirmed — account created; tracked bio link placed** | Primary content channel (short-form reach) |
| 4 | YouTube | **Deferred — Google Workspace account eligibility (not abandoned)** | Primary content channel (Shorts + founder/process long-form) |
| — | Facebook | Confirmed — tracked website link placed | Local communication and community visibility |
| — | Nextdoor | Confirmed — tracked website link placed | Neighborhood credibility and local posts |
| — | Pinterest, Rumble, Gab, Parler, Locals | **Confirmed — accounts created; tracked links placed (2026-10-03)** | Adapted distribution of the same master content; not a separate production line |

## Contact facts to keep identical everywhere (single source: `src/config/business.ts`)

- Business name: **Sparkling Standard Cleaning Co.** (public brand "Sparkling Standard")
- Phone: **(850) 426-8479** — email: **owner@sparkling-standard.com**
- Website: **https://sparkling-standard.com**
- Service area: Cantonment and Pensacola, nearby communities, select Alabama areas
- **Never publish a street address.** This is a service-area business; the operating address is
  private and must never appear in a profile, post, caption or screenshot.

## Brand assets (owner-approved; do not create replacements)

- Profile image: the approved gold "S" crest from `public/brand/icon-512.png` (or `icon-192.png`).
- Header/cover/OG-style imagery: `public/brand/logo-mark-soft.svg`, `og-default.png`; real
  permissioned work photography once available (follow `docs/privacy/PHOTO-PRIVACY-SOP.md`).
- Identity: premium, feminine, elegant, warm, trustworthy; pink and gold.
- Approved slogan: **The Details Are Our Standard.**

## Per-account checklist

### Google Business Profile (priority 1 — VERIFIED, active)

The profile is **verified and publicly visible**, and its exact public profile URL and
"Ask for reviews" link are **captured in `business.ts`** (owner-supplied 2026-10-08). Status:
`docs/operations/PLATFORM-STATUS.md`. Operating rhythm: `docs/marketing/WEEKLY-EXECUTION-PLAYBOOK.md`.

- [x] Verification confirmed by Google (owner-confirmed 2026-10-08).
- [x] Exact links captured and configured: `business.socials.googleProfile` and
      `business.reviews.profileUrl` = the owner-supplied public profile URL;
      `business.reviews.submissionUrl` = `https://g.page/r/CXAcv1Pp7OI2ECE/review` (the exact
      "Ask for reviews" short link). Never modify, shorten or hand-build these URLs.
- [ ] Business category: House cleaning service (primary); add honest secondary categories only.
- [ ] Service-area business settings: hide the street address; set the approved service area.
- [ ] Hours: the residential window configured for the business.
- [ ] Services: mirror the site's seven service pages with honest descriptions.
- [ ] Website field: the tracked **GBP → website** link (registry: `gbp_home`) — ready to paste now.
- [ ] Appointment/estimate link: the tracked **GBP → appointment** link (`gbp_estimate`) — ready to paste now.
- [ ] Photos: real work only after permission; no stock, no identifying details.
- [ ] Posts: begin the weekly GBP rhythm (`LOCAL-AUTHORITY.md` §1) using the tracked post links
      (`gbp_deep_clean`, `gbp_gift_post`).
- [ ] Reviews: request after every satisfied job using the configured review link
      (`docs/marketing/REVIEW-GROWTH-SYSTEM.md`); never buy, gate or invent reviews.

### Instagram (priority 2 — verification in progress)

- [x] Account exists and is undergoing verification (owner-confirmed 2026-10-03).
- [ ] **Do not mark verified and do not publish a URL** until the owner supplies the verified
      profile; it stays PENDING in `business.ts` and never renders.
- [ ] When verification completes: confirm the professional/business account settings, approved
      crest photo, consistent name, contact facts (no street address) and bio positioning.
- [ ] Website field: the tracked **Instagram → Bio link** (`instagram_profile`, currently
      prepared).
- [ ] Story/link-sticker estimate pushes: tracked **Instagram → estimate** link
      (`instagram_estimate`).
- [ ] Content: vertical 9:16 Reels (see the production system); captions on; highlights for real
      series ("Details", "Founder", "Reviews" only when genuine reviews exist).
- [ ] Then update `PLATFORM-REGISTER.md` with the real URL and (with owner approval) add it to
      `business.socials` so it renders on the site.

### TikTok (priority 3 — account created; tracked bio link placed)

- [x] Account created: `https://www.tiktok.com/@sparkling_standard?lang=en` (owner-supplied).
- [x] Tracked bio link placed (owner-confirmed 2026-10-03).
- [ ] Confirm the profile photo (approved crest), display name and contact information.
- [ ] Bio: short positioning plus service area; no unapproved claims.
- [ ] Content: vertical 9:16; use the tracked TikTok detail-video link in descriptions where a
      link is placed.
- [ ] Verification: complete whatever email/phone verification the platform requires.

### YouTube (priority 4 — deferred, not abandoned)

- [ ] **Deferred:** channel creation is temporarily blocked by new Google Workspace account
      eligibility. Revisit when eligible; do not purchase or add paid services to work around it.
- [ ] When unblocked: create the brand channel owned by the business email (not personal);
      approved crest avatar, consistent name, slogan and service area.
- [ ] Links section: the tracked **YouTube → channel link** (`youtube_profile`, prepared).
- [ ] Video descriptions: the tracked **YouTube → detail video** link (`youtube_detail_video`) on
      marketing uploads; never invent a URL.
- [ ] Content: vertical Shorts from the master short-form edit; a longer founder/process cut when
      available; 16:9 for long-form.
- [ ] Never buy subscribers or views.

## Confirmed placements — tracked website links (placed 2026-10-03)

The owner confirms the basic tracked UTM links are placed on the eight existing profiles. Their
registry entries are now **active** (`pending: false`). The URLs below are generated from
`src/config/marketing-links.ts` and listed in `docs/marketing/WHERE-TO-PASTE-UTM-LINKS.md`; use
this table as the record when auditing each profile.

| Platform | Placement | Tracked website URL |
| --- | --- | --- |
| Facebook | Page website field | `https://sparkling-standard.com/?utm_source=facebook&utm_medium=organic_social&utm_campaign=profile` |
| Nextdoor | Business page website field | `https://sparkling-standard.com/?utm_source=nextdoor&utm_medium=organic_social&utm_campaign=profile` |
| TikTok | Edit profile → Website | `https://sparkling-standard.com/?utm_source=tiktok&utm_medium=organic_social&utm_campaign=profile` |
| Pinterest | Business profile → Claim → Website | `https://sparkling-standard.com/?utm_source=pinterest&utm_medium=organic_social&utm_campaign=profile` |
| Rumble | Channel → About → Website | `https://sparkling-standard.com/?utm_source=rumble&utm_medium=organic_social&utm_campaign=profile` |
| Gab | Profile → Website | `https://sparkling-standard.com/?utm_source=gab&utm_medium=organic_social&utm_campaign=profile` |
| Parler | Profile → Website | `https://sparkling-standard.com/?utm_source=parler&utm_medium=organic_social&utm_campaign=profile` |
| Locals | Profile → Website | `https://sparkling-standard.com/?utm_source=locals&utm_medium=organic_social&utm_campaign=profile` |

Never add these UTMs to internal site navigation or to the outbound profile links on the website —
they belong only on the inbound campaign links placed inside the platforms. Instagram and YouTube
links remain **prepared, not placed**. The four GBP links are now **ready to paste** into the
verified profile (owner action).

### Facebook and Nextdoor (confirmed — tracked links placed)

- [x] Tracked website links placed (owner-confirmed 2026-10-03): `facebook_profile`,
      `nextdoor_profile`.
- [ ] Keep contact details and the website field consistent with `business.ts`.
- [ ] Recurring community posts use `facebook_recurring`; recommendation/neighborhood posts use
      `nextdoor_recommendation`.
- [ ] Local communication first: availability notes, helpful answers and genuine updates —
      not indiscriminate reposts of every video.

## Video and profile requirements (all priority platforms)

- Vertical master: **1080×1920 (9:16)**; hook in the first 1–2 seconds; 20–45 seconds target.
- Check the platform's current upload length and profile-field limits in the app at setup time —
  they change; the requirements above are intentionally tool-agnostic.
- Captions on every video; music only from platform-provided libraries.
- One master edit, adapted per platform — never separate filming for each platform.
- Full workflow: `docs/marketing/CONTENT-PRODUCTION-SYSTEM.md`.

## Rules that never bend

- Never invent a handle, profile URL, verification status, review link or account.
- Only confirmed URLs are configured in `business.ts` and rendered on the site.
- UTM parameters belong on inbound marketing links only — never on outbound profile links,
  internal navigation, canonicals, `tel:`/`sms:`/`mailto:` links or review links.
- Never publish private addresses, customer data, credentials or screenshot coordinates.
- Zero additional spending: no paid verification, ads, growth services or tools.
