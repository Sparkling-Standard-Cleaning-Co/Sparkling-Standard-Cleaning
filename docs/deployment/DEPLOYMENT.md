# Deployment

GitHub (`main`) → the owner's GitHub-connected Cloudflare project → production. **No Cloudflare
project, account ID, project ID, domain or token exists in this repository — by design.** They
will be created in the Cloudflare dashboard after the domain is approved.

Nothing here is live yet. Do not claim production is running until step 0 below is done and
verified.

## Step 0 — create the Cloudflare project (owner, post-name)

1. Cloudflare dashboard → Pages (or Workers) → create project → connect the
   `Pensacolacleaningcompany/PensacolaCleaningcompany` repository.
2. Build settings: build command `npm run build`, output directory `dist`.
3. Functions: the repository's `functions/` directory is picked up automatically by the
   Pages/Workers build (Cloudflare Pages Functions).
4. Set environment variables (all of them live in the dashboard, never in git):

| Variable | Environment | Notes |
| --- | --- | --- |
| `PUBLIC_SITE_URL` | Production | Real domain, no trailing slash |
| `PUBLIC_BUSINESS_NAME` / `_LEGAL_NAME` | Production | Owner-approved facts |
| `PUBLIC_BUSINESS_PHONE` / `_EMAIL` | Production | Owner-approved facts |
| `WEB3FORMS_ACCESS_KEY` | Production | Server-side form relay |
| `PUBLIC_WEB3FORMS_ACCESS_KEY` | Production | Public static fallback |
| `PUBLIC_UMAMI_WEBSITE_ID` | Production | Optional |
| `PUBLIC_GTM_CONTAINER_ID` | Production | Optional |
| `PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Production | Recommended |
| `TRAVEL_ORIGIN`, `ROUTES_PROVIDER`, `ROUTES_API_KEY`, `EIA_API_KEY` | Production | Estimator travel |
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
- Regenerate QR codes (`npm run marketing:qr`) after the final domain lands — QRs printed
  before that point point at a placeholder origin and must not be used.
