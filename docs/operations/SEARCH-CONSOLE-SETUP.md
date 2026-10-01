# Search Console and Google Business Profile — owner setup checklist

Prepared 2026-10-01. The owner has approved public indexing; the site is already indexable and
verified. These are the owner-side account steps that make the site discoverable. Nothing here
changes DNS records except the single verification TXT record described — never touch MX, SPF or
DKIM (Google Workspace email).

## 1. Google Search Console (about 10 minutes)

1. Go to `https://search.google.com/search-console` and sign in with the company Google account
   (`owner@sparkling-standard.com` — do not use another business's account).
2. Add property → **Domain** → enter `sparkling-standard.com` (not the URL-prefix option; the
   domain property covers all subdomains and protocols).
3. Google shows a **TXT verification record**. In Cloudflare → the domain's DNS → add:
   - Type: `TXT`
   - Name: `@`
   - Content: the exact value Google supplied
   - Proxy: off (DNS only — TXT is never proxied)
   - **Do not touch any MX, SPF (`v=spf1`), or DKIM records.**
4. Return to Search Console and click **Verify** (often instant).
5. Submit the sitemap: **Sitemaps** → enter `sitemap-index.xml` → Submit.
   The live sitemap is `https://sparkling-standard.com/sitemap-index.xml`.
6. Request indexing for the homepage: **URL inspection** → enter the URL → **Request indexing**.
7. Weekly check (5 minutes): **Pages** report for indexing problems; **Performance** for queries.
   The search strategy lives in `docs/seo/SEO-STRATEGY.md`.

What to expect: a new domain can take days to weeks to index; service pages index gradually.

## 2. Google Business Profile (about 20 minutes)

This is the single highest-value local visibility step for a cleaning company.

1. Go to `https://business.google.com` with the company Google account.
2. Create the business:
   - Name: **Sparkling Standard Cleaning Co.**
   - Category: **House cleaning service** (add **Commercial cleaning service** as a secondary
     category).
   - **Service-area business**: choose "I deliver goods and services to my customers" and **hide
     the private operating address**. The address never appears publicly; the Cantonment area
     appears only as a general service region.
   - Service area: Pensacola, Cantonment, and the surrounding communities within about an hour's
     drive; add nearby Alabama communities you will serve. Do not list fake locations.
   - Phone: `(850) 246-8479`; Website: use the tracked Google Business Profile link from
     `docs/marketing/UTM-MASTER-LINKS.md` (the `gbp_*` entries) so GBP visits are attributed.
   - Hours: Seven days a week, 8:00 AM – 6:00 PM.
3. Verify the business with Google's chosen method (video or postcard — for service-area
   businesses, video verification is common; have the cleaning supplies and vehicle ready).
4. After verification:
   - Add the business description and services from the approved site copy (no invented claims).
   - Upload genuine photos only (owner-provided; see `docs/design/IMAGE-GUIDE.md`).
   - Replace the placeholder review links in configuration as described in §3.
5. Do not use "review gating" or review incentives; ask every customer genuinely.

## 3. Connect reviews to the website

1. In the GBP dashboard, copy:
   - the **review link** (the short "ask for reviews" link), and
   - the public profile URL.
2. Update `src/config/business.ts`:
   - `reviews.submissionUrl` = review link (used by the leave-review page/QR)
   - `reviews.profileUrl` = public profile URL
   - `socials.googleProfile` = public profile URL
3. Commit → Cloudflare rebuilds. Then follow `docs/marketing/REVIEW-GROWTH-SYSTEM.md` for the
   request workflow. Reviews display automatically once genuine entries exist.

## 4. Bing and other channels (optional, after Google)

- `https://www.bing.com/webmasters` → add the site → it can import verification from Google
  Search Console in one click.
- Bing Places (`https://www.bingplaces.com`) → sync the local listing from Google Business
  Profile.
- IndexNow (site freshness): optional; requires an `INDEXNOW_KEY` and running
  `node scripts/indexnow.mjs` after content changes (no workflow configured yet).

## 5. Verifying indexing behavior after any change

```
npm run live:check
```

The script verifies `robots.txt` allows crawling, the sitemap URL is present, the homepage
canonical and robots meta, key pages, and the API reachability. Never introduce noindex or
`Disallow` on public pages; utility pages intentionally excluded from the sitemap (`/404`,
`/thank-you/`, `/leave-review/`) must stay excluded.
