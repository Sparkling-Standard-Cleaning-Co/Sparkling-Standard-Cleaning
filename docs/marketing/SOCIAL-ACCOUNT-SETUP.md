# Social account setup — owner checklist

Owner-action guide for establishing the priority accounts. **Nothing here is done until the owner
does it and the account status is updated in `docs/marketing/PLATFORM-REGISTER.md`.** Account
creation, profile publishing and verification are all **pending** unless that register says
otherwise; never mark an account created, verified or linked before the owner confirms it.

**Status 2026-10-03:** the owner supplied six additional profile URLs (TikTok, Pinterest, Rumble,
Gab, Parler, Locals) and they are now rendering in the Follow Us section
(`docs/marketing/PLATFORM-REGISTER.md`). Account creation is complete for those six; **pasting the
tracked website link into each profile is still an owner action** and is tracked separately below.
Instagram and YouTube remain pending.

Authoritative status: `docs/marketing/PLATFORM-REGISTER.md`. Distribution plan:
`docs/marketing/MULTIPLATFORM-OPERATING-PLAN.md`. Content: `docs/marketing/CONTENT-OPERATING-SYSTEM.md`
and `docs/marketing/CONTENT-PRODUCTION-SYSTEM.md`. Tracked links: generated
`docs/marketing/WHERE-TO-PASTE-UTM-LINKS.md` (never hand-edit generated files).

## Priority order

| Order | Platform | Current status | Role |
| --- | --- | --- | --- |
| 1 | Google Business Profile | **Created — verification pending** | Local discovery; reviews; high-intent search |
| 2 | Instagram | **Pending — not created** | Primary content channel (Reels) |
| 3 | TikTok | **Confirmed — account created 2026-10-03** | Primary content channel (short-form reach) |
| 4 | YouTube | **Pending — not created** | Primary content channel (Shorts + founder/process long-form) |
| — | Facebook | Confirmed | Local communication and community visibility |
| — | Nextdoor | Confirmed | Neighborhood credibility and local posts |
| — | Pinterest, Rumble, Gab, Parler, Locals | **Confirmed — accounts created 2026-10-03** | Adapted distribution of the same master content; not a separate production line |

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

### Google Business Profile (priority 1 — verification pending)

Do **not** publish the URL or claim verification until Google confirms. Status:
`docs/operations/PLATFORM-STATUS.md`.

- [ ] Confirm Google's verification result in the profile dashboard (owner action; may take days).
- [ ] Business category: House cleaning service (primary); add honest secondary categories only.
- [ ] Service-area business settings: hide the street address; set the approved service area.
- [ ] Hours: the residential window configured for the business.
- [ ] Services: mirror the site's seven service pages with honest descriptions.
- [ ] Website field: the tracked **GBP → website** link (registry: `gbp_home`).
- [ ] Appointment/estimate link: the tracked **GBP → appointment** link (`gbp_estimate`).
- [ ] Photos: real work only after permission; no stock, no identifying details.
- [ ] Reviews: request after every completed job (`docs/marketing/REVIEW-GROWTH-SYSTEM.md`); never
      buy, gate or invent reviews.
- [ ] When verified, copy the real "Ask for reviews" short link into
      `business.reviews.submissionUrl` — never hand-build a review URL.
- [ ] Record the verified status and (when the owner chooses to publish) the URL in the register.

### Instagram (priority 2 — creation pending)

- [ ] Create the account and switch it to a professional/business account; category "House
      cleaning service".
- [ ] Choose an available handle that matches the brand; record it only after it exists.
- [ ] Profile photo: approved crest; name field: "Sparkling Standard Cleaning Co.".
- [ ] Bio: premium, warm, service area and slogan — e.g. "Sparkling Standard Cleaning Co.
      Cantonment & Pensacola · owner-operated · The Details Are Our Standard." No unapproved
      claims (no "licensed/bonded/insured", no invented years or client counts).
- [ ] Contact: business phone and email from `business.ts`; never a street address.
- [ ] Website field: the tracked **Instagram → Bio link** (`instagram_profile`).
- [ ] Story/link-sticker estimate pushes: tracked **Instagram → estimate** link
      (`instagram_estimate`).
- [ ] Content: vertical 9:16 Reels (see the production system); captions on; highlights for real
      series ("Details", "Founder", "Reviews" only when genuine reviews exist).
- [ ] Verification: complete phone/email verification; no purchase of verification.
- [ ] Update `PLATFORM-REGISTER.md` with the real URL, then (with owner approval) add it to
      `business.socials` so it renders on the site.

### TikTok (priority 3 — account created 2026-10-03)

- [x] Account created: `https://www.tiktok.com/@sparkling_standard?lang=en` (owner-supplied).
- [ ] Confirm the profile photo (approved crest), display name and contact information.
- [ ] Bio: short positioning plus service area; no unapproved claims.
- [ ] Website field: paste the tracked TikTok bio link from the checklist below when the field is
      available; otherwise direct viewers to the website in captions until it is.
- [ ] Content: vertical 9:16; use the tracked TikTok detail-video link in descriptions where a
      link is placed.
- [ ] Verification: complete whatever email/phone verification the platform requires.

### YouTube (priority 4 — creation pending)

- [ ] Create the channel (brand account owned by the business email), not a personal channel.
- [ ] Channel identity: approved crest avatar, consistent name, description with the slogan and
      service area.
- [ ] Links section: the tracked **YouTube → channel link** (`youtube_profile`).
- [ ] Video descriptions: use the tracked **YouTube → detail video** link (`youtube_detail_video`)
      on marketing uploads; never invent a URL.
- [ ] Content: vertical Shorts from the master short-form edit; a longer founder/process cut when
      available; 16:9 for long-form.
- [ ] Verification: complete the platform's channel verification steps; never buy subscribers or
      views.
- [ ] Update `PLATFORM-REGISTER.md` with the real channel URL after creation.

## Confirmed distribution accounts — tracked website links to paste

The six accounts below exist (owner-supplied 2026-10-03). Paste the exact tracked URL for each
profile into its website field; the URLs are generated from `src/config/marketing-links.ts` and
also listed in `docs/marketing/WHERE-TO-PASTE-UTM-LINKS.md`. Mark the corresponding registry
`pending` flag `false` (and regenerate the docs) only after the owner confirms each paste.

| Platform | Where to paste | Tracked website URL |
| --- | --- | --- |
| TikTok | TikTok → Edit profile → Website | `https://sparkling-standard.com/?utm_source=tiktok&utm_medium=organic_social&utm_campaign=profile` |
| Pinterest | Pinterest business profile → Claim → Website | `https://sparkling-standard.com/?utm_source=pinterest&utm_medium=organic_social&utm_campaign=profile` |
| Rumble | Rumble channel → About → Website | `https://sparkling-standard.com/?utm_source=rumble&utm_medium=organic_social&utm_campaign=profile` |
| Gab | Gab profile → Website | `https://sparkling-standard.com/?utm_source=gab&utm_medium=organic_social&utm_campaign=profile` |
| Parler | Parler profile → Website | `https://sparkling-standard.com/?utm_source=parler&utm_medium=organic_social&utm_campaign=profile` |
| Locals | Locals profile → Website | `https://sparkling-standard.com/?utm_source=locals&utm_medium=organic_social&utm_campaign=profile` |

Never add these UTMs to internal site navigation or to the outbound profile links on the website —
they belong only on the inbound campaign links pasted into the platforms.

### Facebook and Nextdoor (confirmed — no creation needed)

- [ ] Keep contact details and the website field consistent with `business.ts`.
- [ ] Facebook page website field: tracked **Facebook → profile** link (`facebook_profile`);
      recurring community posts use `facebook_recurring`.
- [ ] Nextdoor business page: tracked **Nextdoor → profile** link (`nextdoor_profile`);
      recommendation/neighborhood posts use `nextdoor_recommendation`.
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
