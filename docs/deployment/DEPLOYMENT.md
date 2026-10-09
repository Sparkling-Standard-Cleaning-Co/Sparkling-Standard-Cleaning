# Cloudflare deployment guide — Sparkling Standard Cleaning Co.

Single authoritative deployment document. If anything here disagrees with the actual code or
dashboard, stop and reconcile before deploying. Owner-confirmed facts live in
`src/config/business.ts`; the owner-input checklist lives in
`docs/launch/OWNER-INPUT-REQUIRED.md`.

- Repository: `Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning`
- Cloudflare Pages project: `sparkling-standard-cleaning`
- Production branch: `main`
- **Production website: LIVE at `https://sparkling-standard.com`** (custom domain attached;
  verified 2026-10-02 — see `docs/operations/PLATFORM-STATUS.md`)
- Runtime: Cloudflare Pages + Pages Functions (`functions/`), Astro 5 static build

The site is live. `business.launch.productionApproved` is still `false` as the formal
owner-checklist gate (legal name, insurance/licensing wording, final cancellation
percentages) — it does **not** describe deployment state. Any push to `main` triggers a live
production deployment: treat every commit to `main` as publishing.

## 1. Exact build configuration

| Setting | Value |
| --- | --- |
| Git provider / repository | GitHub, `Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning` only |
| Production branch | `main` |
| Preview deployments | **Not used by owner decision (2026-10-02).** Production deploys from `main` only; no preview environment variables, preview secrets, Cloudflare Access or preview infrastructure are configured or required. A temporary `PUBLIC_PREVIEW_MODE=true` staging deploy remains available if ever needed (section 6) |
| Framework preset | Astro (if offered) or None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `/` (repository root) |
| Node.js | 22.16.0 via the committed `.node-version` file (Pages V3 image default; equivalent to setting `NODE_VERSION=22.16.0`) |
| Functions | `functions/` at the repository root is picked up automatically (`/api/lead`, `/api/travel`, `/api/geocode`) |
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
- Three Pages Functions (all configured on production as of 2026-10-02):
  - `POST /api/lead` — validates and relays form submissions to Web3Forms using the runtime
    `WEB3FORMS_ACCESS_KEY`; returns `503 not_configured` when the key is missing so the client can
    use its static fallback instead of showing a false success. After the owner notification is
    accepted, it sends the branded customer confirmation through Resend when `RESEND_API_KEY` is
    configured (see section 4a); a customer-email failure never fails the lead.
  - `POST /api/travel` — route distance/duration + Gulf Coast gasoline reference; live and verified
    on production. Returns `503 origin_not_configured` only when `TRAVEL_ORIGIN` is missing; the
    estimator keeps working in offline zone mode either way.
  - `POST /api/geocode` — server-side address suggestions/resolution/reverse proxy. Provider keys
    stay in the function environment; the private travel origin is never read or returned here.
- Outbound calls: `api.web3forms.com`, `api.resend.com` (customer confirmation, optional),
  `api.mapmap.ai` (addresses + routing), `geocoding.geo.census.gov`
  (free fallback), `api.eia.gov` (optional), `challenges.cloudflare.com` (Turnstile, optional).

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
| `RESEND_API_KEY` | Optional (customer email) | `functions/api/lead.ts` → `src/lib/forms/customer-email.ts` | The customer confirmation is skipped; the lead, the owner notification and the on-page summary are unaffected. Server-side only — never a `PUBLIC_*` value |
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
| `RESEND_FROM_EMAIL` | `Sparkling Standard Cleaning Co. <notifications@sparkling-standard.com>` | Sender for the customer confirmation; change only to another **verified** sender in Resend |
| `RESEND_REPLY_TO` | `owner@sparkling-standard.com` | Customer replies reach the owner directly |

### 4a. Customer confirmation email (Resend) — owner setup

The customer confirmation is sent by `functions/api/lead.ts` through Resend **after** the owner
notification is accepted. Until the setup below is complete, the code path is inert
(`skipped_not_configured` / provider rejection) and the lead flow is unaffected.

**Status 2026-10-08 (owner-confirmed + live-tested):** steps 1–3 are complete —
`RESEND_API_KEY` is set in Cloudflare as a runtime Secret and `sparkling-standard.com` is verified
in Resend (DNS complete; no `PUBLIC_RESEND_*` variable exists). Step 5 is done (deployed via
`c8a9723`, with the ZIP fix `f92719c`); step 6's controlled live test was submitted through the
production estimate wizard and passed every engineering-observable stage (submission `200`,
server-verified quote, exactly one customer-email send attempted, thank-you summary, analytics
events once, no errors). **Inbox delivery of the two emails is the remaining owner confirmation.**

1. **Owner:** create/log in to the Resend account for the business (free tier is sufficient for
   current volume) and create an API key. Store it as a Cloudflare **Secret** named
   `RESEND_API_KEY` (never a `PUBLIC_*` variable; never committed). ✅ done 2026-10-08
2. **Owner:** add the sending domain `sparkling-standard.com` in Resend → Domains. Resend shows
   the exact DNS records it needs (typically a sending subdomain with SPF/DKIM records). Add those
   records in Cloudflare DNS **exactly as Resend shows them**, set to DNS-only (never proxied).
   - Do **not** change the existing Google Workspace MX, SPF (`v=spf1`) or DKIM records — the
     Resend records belong on the sending subdomain Resend specifies. ✅ done 2026-10-08
3. Wait for Resend to report the domain **Verified**. Only then will sends from
   `notifications@sparkling-standard.com` be accepted. ✅ done 2026-10-08
4. Optional: set `RESEND_FROM_EMAIL` / `RESEND_REPLY_TO` as dashboard **Text** variables to
   override the defaults (only to another verified sender).
5. Trigger a new deployment so the Functions receive the secret. ✅ deployed 2026-10-08
6. **One controlled live test (owner-approved only):** submit one clearly marked test request
   using an address the owner controls (e.g. the owner's own email as the "customer" address) and
   confirm: the owner notification arrives, the customer confirmation arrives from the verified
   sender, the subject is `We received your Sparkling Standard request`, and replying to it
   reaches `owner@sparkling-standard.com`. No other live test email is ever sent.
   ✅ submitted 2026-10-08 (`SS Live Form Test`, both emails addressed to the owner inbox) —
   **awaiting the owner's inbox confirmation**.

Failure behavior (by design): if Resend rejects or fails, the function logs
`customer-confirmation: failed (provider N)` server-side — no PII, no secrets — and still returns
success to the customer, because the lead was already delivered. The on-page thank-you summary is
always shown immediately.

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

## 6. Staging and previews (owner decision: not used)

**The owner does not use Cloudflare preview environments.** No preview branches, preview
environment variables, preview secrets or Cloudflare Access applications are configured or
required. Production deploys from `main` only; a non-`main` branch is a normal Git branch, not a
deployment target.

Reviewing a change before it reaches customers is done with:

1. `npm run check && npm test && npm run test:browser` locally, and
2. `npm run build && npm run preview` for a local copy of the production build.

If a temporary, noindexed staging URL is ever needed, build with `PUBLIC_PREVIEW_MODE=true`
(that single pre-existing mechanism forces `noindex, nofollow` plus `robots.txt Disallow: /`) and
deploy it deliberately rather than enabling preview infrastructure. Never leave
`PUBLIC_PREVIEW_MODE` set on the production environment.

## 7. Validation gates

Local, before any deploy (all must pass):

```
npm run verify                 # astro check + build + links/SEO/QR/checklist validation
npm test                       # full unit suite (estimator, API, promotion, address ranking)
npm run test:browser           # Playwright browser regression suite (builds first)
npm run address:check          # live address-pipeline check (needs the local .env provider key)
npm run pending                # no PENDING placeholder facts in the built output
node scripts/validate-production-env.mjs   # production gate — formal owner checklist items
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

## 11. Formal production approval (the site is already live)

The live site and pipeline are verified operational. `business.launch.productionApproved` remains
`false` as the **formal owner checklist gate** (legal entity spelling, insurance/bonding/licensing
claims, genuine reviews, final cancellation percentages, remaining profile URLs). Closing it
requires ALL of the following:

1. `docs/launch/OWNER-INPUT-REQUIRED.md` items resolved (legal name, claims, genuine reviews,
   remaining profile URLs, final cancellation percentages).
2. Confirm live: `robots.txt` = `Allow: /`; meta robots = `index, follow`; canonical = the
   production domain with trailing slash; `PUBLIC_PREVIEW_MODE` is NOT set in Production.
3. Live form delivery confirmed for every category (section 8), with any test submission clearly
   marked as a test in its subject and body.
4. Owner approves the remaining business claims in writing.
5. Set `business.launch.productionApproved = true` in `src/config/business.ts` (a deliberate,
   reviewable commit) and run the production gate:
   `node scripts/validate-production-env.mjs` — it must pass.
6. Ongoing: keep the sitemap current in Search Console, maintain the Google Business Profile, and
   regenerate marketing QR assets if the domain changes (`npm run marketing:qr`; every QR is
   decode-verified).

## 12. Cloudflare Access — not used

The owner does not use Cloudflare Access. Production is the public website; there is no
access-controlled staging surface to manage. If an isolated environment is ever genuinely
required, treat it as a separate, explicitly approved project rather than adding Access to this
one.

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
