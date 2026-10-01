# Operations Hub — Sparkling Standard Cleaning Co.

Single authoritative entry point for the website and digital operating system: the website,
estimate system, lead handling, analytics, marketing system, deployment and maintenance.

A new developer, marketer or agency should be able to start here and find the authoritative
source for every system without asking the owner about anything already documented.

- Repository: `Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning`
- Production domain (not attached yet): `https://sparkling-standard.com`
- Business facts source of truth: `src/config/business.ts`
- Owner input checklist: `docs/launch/OWNER-INPUT-REQUIRED.md`
- Current platform status: `docs/operations/PLATFORM-STATUS.md` (**the only place status lives**)

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
- Consent-gated analytics (GTM → GA4 and Umami, both implemented but not yet configured).
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
- **Deployment status: the Pages project is not yet created.** The Git setup screen currently
  shows "Production branch → No labels found"; the fix procedure is in
  `docs/deployment/DEPLOYMENT.md` §2. Nothing is live yet.
- **Full guide:** `docs/deployment/DEPLOYMENT.md` (build config, variables, secrets, staging
  noindex, validation, rollback, troubleshooting, launch authorization).
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

Funnel verification status (residential, commercial, STR): blocked until the deployment exists
and the Web3Forms key is entered — tracked in `docs/operations/PLATFORM-STATUS.md`.

## 6. Analytics, consent and attribution

- Nothing analytics-related loads before an explicit analytics consent choice; advertising
  consent is never granted. Both services are gated by the same consent controller.
- GTM (with GA4 inside) and Umami are implemented; **no IDs are configured yet**, so the
  consent UI stays hidden. Never reuse another business's IDs.
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
| `npm test` | 45 tests: 27 estimator + 18 Pages Function fail-safe tests |
| `npm run validate` | links, SEO, marketing registry + QR decode, internal-checklist leaks |
| `npm run pending` | no `PENDING` placeholder facts in the built output (also guards JSON-LD) |
| `npm run smoke` | static structure check across 17 pages |
| `npm run testimonials` / `npm run audit:facts` | fake testimonial / unsupported-claim audit |
| `npm run marketing:verify` | registry in sync and every QR decodes to its intended URL |
| `node scripts/validate-production-env.mjs` | production gate (fails until owner inputs land) |
| Browser checks | Playwright/axe methodology and results: `docs/verification/VERIFICATION.md` |

`npm run verify` is the minimum bar for any change. See `docs/verification/VERIFICATION.md` for
what has actually been run and what remains pending.

## 8. Automation inventory (summary)

Full detail — triggers, failure behavior, recovery: `docs/operations/AUTOMATION-REGISTER.md`.

| Automation | Mode | Trigger | Source |
| --- | --- | --- | --- |
| CI validation | Automatic (GitHub Actions) | Push / PR | `.github/workflows/validate.yml` |
| Cloudflare deployment | Automatic once connected | Push to `main` | Cloudflare Pages (not yet created) |
| Marketing docs + QR generation | Manual | `npm run marketing:links` | `scripts/generate-marketing-links.mjs` |
| Brand raster generation | Manual | `node scripts/generate-brand-images.mjs` | brand script |
| Deployment secret packaging | Manual | `npm run deploy:secrets` | `scripts/generate-deploy-secrets.mjs` |
| IndexNow submissions | Manual (post-launch) | `node scripts/indexnow.mjs` | script only; no workflow |
| Lead relay | Event-driven | Form submit | `functions/api/lead.ts` → Web3Forms |
| Content, publishing, follow-up, reviews, pricing calibration | **Manual** | — | No automation exists |

## 9. Current status and outstanding work

Truthful snapshot; the register in `docs/operations/PLATFORM-STATUS.md` is authoritative.

**Done / verified in the repository:**

- Recovered and rebranded site; full verification suite green (type check, build, links, SEO,
  QR decode, checklist leak check, smoke, no-fabrication audit).
- 45/45 tests passing (estimator + function fail-safes).
- Accessibility: axe WCAG 2.0/2.1/2.2 A+AA **0 violations** across 15 pages at 360 px; browser
  layout pass at 360/768/1440 with no overflow and no console errors.
- Brand, pricing research, owner-input checklist, deployment guide and config package committed.

**Blocked / pending (owner):**

- Cloudflare Pages project creation (Git access fix — `docs/deployment/DEPLOYMENT.md` §2).
- Web3Forms key entry; `TRAVEL_ORIGIN`; analytics IDs; Stripe enabled-method confirmation; SMS
  capability; legal entity spelling; review/social profiles; launch approval.

## 10. Documentation directory

**Start here:** `README.md`, this hub, `docs/operations/PLATFORM-STATUS.md`,
`docs/operations/AUTOMATION-REGISTER.md`.

**Launch & operations:** `docs/launch/OWNER-INPUT-REQUIRED.md`,
`docs/launch/PRICING-PROPOSAL.md`, `docs/operations/ESTIMATOR-CALIBRATION.md`,
`docs/operations/SERVICE-SCOPE-MATRIX.md`, `docs/operations/PROPERTY-ACCESS-SECURITY.md`.

**Deployment & verification:** `docs/deployment/DEPLOYMENT.md`,
`docs/verification/VERIFICATION.md`.

**Marketing:** `docs/marketing/90-DAY-LAUNCH-PLAN.md`,
`docs/marketing/CONTENT-OPERATING-SYSTEM.md`, `docs/marketing/LEAD-MEASUREMENT-MODEL.md`,
`docs/marketing/WEEKLY-SCORECARD.md`, `docs/marketing/REVIEW-GROWTH-SYSTEM.md`,
`docs/marketing/REFERRAL-PROGRAM.md`, `docs/marketing/COMMERCIAL-OUTREACH.md`,
`docs/marketing/STR-HOST-OUTREACH.md`, generated UTM docs.

**SEO:** `docs/seo/SEO-STRATEGY.md`.

**Content & design:** `docs/CONTENT-GUIDE.md`, `docs/design/DESIGN-SYSTEM.md`,
`docs/design/IMAGE-GUIDE.md`, `docs/privacy/PHOTO-PRIVACY-SOP.md`.

**Analytics:** `docs/analytics/ANALYTICS-SETUP.md`.

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
| **Marketer** | `docs/marketing/90-DAY-LAUNCH-PLAN.md` | `docs/marketing/CONTENT-OPERATING-SYSTEM.md`, `docs/marketing/WEEKLY-SCORECARD.md`, generated UTM docs |
| **Deployment/ops** | `docs/deployment/DEPLOYMENT.md` | `docs/operations/AUTOMATION-REGISTER.md`, `docs/operations/PLATFORM-STATUS.md` |

## 12. Troubleshooting and escalation

| Symptom | First checks | Escalation |
| --- | --- | --- |
| Cloudflare shows no branches for the repo | `docs/deployment/DEPLOYMENT.md` §2 (GitHub App access) | Owner (Cloudflare dashboard) |
| Build fails | Build log commit SHA vs `git ls-remote origin refs/heads/main`; Node version | Developer |
| Forms show fallback/no delivery | `PUBLIC_WEB3FORMS_ACCESS_KEY` and `WEB3FORMS_ACCESS_KEY` set for the deployed environment; then a live test | Owner (Web3Forms) |
| Travel stays in zone mode | `TRAVEL_ORIGIN` set and `"lat,lng"` formatted | Owner |
| No analytics events | Consent first; IDs configured; analytics UI hidden until IDs exist | Owner (GTM/GA4/Umami) |
| SEO regression / broken links | `npm run verify`, `node scripts/verify-seo.mjs` after build | Developer |
| QR or UTM doc mismatch | `npm run marketing:verify`; regenerate with `npm run marketing:links` | Developer |
| Site `noindex` after launch | `PUBLIC_PREVIEW_MODE` still set | Owner/developer |

**Escalation rule:** the repository can change website code and documentation. It cannot change
Cloudflare settings/DNS, Google Workspace, Web3Forms, Stripe, analytics or social platforms —
those require the owner. Never push to `main` without owner approval (it deploys once connected).
