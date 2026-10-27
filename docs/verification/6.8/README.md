# Initiative 6.8 verification evidence

**Date:** 2026-10-27
**Owner audit:** `Aaron ss website audit.docx` (three pages)
**Status:** Local release candidate; live booking and gift sales remain owner-gated.

## What the screenshots show

| File | Evidence |
| --- | --- |
| `homepage-desktop.png`, `homepage-mobile.png` | Full homepage with expanded scripture, service cards, trust strip and footer verse |
| `services-desktop.png`, `services-mobile.png` | Equal-height service-card grid; no uneven bottom edges |
| `competitive-pricing.png` | Owner-supplied two-of-four dollar-sign badge installed |
| `scripture-panel.png`, `footer-verse.png` | Reusable KJV scripture presentation |
| `estimate-reveal-desktop.png` | Branded final-calculation reveal |
| `estimate-final-desktop.png`, `estimate-final-mobile.png` | Final estimate/request summary, terms acceptance and no premature live price |
| `facility-reveal-desktop.png`, `facility-final-desktop.png` | Commercial engine uses the same reveal and final-only pricing |
| `terms-checkbox.png` | Required, unchecked-by-default terms and policy acknowledgment |
| `terms-desktop.png` | Expanded public terms and policy suite |
| `gift-certificates-desktop.png` | Gift page remains in honest request mode; no sale is claimed |

## Automated checks

- `npm run check`: 158 files, 0 errors/warnings/hints.
- `npm test`: 548 tests, 547 passed, 1 pre-existing skip, 0 failed.
- `npm run test:browser`: 148 passed, 0 failed.
- `npm run verify`: 28 pages, 1,990 internal links, all SEO/content/registry checks passed.

## Deliberate limits

- Live calendar availability is **not connected**; no slots are fabricated. Preferred dates remain
  requests.
- Gift sales are **disabled** until the owner approves denominations, fulfillment and redemption
  records.
- No new cancellation/reassessment fees are active. A Florida attorney and the owner must approve a
  written fee schedule before publication or collection.
- No live card charge or Stripe test-mode checkout was performed.
