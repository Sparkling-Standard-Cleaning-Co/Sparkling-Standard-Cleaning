# Local SEO and search-visibility audit - 2026-11-27

Targeted audit requested after the owner observed weaker visibility for broader Pensacola searches
and no Bing Maps presence. Evidence in this document is from the repository, the live site, and
limited public search checks on 2026-11-27. No ranking, traffic or review count is invented.

## 1. What is already healthy

- **Indexability:** `robots.txt` returns `Allow: /` and declares
  `https://sparkling-standard.com/sitemap-index.xml`. The IndexNow key file
  `/80020266ab1cc902a87b057b746de406.txt` returns 200.
- **Sitemap:** `sitemap-0.xml` contains 23 public URLs. All 23 returned HTTP 200 on 2026-11-27.
  The Tampa page, admin/employee/portal, signing, invoice/payment, gift redemption, thank-you and
  leave-review pages are excluded while they are private or prelaunch.
- **Canonicals/robots:** every sitemap URL has a correct self-referencing canonical and
  `index, follow`. All 16 private/utility pages checked (including admin, employee, portal,
  signing, invoice/payment, gift redemption, thank-you and leave-review) carry
  `noindex, nofollow`; `/admin/*`, `/api/admin/*`, gift-admin, redemption and payment pages also
  have no-store headers.
- **Titles/descriptions:** all 41 built pages pass the SEO checks; 37 unique public titles.
  The primary service pages already target their owning query cluster with Pensacola/Cantonment
  wording.
- **Structured data:** the site emits `LocalBusiness` with phone `+1-850-426-8479`, legal name
  `Sparkling Standard LLC`, 12 `sameAs` profiles (including the owner-supplied Google Business
  Profile URL), seven-day 07:00-19:00 hours, service-area data, payment methods and currencies.
  Service pages add `Service`, breadcrumbs and visible `FAQPage` data. No fake Review or
  AggregateRating markup is emitted.
- **NAP consistency:** the site name is `Sparkling Standard`; legal name `Sparkling Standard LLC`;
  phone `(850) 426-8479`; customer email `customer-service@sparkling-standard.com`; hours seven
  days, 7:00 a.m.-7:00 p.m.; area Pensacola, Cantonment, surrounding communities and select nearby
  Alabama. The private street address is deliberately absent.
- **Analytics/conversion:** consent-gated GTM/GA4 and the inquiry/estimate event taxonomy remain
  present; no change was needed.
- **Mobile performance architecture:** static Astro output, self-hosted font subsets, responsive
  WebP images, eager first hero image with later slides lazy, minimal public-page JavaScript.
  Maplibre and HEIC conversion are lazy-loaded and the large admin bundle is private. No new
  Lighthouse lab run was performed in this audit; do not claim a lab score without a measured run.

## 2. Actual deficiencies found and corrected in the working tree

1. **Duplicate, inconsistent LocalBusiness entity on `/locations/pensacola/`.** The page emitted a
   second `LocalBusiness` named `Sparkling Standard Cleaning Co.` with a display phone and a
   parent organization, alongside the global `Sparkling Standard` entity. That is an entity-
   consistency risk. Replaced with a `Service` node whose `provider` references the single main
   business `@id` (`/#business`), with Pensacola/Cantonment `areaServed`. The schema breadcrumb now
   matches the visible Home > Pensacola trail instead of inserting a duplicate "Locations" step.
2. **Old public brand name.** The Pensacola location title and the service-area multi-branch
   heading said `Sparkling Standard Cleaning Co.`. Changed both public uses to
   `Sparkling Standard` (the authentic review text and owner-supplied GBP URL are unchanged).
   The location title is now `Pensacola Cleaning Services | Sparkling Standard`.
3. **Orphaned location page.** `/locations/pensacola/` was linked only from `/service-area/`.
   Added a sitewide footer link (`Pensacola Cleaning`) and changed the service-area CTA anchor to
   `Pensacola cleaning services`. This gives the location page a normal internal-link path and
   descriptive anchor text.
4. **High-intent metadata lacked local intent.** Added Pensacola wording to:
   - `/estimate/` - `Cleaning Estimate Options in Pensacola | Sparkling Standard`
   - `/estimate/residential/` - `Residential Cleaning Estimate in Pensacola | Sparkling Standard`
   - `/estimate/str/` - `STR Turnover Estimate in Pensacola | Sparkling Standard`
   - `/estimate/commercial/` - `Commercial Cleaning Estimate in Pensacola | Sparkling Standard`
   - `/estimate/church/` - `Church Cleaning Estimate in Pensacola | Sparkling Standard`
   - `/supportive-home-cleaning/` - `Community Support Cleaning in Pensacola | Sparkling Standard`
   - `/faq/` - `Cleaning FAQ | Pensacola | Sparkling Standard`
   - `/about/` - `About Hayli | Pensacola Cleaning | Sparkling Standard`
   - `/careers/` - `Cleaning Careers in Pensacola | Sparkling Standard`
5. **Stale owner-facing hours documentation.** `docs/operations/SEARCH-CONSOLE-SETUP.md` told the
   owner to set Google Business Profile hours to 8:00 a.m.-6:00 p.m. The authoritative site
   config and public pages use 7:00 a.m.-7:00 p.m. Corrected the setup document to 7-7.
6. **Bing/IndexNow guidance was too weak.** The same document now treats Bing Webmaster Tools,
   Bing Places and IndexNow as required for Bing visibility, not optional afterthoughts. IndexNow
   has a valid key and script but its local state was last submitted 2026-10-22; 23 current public
   URLs would be submitted on the next run, and no GitHub workflow is configured.

## 3. External evidence and limitations

- **Google Search Console (owner-reported, 2026-11-27):** property established; sitemap processed
  with 23 discovered URLs; 23 indexed pages and 12 excluded URLs (5 alternate pages with correct
  canonicals, 4 redirects, 1 noindex, 1 robots.txt, 1 discovered but not indexed, 0 crawled but not
  indexed). The reported query table has 28 queries, about 47 impressions and zero clicks. These
  figures are not necessarily the property's complete totals. The repo-side technical checks align:
  the public sitemap has the same 23 URLs and all return 200.
- **Bing:** the owner reports Bing Webmaster Tools established, and GA4 recorded six Bing organic
  sessions. A direct `site:sparkling-standard.com` query returned no sparkling-standard.com results
  on 2026-11-27, but a site-search query is not definitive evidence that Bing has indexed nothing.
  The concrete Bing Maps blocker is separate: `business.socials.bingPlaces` is still `PENDING`, so
  no Bing Places listing URL exists. Bing Maps local results require a Bing Places for Business
  listing; a website cannot create or verify it.
- **Google Business Profile (owner-reported, 2026-11-27):** 139 profile views (83 Google Search,
  56 Google Maps), fewer than 50 searches showing the profile, and nine genuine reviews. Visibility
  is stronger in Cantonment than in broader Pensacola searches. The profile URL is present and
  verified per prior owner confirmation, but categories, services, hours, photos, posts and
  performance require the owner's Google account.
- **GA4 (owner-reported, 2026-11-17 to 11-27):** 19 active users, 16 new users, 115 sessions, $0
  recorded revenue and six Bing organic sessions. Revenue is $0 because the site has no purchase
  or transaction event; see the separate tracking audit. Internal development and checkout testing
  can contaminate these figures because no GA4 internal-traffic filter is confirmed.
- **No ranking or review-count claims are made.** Competitor observations are qualitative.

## 4. Competitor comparison (public results, 2026-11-27)

Top Pensacola residential results (Palafox, American Maids, Tidy by the Bay, Purely Pensacola,
Pensacola Maids, Alaya, Pensacola Cleaner) show recurring patterns:

- Titles and H1s naming Pensacola plus nearby communities (Gulf Breeze, Pace, Milton, Navarre,
  Cantonment).
- Dedicated service pages with checklists, starting prices and online booking/instant quotes.
- Neighborhood/ZIP detail and local access considerations (older downtown homes, salt film,
  rental turnover, military moves).
- Large review counts and active GBP profiles; several have physical addresses and local photos.

Sparkling Standard is stronger on transparent server-verified estimates, service depth
(residential, deep, move-out, STR, commercial, church, Community Support), owner-operated story and
honest structured data. It is weaker on domain age/authority, review volume, GBP photo/post
activity, Bing listing verification and volume of locally specific content. Do not close that gap
with thin city pages; the existing no-doorway policy stands.

## 5. Prioritized high-intent opportunities

| Intent | Owning page | Current state | Best next action |
| --- | --- | --- | --- |
| house cleaning Pensacola | `/house-cleaning/` | Strong title/H1, routes to real services | Earn reviews and internal links; no new page |
| deep cleaning Pensacola | `/deep-cleaning/` | Strong scope/detail content | Add genuine completed-work evidence when approved |
| recurring house cleaning | `/recurring-cleaning/` | Clear two-price/first-deep-clean terms | GBP services link and review requests |
| move-out cleaning | `/move-in-move-out-cleaning/` | Clear process/FAQ | Owner-approved local content only if real |
| commercial / office cleaning | `/commercial-cleaning/` | Broad but credible scope | Name office/medical/retail specifics only where true |
| vacation rental turnover | `/short-term-rental-cleaning/` | Strong niche page | Real host case evidence when permissioned |
| Pensacola local service | `/locations/pensacola/` | Now linked sitewide and schema-consistent | Keep NAP/hours aligned with GBP |
| coverage questions | `/service-area/` | Clear policy, no fake city pages | Owner may approve naming surrounding communities later |

## 5b. Mobile performance investigation

Measured on the live homepage on 2026-11-27 with Playwright Chromium mobile emulation. These are
lab-style synthetic observations, not a Lighthouse/PageSpeed Insights field score.

- **Unthrottled mobile viewport:** TTFB 496 ms, FCP 1.06 s, LCP 1.06 s, load 1.16 s. The page is
  fast when the network is not constrained.
- **Simulated 4x CPU / 1.6 Mbps / 150 ms (one run):** TTFB 3.32 s, FCP 5.66 s, LCP 6.01 s, CLS 0,
  863 DOM nodes, about 450 KB transferred. The earlier 5.76 s LCP result is consistent with this
  throttled profile.
- **LCP element:** the first hero-carousel image
  `/_astro/living-room-bright.CRZtQ9p7_Z1rPbIY.webp` (49.6 KB transfer, 63,200 px area). It starts
  at 3.42 s and finishes at about 4.81 s; the 6.01 s LCP timestamp follows the throttled HTML/CSS
  and image pipeline. This is a real image, already eager and sized for mobile.
- **Fonts:** four preloads total about 223.9 KB: Fraunces italic 81.8 KB, Fraunces normal 67.6 KB,
  Great Vibes 43.1 KB and Nunito Sans 31.4 KB. All four are used above the fold in the current
  design (display headline/accents, script wordmark and body text), so they are not automatically
  unnecessary; the italic display file is the largest single font asset.
- **Render-blocking/CSS:** one stylesheet (`_service_.css`) transfers 26.7 KB (151 KB decoded).
  Module scripts are deferred by module semantics; the Cloudflare beacon loads separately. No
  maplibre or HEIC bundle loads on the homepage.
- **Images:** the first hero image is eager, later slides are lazy, and the other visible images
  are small optimized WebPs. No obvious oversized public-page image was found.
- **Caching:** `/_astro/*` and `/fonts/*` currently return
  `public, max-age=14400, must-revalidate` (four hours). Content-hashed `/_astro/*` assets could
  safely use a one-year immutable cache; font filenames are stable, so a shorter long-lived policy
  should be chosen deliberately.

**Proposed isolated corrections (not yet implemented):**

1. Add `fetchpriority="high"` to the first hero-carousel image (the measured LCP element) and
   consider preloading its responsive `imagesrcset`. This is a small public-page asset change.
2. Add explicit cache headers for `/_astro/*` (immutable, one year) and `/fonts/*` (long max-age)
   in `public/_headers`. This improves repeat visits only, not first-load LCP.
3. Re-run Lighthouse/PageSpeed Insights on the deployed production URL before claiming a lab
   score; the synthetic result above is useful for diagnosis but not a field-data substitute.
4. Do not restructure estimator initialization, payment scripts or application dependencies for
   this performance work.

## 6. Owner actions required (not code changes)

1. **Google Business Profile (existing profile):** keep the public name `Sparkling Standard`, the
   House cleaning service category, the genuine service list, seven-day 7:00 a.m.-7:00 p.m. hours,
   a hidden service-area address, real photos, weekly posts and replies to every review. The
   remaining work is ongoing maintenance and honest review requests, not another setup.
2. **Bing Places:** create/claim the listing at `bingplaces.com`, sync the Google Business Profile
   data, use the same NAP and 7-7 hours, and provide the resulting public listing URL so it can be
   added to `business.socials.bingPlaces` and the structured-data `sameAs`. This is the remaining
   Bing Maps publication action.
3. **Search Console follow-up:** review the 12 excluded URLs and the one discovered-but-not-indexed
   page; the intentional private/utility exclusions and canonicals already match the site build.
   No new verification or sitemap submission is needed.
4. **Bing Webmaster follow-up:** confirm the sitemap/indexed URL count in the dashboard. No new
   verification is needed; the existing site-side IndexNow key and script are sufficient.
5. **Apple Business Connect, Nextdoor, Facebook, Yelp:** confirm or correct NAP and hours only where
   a genuine listing exists; do not create fake locations.
6. **GA4 internal traffic:** add an internal-traffic definition for owner/test devices and use a
   separate test property or DebugView for Stripe test-mode checkout work. Do not activate a
   permanent exclusion filter without reviewing the rule.
7. **Reviews and content:** the largest non-technical gap is review volume and genuine local proof.
   Continue asking every satisfied customer for an honest Google review and publish only real,
   permissioned work photos. Do not buy reviews, backlinks or directory spam.
8. **Event receipt:** verify the church and promotion events in GA4 DebugView/Realtime if they are
   not already confirmed in the current GTM version.

## 7. Deployment and verification state

The corrections in section 2 were implemented and locally verified, then released on 2026-11-27
in the authorized SEO commit following `4206a28`, synchronized on `main` and `production-safe`.
The final closeout records the exact commit, live metadata/sitemap/structured-data checks,
Careers verification, IndexNow submission and the unchanged checkout path. No checkout, payment,
pricing, scheduling, gift, promotion, agreement, customer, employee or administrative code was
modified by this SEO pass.
