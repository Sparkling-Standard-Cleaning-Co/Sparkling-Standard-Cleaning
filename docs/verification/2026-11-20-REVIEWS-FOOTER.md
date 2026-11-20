# Reviews carousel and footer refinement - 2026-11-20

## Review audit

The Google Business Profile currently shows **5.0 from 10 reviews**.
Google Maps exposes five reviews to a signed-out browser; the remaining five
require a signed-in Google session or the owner's screenshots.

Verified and included (7):

1. Christina - residential cleaning (existing owner-supplied review).
2. Richard - deep cleaning (existing owner-supplied review).
3. Laura - residential cleaning; full text re-verified on the public profile.
4. Dennis - residential cleaning / upholstery add-on (newly visible).
5. Amanda - residential cleaning (newly visible).
6. Elizabeth - residential cleaning (newly visible).
7. Rob & Christi - recurring residential cleaning (newly visible).

Excluded by owner instruction (1): **Bob**.

Could not verify exact public wording (2): **K V** and **S Ismail**. Both are
shown in the owner's screenshots and the public profile count, but their full
review text is behind Google's signed-out review limit. They were **not
invented or paraphrased**.

The carousel therefore states the true 5.0 / 10 profile total and separately
states that 7 verified reviews are shown. It explicitly says the carousel is a
selected view, not a complete copy of the profile.

## Implementation

- New verified review entries:
  - `src/content/reviews/dennis.md`
  - `src/content/reviews/amanda.md`
  - `src/content/reviews/elizabeth.md`
  - `src/content/reviews/rob-and-christi.md`
- Existing review entries keep verbatim quote text with first-name-only public
  attribution. Laura's corrupted apostrophe was repaired to the original curly
  apostrophe.
- `src/components/Reviews.astro` now shows the overall Google rating separately
  from the displayed count, adds reviewer context, exposes a keyboard-focusable
  carousel stage with instructions, and keeps the existing no-JS stacked view.
- The existing layered-card design, dots, arrows, swipe, reduced-motion and
  live-region behavior remain. No autoplay was added.
- `src/components/SocialLinks.astro` and the footer CSS remove the white
  circular chips. Official marks now sit on transparent 44px targets at 32px.
- The Follow Us block is a boxless, integrated section beneath the footer
  masthead. Black marks receive a subtle light outline for contrast; coloured
  marks keep their official brand colours.
- The shared `Footer.astro` is rendered by `BaseLayout`, so Follow Us appears on
  every ordinary public page, including estimator pages. Private/admin and
  signature-only pages keep their exclusions.

## Social registry verification

Twelve confirmed profiles render from `src/config/business.ts`:

Google Business Profile, Facebook, Nextdoor, Instagram, TikTok, YouTube,
Pinterest, Rumble, Gab, Parler, Locals and X.

Every link keeps `target="_blank"`, `rel="noopener noreferrer"`, an explicit
accessible name and no outbound UTM parameters. No pending platform renders.

## Visual verification

Screenshots saved in `docs/verification/2026-11-20-reviews-footer/`:

- `reviews-desktop.png`
- `reviews-mobile.png`
- `footer-desktop.png`
- `footer-mobile.png`
- `footer-commercial.png`
- `footer-church.png`
- `footer-estimator.png`

Checked desktop and mobile review cards, 7 dots/controls, all seven reviews,
Bob absent, no duplicated reviews, footer icon row, no white chips, and no
horizontal overflow. Commercial, church and residential-estimator footers use
the same shared component.

## Validation

- `npm run check`: 0 errors, 0 warnings, 2 pre-existing hints.
- Build: 37 pages.
- `npm run validate`: pass (links, SEO, QR, GTM, checklist leak).
- Unit: 906 tests, 905 pass, 1 pre-existing skip, 0 fail.
- Browser: 226 pass, 0 fail.
- Targeted review/footer tests: 14 pass.

## Remaining

K V and S Ismail exact review text is still required to reach the expected 9
displayed reviews. Bob remains intentionally excluded. No review text was
fabricated.
