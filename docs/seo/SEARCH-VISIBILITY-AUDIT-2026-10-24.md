# Search Visibility & Local SEO Audit — 2026-10-24

Initiative 5.0 (Google Search Visibility, Local SEO, Competitive Growth & Premium Customer
Reviews). Evidence dates: live production checks and implementation on **2026-10-24**.
Companion documents: `docs/seo/SEO-STRATEGY.md` (strategy/ownership),
`docs/operations/SEARCH-CONSOLE-SETUP.md` (owner diagnostics), `docs/operations/PLATFORM-STATUS.md`.

> **Evidence rules.** Only verified facts are stated as facts. Anything requiring authenticated
> Google/Bing/GBP access is explicitly labelled **Requires authenticated account access**. No
> ranking, traffic, review-count or competitor metric is invented. A deployment response is not
> proof that Google has indexed anything.

## 1. Production technical audit (verified 2026-10-24)

Checked against the live site (HTTP headers + rendered HTML) after the 2026-10-24 release.

### 1.1 URL results

| URL | HTTP | Canonical | robots meta | X-Robots-Tag |
| --- | --- | --- | --- | --- |
| `/` | 200 | correct | `index, follow` | none |
| `/robots.txt` | 200 | n/a | n/a | none |
| `/sitemap-index.xml` → `/sitemap-0.xml` | 200 | n/a | n/a | none |
| `/house-cleaning/` | 200 | correct | `index, follow` | none |
| `/recurring-cleaning/` | 200 | correct | `index, follow` | none |
| `/deep-cleaning/` | 200 | correct | `index, follow` | none |
| `/move-in-move-out-cleaning/` | 200 | correct | `index, follow` | none |
| `/short-term-rental-cleaning/` | 200 | correct | `index, follow` | none |
| `/commercial-cleaning/` | 200 | correct | `index, follow` | none |
| `/church-cleaning/` | 200 | correct | `index, follow` | none |
| `/supportive-home-cleaning/` | 200 | correct | `index, follow` | none |
| `/service-area/` | 200 | correct | `index, follow` | none |
| `/about/` | 200 | correct | `index, follow` | none |
| `/contact/` | 200 | correct | `index, follow` | none |
| `/estimate/` | 200 | correct | `index, follow` | none |
| `/faq/` | 200 | correct | `index, follow` | none |

- One `<h1>` per page; unique titles and descriptions across all 22 built pages.
- Every audited page carries valid JSON-LD: `LocalBusiness` + `OpeningHoursSpecification`
  (07:00–19:00, seven days — matching owner-approved hours) + `BreadcrumbList`, plus `Service`
  and `FAQPage` where applicable. **No** `AggregateRating` or `Review` markup is emitted
  (correct: Sparkling Standard does not manufacture star-rich snippets).
- The hidden private address is absent from structured data (`hasAddress: false`).
- Sitemap contains 17 URLs and excludes `/thank-you/`, `/leave-review/`,
  `/gift-certificates/redeem/`, `/gift-certificates/success/` and `404`.
- All four utility pages deliberately carry effective `noindex, nofollow`.
- Preview builds remain `noindex` (`PUBLIC_PREVIEW_MODE`), canonicals always use
  `PUBLIC_SITE_URL` (production origin verified).

### 1.2 Verified healthy

- Crawlability: `robots.txt` allows all crawling and declares the sitemap.
- Indexability: no production page carries an effective `noindex`; no `X-Robots-Tag` blocks
  search engines.
- Canonicals: absolute, correct origin, correct path, no duplicate canonical targets.
- Titles/descriptions present and unique on every page; local intent present on all service
  pages after this release.
- Structured data parses; LocalBusiness identity consistent (name, phone `(850) 426-8479`,
  logo, social profiles); area served = Pensacola, Cantonment, surrounding communities, select
  nearby Alabama; private address hidden.
- Internal links: six primary service pages are linked from the estimator and navigation;
  contextual service-to-service links added this release (deep ↔ recurring, commercial ↔ church,
  house → recurring/deep/estimate).
- Review section content is server-rendered (readable without JavaScript) and the verified
  Google reviews link is intact.

### 1.3 Verified problems corrected this release

1. **Homepage title** was brand-only (`Sparkling Standard | Pensacola & Cantonment`) with no
   service/category wording. Now `Cleaning Company in Pensacola, FL | Sparkling Standard`.
2. **Homepage meta description** claimed "five cleaning services", implying a smaller offering
   than the seven legitimate categories. Rewritten to name recurring, deep, move-in/move-out,
   short-term rental, commercial and church cleaning.
3. **Thin local intent in supporting titles**: About, Contact and Supportive Home Cleaning titles
   lacked local/service wording. Improved.
4. **SEO validator defect** (`scripts/verify-seo.mjs`): the robots check used
   `content.includes('index')`, which incorrectly accepts `noindex`. Replaced with directive
   parsing (`scripts/lib/seo-checks.ts`): comma/semicolon/space separated tokens, case-insensitive,
   `none` = noindex+nofollow, conflicting `index`/`noindex` resolves to the most restrictive.
   The validator now also detects duplicate canonicals, wrong canonical origins, stale sitemap
   URLs and sitemap/noindex contradictions. Eight regression tests added
   (`tests/seo-checks.test.ts`).
5. **Reviewer surname exposure**: review cards published full surnames and file names carried
   them. Public attributions are now first names only (Christina · Richard · Laura); the third
   authentic review (Laura) was added with her exact words; her five-star rating was verified on
   the owner-supplied Google Maps contributor profile (2026-10-24) and renders with the other
   two, whose words and ratings are unchanged.
6. **Navigation consistency**: Church Cleaning is now reachable from the desktop cleaning
   dropdown and footer (fixed earlier in the same session); the homepage still shows exactly
   five primary service cards.

### 1.4 Suspected problems (not yet provable from outside)

- **Search-engine index visibility is not established.** A web search for
  `site:sparkling-standard.com` through the research provider returned **zero results**, and a
  brand query did not surface the site or its Google Business Profile. This is consistent with a
  new domain lacking accumulated indexation/authority, but it does **not** prove Google has
  excluded the site. Confirm in Google Search Console (Coverage + URL Inspection).
- **Competitive authority gap**: established competitors display far more Google review volume
  (e.g., Cynsational Clean advertises 165 Google reviews; Sparkling Home Cleaner 44). Three
  authentic reviews cannot match that prominence yet — it must be earned over time.
- **Maps/local-pack competition**: established companies with longer history and review volume
  will outrank a new service-area business for broad "cleaning company Pensacola" queries.
  Local ranking is relevance + distance + prominence; there is no legitimate shortcut.
- **GBP category/service configuration, photos and posts** cannot be inspected without account
  access; owner action required.

### 1.5 Requires authenticated account access

- Google Search Console: indexed/non-indexed URL lists, exclusion reasons, Google-selected
  canonicals, sitemap processing, crawl errors, impressions, clicks, positions, queries,
  Core Web Vitals reports.
- Google Business Profile: categories, services, description, hours, service-area settings,
  photo inventory, Q&A, performance (calls, website clicks, direction requests, searches).
- Bing Webmaster Tools / Bing Places, Apple Business Connect, Yelp for Business: existence and
  claim status of listings.

## 2. Keyword → page ownership (preserved, no doorway pages)

| Intent cluster | Owning page |
| --- | --- |
| cleaning company Pensacola / professional cleaning | `/` (now titled for it) |
| house cleaning / house cleaners / maid service Pensacola | `/house-cleaning/` (informational; routes to the real services) |
| recurring / weekly / biweekly / monthly house cleaning | `/recurring-cleaning/` |
| deep cleaning / detailed one-time cleaning | `/deep-cleaning/` |
| move-in / move-out / apartment cleaning | `/move-in-move-out-cleaning/` |
| Airbnb / VRBO / vacation-rental turnover | `/short-term-rental-cleaning/` |
| commercial / office / janitorial cleaning | `/commercial-cleaning/` |
| church cleaning | `/church-cleaning/` |
| supportive home cleaning | `/supportive-home-cleaning/` |
| service area / coverage (Pensacola, Cantonment, Alabama) | `/service-area/` |
| pricing questions / estimate | `/estimate/` + `/faq/` |

Long-tail questions (first deep clean, weekly vs biweekly, move-out requirements, water-mark
removal, price factors) belong in FAQ entries and future evidence-based articles — not in thin
city landing pages. **House Cleaning is not bookable and must not return to the estimator.**

## 3. Competitor observations (public search results, 2026-10-24)

Observed while researching broad residential queries with the available search provider. These
are qualitative observations, not measured rankings; no organic-position numbers are invented.

| Competitor | Observed strengths | Notable gaps / notes |
| --- | --- | --- |
| housecleanpensacola.com ("House Cleaning") | Exact-match domain, Pensacola address, estimate requests, dedicated service pages, HomeGuide listing | Generic brand; heavy repetition |
| Pensacola Maids | Cantonment location page, service comparison table, online booking, multi-city pages | Franchise-style, broad service area |
| Cynsational Clean | 165 Google reviews embedded (Trustindex), before/after photos, 10+ years experience, local service-area copy | Dated visual design |
| Pensacola Cleaner | Instant online quotes and simple booking, residential + commercial | Less depth on detailed standards |
| The Cleaning Authority – Pensacola | Franchise authority, ZIP-level service-area pages, review page | Corporate tone; less personal |
| Dirt Busters of Pensacola | Family-owned story, licensed/bonded/insured claims, testimonials, established phone/brand | Older site |
| Starin Cleaning Services | Founded 2023, founder story, TikTok presence, testimonials | Still building review volume |
| Southern Standard Cleaning LLC | Package pricing (Bronze), service locations | Name similarity creates brand-confusion risk for us |
| Juniper Cleaning Co. | Eco/women-owned positioning, fifth year, residential + STR + commercial | Narrow differentiation |
| 360clean | Commercial/janitorial franchise with medical-grade positioning | Not a residential competitor |

**Where Sparkling Standard is stronger:** transparent instant estimate with server-verified
pricing; owner-operated personal review; explicit detailed-cleaning standards; required deep
first visit and two-price recurring transparency; genuine review wording displayed; fast,
accessible static site; broad legitimate service mix (residential, STR, commercial, church,
supportive).

**Where it is weaker:** domain age/authority, review volume (3 vs dozens/hundreds), backlinks,
GBP age and photo/post activity, brand recognition, published service history. These are earned
over time — not fixable by markup.

**Immediate opportunities:** keep technical eligibility perfect (done); publish genuinely useful
local content answering real customer questions; ask every satisfied customer for a Google
review (owner action); add real completed-work photos with permission; consistent citations.
**Long-term moat:** recurring-customer base, authentic reviews, owner-led content, community
relationships, and the transparent estimate experience.

## 4. Google Business Profile recommendations (owner executes; no account changes made)

1. **Public name:** `Sparkling Standard` exactly. Replace any lingering
   "Sparkling Standard Cleaning Co." display names (do not alter legal records). Never add
   keywords to the GBP name.
2. **Primary category:** House cleaning service. Secondary (only where genuinely applicable):
   Commercial cleaning service, Janitorial service, Deep cleaning service.
3. **Description:** lead with owner-operated residential & commercial cleaning in Pensacola and
   Cantonment; mention the required deep first visit, transparent estimates, and service mix;
   keep under Google's 750-character limit; no keyword stuffing.
4. **Services:** list Recurring Residential Cleaning, Deep Cleaning, Move-in/Move-out Cleaning,
   Short-term Rental Turnover, Commercial Cleaning, Church Cleaning, Supportive Home Cleaning.
   Do not list "House Cleaning" as a bookable service.
5. **Hours:** seven days, 7:00 a.m.–7:00 p.m. (owner-approved). Update Nextdoor and any external
   listing still showing 8:00 a.m.–6:00 p.m.; treat the central config as authoritative.
6. **Service areas:** Pensacola, Cantonment, surrounding communities, select nearby Alabama —
   matching `src/config/geography.ts`. Service-area business; keep the address hidden.
7. **Photos:** real founder/work photos only, with customer permission; no stock interiors in
   GBP; add a few new genuine photos monthly.
8. **Reviews:** reply to every review within 48 hours, personally, without incentives.
   Never offer discounts for reviews. Use first names only in public replies.
9. **Weekly maintenance:** one update post, one photo set, review responses, Q&A check.
10. **Links:** use the tracked links in `src/config/marketing-links.ts`
    (`npm run marketing:links`) for GBP website/booking links; never manual UTM on internal
    navigation.

## 5. Citation ledger (verified public knowledge only)

| Platform | Status | Action | Priority | Owner action |
| --- | --- | --- | --- | --- |
| Google Business Profile | Verified (owner-confirmed; profile/review URLs live in `business.ts`) | Apply §4 optimizations; monitor performance | High | Yes (Google account) |
| Facebook | Active profile (rendered in footer) | Confirm name/hours/website/phone match | High | Yes |
| Nextdoor | Active (owner-confirmed; historically showed 8–6 hours) | Correct hours to 7–7; confirm service area | High | Yes |
| TikTok / Pinterest / Rumble / Gab / Parler / Locals | Active profiles (footer) | Keep NAP consistent; no spam links | Medium | Owner |
| Bing Places | **Unknown — verify** | Claim/create, import GBP data | Medium | Yes |
| Apple Business Connect | **Unknown — verify** | Claim/create, add hours/photos | Medium | Yes |
| Yelp | **Unknown — verify** | Claim only if a legitimate listing exists; correct NAP | Low | Yes |
| Pensacola Chamber / local directories | **Unknown — verify** | Pursue only credible, relevant memberships/listings | Low | Yes |
| Industry directories / HomeGuide-style | **Not established** | Consider after 10+ reviews; avoid paid lead spam | Low | No rush |

## 6. Measurement baseline and reporting

**Externally available today:** the site itself (200s, SEO checks), GA4/GTM (owner-confirmed
operational), lead notifications, and this audit. **Not available without account access:**
Search Console coverage/queries and GBP performance. No traffic, ranking or conversion number is
invented here.

Weekly routine (owner + website):
1. Search Console → Pages (indexed/not indexed), Sitemaps, URL Inspection for new/changed pages.
2. Search Console → Performance: impressions, clicks, average position, top queries; split branded
   vs non-branded.
3. GA4: sessions by landing page, `estimate_start`, inquiry key events, qualified leads, recurring
   first visits; consent-mode coverage noted.
4. GBP: calls, website clicks, direction requests, searches, new reviews.
5. Record in the weekly scorecard (`docs/marketing/WEEKLY-SCORECARD.md`); investigate deltas >20%.

Monthly review: compare 30/60/90-day trends, update keyword → page map, pick one content piece
and one conversion improvement from evidence. **Never promise rankings.**

## 7. 90-day roadmap (status at audit time)

**Days 0–7 — DONE this release (implemented → tested → committed → deployed):**
- Production technical audit (this document).
- Fixed robots/noindex validator defect with regression tests.
- Improved homepage + About/Contact/Supportive titles and homepage description.
- Internal-link pass (service → service, service → estimate).
- Three authentic reviews with first-name-only attributions; Laura added verbatim with her verified five-star rating.
- Premium layered 3D review carousel (keyboard, swipe, reduced motion, no-JS readable, mobile).
- Playwright browser regression job already in CI (Initiative 4.0 M1).
- Structured data and sitemap verified healthy; no misleading review markup.

**Days 8–30 — owner-dependent:**
- Confirm GSC coverage/URL Inspection and submit the sitemap again; capture baseline numbers.
- Apply GBP recommendations; reconcile Nextdoor hours; claim Bing/Apple listings.
- Ask the next satisfied customers for honest Google reviews (no incentives).
- Publish 2–4 genuinely useful FAQ/article pieces from real customer questions; add internal links.
- Begin consistent real-photo posting (website + GBP + social).

**Days 31–60:**
- Re-check indexing and query growth; double down on pages earning impressions.
- Add genuine completed-work examples (with written permission) and refine service pages from
  actual customer questions.
- Pursue 2–3 credible local authority relationships (chamber, local organizations, complementary
  businesses); no paid link schemes.
- Improve conversion friction identified by funnel data (estimate entry points, mobile CTA).

**Days 61–90:**
- Compare organic search trends and qualified-lead volume (not vanity metrics).
- Prioritize next investments from evidence: content, GBP, citations, or estimator experience.
- Refresh titles/descriptions only where query data shows mismatch.
- Review review-response quality and photo cadence; keep earning prominence.

## 8. Owner actions summary

1. Google Search Console: retrieve coverage, queries, impressions and URL Inspection; share
   screenshots/exports. (Free; no third-party connector required.)
2. Google Business Profile: apply §4; correct Nextdoor hours; verify Bing/Apple/Yelp status.
3. Supply genuine review requests and real work photos with permission.
4. No paid tools, directories or review schemes are authorized or required.

## 9. What success looks like (honest)

Technically healthy, crawlable, correctly configured pages; stronger relevance for Pensacola and
Cantonment cleaning searches; a trustworthy review experience; measurable acquisition through
GA4 + Search Console + GBP; and a business whose real service history compounds its visibility.
No one can guarantee first-page positions for competitive queries; the site can only earn them.
