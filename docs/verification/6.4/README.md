# Initiative 6.4 visual verification

Captured from the local production build (`npm run build` + `astro preview`) with
Playwright Chromium at the sizes below. The sticky header, mobile action bar and
consent banner were hidden only for section captures; no section layout was
altered for the screenshots. The mobile-menu capture is the one exception: the
header is shown with its menu open.

| File | What it shows | Viewport |
| --- | --- | --- |
| `00-before-map-audit.png` | Owner-audit excerpt: the old tightly cropped map, pink/green policy colours, missing context counties and “Gulf Of Mexico” | 1462 × 720 |
| `01-map-desktop.jpg` | Expanded 18-county Census map; green core, yellow dashed arrangement, neutral context, city labels and “Gulf Of America” over the water | 1440 px |
| `02-map-tablet.jpg` | The same map and full legend at tablet width | 768 px |
| `03-map-mobile.jpg` | Phone map with county labels suppressed to prevent collisions; city labels, legend and the county-naming note remain | 390 px |
| `04-values-desktop.jpg` | Centered four-value banner; Competitive Pricing keeps the exact four-dollar-sign tile | 1440 px |
| `05-values-mobile.jpg` | One-column centered value sequence on a phone | 390 px |
| `06-footer-desktop.jpg` | Four-column footer with glasses review action, exact review sentence and the four contact buttons in order | 1440 px |
| `07-footer-mobile.jpg` | Mobile footer actions and single-line hours | 390 px |
| `08-reading-glasses-footer.jpg` | Footer reading-glasses vector at 24 px and the exact centered review invitation | 1440 px |
| `09-reading-glasses-reviews.jpg` | Reviews heading with the replacement reading-glasses white-tile icon | 1440 px |
| `10-community-red-white-blue.jpg` | Community groups with the replacement red/white/blue “Other eligible community members” tile | 1440 px |
| `11-bible-belt-copy.jpg` | Southern Hospitality copy with the explicit Bible Belt/neighbour wording | 1440 px |
| `12-founder-copy.jpg` | Founder section using “The founder of Sparkling Standard” in both paragraphs | 1440 px |
| `13-deep-card-and-grid.jpg` | Shortened Deep Cleaning card inside the three-column service layout | 1440 px |
| `14-header-1024.jpg` | Desktop header at 1024 px with Service Area and FAQ present and no overflow | 1024 px |
| `15-mobile-menu-390.jpg` | Open mobile menu with Service Area and FAQ between the cleaning services and Reviews | 390 px |
| `16-community-support-page.jpg` | Canonical `/supportive-home-cleaning/` page with the public Community Support Cleaning name | 1440 px |
| `17-icon-inventory.jpg` | Current 17 white-tile assets after the 08 and 17 substitutions | 1000 px |

Before/after pairing: the map in `00-before-map-audit.png` is the owner’s
2026-10-25 audit excerpt; `01-map-desktop.jpg` is the expanded implementation.
The retired v6.3 review magnifier and the original community tile remain
archived locally under `99-Archive-For-Review/`, not in the public repository.

The phone map intentionally suppresses county labels: at 390 px the core,
arrangement and context names collided. The legend keeps the three policy
colours, and the note directly below names all four policy counties. Desktop
labels are collision-tested at 1440 px.

Automated coverage for this increment (all run on the local production build):

- `tests/browser/initiative-6.4-content.test.mjs` — map layers, continuity,
  desktop label collisions, water label, phone suppression, centered values,
  Community Support naming and Bible Belt copy.
- `tests/browser/homepage-audit.test.mjs` — footer reading-glasses vector,
  contact-button order and service-card content.
- `tests/browser/header-about.test.mjs` — desktop Service Area/FAQ fit and
  mobile menu links.
- `tests/pricing-adjustments.test.ts`, `tests/estimator-config-integrity.test.ts`
  — four independent calibration factors, default parity, isolation, bounds and
  fail-closed behavior.
- `npm test` — 500 tests, 499 pass, 1 pre-existing skip, 0 fail.
- `npm run check` — 0 errors, 0 warnings, 0 hints.
- `npm run test:browser` — 136 tests, 136 pass, 0 fail.
- `npm run verify` — check, build (26 pages) and site validation pass.
