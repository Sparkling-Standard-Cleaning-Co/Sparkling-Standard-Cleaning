# SEO strategy (canonical)

One strategy document. Git history is the archive — never create competing "master plan" files.

## Owning pages (one per query cluster)

| Query cluster | Owning page | Primary intent |
| --- | --- | --- |
| house cleaning pensacola / one-time cleaning | `/house-cleaning/` | Residential standard clean |
| recurring house cleaning / weekly / biweekly | `/recurring-cleaning/` | Recurring service |
| deep cleaning | `/deep-cleaning/` | Detail reset |
| move out cleaning / move in cleaning | `/move-in-move-out-cleaning/` | Walkthrough-driven cleaning |
| airbnb cleaning / vrbo turnover | `/short-term-rental-cleaning/` | STR turnovers |
| commercial cleaning / office cleaning | `/commercial-cleaning/` | Commercial walkthrough requests |
| church cleaning | `/church-cleaning/` | Faith facilities |
| cleaning estimate / price | `/estimate/` | Conversion page (no pricing claims) |
| service area coverage | `/service-area/` | Coverage questions |
| FAQ intents | `/faq/` | Long-tail questions |

Do not create a second page for a cluster. Do not create city pages
(`pensacola-house-cleaning`, `cantonment-house-cleaning`, …) — see the no-doorway policy below.

## No-doorway policy

Location pages are created only when there is **genuine, unique, locally substantive content**
— real service detail, real access considerations, real local relevance supplied or approved by
the owner. Thin duplicated city pages are prohibited. The approved broad coverage language
lives in `business.serviceArea.summary` and on `/service-area/`.

## Internal linking

- Every service page links to related services and to `/estimate/`.
- `/faq/` links out to owning pages from relevant answers through shared categories.
- Footer links every service; header keeps the seven high-priority entries.
- Service pages carry breadcrumbs (Home → page) with `BreadcrumbList` schema.
- Anchor text is descriptive; never "click here".

## Local SEO foundation

Prepared for: Google Business Profile, Bing Places, Apple Business Connect, local citations,
review acquisition and NAP consistency. None of these are claimed as existing — the profile
setup checklist lives in `docs/marketing/CONTENT-OPERATING-SYSTEM.md` (§Week 1) and the launch
blockers in `docs/launch/OWNER-INPUT-REQUIRED.md`.

Rules:

- `LocalBusiness` structured data uses only owner-approved facts; PENDING values are omitted.
- No `AggregateRating`/`Review` markup until genuine reviews exist and are visible.
- Review counts are never displayed as numbers unless verified by the owner.

## Structured data decisions (verified against schema.org)

- **`CleaningService` is NOT a valid schema.org type** (`https://schema.org/CleaningService`
  returns 404 as of September 2026). Do not "upgrade" to it because a blog post suggested it.
- The global business entity uses **`LocalBusiness`** — the most specific valid type available
  (HomeAndConstructionBusiness subtypes cover HVAC, plumbing, roofing, painting, etc., none of
  which describe cleaning).
- Service pages use **`Service`** with `provider` referencing the business entity.
- FAQ pages use **`FAQPage`** — only for FAQ content that is visibly rendered on that page.
- Breadcrumbs use **`BreadcrumbList`**.
- Review/rating schema is deliberately absent until genuine reviews exist (never fabricate).

## Technical SEO

- `output: 'static'`, `trailingSlash: 'always'`, canonical URLs from `PUBLIC_SITE_URL`.
- Canonicals never contain UTMs or query strings; the site never persists UTMs across
  navigation.
- `robots.txt` is environment-aware: production allows all + sitemap; preview is
  `noindex, nofollow` + `Disallow: /` (both via `PUBLIC_PREVIEW_MODE=true`).
- Sitemap excludes `/404`, `/thank-you/`, `/leave-review/` (noindex utility pages).
- Automatic checks (`npm run seo`, `npm run links`, `npm run validate`): unique titles and
  descriptions, one `<h1>` per page, canonical shape, robots correctness, valid JSON-LD,
  sitemap contents, internal-link resolution.
- Performance targets (Astro static output, self-hosted subset fonts, minimal bundled JS,
  responsive images, no hero video): mobile LCP ≤ 2.0s on a mid device. Lighthouse lab runs are
  documented as pending in `docs/verification/VERIFICATION.md`.

## Metadata rules

- Every page sets a unique `metaTitle` + `metaDescription` through `BaseLayout` → `BaseHead`.
- Titles may use location ("Pensacola & Cantonment") where true; never keyword-stuff.
- OG image: `public/brand/og-default.png` (regenerate after brand changes).

## Launch indexing checklist

1. `PUBLIC_SITE_URL` set to the real domain (production), `PUBLIC_PREVIEW_MODE` unset.
2. `npm run build && npm run pending` → passes (no placeholder facts).
3. `npm run validate:production` → passes.
4. robots.txt shows `Allow: /` + sitemap; a live URL's meta robots is `index, follow`.
5. Submit sitemap in Google Search Console + Bing Webmaster Tools.
6. Create/populate the Google Business Profile (name, category, area, hours, phone, website
   with the GBP campaign link from `docs/marketing/UTM-MASTER-LINKS.md`).
7. Verify rich results (LocalBusiness/Service/Breadcrumb/FAQ) with Google's Rich Results Test.
8. Optional: `node scripts/indexnow.mjs --all` with `INDEXNOW_KEY` configured.
9. Recheck after 72h: indexed page count, coverage errors, canonical warnings.

## Future content (only when justified)

- More FAQ coverage from real customer questions (highest-value SEO content, lowest risk).
- Genuine proof entries (before/after) — content that ranks for detail-oriented queries.
- A leave-review utility page once a real review profile exists.
- Expanded service-area content only with owner-approved, locally substantive material.
