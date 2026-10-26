# Initiative 6.3 visual verification

> Historical record. The footer magnifier and two icon tiles were superseded by Initiative 6.4; see `../6.4/`.

Captured from the local production build (`npm run build` → `astro preview`) with
Playwright Chromium at the sizes noted below. The header, mobile action bar and
consent banner were hidden only for section captures; no section layout was
altered for the screenshots.

| File | What it shows | Viewport |
| --- | --- | --- |
| `00-before-location-helper.jpg` | Owner audit excerpt showing the GPS helper paragraph that was removed | 1100 px |
| `01-services-desktop.jpg` | Six service cards with the new white-tile icons | 1440 px |
| `02-values-desktop.jpg` | Locally Owned, Flexible Scheduling, Christian Values and exact Competitive Pricing tile | 1440 px |
| `03-community-desktop.jpg` | Community Support icon, five eligibility groups and CTA | 1440 px |
| `04-review-cta-desktop.jpg` | Read Our Reviews icon, authentic review carousel and Google CTA | 1440 px |
| `05-supportive-eligibility.jpg` | Five Supportive Home eligibility cards with icons 13–17 | 1440 px |
| `06-after-location-clean.jpg` | The same address section after the helper paragraph was removed | 1440 px |
| `07-services-mobile.jpg` | One-column service cards and icons on a phone | 390 px |
| `08-values-mobile.jpg` | Trust values with the new tiles on a phone | 390 px |
| `09-community-mobile.jpg` | Community Support spotlight and CTA on a phone | 390 px |
| `10-all-17-icons.jpg` | Labeled inventory of all 17 implemented assets and placements | 1320 px |

Before/after pairing: the retired premium vector icons are visible in
`docs/verification/6.2/audit-2026-10-25/01-services-desktop.jpg`; the white-tile
implementation is in `01-services-desktop.jpg` here. The removed location helper
is visible in `00-before-location-helper.png`; the cleaned form is
`06-after-location-clean.jpg`.

The small footer “Read Our Reviews” button intentionally keeps the simple vector
magnifying glass, per the owner icon pack’s implementation guide. The new
Read Our Reviews tile is used as the larger reviews-section icon.

Automated coverage: `tests/icon-inventory.test.ts`,
`tests/estimator-config-integrity.test.ts`,
`tests/browser/homepage-audit.test.mjs`,
`tests/browser/initiative-6.2-content.test.mjs` and the full regression suites.
