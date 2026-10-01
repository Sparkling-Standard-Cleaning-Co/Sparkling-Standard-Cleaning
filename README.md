# Sparkling Standard Cleaning Co. — digital operating system

Marketing, estimate and lead-capture platform for Sparkling Standard Cleaning Co. (public brand:
"Sparkling Standard"), an owner-operated residential and commercial cleaning company based in
Cantonment and serving Pensacola, surrounding communities within about an hour of Cantonment, and
select nearby areas into Alabama.

This is **not** a brochure site. It is the beginning of a full operating loop:

```
TRAFFIC → ESTIMATE → LEAD → BOOKING REQUEST → CONFIRMED JOB → RECURRING CUSTOMER
       → REVIEW → REFERRAL → ATTRIBUTED REVENUE
```

## Status (October 2026)

- **Pre-launch.** Owner-confirmed: company name, domain (`https://sparkling-standard.com`),
  phone, email, founder background, service territory, Stripe and the Cloudflare account. Still
  pending before production: legal entity spelling, Web3Forms access key, travel origin, analytics
  IDs, review/social profiles and owner launch approval. Preview builds are `noindex, nofollow`,
  and production deployment is blocked by validation until the remaining facts land. See
  `docs/launch/OWNER-INPUT-REQUIRED.md`.
- Everything below works today and is verified by the committed test/validation suite.

## Stack

- **Astro 5** static-first (`output: 'static'`), strict TypeScript, no UI framework
- Self-hosted fonts (Fraunces + Nunito Sans, SIL OFL — `src/styles/fonts.css`)
- Vanilla TS client scripts bundled by Astro (`src/scripts/`) — no framework runtime
- **Cloudflare Pages Functions** for the only two dynamic endpoints (`functions/api/`)
- Node's built-in test runner for estimator unit tests (type-stripped TypeScript)
- Zero paid services required to build, test or self-host

## Local setup

```bash
npm install
cp .env.example .env        # optional for local preview; nothing is required to build
npm run dev                 # http://localhost:4321
```

## Environment variables

All optional for local development; all documented in `.env.example`.

| Variable | Purpose |
| --- | --- |
| `PUBLIC_SITE_URL` | Production canonical origin. Required for production deploys. |
| `PUBLIC_PREVIEW_MODE` | `true` forces `noindex, nofollow` + `Disallow: /`. Never set in production. |
| `PUBLIC_BUSINESS_NAME` / `_LEGAL_NAME` | Owner-approved facts; otherwise `PENDING`. |
| `PUBLIC_BUSINESS_PHONE` / `_EMAIL` | Owner-approved contact facts. |
| `PUBLIC_WEB3FORMS_ACCESS_KEY` | Public client-safe form key (static fallback path). |
| `WEB3FORMS_ACCESS_KEY` | Server-side key used by `functions/api/lead.ts`. |
| `PUBLIC_UMAMI_WEBSITE_ID`, `PUBLIC_GTM_CONTAINER_ID` | Analytics IDs (consent-gated; empty = off). |
| `PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Optional Cloudflare Turnstile spam protection. |
| `TRAVEL_ORIGIN`, `ROUTES_PROVIDER`, `ROUTES_API_KEY` | Server-side travel routing for the estimator. |
| `EIA_API_KEY` | Optional live Gulf Coast gas price feed; falls back to `REFERENCE_GAS_PRICE`. |
| `VEHICLE_MPG`, `INCLUDED_ONE_WAY_MILES`, `MAX_INSTANT_ESTIMATE_DISTANCE`, `TRAVEL_CACHE_SECONDS` | Travel economics. |

## Development, builds and verification

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm run check` | TypeScript/Astro diagnostics (0 errors required) |
| `npm test` | Estimator unit tests (anchors, thresholds, travel, fail-safes) |
| `npm run verify` | `check` + `build` + `validate` (minimum bar) |
| `npm run validate` | Links, SEO, marketing registry, QR decode verification, checklist leak check |
| `npm run pending` | PENDING-fact gate (fails pre-launch **by design**) |
| `npm run validate:production` | Production environment gate (needs real facts) |
| `npm run smoke` | Static smoke test of the built output |
| `npm run audit:facts` | No-fabrication audit of claims |
| `npm run marketing:links` / `marketing:qr` / `marketing:verify` | UTM docs + QR assets |
| `node scripts/photo.mjs <path>` | Photo guardrail (dimensions/size/format) |
| `node scripts/indexnow.mjs` | Submit changed URLs to IndexNow (post-launch) |

## Content and configuration locations

| What | Where |
| --- | --- |
| Business facts (name, phone, hours, area, payments, flags) | `src/config/business.ts` |
| Pricing, labor model, add-ons, policies | `src/config/pricing.ts` |
| Service geography + zones | `src/config/geography.ts` |
| UTM links + QR registry | `src/config/marketing-links.ts` |
| Services / FAQs / checklists / proof / reviews / page copy | `src/content/` |
| Estimator engine | `src/lib/estimate/` |
| Travel providers (routing, fuel) | `src/lib/travel/` |
| Serverless endpoints | `functions/api/` |
| Generated marketing docs | `docs/marketing/UTM-*.md` (do not edit by hand) |

## Estimator architecture (short version)

- `src/lib/estimate/` — types, validation, labor model, condition/frequency factors, add-ons,
  orchestrator with explicit review flags and an internal calculation trace.
- `src/lib/travel/` — provider interfaces (Google Routes / Mapbox), EIA fuel provider, Pure
  travel-adjustment math; everything fails safe to offline ZIP-zone mode.
- The browser computes the estimate (static page, works offline of the APIs); a serverless
  `/api/travel` function upgrades to real route distance + live gas price when keys are set.
- Labor is the currency: a maintained 3/2 anchors at ≈4.5–5.0 labor-hours and a first clean at
  ≈6; all constants live in `src/config/pricing.ts` for recalibration after real jobs
  (`docs/operations/ESTIMATOR-CALIBRATION.md`).
- Internal math (rate per labor-hour, trace) is never displayed to visitors.

## Marketing infrastructure

- Campaign links and QR codes generate from `src/config/marketing-links.ts`
  (`npm run marketing:links`); every QR is independently decode-verified.
- Docs: UTM master registry, "where to paste" cheat sheet, content operating system, 90-day
  launch plan, weekly scorecard, review growth, referral, commercial and STR outreach playbooks
  (all under `docs/marketing/`).

## Deployment

GitHub (`main`) → the company's dedicated Cloudflare Pages project → production. The domain
(`sparkling-standard.com`) is registered, active on Cloudflare DNS, and will be attached as the
Pages custom domain. There is **no wrangler configuration in this repository** — deployment
settings live in the Cloudflare dashboard. The full checklist, including the production gates,
lives in `docs/deployment/DEPLOYMENT.md`:

```
npm run verify
npm run pending            # must pass (blocks while facts are PENDING)
npm run validate:production
```

## Ground rules for contributors (human or AI)

Read `AGENTS.md` first. The short version: never invent a business fact, never publish a
provisional price without approval, keep security/consent server-enforced or fail closed, and
run the verification suite before claiming anything passes.
