# Initiative 6.2 visual verification

These screenshots were captured from the **local production build** of the
`initiative-6.2-complete-experience-audit` release candidate using Playwright
(Chromium) at the viewport sizes noted below. They are evidence of the
implemented site, not mockups, and are **not** screenshots of the live
production site (6.1 remains deployed until the owner approves 6.2).

| File | What it shows | Viewport |
| --- | --- | --- |
| `01-home-desktop.jpg` | Homepage: premium icon cards, trust values, reviews, footer | 1440px |
| `02-service-area-desktop.jpg` | Service area: title → concise description → coverage map | 1440px |
| `03-service-area-mobile.jpg` | Service area mobile layout and map | 390px |
| `04-reviews.jpg` | Review cards with larger stars, source label, first-name author | 1440px |
| `05-premium-icons.jpg` | Implemented inline premium icon contact sheet (all tiles) | 1.5× display |
| `06-estimate-hub.jpg` | Dedicated four-engine selection hub | 1440px |
| `07-residential-estimator.jpg` | Residential estimator at its dedicated route | 1440px |
| `08-commercial-tier-a.jpg` | Commercial guided form with a Tier A preliminary per-visit price | 1440px |
| `09-field-validation.jpg` | Commercial step validation with field-specific messages | 1440px |
| `10-church-discount.jpg` | Church 10% discount reconciliation and tax/exemption note | 1440px |
| `11-footer.jpg` | Footer: review copy, Read Our Reviews and Leave Us a Review | 1440px |
| `12-home-mobile.jpg` | Homepage mobile composition | 390px |
| `13-photo-upload-commercial.jpg` | Shared commercial photo section with a converted iPhone HEIC thumbnail, limits and remove/replace controls | 1200px |
| `14-photo-upload-church.jpg` | Shared church photo section and category set | 1200px |
| `15-photo-upload-mobile.jpg` | Photo section on a 390px phone viewport | 390px |

The photo screenshots (13–15) use a local mocked upload endpoint plus the CC0 HEIC test fixture to show the UI; they are not proof of a real Cloudflare R2 upload.

Automated coverage for these areas is in `tests/browser/initiative-6.2-content.test.mjs`,
`tests/browser/estimate-engines.test.mjs`, `tests/browser/journey.test.mjs`,
`tests/pricing-adjustments.test.ts`, `tests/facility-verify.test.ts` and the rest of
the release verification suite.
