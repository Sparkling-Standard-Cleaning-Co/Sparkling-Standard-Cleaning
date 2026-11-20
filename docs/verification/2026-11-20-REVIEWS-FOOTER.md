# Reviews, photographs, footer and Tampa inquiry corrections - 2026-11-20

## Owner-approved review set

The owner-approved carousel displays exactly seven reviews:

1. Christina - residential cleaning
2. Richard - deep cleaning
3. Laura - residential cleaning
4. Dennis D - residential cleaning / upholstery add-on
5. K V - residential deep cleaning
6. S Ismail - commercial office cleaning
7. Rob & Christi Moore - recurring residential cleaning

Excluded by owner instruction: **Bob**, **Amanda** and **Elizabeth**.

K V and S Ismail use the exact owner-supplied text in this directive. K V's
"bi-monthly" wording is preserved. Both are five stars. No summary, aggregate
count or "not a complete copy" disclaimer appears under the heading; the owner
asked for that text to be removed.

## Review photographs

Real Google review photographs were restored from the public review profile and
optimized as local WebP assets:

- Dennis D: `src/assets/images/reviews/dennis-couch-1.webp` and
  `dennis-couch-2.webp` (the two couch photographs on his review).
- Laura: `src/assets/images/reviews/laura-shower.webp` (the shower photograph
  associated with her review).

No stock, AI-generated or third-party substitutes were used.

## Carousel presentation

- Cards now size to their content instead of stretching every short review to
  the height of the longest.
- Hidden cards beyond the active neighbours no longer reserve stage height; on
  phones only the active card is in layout, eliminating the large blank area
  above short reviews.
- Photos render in a responsive card grid with lazy loading and descriptive
  alt text.
- Existing arrows, dots, swipe, arrow-key navigation, live announcements,
  focus styles and reduced-motion handling remain.
- No autoplay was added.

## Footer corrections

- Removed the entire footer service-area paragraph beginning "Serving
  Pensacola, Cantonment and surrounding communities..." from
  `src/components/Footer.astro`.
- Remaining footer content moves upward.
- Follow Us remains a boxless integrated row of twelve official marks on
  transparent 44px targets, with no white circular chips.
- Logo, slogan, Matthew 5:16, navigation and contact actions remain intact.
- The shared footer still renders on every ordinary public page.

## Tampa Bay public page and inquiry

- Replaced the technical prelaunch explanation with a premium regional page:
  services, honest availability wording, service-area context and a dedicated
  Tampa inquiry form.
- Removed developer-style status language from the main presentation.
- The page remains `noindex, nofollow` until fulfillment and launch gates are
  approved.
- The inquiry form captures name, phone, email, category, service address,
  city and ZIP.
- `branch_id=branch_tampa` and `request_type=contact` are submitted; the server
  persists the lead, customer and property to Tampa and creates no booking,
  appointment, quote or payment.
- Commercial/church/property-management/STR/realtor categories are included.
- Owner notification includes the branch name and inquiry category.
- Capabilities are code-owned in `src/config/branches.ts`; inquiries and
  commercial leads are enabled for Tampa, while public estimates, scheduling,
  payments and fulfillment remain disabled.

## Service-area navigation

The `/service-area/` page now uses two professional branch cards: Pensacola
(live branch) and Tampa Bay (preparing for launch), instead of disconnected
small text links.

## Visual verification

Final local captures:

- `docs/verification/2026-11-20-reviews-footer/reviews-desktop.png`
- `docs/verification/2026-11-20-reviews-footer/reviews-dennis-desktop.png`
- `docs/verification/2026-11-20-reviews-footer/reviews-dennis-mobile.png`
- `docs/verification/2026-11-20-reviews-footer/footer-desktop.png`
- `docs/verification/2026-11-20-reviews-footer/footer-mobile.png`
- `docs/verification/2026-11-20-reviews-footer/service-area-desktop.png`
- `docs/verification/2026-11-20-reviews-footer/tampa-page-desktop.png`
- `docs/verification/2026-11-20-reviews-footer/tampa-page-mobile.png`

## Validation

- `npm run check`: 0 errors, 0 warnings, 2 pre-existing hints.
- Build: 37 pages.
- `npm run validate`: pass.
- No-fabrication audit: pass.
- Unit: **907 tests, 906 pass, 1 pre-existing skip, 0 fail**.
- Browser: **228 pass, 0 fail**.
- Targeted review/footer/Tampa tests: 16 pass.

## Production deployment

- Application code: `1d7c997`.
- Cloudflare Pages production deployment: `c6469de6-bf79-407c-a2a4-3f54c4051d35`.
- CI `validate` and `browser`: pass.

Live verification at https://sparkling-standard.com:

- 7 review cards render in the order Christina, Richard, Laura, Dennis D, K V,
  S Ismail, Rob & Christi Moore.
- No rating/count summary or selected-view disclaimer appears under the heading.
- Bob, Amanda and Elizabeth are absent.
- Dennis's two couch photos and Laura's shower photo load from the production
  image pipeline (320x480 and 320x240 rendered WebP variants).
- 12 Follow Us links render with 44 x 44 px transparent targets, 0px border
  and 0px radius.
- The footer service-area paragraph is absent.
- Tampa page loads with no delivery warning; `/api/lead-readiness` reports
  `ready: true`.
- Tampa remains `noindex, nofollow` and absent from the sitemap.
- Service-area page shows two branch cards.
- Screenshots: `live-reviews-desktop.png`, `live-reviews-dennis-desktop.png`,
  `live-reviews-dennis-mobile.png`, `live-footer-desktop.png`,
  `live-footer-mobile.png`, `live-service-area-desktop.png`,
  `live-tampa-page-desktop.png`, `live-tampa-page-mobile.png`.

## Remaining

No review text or photograph is missing from the owner-approved seven. Bob,
Amanda and Elizabeth remain excluded by instruction.
