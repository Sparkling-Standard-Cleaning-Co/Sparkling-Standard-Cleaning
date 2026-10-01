# Deployment

GitHub (`main`) → the company's dedicated Cloudflare Pages project → production. **No Cloudflare
account ID, project ID or token exists in this repository — by design.** They live in the
Cloudflare dashboard of the company's own account (separate from any other business).

Current infrastructure (owner-confirmed October 2026):

- Domain `sparkling-standard.com` is registered (Squarespace registrar) and active on the
  company's Cloudflare DNS.
- Google Workspace handles company email (`owner@sparkling-standard.com`) — MX, SPF and DKIM
  records are live and must **never** be modified or deleted while configuring the website.
  Do **not** enable Cloudflare Email Routing for this domain.
- The repository is `Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning`.

Nothing here is live yet. Do not claim production is running until step 0 below is done and
verified.

## Step 0 — create the Cloudflare Pages project (owner)

1. Cloudflare dashboard (company account) → Workers & Pages → Pages → create project → connect
   the `Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning` repository only.
2. Build settings: build command `npm run build`, output directory `dist`.
   Production branch: `main`. Framework preset: Astro (if offered).
3. Functions: the repository's `functions/` directory is picked up automatically by the
   Pages build (Cloudflare Pages Functions).
4. Set environment variables (all of them live in the dashboard, never in git):

| Variable | Environment | Notes |
| --- | --- | --- |
| `PUBLIC_SITE_URL` | Production | `https://sparkling-standard.com` (no trailing slash) |
| `PUBLIC_BUSINESS_NAME` / `_LEGAL_NAME` | Production | Company name is confirmed; legal name only when verified |
| `PUBLIC_BUSINESS_PHONE` / `_EMAIL` | Production | Owner-confirmed contact facts |
| `WEB3FORMS_ACCESS_KEY` | Production | Server-side form relay — enter the existing owner-created key |
| `PUBLIC_WEB3FORMS_ACCESS_KEY` | Production | Public static fallback (same key; client-safe) |
| `PUBLIC_UMAMI_WEBSITE_ID` | Production | Optional analytics (unique to this business) |
| `PUBLIC_GTM_CONTAINER_ID` | Production | Optional analytics (unique to this business) |
| `PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Production | Recommended |
| `TRAVEL_ORIGIN`, `ROUTES_PROVIDER`, `ROUTES_API_KEY`, `EIA_API_KEY` | Production | Estimator travel (origin is private — server-side only) |
| `VEHICLE_MPG`, `INCLUDED_ONE_WAY_MILES`, `MAX_INSTANT_ESTIMATE_DISTANCE`, `REFERENCE_GAS_PRICE`, `TRAVEL_CACHE_SECONDS` | Production | Travel economics |
| `PUBLIC_PREVIEW_MODE` | **Never set in production**; `true` on preview branches | Forces noindex |

5. Preview deployments (non-main branches): set `PUBLIC_PREVIEW_MODE=true` so preview URLs are
   `noindex, nofollow` and `Disallow: /`.

## Deploy checklist (every production deploy after step 0)

```bash
git status                     # clean tree, intended commits only
npm run verify                 # type check + build + static validation
npm run pending                # must pass — no PENDING facts in the build
npm run validate:production    # environment + launch-flag gate
npm test                       # estimator suite
```

Then verify live, immediately after the deploy:

1. `https://<domain>/robots.txt` → `Allow: /` and the sitemap URL.
2. A live page's `<meta name="robots">` → `index, follow` (never noindex in production).
3. Canonical on `/` → the real domain with trailing slash.
4. Submit one real form (owner-authorized) and confirm it arrives.
5. Run the estimate on mobile: range appears, out-of-area ZIPs route to confirmation.
6. Create the Google Business Profile with the tracked GBP link
   (`docs/marketing/UTM-MASTER-LINKS.md`), then submit the sitemap in Search Console.

## Rollback

Cloudflare keeps deployment history: re-promote the previous successful production deployment
from the dashboard. No database ties this site down — rollbacks are safe.

## Rules

- Never push directly to `main` without owner approval (it deploys).
- Never put secrets in the repository; only `PUBLIC_*` client-safe values live in `.env.example`.
- Regenerate QR codes (`npm run marketing:qr`) whenever the domain or registry changes — every QR
  is decode-verified against its intended URL by `npm run marketing:verify`.
- Never modify Google Workspace DNS records (MX/SPF/DKIM) or enable Cloudflare Email Routing while
  configuring the website.
