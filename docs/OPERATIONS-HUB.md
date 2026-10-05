# Operations Hub — Sparkling Standard Cleaning Co.

Single authoritative entry point for the website and digital operating system: the website,
estimate system, lead handling, analytics, marketing system, deployment and maintenance.

A new developer, marketer or agency should be able to start here and find the authoritative
source for every system without asking the owner about anything already documented.

- Repository: `Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning`
- Production domain: `https://sparkling-standard.com` (**live**)
- Business facts source of truth: `src/config/business.ts`
- Owner input checklist: `docs/launch/OWNER-INPUT-REQUIRED.md`
- Current platform status: `docs/operations/PLATFORM-STATUS.md` (**the only place status lives**)
- Marketing entry point: `docs/marketing/MULTIPLATFORM-OPERATING-PLAN.md`

## 1. Executive overview

Sparkling Standard Cleaning Co. is an owner-operated residential and commercial cleaning company
based in Cantonment, Florida, serving Pensacola, surrounding communities within about an hour's
drive, and select nearby areas into Alabama. The differentiator is detail: estimates are built on
real labor hours, and the company sells a standard that rushed production cleaning cannot match.

This repository is the company's marketing and lead system:

- Astro 5 static site: home, seven service pages, service area, estimate wizard, about, FAQ,
  contact, privacy, terms, thank-you, leave-review, 404.
- A six-step instant estimate engine with travel/fuel architecture and fail-safe behavior.
- Pages Functions for lead relay (`/api/lead`) and travel lookup (`/api/travel`).
- Consent-gated analytics, owner-confirmed operational: GTM container `GTM-KSQ26HMG` loads only
  after consent and GA4 `G-LG222LQRQ2` receives page views, `estimate_start` and the three inquiry
  key events (`docs/analytics/ANALYTICS-SETUP.md`). Umami is implemented but has no website ID.
- A UTM/QR attribution system with a central registry and decode-verified assets.
- Owner-facing launch, pricing, marketing and verification documentation.

## 2. Architecture at a glance

```text
                        OWNER / FIELD WORK
                               │
   ┌───────────────────────────┼──────────────────────────────┐
   │                           │                              │
 WEBSITE                    SEARCH / LOCAL                 SOCIAL
 Astro static               Google Business Profile        Facebook · Instagram
 business.ts = facts        Search Console · Bing (later)   TikTok · Nextdoor
   │                           │                              │
   └───────────────┬───────────┴──────────────┬───────────────┘
                   │                          │
              ANALYTICS                    LEADS
   GTM → GA4 (consent-gated)     Instant estimate → /api/lead → Web3Forms
   Umami (cookieless, gated)     Direct call / email to owner@sparkling-standard.com
   fixed event names only        no CRM — owner-managed follow-up
                   │
             MARKETING SYSTEM
   src/config/marketing-links.ts → UTM docs + QR assets (generated, verified)
```

Every arrow maps to an authoritative document — see §10.

## 3. Source-of-truth files

| What | File | Rules |
| --- | --- | --- |
| Business facts | `src/config/business.ts` | Never hard-code phone, email, name, area or claims elsewhere; confirmed facts are defaults, env can override |
| Pricing, labor model, policies | `src/config/pricing.ts` | Provisional values are internal; publication flags gate display; no rate change without owner approval |
| Service zones | `src/config/geography.ts` | Provisional ZIP zones; exact origin is private (`TRAVEL_ORIGIN`, server-side only) |
| Campaign links + QR registry | `src/config/marketing-links.ts` | Generated docs/QRs are never hand-edited (`npm run marketing:links`) |
| Page copy | `src/content/site/*.md`, `src/content/services/*.md`, `src/content/faqs/*.md` | Zod-validated; business facts still come from `business.ts` |
| Internal checklists | `src/content/checklists/*.md` | `visibility: internal` must never render publicly |
| Estimator engine | `src/lib/estimate/` | Arithmetic never lives in pages |
| Travel providers | `src/lib/travel/` | Factors, provider interfaces, fail-safe fallbacks |
| Serverless endpoints | `functions/api/` | Secrets only in the function environment |
| Permanent engineering rules | `AGENTS.md` | Read before changing anything |

## 4. Website and deployment

- Astro 5, `output: 'static'`, strict TypeScript; no framework, no CMS, no database.
- **Deployment:** GitHub `main` → the company's own Cloudflare Pages project
  (`sparkling-standard-cleaning`). Build `npm run build`, output `dist`, Node 22.16.0
  (`.node-version`). Pages Functions in `functions/` deploy automatically.
- **Deployment status: live and indexable (owner-approved 2026-10-01).**
  `https://sparkling-standard.com` serves the Git-connected project; every push to `main`
  deploys. Never introduce noindex/disallow; keep intentionally excluded utility pages
  excluded. Full guide: `docs/deployment/DEPLOYMENT.md`.
- `PUBLIC_PREVIEW_MODE=true` produces a noindex build and is used for the temporary pages.dev
  staging deployment only. It must be removed before launch. Noindex is not access control.
- URLs are permanent; there is no redirect mechanism in a static build.

## 5. Lead flow (estimate → inbox)

1. Visitor starts the six-step estimate at `/estimate/` (runs entirely in the browser).
2. A range is shown for in-area homes; out-of-area or unusual jobs route to personal
   confirmation instead of a guessed number.
3. The visitor submits a request. The client posts to `/api/lead`; the function validates,
   applies spam checks (Turnstile when configured), and relays to Web3Forms using the server key.
4. If the function is not configured (`503`), the client falls back to a direct Web3Forms
   submission using the public key. If neither path is configured, the visitor sees an honest
   message plus call/email alternatives — **never a fake success**.
5. The owner receives the inquiry at `owner@sparkling-standard.com` and replies personally.
   There is no CRM; follow-up is manual.

Funnel verification status: **live and owner-confirmed (2026-10-01)** — all four funnels deliver to
the owner inbox (four marked tests confirmed). Details:
`docs/verification/VERIFICATION.md`.

## 6. Analytics, consent and attribution

- Nothing analytics-related loads before an explicit analytics consent choice; advertising
  consent is never granted. Both services are gated by the same consent controller.
- The GTM container (`GTM-KSQ26HMG`) loads only after an explicit analytics choice. The owner
  published GTM Version 3 on 2026-10-03 (one Google tag, 12 event tags, 12 triggers, 7 variables);
  GA4 `G-LG222LQRQ2` is **owner-confirmed operational** — page views, `estimate_start` and the
  three inquiry key events verified end-to-end, Enhanced Measurement form interactions disabled,
  consent tests passed. The import files in `docs/analytics/gtm-import/` remain a rebuild
  reference; the live account configuration is authoritative. Umami is implemented but **has no
  website ID yet**. Never republish/overwrite the container, add a second Google tag, or reuse
  another business's IDs.
- Event names are a closed, fixed taxonomy (`src/lib/analytics/events.ts`); payloads are
  allowlisted. **Never send names, emails, phones, addresses, form contents or any PII to
  analytics.**
- UTM/attribution is captured for lead records only. Registry:
  `src/config/marketing-links.ts`; generated docs in `docs/marketing/`.
- Honest limits: a click is not a call; a form start is not a submission; an estimate is not a
  booking. Estimates are requests, not confirmations.

## 7. Verification tooling

| Command | Checks |
| --- | --- |
| `npm run verify` | astro check (0 errors) + build + full static validation |
| `npm test` | 291 unit tests: estimator, quote verification, attribution, promotions, Page Functions |
| `npm run test:browser` | 77 Playwright tests incl. analytics generation, attribution and consent |
| `npm run validate` | links, SEO, marketing registry + QR decode, GTM import artifacts, internal-checklist leaks |
| `npm run pending` | no `PENDING` placeholder facts in the built output (also guards JSON-LD) |
| `npm run smoke` | static structure check across the built pages |
| `npm run testimonials` / `npm run audit:facts` | fake testimonial / unsupported-claim audit |
| `npm run marketing:verify` | registry in sync and every QR decodes to its intended URL |
| `npm run analytics:gtm:verify` | GTM import artifacts match the fixed event taxonomy |
| `node scripts/validate-production-env.mjs` | production gate (fails until owner inputs land) |
| Browser checks | Playwright/axe methodology and results: `docs/verification/VERIFICATION.md` |

`npm run verify` is the minimum bar for any change. See `docs/verification/VERIFICATION.md` for
what has actually been run and what remains pending.

## 8. Automation inventory (summary)

Full detail — triggers, failure behavior, recovery: `docs/operations/AUTOMATION-REGISTER.md`.

| Automation | Mode | Trigger | Source |
| --- | --- | --- | --- |
| CI validation | Automatic (GitHub Actions) | Push / PR | `.github/workflows/validate.yml` |
| Cloudflare deployment | Automatic (live) | Push to `main` | Cloudflare Pages project (Git-connected) |
| Marketing docs + QR generation | Manual | `npm run marketing:links` | `scripts/generate-marketing-links.mjs` |
| GTM import artifact generation | Manual | `npm run analytics:gtm` | `scripts/generate-gtm-import.mjs` |
| Brand raster generation | Manual | `node scripts/generate-brand-images.mjs` | brand script |
| Deployment secret packaging | Manual | `npm run deploy:secrets` | `scripts/generate-deploy-secrets.mjs` |
| IndexNow submissions | Manual (post-launch) | `node scripts/indexnow.mjs` | script only; no workflow |
| Lead relay | Event-driven | Form submit | `functions/api/lead.ts` → Web3Forms |
| Content, publishing, follow-up, reviews, pricing calibration | **Manual** | — | No automation exists |

## 9. Current status and outstanding work

Truthful snapshot; the register in `docs/operations/PLATFORM-STATUS.md` is authoritative.

**Done / verified:**

- Production site live and indexable; all funnels deliver to the owner inbox (owner-confirmed);
  MapMap geocoding + routing live; GA4 owner-confirmed operational with the three inquiry key
  events; consent behavior verified.
- Full verification suite green at the last run: `npm run check` 0 errors, **291 unit tests**,
  **77 browser tests**, build (21 pages), `validate`, `pending`, `testimonials`, `audit:facts`,
  `smoke` (2026-10-03).
- Accessibility: axe WCAG 2.0/2.1/2.2 A+AA 0 violations; layout passes at 360/768/1440 with no
  overflow.

**Released:** the owner-authorized 2026-10-03 release set — `8b8dde4`, `03d6ba8`, `53a85aa`,
`0f3c38c`, `5a4a024`, `7a51efa`, `cdc4971`, `6ebc3fb` and `62a1a46` — is **deployed**;
`origin/main` = `62a1a46`; live acceptance checks passed (`docs/verification/VERIFICATION.md`),
including the eight-profile logo-only Follow Us section. Any later local documentation follow-up
stays unpublished until the owner authorizes another push.

**Pending (owner):** marketing launch actions M2–M7 in
`docs/launch/OWNER-INPUT-REQUIRED.md` — confirm Google Business Profile verification, create the
priority social accounts, approve the proposed content plan and film/publish the opening content.
Formal launch checklist items (legal entity spelling, claims, genuine review link, final
cancellation percentages) and Stripe enabled-method confirmation also remain open.

## 10. Documentation directory

**Start here:** `README.md`, this hub, `docs/operations/PLATFORM-STATUS.md`,
`docs/operations/AUTOMATION-REGISTER.md`.

**Launch & operations:** `docs/launch/OWNER-INPUT-REQUIRED.md`,
`docs/launch/PRICING-PROPOSAL.md`, `docs/launch/REVENUE-READINESS-PLAN.md`,
`docs/operations/ESTIMATOR-CALIBRATION.md`,
`docs/operations/ESTIMATOR-LOCATION-ENGINE.md`, `docs/operations/OWNER-SETTINGS-GUIDE.md`,
`docs/operations/SEARCH-CONSOLE-SETUP.md`,
`docs/operations/SERVICE-SCOPE-MATRIX.md`, `docs/operations/PROPERTY-ACCESS-SECURITY.md`,
`docs/operations/CAPABILITY-REVIEW.md`.

**Deployment & verification:** `docs/deployment/DEPLOYMENT.md`,
`docs/verification/VERIFICATION.md`.

**Marketing:** start with `docs/marketing/MULTIPLATFORM-OPERATING-PLAN.md` (strategy, two growth
engines, priorities). Then `docs/marketing/CONTENT-OPERATING-SYSTEM.md` (pillars/roles),
`docs/marketing/CONTENT-PRODUCTION-SYSTEM.md` (proposed series + video workflow),
`docs/marketing/SOCIAL-ACCOUNT-SETUP.md` (owner account checklist),
`docs/marketing/PLATFORM-REGISTER.md` (account status),
`docs/marketing/90-DAY-LAUNCH-PLAN.md` (schedule), `docs/marketing/LEAD-MEASUREMENT-MODEL.md`
(reporting hierarchy), `docs/marketing/WEEKLY-SCORECARD.md`, `docs/marketing/REVIEW-GROWTH-SYSTEM.md`,
`docs/marketing/REFERRAL-PROGRAM.md`, `docs/marketing/COMMERCIAL-OUTREACH.md`,
`docs/marketing/STR-HOST-OUTREACH.md`, `docs/marketing/COMPETITIVE-COMPARISON.md`,
`docs/marketing/LEAD-LEDGER-TEMPLATE.csv`, generated UTM docs.
Canvassing intelligence: `docs/marketing/CANVASSING-SYSTEM.md` (methodology and pipeline),
`docs/marketing/CANVASSING-TOP-NEIGHBORHOODS.md` (objective ranking),
`docs/marketing/CANVASSING-ROUTES-OVERVIEW.md` (route totals and strategic analysis); the
address-level database, workbook, route sheets and map are generated locally into git-ignored
`canvass-out/` by `scripts/canvass/`.

**SEO:** `docs/seo/SEO-STRATEGY.md`.

**Content & design:** `docs/CONTENT-GUIDE.md`, `docs/design/DESIGN-SYSTEM.md`,
`docs/design/IMAGE-GUIDE.md`, `docs/privacy/PHOTO-PRIVACY-SOP.md`.

**Analytics:** `docs/analytics/ANALYTICS-SETUP.md` (current state + event taxonomy),
`docs/analytics/GTM-CONTAINER-SETUP.md` (container rebuild reference).

### Documentation governance

- Code/config is authoritative; generated documents are regenerated, never hand-edited.
- Current operational status lives only in `docs/operations/PLATFORM-STATUS.md`; historical
  records stay historical.
- Never describe something as automated without a trigger and source in the automation register.
- Never publish fabricated reviews, photos, projects, certifications or claims.
- No credentials, customer PII or private operating coordinates anywhere in the repository.
- New systems and documents must be linked from this hub.

## 11. Role onboarding

| Role | Start here | Then |
| --- | --- | --- |
| **Owner** | `docs/operations/PLATFORM-STATUS.md` (outstanding actions) | `docs/launch/OWNER-INPUT-REQUIRED.md`, `docs/deployment/DEPLOYMENT.md` |
| **Developer** | `AGENTS.md` | `docs/deployment/DEPLOYMENT.md`, `src/config/business.ts`, `docs/verification/VERIFICATION.md` |
| **Marketer** | `docs/marketing/MULTIPLATFORM-OPERATING-PLAN.md` | `docs/marketing/90-DAY-LAUNCH-PLAN.md`, `docs/marketing/CONTENT-PRODUCTION-SYSTEM.md`, `docs/marketing/SOCIAL-ACCOUNT-SETUP.md`, `docs/marketing/WEEKLY-SCORECARD.md`, generated UTM docs |
| **Deployment/ops** | `docs/deployment/DEPLOYMENT.md` | `docs/operations/AUTOMATION-REGISTER.md`, `docs/operations/PLATFORM-STATUS.md` |

## 12. Troubleshooting and escalation

| Symptom | First checks | Escalation |
| --- | --- | --- |
| Cloudflare shows no branches for the repo | `docs/deployment/DEPLOYMENT.md` §2 (GitHub App access) | Owner (Cloudflare dashboard) |
| Build fails | Build log commit SHA vs `git ls-remote origin refs/heads/main`; Node version | Developer |
| Forms show fallback/no delivery | `PUBLIC_WEB3FORMS_ACCESS_KEY` and `WEB3FORMS_ACCESS_KEY` set for the deployed environment; then a live test | Owner (Web3Forms) |
| Travel stays in zone mode | `TRAVEL_ORIGIN` set and `"lat,lng"` formatted | Owner |
| No analytics events | Consent first (nothing loads before a choice); GA4 is owner-confirmed operational — recheck the GTM container state (`GTM-KSQ26HMG`) against `docs/analytics/GTM-CONTAINER-SETUP.md` before changing anything; never republish/overwrite the live version; Umami awaits a website ID | Owner (GTM container + GA4 property; Umami ID optional) |
| SEO regression / broken links | `npm run verify`, `node scripts/verify-seo.mjs` after build | Developer |
| QR or UTM doc mismatch | `npm run marketing:verify`; regenerate with `npm run marketing:links` | Developer |
| Site `noindex` after launch | `PUBLIC_PREVIEW_MODE` still set | Owner/developer |

**Escalation rule:** the repository can change website code and documentation. It cannot change
Cloudflare settings/DNS, Google Workspace, Web3Forms, Stripe, analytics or social platforms —
those require the owner. Never push to `main` without owner approval (it deploys once connected).
