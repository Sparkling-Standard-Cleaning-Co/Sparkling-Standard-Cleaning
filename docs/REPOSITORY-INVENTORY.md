# Repository inventory — Sparkling Standard

Audited 2026-10-25 for Initiative 6.4. This is the map of what is active, what
was archived, and what intentionally lives outside Git. It is not a second set
of operating instructions; start at
[START HERE — OWNER CONTROL CENTER](../START-HERE-OWNER-CONTROL-CENTER.md).

## Active source map

| Area | Purpose | Notes |
| --- | --- | --- |
| `src/pages/` | Astro routes and thin page wrappers | Content/arithmetic live outside pages |
| `src/components/` | Shared UI components | `PremiumIcon` is the sole white-tile renderer |
| `src/layouts/` | Base page shell | |
| `src/content/` | Services, site copy, FAQs, reviews, checklists | Zod-validated; internal checklists never public |
| `src/config/` | Business facts, content schemas, estimator config, geography, scheduling | `estimators/` is the owner editing home |
| `src/config/estimators/` | Raw pricing values, input definitions, travel, commercial switch | Canonical; `index.ts` is a map only |
| `src/lib/` | Estimator, location, travel, forms, analytics, schema, photos | Calculation code, not owner settings |
| `src/scripts/` | Small browser enhancements | No client framework |
| `src/styles/` | Design tokens and component styles | Tokens are the color/spacing source |
| `src/assets/images/` | Website photography | Licences in the image register |
| `src/assets/icons/white-tile/` | 17 approved WebP icons | PNG masters are local |
| `functions/api/` | Cloudflare Pages Functions | Secrets only in Cloudflare |
| `tests/` | Node and Playwright regression suites | Unit + real browser |
| `scripts/` | Verification, calibration, marketing, print, growth tools | See `scripts/README.md` |
| `assets/` | Print/release source assets that must travel with code | `assets/owner/Headshot.jpg` is the print source |
| `deploy/` | Example deployment configuration only | No live secrets |

## Documentation map

- Owner front door: `START-HERE-OWNER-CONTROL-CENTER.md`
- Owner manual: `docs/OWNER-OPERATIONS-MANUAL.md`
- Estimator manual: `docs/ESTIMATOR-CONTROL-CENTER.md`
- System hub: `docs/OPERATIONS-HUB.md`
- Verification/release evidence: `docs/verification/VERIFICATION.md`
- Current platform status: `docs/operations/PLATFORM-STATUS.md`
- Deployment/secrets: `docs/deployment/DEPLOYMENT.md`
- Brand/photo/icon records: `docs/design/`
- Marketing strategy and execution: `docs/marketing/`
- SEO: `docs/seo/`
- Historical decisions: `docs/archive/`

## What changed in this audit

### Moved into the estimator control center

| Before | After |
| --- | --- |
| `src/config/owner-pricing.ts` | `src/config/estimators/pricing-values.ts` |
| `src/config/travel.ts` | `src/config/estimators/travel.ts` |
| `src/config/commercial-tiers.ts` | `src/config/estimators/commercial.ts` |
| Input options inline in forms | `src/config/estimators/input-definitions.ts` |

`src/config/pricing.ts` remains the typed approval/notes wrapper. No pricing
value or formula was changed by the move.

### Archived, not active

| Item | Location | Reason |
| --- | --- | --- |
| Earlier premium vector icon register | `docs/archive/design/PREMIUM-ICON-REGISTER-2026-10-24.md` | Superseded by the white-tile inventory |
| Earlier commercial estimate model | `docs/archive/launch/COMMERCIAL-ESTIMATE-MODEL-2026-10-24.md` | Historical modelling; current model is the estimator docs |

### Removed from active source

- `src/components/ProofGrid.astro` — unreferenced component; the `proof`
  collection remains intentionally empty until genuine proof exists. Git history
  preserves the file.
- `src/assets/icons/premium/` — 32 superseded SVG files. The owner-supplied set
  is preserved in the local master archive and in Git history.
- Owner source files that were untracked and should not deploy (`public/` social
  covers, profile images, raw portrait duplicate, LLC template, private handoff,
  GTM history JSONs) were moved to the local master archive.

### Added

- Owner control center, estimator control center, owner operations manual.
- Input definition registry and estimator directory README/index.
- White-tile icon inventory and the owner contact sheet.
- Scripts orientation map and this inventory.
- 12 audit-correction screenshots (6.2 audit folder), 11 Initiative 6.3
  visual-evidence files (including the before/after location helper and the
  labeled 17-icon inventory) and the 18 Initiative 6.4 verification files.

## Dependencies

Production: `astro`, `@astrojs/sitemap`, `heic2any`, `maplibre-gl`.
Development: `@astrojs/check`, `jsqr`, `playwright`, `pngjs`, `qrcode`,
`typescript`.

Each is used by the site, tests, QR verification or print tooling. No unused
dependency was identified in this audit; do not remove one without searching all
scripts and tests.

## Intentionally outside Git

- The active repository's local master home (see the master directory guide).
- Original 1254 px icon PNGs, raw social covers, founder photo originals.
- Business HQ, legal documents, vendor exports and audit source files.
- Runtime/generated outputs: `dist/`, `.astro/`, `.wrangler/`, `canvass-out/`,
  `confirmation-out/`, `gift-out/`, `invoice-out/`, `indexnow-out/`,
  `node_modules/`.
- Customer photos and private operating coordinates. These never belong in Git.

## Deliberate non-changes

- Pricing values, discounts, minimums, calibrations and production assumptions
  were not repriced by the organization refactor.
- The `proof` and `reviews` publication rules are unchanged: no fabricated
  material.
- Cloudflare secrets, deployment settings and DNS were not modified.
- The separate `PensacolaCleaningcompany` and Sunshine Climate repositories were
  not modified; they are outside this product repository.
