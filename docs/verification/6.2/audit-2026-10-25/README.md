# 2026-10-25 audit corrections — visual verification

Captured from the local production build (`npm run build` → `astro preview`) with Playwright
Chromium. These are evidence of the implemented site, not mockups. Sticky header and mobile action
bar were hidden during element captures so the sections themselves are fully visible; no section
layout or typography was altered for the screenshots.

| File | What it shows | Viewport |
| --- | --- | --- |
| `01-services-desktop.jpg` | Six core services, three balanced columns, Church Cleaning card | 1440px |
| `02-services-1024.jpg` | Three-column service composition at the small-desktop boundary | 1024px |
| `03-services-tablet.jpg` | Two-column service flow | 820px |
| `04-services-mobile.jpg` | One-column service cards and Church Cleaning | 390px |
| `05-community-desktop.jpg` | Community Support spotlight, eligibility groups and CTA | 1440px |
| `06-community-tablet.jpg` | Community Support spotlight at tablet width | 820px |
| `07-community-mobile.jpg` | Wrapped CTA and list without clipping or page overflow | 390px |
| `08-reviews-desktop.jpg` | Centered Google-gold stars, source cue, names anchored at card bottoms | 1440px |
| `09-reviews-mobile.jpg` | Mobile review card with centered stars and attribution | 390px |
| `10-footer-desktop.jpg` | Read Our Reviews magnifying-glass icon and Leave Us a Review Google action | 1440px |
| `11-contact-desktop.jpg` | Concise privacy note with the privacy-policy link | 1440px |
| `12-contact-mobile.jpg` | Mobile contact form with the same privacy note | 390px |

The local preview contact form honestly reports that message delivery is not configured in a
preview build. Production delivery is configured separately; the screenshots verify the visible
copy and layout only.

Automated coverage: `tests/browser/homepage-audit.test.mjs` (six cards, Church CTA/photo,
community spotlight and mobile containment, footer icon, contact copy), and
`tests/browser/review-carousel.test.mjs` (Google-gold stars, centering, bottom-aligned names,
carousel behavior and reduced motion).
