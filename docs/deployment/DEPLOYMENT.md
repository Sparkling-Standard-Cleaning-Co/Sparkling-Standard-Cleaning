# Cloudflare deployment guide — Sparkling Standard Cleaning Co.

Single authoritative deployment document. If anything here disagrees with the actual code or
dashboard, stop and reconcile before deploying. Owner-confirmed facts live in
`src/config/business.ts`; the owner-input checklist lives in
`docs/launch/OWNER-INPUT-REQUIRED.md`.

- Repository: `Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning`
- Cloudflare Pages project (intended): `sparkling-standard-cleaning`
- Production branch: `main`
- Custom domain (not attached yet): `https://sparkling-standard.com`
- Runtime: Cloudflare Pages + Pages Functions (`functions/`), Astro 5 static build

Nothing is live yet. Do not claim production is running until the validation and launch
authorization steps below are complete.

## 1. Exact build configuration

| Setting | Value |
| --- | --- |
| Git provider / repository | GitHub, `Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning` only |
| Production branch | `main` |
| Preview deployments | Disabled by owner choice (Settings → Builds → Branch control → Preview branch: **None**) |
| Framework preset | Astro (if offered) or None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `/` (repository root) |
| Node.js | 22.16.0 via the committed `.node-version` file (Pages V3 image default; equivalent to setting `NODE_VERSION=22.16.0`) |
| Functions | `functions/` at the repository root is picked up automatically (`/api/lead`, `/api/travel`) |
| Build cache | May be enabled; no adverse effect |

`npm run build` runs `astro build` only. It does not run tests or validation — run those locally
before pushing (section 8).

## 2. Fix "Production branch → No labels found" (owner, ~5 minutes)

This message means Cloudflare's branch list for the repository is empty. The `main` branch exists
(it has been pushed), so this is a GitHub access or stale-cache problem, not missing code.

Do these in order, stopping when the branch list appears.

1. **Grant the Cloudflare GitHub App access to this repository** (most common cause — the repo was
   created after the app was authorized).
   - Sign in to GitHub as **`Sparkling-Standard-Cleaning-Co`** (the repository owner).
   - Open `https://github.com/settings/installations` → **Cloudflare Workers and Pages** →
     **Configure**.
   - Under **Repository access**, either select **All repositories** or add
     `Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning` under **Only select
     repositories** → **Save**.
   - In Cloudflare: Workers & Pages → Create application → Pages → Connect to Git. Re-open the
     repository (go back one step and re-select it) so the branch list is fetched again.

2. **Confirm the correct GitHub account is connected in Cloudflare.** In the same "Connect to
   Git" screen the account dropdown must show `Sparkling-Standard-Cleaning-Co`. If it shows any
   other GitHub account, choose **+ Add account** and authorize the cleaning-company account. A
   GitHub account should point to only one Cloudflare account; do not connect this repository
   through a different company's GitHub account.

3. **Clear the stale branch cache.** Cloudflare prefetches the branch list. If the repository was
   listed while it was still empty, the list can stay empty:
   - Hard-refresh the page (Ctrl+Shift+R) or use a private/incognito window and start the Pages
     import again.
   - If the project already exists: **Settings → Builds → Branch control**, open the Production
     branch dropdown again. If it stays empty, disconnect and reconnect the Git integration, or
     delete the broken project (nothing is deployed yet) and recreate it after step 1.

4. **If Cloudflare still cannot read the repository**, use its documented reinstall procedure:
   GitHub → Settings → Applications → Cloudflare Workers and Pages → **Uninstall**; then in
   Cloudflare → Workers & Pages → Create application → Pages → Connect to Git → **+ Add
   account** → select the cleaning-company account → **Install & Authorize**. Retry the project
   creation.

5. **One-repository-per-Cloudflare-account rule.** Cloudflare disallows the same GitHub
   repository on Pages projects in two different Cloudflare accounts. If another Cloudflare
   account you control already shows this repository in Workers & Pages, remove it there first.
   Do not modify the other company's working connections.

6. **Fallback (still Cloudflare Pages, not a Worker).** If Git integration is still blocked, you
   can deploy the built output directly from the repository root:
   ```
   npm run verify
   npm run build
   npx wrangler pages deploy dist --project-name sparkling-standard-staging --branch main
   ```
   Caveats, by design: use a temporary project name such as `sparkling-standard-staging`;
   direct-upload projects cannot be converted to Git integration later, so the final production
   project must still be created through the Git flow once access is fixed. Wrangler deploys the
   `functions/` directory with the upload; verify `/api/lead` after the deploy (section 8).

## 3. Runtime requirements

- Node.js ≥ 20 for the build (pinned to 22.16.0 by `.node-version`).
- No database, no server framework, no paid add-ons.
- Two Pages Functions only:
  - `POST /api/lead` — validates and relays form submissions to Web3Forms using the runtime
    `WEB3FORMS_ACCESS_KEY`; returns `503 not_configured` when the key is missing so the client can
    use its static fallback instead of showing a false success.
  - `POST /api/travel` — route distance + Gulf Coast gasoline reference; returns
    `503 origin_not_configured` until `TRAVEL_ORIGIN` is set; the estimator keeps working in
    offline zone mode either way.
- Outbound calls: `api.web3forms.com`, `routes.googleapis.com` or `api.mapbox.com` (optional),
  `api.eia.gov` (optional), `challenges.cloudflare.com` (Turnstile, optional).

## 4. Environment variables — build-time vs runtime

**The local `.env` file is never read by Cloudflare.** Production values must be set in the Pages
project. Changing any variable or secret requires a **new deployment** (Retry deployment, or push
a commit) before the built pages and Functions see it.

### Build-time (Astro inlines these; public by design)

| Variable | Required | Consumed by | Notes |
| --- | --- | --- | --- |
| `PUBLIC_SITE_URL` | Recommended | `astro.config.mjs`, `business.url`, marketing/QR generation, IndexNow | `https://sparkling-standard.com` — also the committed default |
| `PUBLIC_BUSINESS_NAME` | Optional override | wordmark, titles, schema | Default already in source |
| `PUBLIC_BUSINESS_PHONE` | Optional override | call CTAs, schema | Default already in source |
| `PUBLIC_BUSINESS_EMAIL` | Optional override | email links, schema | Default already in source |
| `PUBLIC_BUSINESS_LEGAL_NAME` | Later | schema `legalName` | Leave unset until the registered spelling/suffix is verified |
| `PUBLIC_WEB3FORMS_ACCESS_KEY` | Yes for the form fallback | client-side static submit fallback | Public client-side identifier — safe in HTML. Use the SAME key as the server secret |
| `PUBLIC_UMAMI_WEBSITE_ID` | Optional | consent-gated Umami | Analytics stays hidden until set |
| `PUBLIC_GTM_CONTAINER_ID` | Optional | consent-gated GTM/GA4 | Never load gtag.js directly |
| `PUBLIC_TURNSTILE_SITE_KEY` | Optional, recommended | Turnstile widget | Pair with `TURNSTILE_SECRET_KEY` |
| `PUBLIC_PREVIEW_MODE` | **Staging only** | noindex + robots `Disallow` + preview badges | Must be removed before launch (section 6) |

### Runtime secrets (Functions; never in client bundles)

| Secret | Required | Read by | Effect when missing |
| --- | --- | --- | --- |
| `WEB3FORMS_ACCESS_KEY` | Yes | `functions/api/lead.ts` | `/api/lead` returns `503`; client falls back to direct Web3Forms submit when the public key is set |
| `TRAVEL_ORIGIN` | Yes for routed travel | `functions/api/travel.ts` | `/api/travel` returns `503`; estimator stays in offline zone mode |
| `TURNSTILE_SECRET_KEY` | Optional | `functions/api/lead.ts` | Turnstile check skipped; honeypot + timing still apply |
| `ROUTES_API_KEY` | Optional | `functions/api/travel.ts` | Straight-line × 1.18 distance estimate labeled as such |
| `EIA_API_KEY` | Optional | `functions/api/travel.ts` | Uses `REFERENCE_GAS_PRICE` |

### Optional runtime text variables (dashboard, "Text" type)

| Variable | Default | Notes |
| --- | --- | --- |
| `ROUTES_PROVIDER` | unset | `google` or `mapbox`; requires `ROUTES_API_KEY` |
| `REFERENCE_GAS_PRICE` | `3.1` | USD/gal fallback |
| `TRAVEL_CACHE_SECONDS` | `21600` | Per-isolate route cache |

### Documented but NOT consumed by code

`VEHICLE_MPG`, `INCLUDED_ONE_WAY_MILES`, `MAX_INSTANT_ESTIMATE_DISTANCE` appear in `.env.example`
as planning values but are **not read from the environment**; the estimator uses the constants in
`src/config/pricing.ts` (`travel.clientDefaults`). Update both together or not at all — setting
them in Cloudflare currently has no effect.

## 5. Entering secrets — local workflow

1. Copy `.env.example` to `.env` and fill the real values (`.env` is git-ignored).
2. Generate the bulk-upload file and the dashboard checklist:
   ```
   npm run deploy:secrets
   ```
   This writes `deploy/secrets.env` (git-ignored) and prints which public values go in the
   dashboard. It never prints secret values.
3. Upload all runtime secrets in one officially supported command:
   ```
   npx wrangler login
   npx wrangler pages secret bulk deploy/secrets.env --project-name sparkling-standard-cleaning
   npx wrangler pages secret list --project-name sparkling-standard-cleaning
   ```
   `wrangler pages secret bulk` accepts JSON (`{"KEY":"value"}`) or dotenv/`.dev.vars` format —
   confirmed current. The Cloudflare dashboard has **no file-import** for environment variables;
   there, add each key manually under Settings → Environment variables (type **Secret**).
4. Enter the build-time `PUBLIC_*` values as **Text** variables in the dashboard (reference list:
   `deploy/cloudflare-public-vars.example.json`). `PUBLIC_WEB3FORMS_ACCESS_KEY` must be the same
   access key as `WEB3FORMS_ACCESS_KEY`.
5. Trigger a new deployment.

Never commit `.env`, `deploy/secrets.env`, `deploy/secrets*.json`, or `.dev.vars`; all are
git-ignored.

## 6. Temporary staging deployment (first pages.dev test)

Preview branch builds are disabled, so the first test deployment runs from `main` — which
Cloudflare classifies as a **production deployment** even though it is only a staging test.

1. Before the first deploy, add the Text variable `PUBLIC_PREVIEW_MODE=true` to the **Production**
   environment. This makes the built site `noindex, nofollow` and `robots.txt` `Disallow: /`, so
   the `*.pages.dev` URL is not submitted for indexing.
2. Do **not** attach the custom domain yet (settings → Custom domains stays empty).
3. Deploy and run the verification checklist (section 8) against the `*.pages.dev` URL.
4. `noindex` is not access control — anyone with the URL can view the staging site. If genuinely
   restricted access is required, add Cloudflare Access (section 12).
5. Before launch: **remove** `PUBLIC_PREVIEW_MODE`, trigger a new deployment, and confirm
   `robots.txt` shows `Allow: /` and pages show `index, follow` (section 11). This step is
   mandatory and is part of the owner launch checklist.

## 7. Validation gates

Local, before any deploy (all must pass):

```
npm run verify                 # astro check + build + links/SEO/QR/checklist validation
npm test                       # 27 estimator tests
npm run pending                # no PENDING placeholder facts in the built output
node scripts/validate-production-env.mjs   # production gate — expected to FAIL until owner inputs land
```

Live, immediately after a deployment (section 8 lists the exact checks). Do not report a
deployment as successful from the dashboard status alone.

## 8. Live verification checklist (after each deploy)

1. `https://<project>.pages.dev/robots.txt` — while staging: `Disallow: /`; after launch:
   `Allow: /` + sitemap URL.
2. Page `<meta name="robots">` — staging: `noindex, nofollow`; after launch: `index, follow`.
3. Canonical on `/` — `https://sparkling-standard.com/` (with trailing slash).
4. Pages Functions respond: `POST /api/travel` with `{"zip":"32503"}` returns `200` once
   `TRAVEL_ORIGIN` is set, or `503 origin_not_configured` when it is not — either proves the
   function is running (a 404 means it was not deployed).
5. `POST /api/lead` with a test payload returns `200 { ok: true }` once the server key is set, or
   `503 not_configured`. A test that returns `200` without an email arriving at
   `owner@sparkling-standard.com` is a failure, not a pass.
6. Submit one real (owner-authorized) form per category — residential, instant estimate,
   commercial, STR — and confirm each arrives in the Workspace inbox with the intended subject
   and reply-to where an email was supplied.
7. Estimate flow on a phone: range appears, out-of-area ZIP routes to manual confirmation.
8. Browser console: no errors; no failed requests other than the expected `/api/*` fallbacks while
   unconfigured.

## 9. Rollback

- Dashboard: Workers & Pages → project → Deployments → select the last good deployment →
  **Rollback to this deployment**. No database or state is involved; rollbacks are safe.
- Code: revert the offending commit on `main` and push (this triggers a fresh production
  deployment).

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| "Production branch → No labels found" | GitHub App lacks repository access, wrong GitHub account, or stale branch cache | Section 2 |
| Build fails on `npm ci` / missing files | Repository not fully pushed, or wrong branch than `main` | Check the build log's commit SHA against `git ls-remote origin refs/heads/main` |
| Build fails on Node version | Build image Node older than engines | `.node-version` is committed (22.16.0); optionally set `NODE_VERSION=22.16.0` as a Text variable |
| `/api/lead` or `/api/travel` returns 404 | Functions not included in the deployment | Confirm `functions/` exists at the repository root; for direct uploads run Wrangler from the repo root; check `npx wrangler pages deployment tail` |
| Forms show the honest fallback instead of sending | `PUBLIC_WEB3FORMS_ACCESS_KEY` (build-time) missing, and/or `WEB3FORMS_ACCESS_KEY` (runtime) missing | Set both to the same key, then redeploy |
| `503 not_configured` from `/api/lead` | Runtime secret not set for this environment (Production vs Preview are separate) | Add the secret to the environment being deployed |
| Travel stays in zone mode | `TRAVEL_ORIGIN` missing or malformed (must be `"lat,lng"`) | Set it as a runtime secret; redeploy |
| Environment change appears to have no effect | Variables/secrets apply to the **next deployment** | Retry the deployment or push a commit |
| Site is `noindex` after launch | `PUBLIC_PREVIEW_MODE=true` still set | Remove it and redeploy (section 11) |
| Cloudflare shows "repository used on a different Cloudflare account" | Repository connected to a Pages project in another Cloudflare account | Remove it in that account only if you control it; never modify another company's working setup |

## 11. Launch authorization

Production launch requires ALL of the following, in order:

1. `docs/launch/OWNER-INPUT-REQUIRED.md` BLOCKS PRODUCTION items resolved (Web3Forms key entered,
   `TRAVEL_ORIGIN` set, live form tests received, Stripe methods confirmed, owner approval).
2. **Remove `PUBLIC_PREVIEW_MODE`** from the Production environment and redeploy.
3. Confirm live: `robots.txt` = `Allow: /`; meta robots = `index, follow`; canonical = the
   production domain with trailing slash.
4. Live form delivery confirmed for every category (section 8).
5. Owner approves attaching the custom domain.
6. Attach `sparkling-standard.com` in Pages → Custom domains. Cloudflare manages the DNS in this
   account, so no nameserver changes occur. **Do not touch Google Workspace MX/SPF/DKIM records
   and do not enable Email Routing.**
7. Set `business.launch.productionApproved = true` in `src/config/business.ts` (a deliberate,
   reviewable commit) and run the production gate:
   `node scripts/validate-production-env.mjs` — it must pass.
8. Post-launch: submit the sitemap in Search Console, create the Google Business Profile, and
   regenerate marketing QR assets if the domain changes (`npm run marketing:qr`; every QR is
   decode-verified).

## 12. Optional — Cloudflare Access for the staging URL

`noindex` keeps search engines away; it does not restrict visitors. For genuine access control on
the `*.pages.dev` staging URL, use Zero Trust → Access → Applications → **Self-hosted and
private** → add the pages.dev hostname with an email one-time-PIN policy. Remove or bypass the
Access application before the public launch so real customers are not challenged.

## 13. Reference files

| File | Purpose |
| --- | --- |
| `.node-version` | Pins the build Node version (22.16.0) |
| `.env.example` | Every local variable, documented (template only) |
| `deploy/cloudflare-public-vars.example.json` | Reference list of public dashboard values (not an import file) |
| `deploy/secrets.env.example` | Template for the runtime-secret bulk file (git-ignored when populated) |
| `scripts/generate-deploy-secrets.mjs` | Builds `deploy/secrets.env` from `.env` (`npm run deploy:secrets`) |
| `wrangler.toml.example` | Optional Wrangler CLI configuration template (no secrets) |
| `scripts/validate-production-env.mjs` | Production environment gate |
| `scripts/check-pending-facts.mjs` | Built-output placeholder gate |
