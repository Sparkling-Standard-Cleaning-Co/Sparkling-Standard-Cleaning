# Design system

Brand direction (owner directive): **bright modern home + feminine boutique + family warmth +
subtle Southern character.** Premium, warm, trustworthy, energetic. Gold/champagne is an accent
only. The final logo/name are PENDING — the system is built so changing them is a config change,
not a redesign.

## Logo & brand assets

- The mark (`public/brand/logo-mark.svg`, rendered by `Logo.astro`) is an abstract five-petal
  rosette — floral, clean, scales to a favicon or a vehicle panel, with no clip-art mop or
  spray bottle. Faith imagery stays absent by design (tasteful and secondary — a future decision
  for the owner, not the engineering team).
- **Wordmark:** driven by `business.displayName`. While PENDING, preview builds render
  `PENDING_BUSINESS_NAME` with a preview badge; production is blocked by validation.
- Regenerate favicons/OG assets after brand changes: `node scripts/generate-brand-images.mjs`.
  Originals/alternates belong in `brand-source/` (owner-managed, not required to build).
- Do not fabricate a final name or initials. Do not add sparkle/mop clip-art. Do not make the
  site metallic.

## Typography

| Role | Face | Weights | Notes |
| --- | --- | --- | --- |
| Display/headings | **Fraunces** (variable) | 300–700 | Editorial warmth; used for h1–h4 and pull quotes |
| Body/interface | **Nunito Sans** (variable + italic) | 200–1000 | Highly readable; all controls and body text |

Self-hosted via `scripts/fetch-fonts.mjs` (SIL OFL — `docs/design/FONT-LICENSES.md`). No
cursive/script faces anywhere, especially not for prices, phone numbers or navigation.

## Color tokens (`src/styles/tokens.css`)

All color use flows through CSS variables. Never hard-code a hex value in a component.

| Token family | Role |
| --- | --- |
| `--color-cream-*` | Page and alternating-section backgrounds (warm white) |
| `--color-rose-*` | Primary brand pink — actions (`rose-700` on cream/white passes AA) |
| `--color-sage-*` | Floral green accent (checkmarks, tags) |
| `--color-champagne-*` | Restrained gold accent — borders/rules/icons only |
| `--color-ink-*` | Warm near-black text and dark bands |
| `--color-*-100/700` | Success/warning/error surfaces and text |

Rules:

- Gold is never small text on a light surface (it fails contrast); use `rose-700` or `taupe-600`.
- Body text is `--color-text` (ink-800) on cream/white — always AA or better.
- Dark bands (`section--ink`, footer, CTA band) use cream text on ink; links inside them use
  champagne-300.
- Focus outlines are a 3px `--color-focus` ring and are never removed, only offset.

## Layout

- Container: max 1120px (`--container-max`); prose measure ~736px (`--container-narrow`).
- Sections: vertical rhythm via `.section` (`clamp(3rem, 7vw, 5.5rem)`), alternating
  `.section--alt` for visual rhythm, `.section--ink` for dark bands.
- Grids: `.grid--2/3/4` use `auto-fit` with sensible minimums; mobile-first.
- Header: sticky, translucent cream, 68px tall. Mobile action bar: fixed bottom, three
  actions, respects `env(safe-area-inset-bottom)`; main content is padded to clear it.

## Components

- **Buttons** (`.btn`): pill radius, min-height 48px, `--primary` (rose), `--secondary`
  (outlined), `--ghost` (neutral); `--large` for primary CTAs; `--block` in forms.
- **Cards** (`.card`): 1px sand border, radius ~22px, soft warm shadow; `--link` variant lifts on
  hover; `--feature` has a champagne top rule; `--muted` is flat cream.
- **Option controls** (`.option`): radio/checkbox cards used throughout the estimate wizard —
  tap targets ≥ 44px, visible checked state, focus ring preserved.
- **Forms**: 48px inputs, 16px+ font (prevents iOS zoom), visible labels, inline errors,
  `.form-status` states (success/error/info) announced via `role="status"`.
- **FAQ** (`.faq-item`): native `<details>` — keyboard accessible with zero JavaScript.
- **Estimate result panel**: rose-tinted card with range, confidence note and review flags.

## Imagery

See `docs/design/IMAGE-GUIDE.md`. Real founder/work photos dominate; no stock spray-bottle
identity, no fake before/after. Photos are optimized by Astro's image pipeline with required
alt text.

## Iconography

`src/components/Icon.astro` — a closed set of 24px stroke icons (names in `src/lib/icons.ts`).
Add new names to the union; never inline one-off SVGs. Social glyphs live in
`SocialIcon.astro` and render only when a real profile URL is configured.

## Motion & accessibility

- Motion is short (140–220ms) and honors `prefers-reduced-motion` (all animation collapses).
- WCAG 2.2 AA targets: semantic landmarks, visible skip link, focus never removed, no color-only
  meaning, sticky bar never covers form controls (padding accounts for it).
- No content depends on JavaScript. The estimate flow degrades to a readable request form.

## Pending visual items

- Final logo/wordmark and brand name (owner)
- Real founder photography (owner)
- Any color re-tuning after the founder approves a palette direction
