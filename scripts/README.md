# Scripts directory

All commands are run from the repository root. This file is an orientation map,
not a second source of truth; `package.json` holds the exact command names.

## Verification and release

| Script | Purpose |
| --- | --- |
| `scripts/validate-site.mjs` | Orchestrates links, SEO, homepage copy, marketing/QR, GTM and checklist checks |
| `scripts/links.mjs` | Internal link validation of `dist/` |
| `scripts/verify-seo.mjs` | Canonicals, titles, robots, sitemap and structured data |
| `scripts/smoke.mjs` | Required-page smoke test |
| `scripts/live-check.mjs` | Production reachability/configuration check |
| `scripts/check-pending-facts.mjs` | Blocks unresolved PENDING facts |
| `scripts/check-fake-testimonials.mjs` | Blocks fabricated review fixtures |
| `scripts/audit-facts.mjs` | Human-review audit of potentially unsupported claims |
| `scripts/check-homepage-audit.mjs` | Guards the approved homepage service copy |

## Estimator and pricing

| Script | Purpose |
| --- | --- |
| `scripts/quote-preview.mjs` | Representative quote comparison |
| `scripts/estimate-scenarios.mjs` | Estimator scenario inventory |
| `scripts/discount-impact.mjs` | Discount financial impact |
| `scripts/promotions-impact.mjs` | Promotion proposal impact |
| `scripts/commercial-calibration.ts` | Commercial/church calibration |
| `scripts/facility-calibration-report.ts` | Calibration report |
| `scripts/test-mapmap.mjs` | Travel provider check |
| `scripts/address-live-check.mjs` | Live address-pipeline check |

## Marketing, print and growth

| Path | Purpose |
| --- | --- |
| `scripts/generate-marketing-links.mjs` | UTM docs and QR registry |
| `scripts/generate-gtm-import.mjs` | GTM import artifacts |
| `scripts/print/` | Brand-locked print masters and PDF/PPTX generation |
| `scripts/canvass/` | Neighborhood/route data generation (outputs git-ignored) |

## Brand assets

| Script | Purpose |
| --- | --- |
| `scripts/generate-logo-assets.mjs` | Regenerates favicon/PWA/social assets from the approved logo |
| `scripts/fetch-fonts.mjs` | Refreshes self-hosted fonts |
| `scripts/gift-certificate.mjs` | Printable gift certificate |
| `scripts/customer-confirmation.mjs` | Customer confirmation tooling |
| `scripts/commercial-invoice.mjs` | Commercial invoice generation |

## Housekeeping rules

- Generated outputs (`dist/`, `canvass-out/`, `gift-out/`, `invoice-out/`,
  `confirmation-out/`, `indexnow-out/`, `.astro/`, `.wrangler/`) are git-ignored
  or disposable.
- Do not move scripts casually: `package.json`, tests and documentation refer to
  these paths. Add a new script to this map and to `package.json` when it becomes
  a supported workflow.
- Never put secrets in a script or its output.
