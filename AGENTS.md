# AGENTS.md — Sparkling Standard Digital Operating System

Authoritative operating instructions for every AI engineering agent (OpenCode and similar)
working in this repository. Read this file fully before changing anything, then read the specific
documentation it links for the system you are touching.

If reality and this file disagree, **reality wins**: verify against the repository, the deployed
site and the owner's current instructions, then correct the documentation in the same session.

## Authority hierarchy

When instructions conflict, resolve them in this order:

1. **The owner's current, explicit instructions and approved business requirements.**
2. **Verified facts** from the current codebase, production configuration and actual platform state.
3. **Current architectural documentation and operating procedures** (this file and `docs/`).
4. **Historical instructions**, reconciled and corrected when superseded.

Never let outdated documentation override verified current information. Never treat a focused
hotfix instruction as the company's permanent engineering philosophy.

## Engineering philosophy — solve the problem completely

Sparkling Standard is engineered to an exceptional professional standard. The objective is the
highest-quality finished product that competes and grows, not the smallest possible diff or the
fastest possible completion.

**Solve the underlying problem, deliver exceptional quality, and avoid unnecessary work.**

Expected professional behavior:

- Do not stop at a superficial fix when the underlying defect remains.
- Do not avoid a necessary refactor merely because it touches multiple files.
- Do not preserve a poor user experience just because it technically functions.
- Do not reject a valuable improvement solely because it falls outside the narrowest reading of a task.
- Do not repeatedly patch symptoms of the same architectural defect.
- Do not claim visual quality based only on passing automated tests.

When a root cause requires coordinated changes across components, shared configuration, server
functions, tests and documentation, make those changes. When an adjacent problem materially
undermines the requested outcome, address it within the owner's authorized scope. At the same time,
distinguish valuable work from scope creep: do not add complexity for its own sake, do not redesign
unrelated pages, and do not churn working systems without a concrete quality or business reason.

### Quality dimensions for every meaningful change

- **Design & presentation** — premium visual execution, typography, spacing, responsive layouts,
  consistent branding, polished interaction states, finished details.
- **Customer experience** — fewer questions, clicks, scrolls and confusing states; no dead ends;
  conversion is exceptionally straightforward.
- **Engineering** — cohesive architecture, maintainable modules, strict typing, appropriate
  abstraction, minimal duplication, reliable error handling, clear responsibilities.
- **Accessibility** — keyboard operation, visible focus, readable errors, screen-reader support,
  properly sized mobile controls, WCAG 2.2 AA expectations.
- **Performance** — fast loading, efficient JavaScript, lazy loading where appropriate, correctly
  sized media, protection from layout shifts.
- **Security & privacy** — credentials, customer data, private operating coordinates, pricing
  integrity and analytics consent are protected; server-enforced where it matters.
- **Commercial effectiveness** — generate legitimate inquiries, communicate trust, explain
  differentiation honestly, remove friction from conversion.
- **Operational maintainability** — the owner or a future developer can understand and safely
  change the system without reverse-engineering it.

Passing tests is a requirement, not proof of quality. UI changes need visual browser verification.

## Project identity and current verified status

- **2026-10-21 owner decision implementation:** 46 decisions applied; public brand **Sparkling Standard**, legal entity **Sparkling Standard LLC**, slogan **Standards That Make Your Space Sparkle.** See `docs/verification/VERIFICATION.md` and the Business HQ workbook.
- Marketing, estimate and lead-capture website for **Sparkling Standard** (legal entity:
  **Sparkling Standard LLC**), an owner-operated residential and commercial cleaning company based
  in Cantonment, serving Pensacola, surrounding communities within about an hour of driving time
  from the private operating origin, and select nearby areas into Alabama.
- Repo: `Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning`. **`main` is the production
  branch and the site is LIVE** at `https://sparkling-standard.com` (Cloudflare Pages connected to
  GitHub; deployment settings live in the Cloudflare dashboard, not in this repository).
- Local dev: http://localhost:4321. Build output: `dist/`.
- **Budget: ZERO additional spending.** Prefer free, low-cost, usage-based, low-lock-in choices.
  Never add billable services, paid APIs, databases, CMS platforms or extra dependencies without
  explicit owner authorization.
- **Operational as of October 2026:** production deployment pipeline; MapMap geocoding + routing
  with the private `TRAVEL_ORIGIN` configured in Cloudflare; Web3Forms lead delivery (owner-
  confirmed); Cloudflare Turnstile optional; **GA4 analytics owner-confirmed operational**
  (`GTM-KSQ26HMG` / `G-LG222LQRQ2`, GTM Version 3 published, all three inquiry key events
  verified); SMS enabled (`business.flags.smsEnabled: true`, owner-verified); eight confirmed
  social profiles rendering (Facebook, Nextdoor, TikTok, Pinterest, Rumble, Gab, Parler, Locals);
  owner-approved circular logo and regenerated favicon/PWA/social assets installed (2026-10-19).
- **Current release (2026-10-21):** the 46-decision owner implementation is the current production release set. Verify the exact deployed SHA with git log -1; Cloudflare Pages and the live site are verified after each push. The historical release note follows.
- **Prior release status:** the 2026-10-03 release was **deployed to production** — `origin/main` =
  `62a1a46` (the five-commit release `8b8dde4`/`03d6ba8`/`53a85aa`/`0f3c38c`/`5a4a024`, the
  documentation closeout `7a51efa`, the social integration `cdc4971`, the deployment-closeout
  `6ebc3fb` and the logo-only Follow Us redesign `62a1a46`), owner-authorized with live
  acceptance checks passed (see `docs/verification/VERIFICATION.md`). Any new local work —
  including later documentation follow-ups — stays unpublished until the owner authorizes another
  push.
- **Marketing phase (2026-10-03):** the business is transitioning from development into active
  marketing. **Immediate execution priorities: film Hayli's founder introduction, produce the
  first cleaning videos and acquire local recurring customers.** Two growth engines (audience
  growth vs. local customer acquisition), priority content platforms (TikTok live; Instagram in
  verification; YouTube deferred; Google Business Profile verified with its profile + review links
  captured), the proposed "30 Days. 30 Details." content plan, the 30-day
  launch schedule and the owner account checklist are documented under `docs/marketing/`. The
  primary business objective is dependable weekly/biweekly residential customers. The owner's
  pending marketing actions live in `docs/launch/OWNER-INPUT-REQUIRED.md` (M2–M7; M1 — the
  software release — was deployed 2026-10-03).
- **Formal launch checklist still outstanding (owner sign-off):** legal entity spelling, insurance/
  bonding/licensing claims, genuine reviews, final cancellation percentages, and any profile
  URLs not yet supplied. `business.launch.productionApproved` remains `false` as the formal
  checklist gate; it does NOT reflect deployment state (the site is live).
- Owner-confirmed facts: name, domain, phone `(850) 426-8479` (corrected 2026-10-02 — the
  earlier `(850) 246-8479` was a typo and must never be reintroduced), email
  `owner@sparkling-standard.com`, founder Hayli, Stripe, Cloudflare DNS.

### THE NO-FABRICATION RULE (non-negotiable)

**Never convert a `PENDING` fact into a public claim. Ever.**

Never invent or "fill in" company/legal names, phone, email, addresses, years in business,
customer/review counts, certifications, insurance, bonding, licenses, employee counts,
testimonials, commercial clients, guarantees, response times, exact pricing, social URLs or review
links. Unknown information must be centralized as `PENDING` in `src/config/business.ts` (or
`.env`), excluded from public claims, and blocked by validation gates before publication.

Never invent reviews, credentials, statistics, client testimonials or unsupported marketing claims.
Never publish unapproved promotional promises or activate binding pricing without authorization.

## Non-negotiable constraints

- **No additional expenditure** or activation of billable external services without explicit owner
  authorization.
- **No fabricated business claims** (see rule above).
- **No leaking** private operating coordinates, customer data, credentials, API keys, tokens or
  session data — into code, logs, tests, commits, docs, analytics, notifications or reports.
- **Sunshine Climate Solutions is a READ-ONLY architectural reference.** Never modify its
  repository; adapt patterns with applicable licenses/attribution preserved.
- **No destructive Git operations** (force push, history rewrite, reset, clean) and no undocumented
  production changes. Never push without explicit owner approval. Never touch Cloudflare settings
  or DNS without authorization.
- **Publication discipline:** provisional pricing and unapproved promotions stay internal behind
  their publication flags. Nothing customer-visible ships without the flag and the owner approval.

## Verified architecture

- **Astro 5, `output: 'static'`, strict TypeScript** (`astro/tsconfigs/strictest` + explicit `.ts`
  import extensions for Node-test compatibility). No client framework, no CSS framework, no CMS,
  no database.
- `trailingSlash: 'always'`; canonical domain from `PUBLIC_SITE_URL`; sitemap excludes 404,
  thank-you and leave-review.
- **Single sources of truth** (never hard-code these facts elsewhere):
  - `src/config/business.ts` — every business fact, contact channel, socials, launch flags,
    publication flags.
  - `src/config/pricing.ts` — pricing, labor model, add-ons, promotions, discounts, policies,
    publication flags (`provisional` / `approved`).
  - `src/config/travel.ts` — shared client/server travel economics.
  - `src/config/geography.ts` — ZIP→zone reference and zone policy (preliminary, not addresses).
  - `src/config/marketing-links.ts` — inbound UTM links and QR assets.
- **Content collections** (`src/content.config.ts`, Zod-validated): `services` (seven owning
  pages), `faqs`, `checklists` (`public | internal`; internal must never render publicly),
  `proof` (intentionally empty until genuine material exists), `reviews` (carries the two
  authentic owner-supplied Google reviews since 2026-10-23 — never fabricate more), `site` (page copy).
- Pages are thin wrappers. The estimator engine lives in `src/lib/estimate/`; travel logic in
  `src/lib/travel/`; address/location logic in `src/lib/location/`. Arithmetic never lives in pages.
- The estimate flow collects a **confirmed destination**: GPS "Use My Current Location" first, with
  an expandable manual address section (closed by default), MapMap suggestions through
  `/api/geocode`, a manual fallback, and a lazy-loaded MapLibre GL + OpenFreeMap pin confirmation.
  A confirmed pin is the only destination source — never let a ZIP centroid silently replace it.
  GPS/manual modes are isolated: the selected method is the only source of the submitted address.
  A suggestion the provider only knows at street level opens the same pin confirmation and records
  `pin_precision: 'street'` — the exact house number is never fabricated and travel stays preliminary.
- The **promotion engine** (`src/lib/estimate/promotions.ts`) is pure and shared by the browser
  estimator and server verification: at most ONE promotion per quote, owner-gated, term-gated,
  minimum-job floor enforced, specialty work excluded, customer-kind programs fail closed. All
  shipped programs are disabled — never enable or publish one without the owner's written terms, the
  `docs/launch/PROMOTION-PROPOSALS.md` review and a `configVersion` bump.
- Client-side JS is minimal, bundled by Astro from `src/scripts/` (no framework). The estimator
  computes in the browser so the instant estimate works on a fully static page. A browser price is
  a PROPOSAL: every priced reservation request is recalculated server-side
  (`src/lib/estimate/verify.ts` via `functions/api/lead.ts`); client price/coordinate/verdict
  fields are never trusted. A GPS destination without a resolvable ZIP is priced from its confirmed
  pin and stays **preliminary** — never represented as a server-verified street address.
- Serverless functions live in `functions/api/` (Cloudflare Pages Functions) for geocoding, travel
  lookup and the lead relay. **Secrets only ever live in the function environment** (Cloudflare).
- Styles: `src/styles/tokens.css` (design tokens), `global.css` (component styles), `fonts.css`
  (generated). Use tokens only — never raw colors, spacing or font sizes.
- Analytics: nothing loads before an explicit analytics consent choice; Umami/GTM/GA4 are gated by
  the same consent controller. Event names are a closed taxonomy
  (`src/lib/analytics/events.ts`) with allowlisted payload keys. Never send names, emails, phones,
  addresses, ZIPs, photos, form contents or anything you would not publish on a billboard.
  Attribution (UTMs, referrer, ad click ids) is captured for LEAD RECORDS only.
- Brand assets: browser/PWA icons and the social preview come from the owner-approved circular
  logo (2026-10-19) and are generated together by `node scripts/generate-logo-assets.mjs`
  (`public/favicon.ico`, `favicon.svg`, `favicon-16/32/48/64/96/128/256.png`,
  `public/brand/apple-touch-icon.png`, `icon-192/512.png`, `icon-maskable-512.png`,
  `og-default.png`, `logo-mark*.svg`). The historical
  `node scripts/generate-brand-images.mjs` command aliases the same generator. Do not overwrite
  the approved icons with older artwork.

## System map — where the source of truth lives

| System | Source of truth | Detailed docs |
| --- | --- | --- |
| Business facts, contact, socials, launch/publication flags | `src/config/business.ts`, `.env` | `docs/launch/OWNER-INPUT-REQUIRED.md` |
| Pricing, labor model, add-ons, promotions, discounts | `src/config/owner-pricing.ts` (owner-editable values) + `src/config/pricing.ts` (typed config/flags) | `docs/launch/PRICING-PROPOSAL.md`, `docs/operations/OWNER-SETTINGS-GUIDE.md` |
| Travel economics, included miles, zone adjustments | `src/config/travel.ts`, `src/config/geography.ts` | `docs/operations/ESTIMATOR-LOCATION-ENGINE.md` |
| Location selection, geocoding, GPS/manual modes | `src/scripts/address-finder.ts`, `src/lib/location/`, `functions/api/geocode.ts` | `docs/operations/ESTIMATOR-LOCATION-ENGINE.md` |
| Quote calculation and server verification | `src/lib/estimate/` (`calculate.ts`, `quote.ts`, `verify.ts`, `validation.ts`) | `docs/verification/VERIFICATION.md` |
| Promotions, bundles, Founding-10 (all disabled) | `src/lib/estimate/promotions.ts` + `src/config/owner-pricing.ts` | `docs/launch/PROMOTION-PROPOSALS.md` |
| Lead notification formatting | `src/lib/forms/lead-notification.ts` + `functions/api/lead.ts` | `docs/operations/LEAD-NOTIFICATION-FORMAT.md` |
| Customer confirmation + financial workflow + invoicing | `functions/api/lead.ts` (delivery), `src/lib/forms/customer-email.ts` (Resend), `src/lib/forms/customer-confirmation.ts`, `src/lib/forms/request-summary.ts`, `src/lib/forms/submission-receipt.ts`, `src/scripts/thank-you-summary.ts`, `src/lib/invoicing/invoice.ts`, `scripts/customer-confirmation.mjs`, `scripts/commercial-invoice.mjs` | `docs/operations/CUSTOMER-CONFIRMATION-EMAIL.md`, `docs/operations/FINANCIAL-WORKFLOW.md`, `docs/operations/COMMERCIAL-INVOICING.md`, `docs/deployment/DEPLOYMENT.md` §4a |
| Reservation window, statuses, ledger | `src/config/scheduling.ts` + `src/scripts/estimate-wizard.ts` | `docs/operations/RESERVATION-TRACKING.md` |
| Gift certificates (sales disabled pending approval) | `src/config/gift-certificates.ts`, `src/lib/gift/`, `src/pages/gift-certificates/`, `functions/api/gift-checkout.ts`, `functions/api/stripe-webhook.ts` | `docs/operations/GIFT-CERTIFICATES.md`, `docs/operations/COMMUNICATION-TEMPLATES.md` |
| Platform accounts, status, owner actions | `src/config/business.ts` `socials` + `src/components/SocialLinks.astro` | `docs/marketing/PLATFORM-REGISTER.md`, `docs/marketing/MULTIPLATFORM-OPERATING-PLAN.md` |
| Lead capture, notification fields, provider relay | `functions/api/lead.ts`, `src/lib/forms/` | `docs/verification/VERIFICATION.md` |
| Services, FAQs, checklists, page copy | `src/content/`, `src/content/site/` | `docs/CONTENT-GUIDE.md` |
| SEO, structured data, sitemap, robots, page ownership | `src/components/BaseHead.astro`, `src/lib/schema.ts`, page files | `docs/seo/SEO-STRATEGY.md`, `docs/operations/SEARCH-CONSOLE-SETUP.md` |
| Analytics, consent, event taxonomy, attribution | `src/scripts/consent-controller.ts`, `src/lib/analytics/`, `src/lib/attribution.ts` | `docs/analytics/ANALYTICS-SETUP.md`, `docs/analytics/GTM-CONTAINER-SETUP.md` |
| Visual design, tokens, images, icons, OG image | `src/styles/`, `public/brand/`, `src/assets/images/` | `docs/design/DESIGN-SYSTEM.md`, `docs/design/IMAGE-GUIDE.md`, `docs/design/IMAGE-SOURCE-REGISTER.md` |
| Photo privacy rules | `docs/privacy/PHOTO-PRIVACY-SOP.md` |
| UTM links and QR assets | `src/config/marketing-links.ts` | `docs/marketing/UTM-MASTER-LINKS.md`, `docs/marketing/WHERE-TO-PASTE-UTM-LINKS.md` |
| Marketing strategy, growth engines, platform priorities | — | `docs/marketing/WEEKLY-EXECUTION-PLAYBOOK.md` (execution front door), `docs/marketing/GROWTH-SYSTEM.md` (spine: flywheel, weekly loop, roadmap; subsystems `COMPETITIVE-STRATEGY.md`, `CONTENT-ENGINE.md`, `FIELD-CONTENT-CAPTURE.md`, `VIDEO-DIRECTING-SHEETS.md`, `CUSTOMER-LIFECYCLE.md`, `ACQUISITION-CHANNELS.md`, `LOCAL-AUTHORITY.md`, `ECONOMIC-MODEL.md`), `docs/marketing/MULTIPLATFORM-OPERATING-PLAN.md`, `docs/marketing/CONTENT-OPERATING-SYSTEM.md` |
| Social account setup (owner checklist) | `src/config/business.ts` `socials` | `docs/marketing/SOCIAL-ACCOUNT-SETUP.md`, `docs/marketing/PLATFORM-REGISTER.md` |
| Content production, proposed series, video workflow | — | `docs/marketing/CONTENT-PRODUCTION-SYSTEM.md` |
| Marketing → business reporting hierarchy | `docs/marketing/LEAD-MEASUREMENT-MODEL.md` | `docs/marketing/WEEKLY-SCORECARD.md` |
| Canvassing intelligence (neighborhood scoring, routes, workbook) | `scripts/canvass/` (public county parcel + ACS data; canonical `route_object.json`; outputs in git-ignored `canvass-out/`) | `docs/marketing/CANVASSING-SYSTEM.md`, `docs/marketing/CANVASSING-TOP-NEIGHBORHOODS.md`, `docs/marketing/CANVASSING-ROUTES-OVERVIEW.md`, `docs/marketing/field-acquisition/ROUTE-PLANNING.md` |
| Physical acquisition / print system (8 pieces × 3 variants, PPTX masters, print PDFs) | `scripts/print/` (brand-locked generator; outputs to `~/Downloads/Door Knocking - Stage 2 Review/` by default) + `src/config/brand.ts` mark + `src/config/marketing-links.ts` QR registry | `docs/brand/PHYSICAL-BRAND-SYSTEM-AUDIT.md`, `docs/marketing/field-acquisition/` (design decisions, manifest, specs, QR assignments, owner editing, privacy) |
| Launch schedule and owner approvals | — | `docs/marketing/90-DAY-LAUNCH-PLAN.md`, `docs/launch/OWNER-INPUT-REQUIRED.md` |
| Owner-confirmed decisions and outstanding approvals | `src/config/business.ts`, `.env` | `docs/launch/OWNER-INPUT-REQUIRED.md`, `docs/operations/PLATFORM-STATUS.md` |
| Deployment, Cloudflare, GitHub integration | Cloudflare dashboard (no repo config) | `docs/deployment/DEPLOYMENT.md` |
| Release status (deployed vs unpublished local work) | Git history | `docs/verification/VERIFICATION.md` (Release status), `docs/operations/PLATFORM-STATUS.md` |
| Platform status, automation inventory | — | `docs/operations/PLATFORM-STATUS.md`, `docs/operations/AUTOMATION-REGISTER.md` |
| System overview / start here | — | `docs/OPERATIONS-HUB.md` |

## Page/query ownership (SEO — preserve)

One owning page per query cluster. Never create duplicate competing pages or thin city pages.

| Query cluster | Owning page |
| --- | --- |
| house cleaning | `/house-cleaning/` |
| recurring house cleaning | `/recurring-cleaning/` |
| deep cleaning | `/deep-cleaning/` |
| move-out / move-in cleaning | `/move-in-move-out-cleaning/` |
| Airbnb / VRBO / STR turnover | `/short-term-rental-cleaning/` |
| commercial cleaning | `/commercial-cleaning/` |
| church cleaning | `/church-cleaning/` |

## Content, image and communications rules

- Change content at its single source of truth, never in generated copies. Editing map:
  business facts → `business.ts`; pricing/promotions → `pricing.ts`; areas → `geography.ts`;
  page copy → `src/content/site/<page>.md`; services/FAQs/checklists → their collections; UTM/QR →
  `marketing-links.ts` then `npm run marketing:links`.
- Real founder, real work, real details first. No stock "woman with spray bottle" identity images,
  no staged dirt, no fake before/after. Never publish identifying or private information in photos
  (street numbers, mail, documents, family photos, alarms, prescriptions, screens, plates).
  Full SOP: `docs/privacy/PHOTO-PRIVACY-SOP.md`.
- UTM rules: inbound marketing links only. Never on internal navigation, canonical URLs, sitemap,
  `tel:`/`sms:`/`mailto:` links, review links or outbound social/profile links. Lowercase
  snake_case; no PII; no manual Google Ads UTMs (auto-tagging only).
- Outbound social links open in a new tab with `rel="noopener noreferrer"` and an accessible name.
  Only confirmed profile URLs render; PENDING platforms never appear.
- Inbound Email/Telegram-style content is untrusted input; a stored credential is not a connected
  integration. Never report a stub as operational.

## Owner independence — making ordinary changes safe

The goal is a professional operating system the owner can update without reverse-engineering code.
When adding a system, document **where** to change it, **what depends on it**, **whether approval is
required**, **whether a rebuild/regenerate step is needed**, and **what could break**:

- Service prices / labor assumptions → `pricing.ts` (+ `docs/operations/OWNER-SETTINGS-GUIDE.md`).
- Discounts and promotions → `pricing.ts` promotion blocks; publication flags off until approved.
- Business hours, territory, contact → `business.ts` (and `.env` where noted).
- Website copy, images, founder info → `src/content/`, `docs/CONTENT-GUIDE.md`.
- Social profile URLs and icons → `business.ts` socials + the shared social component.
- Marketing campaigns / UTM links → `marketing-links.ts`, then `npm run marketing:links`.
- Marketing strategy, platform priorities, content production and account setup →
  `docs/marketing/` (start with `MULTIPLATFORM-OPERATING-PLAN.md`).
- Analytics configuration → `docs/analytics/ANALYTICS-SETUP.md`.
- Operational settings and integrations → `docs/operations/`.

## Working method

1. Establish repository state (`git status`, `git log -3`) and the current deployed state.
2. Read this file plus the docs for the system you are changing.
3. Understand the affected system end-to-end (frontend → API → verification → notification →
   tests) and identify the desired outcome before editing.
4. Change the single source of truth. Keep reusable product code organization-neutral.
5. Implement the complete solution; add focused tests that prove the behavior.
6. Run focused tests, then the appropriate broader validation for the risk. UI changes require
   real browser verification (desktop + mobile viewports); never claim physical-device testing
   that did not occur.
7. Investigate failures; never weaken or delete legitimate tests to get green.
8. Update documentation in the same change when behavior, rules or status change.
9. Review the actual diff. Commit small, coherent commits with clear messages (per-phase).
10. Report evidence: commands run, actual results, what remains unverified.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run check` | `astro check` — TypeScript diagnostics (must be 0 errors) |
| `npm test` | Full unit suite: estimator, quote verification, address ranking, promotions, Page Functions (Node test runner, type-stripped TS) |
| `npm run test:browser` | Playwright browser regression suite (builds first) |
| `npm run address:check` | Live address-pipeline check against the real provider (local `.env` key; prints results only, never secrets) |
| `npm run promotions:impact` | Internal financial model for the disabled promotion proposals |
| `npm run verify` | `check` + `build` + `validate` — minimum bar for any change |
| `npm run validate` | Links, SEO, marketing registry, QR decode, checklist leak checks |
| `npm run links` / `npm run seo` | Focused broken-link / SEO checks on `dist/` |
| `npm run pending` | PENDING-fact gate (fails while genuine blockers remain) |
| `npm run testimonials` | Fake-testimonial / fixture detector |
| `npm run audit:facts` | No-fabrication claim audit |
| `npm run smoke` | Static smoke test over `dist/` |
| `npm run validate:production` | Production environment gate (formal pre-launch checklist) |
| `npm run marketing:links` | Regenerate UTM docs + decode-verified QR codes |
| `npm run analytics:gtm` | Regenerate the GTM import files (`--check` mode via `analytics:gtm:verify`) |
| `node scripts/generate-logo-assets.mjs` | Regenerate the circular logo's favicon/PWA/social assets (historical alias: `generate-brand-images.mjs`) |
| `node scripts/fetch-fonts.mjs` | Refresh self-hosted fonts |

Build notices like "The collection 'proof' does not exist or is empty" are expected while those
collections are intentionally empty — not errors.

## Git safety and deployment

- **Never push without explicit owner authorization.** A push to `main` triggers the production
  deployment.
- Line endings are LF-normalized (`.gitattributes`: `text=auto eol=lf`). Generated marketing
  documents are byte-compared by validation; never commit CRLF variants. Keep repository-local
  `core.autocrlf=false` on Windows clones.
- Use repository-local Git identity only (`git config --local`); never change global config.
- Never force push, rewrite history, reset, clean, stash-pop/drop, delete branches, or touch
  Cloudflare/DNS without explicit authorization.
- Commit small, per approved phase. Review `git status --short`, `git diff --stat` and `git diff`
  before committing. Never stage unrelated or untracked files you did not create.
- Do not run automatic dependency upgrades, `npm audit fix`, or unrelated "cleanup."
- Owner-supplied files that do not belong in the site (browser saved-page dumps, redundant
  downloads, temp HTML) must be moved outside the repository and preserved — never committed.

## Current operational / provisional / pending snapshot

- **Operational:** production site and deploy pipeline, estimator (GPS + manual + street-level
  pin confirmation for streets the provider only knows by name), MapMap geocode and routing,
  Web3Forms delivery, consent-gated GTM container installation with verified website event
  generation, SMS, eight confirmed social profiles (Facebook, Nextdoor, TikTok, Pinterest,
  Rumble, Gab, Parler, Locals), the owner-approved circular logo/favicon kit (2026-10-19),
  sitemap/robots, quote verification and owner notification. Published hours are **7:00 a.m. –
  7:00 p.m., seven days per week**, sitewide. A new recurring residential maintenance arrangement
  requires a **Deep Cleaning first, without exception**; the estimator requires explicit
  acknowledgment and the lead relay rejects a recurring request without it.
- **Corrective refinement (2026-10-23, owner audit):** the homepage trust banner carries the
  owner's four values — **Locally Owned** (house-heart mark), **Flexible Scheduling** (calendar
  with the numeral 7), **Christian Values** (cross), **Competitive Pricing** (four dollar signs,
  ONE filled, three outlined) — in a rose-and-cream strip (`src/components/TrustChips.astro`).
  Both hero CTAs are equal-sized; Explore Services uses the inverse treatment (cream fill, rose
  lettering) and the script "Sparkling" sits centered on its own headline line. The services
  section head is centered. The estimate CTA section and the service-area section are centered;
  the service-area copy ends with "Not sure if you're within range?". The header logo renders at
  6rem (4.35rem on phones). Founder portrait label reads "Founder / Owner-Operator". Photo
  captions read "Project photos are added only with customer approval." Proposed prices round
  **DOWN** to the nearest $5 (owner-approved), and travel assumes a 35-mile round trip
  (17.5 one-way included). Quote `configVersion` is `2026-10-23.floor5-travel35.v1`.
- **Smart Estimate System 2.0 (2026-10-24, owner directive):**
  - **Address reliability:** an exact-address resolve that no provider could pinpoint no longer
    dead-ends — when the typed query carries a KNOWN 5-digit ZIP, the resolve action returns the
    ZIP-reference centre as an APPROXIMATE result (functions/api/geocode.ts). The customer can
    drag the pin to the real property or confirm the approximate area; the confirmed location
    carries `precision: 'approximate'`, travel stays preliminary everywhere (live panel, summary,
    notification "Approximate ZIP-area pin — confirm the exact address"), and it is NEVER
    presented as a verified street address. Suggestions show 3–5 rows.
  - **House Cleaning removed as an offering (additional owner directive):** "House Cleaning" no
    longer appears in the footer SERVICES column, the navigation dropdowns, or the estimator's
    service selection (the option reads "Residential Cleaning"). `/house-cleaning/` remains as an
    SEO information page that routes visitors to Recurring Residential Cleaning and Deep Cleaning
    — never deleted, never a broken link, never presented as a third service.
  - **Customer photos (architecture in, production DISABLED):** optional estimator section "Help
    Us Get to Know Your Space" (bathroom/kitchen/living area; STR switches to bedrooms/laundry
    categories). Uploads POST directly to functions/api/photo-upload.ts → PRIVATE Cloudflare R2
    (`PHOTOS_BUCKET` binding) with server-generated keys, magic-byte validation and size caps;
    owner-only retrieval via functions/api/photo-view.ts + `PHOTO_OWNER_TOKEN`. The section stays
    hidden until the GET probe reports `enabled: true` — nothing fakes an upload. Provisioning:
    docs/operations/PHOTO-UPLOADS.md.
  - **STR turnover context:** the estimator's STR path adds optional check-out/check-in times and
    a linen/laundry preference (informational — the per-turnover price is unchanged); all three
    travel with the request into the owner notification.
  - **Commercial tiers (architecture in, numeric estimates PENDING OWNER APPROVAL):**
    src/config/commercial-tiers.ts holds the Tier A/B/C model with configurable thresholds
    (~2,500 sqft Tier A boundary is the owner's PROPOSAL, not approved policy). While
    `numericEstimatesEnabled: false`, every commercial request routes to Tier C (walkthrough
    quote). The commercial intake form now collects cleanable sqft, restrooms, kitchen/breakroom,
    condition and specialty needs — all labeled in the owner notification. Model analysis:
    docs/launch/COMMERCIAL-ESTIMATE-MODEL.md.
  - **Future booking roadmap (documentation only):** docs/operations/BOOKING-ARCHITECTURE.md
    defines the state machine (Estimate → Request Submitted → Owner Approved → Reserved →
    Confirmed → Paid) and the recommended additions. NOTHING is auto-booked and no payment is
    collected.
- **Premium icon collection (2026-10-24, owner-supplied artwork):** the six service icons
  and four company-value icons are the owner's premium vector tiles
  (`src/assets/icons/premium/`, rendered by `src/components/PremiumIcon.astro` with the
  type registry in `src/lib/premium-icons.ts`). The tiles carry their own rose/ivory
  gradients, drop shadows and gold accents — **never add a CSS chip/plate background
  around them (no nested tiles) and never substitute stock or redrawn icons**. The
  services content `icon` field holds the premium slugs (`recurring-residential`,
  `deep-cleaning`, `move-in-move-out`, `short-term-rental`, `commercial-cleaning`,
  `church-cleaning`). Competitive Pricing uses the WIDE recommended asset (four dollar
  signs, ONE filled, three outlined) with the exact copy "Quality service at an
  affordable price"; Christian Values carries the three owner-supplied KJV New Testament
  excerpts (Galatians 5:13, Mark 12:31, Colossians 3:23 — shortened passages marked as
  excerpts); Locally Owned and Flexible Scheduling keep their approved copy. The trust
  banner is a 2-column grid from tablet up to give the verses room. Church Cleaning's
  tile renders on the church page (no sixth homepage card). The estimator's Preferred
  date helper reads exactly "Requests can be made up to 60 days in advance." (the
  Hayli-confirmation sentence was removed by owner direction). Registry documentation:
  `docs/design/PREMIUM-ICON-REGISTER.md`.
- **Authentic reviews live (2026-10-23):** the homepage reviews section renders the two
  genuine Google reviews (Christina Sherwin, Richard Lionhart — owner-supplied verbatim, 5 stars
  each) as cards with the authentic star rating, plus a link to the verified Google reviews
  destination. Never fabricate additional reviews; new genuine entries render automatically.
- **Service-driven estimator questionnaire (2026-10-23 finishing pass):** the selected cleaning
  service determines which questions exist — `src/lib/estimate/service-matrix.ts` is the single
  source of truth for service/frequency compatibility: **Residential house cleaning** offers
  one-time + weekly/biweekly/monthly; **Deep Cleaning, Move-in/Move-out and STR turnover are
  one-time services** (the rhythm question is hidden, the value normalizes to `one_time`, stale
  values clear on service switches, and the shared validator REJECTS invalid combinations —
  never silently repriced). Commercial/church cleaning use their walkthrough request forms, not
  the instant estimator. The quote display presents **Estimated Price** (one-time) or
  **First Visit — Deep Cleaning** + **Ongoing Visits** (recurring) with a grouped request
  summary (Cleaning details / Schedule / Location, full-width address rows). Quote
  `configVersion` remains `2026-10-23.floor5-travel35.v1`. The service-area map uses
  collision-aware label placement (county labels pinned away from the city cluster; Cantonment
  centered above its marker); the About page carries no hero CTA, no detail-first slogan
  section and no four-card banner (owner removals); the homepage hero carousel and the service
  cards use DISTINCT photographs.
- **Two-price recurring quotes (2026-10-23):** a NEW recurring residential arrangement is quoted
  as its required FIRST VISIT (a Deep Cleaning computed at the one-time/deep rate — this is the
  price the customer submits and the server verifies), with the ongoing per-visit rhythm shown
  alongside (`EstimateResult.ongoing`, wizard live panel/summary, `first_visit_total` /
  `ongoing_price_per_visit` / `ongoing_frequency` submission fields, server-owned in the lead
  relay). The SPARKLE100 campaign discounts ONLY the first visit and only when the customer's
  arrangement is weekly or biweekly (`campaignArrangement` in
  `src/lib/estimate/promotions.ts`); the ongoing rhythm is never discounted.
- **Homepage refinement (2026-10-23):** the homepage hero carries a four-slide representative
  interior carousel (`src/components/HeroCarousel.astro`, auto-advance respects
  prefers-reduced-motion, pauses on hover/focus), the trust strip sits directly under the hero,
  a Southern-hospitality section follows, and the five service cards are photo cards
  (honest licensed interiors; see `docs/design/IMAGE-SOURCE-REGISTER.md`). The recurring page
  has its own dedicated `src/pages/recurring-cleaning.astro` (owner-directed structure) and is
  excluded from `[service].astro`. The footer is a centered masthead (logo + slogan with the
  script "Sparkle." finish + Follow Us) over a responsive four-column grid; the footer offers
  Leave Us a Review only (the Read Our Google Reviews link moved out with the redesign), and
  the social Google icon is the official four-color G.
- **Address reliability (2026-10-02):** state matching parses both full names and USPS codes;
  partially typed street names match by safe prefix; same-state results rank by proximity to the
  public Pensacola centre; provider alternates include suffix expansion and a house-numberless
  street-level fallback. Exact house numbers are never fabricated. Live checks:
  `npm run address:check`. Rules and evidence: `docs/operations/ESTIMATOR-LOCATION-ENGINE.md`.
- **Premium header + platform registry (2026-10-02):** the header/footer brand lockup uses the
  owner-approved circular mark (2026-10-19): script "Sparkling" above spaced "STANDARD" inside a
  gold ring with sparkles, with no "Cleaning Co." or tagline in the visual logo; the
  complete platform inventory (19 platforms) is prepared in `business.socials`, rendered only when
  a confirmed URL exists, and documented in `docs/marketing/PLATFORM-REGISTER.md`. Google Business
  Profile is **verified with its profile + review links captured (owner-supplied 2026-10-08)** —
  use the exact supplied URLs, never modify or construct them.
- **Social profiles + Follow Us icons (2026-10-03; GBP added 2026-10-08):** the owner supplied six
  additional profile
  URLs (TikTok, Pinterest, Rumble, Gab, Parler, Locals) — eight social profiles render in the
  Follow Us section (plus the verified Google Business Profile, 2026-10-08) as **logo-only 52px
  circular buttons** (one tidy row on desktop/tablet, rows capped at four on phones — nine
  profiles wrap as 4 + 4 + 1 — natural wrapping for future profiles). Platform names are visually
  hidden but remain each link's explicit accessible name. Icons use official marks, including
  Nextdoor's house-"n" favicon, the official Gab and Parler marks and the official Locals logo
  (`src/components/SocialIcon.astro` documents each source). **The owner confirms the basic
  tracked UTM links are placed on all eight** (registry entries active). **Instagram is
  undergoing verification** and **YouTube is deferred** by new Google Workspace account
  eligibility (not abandoned; no paid workarounds); never render a PENDING platform or publish an
  unconfirmed URL. Tracked links and the checklist: `docs/marketing/SOCIAL-ACCOUNT-SETUP.md`.
- **Circular logo kit (2026-10-19):** the owner replaced the old crest + descriptor + tagline
  lockup with a single circular mark — script "Sparkling" above spaced "STANDARD" inside a gold
  ring with sparkles. `logoSvg()` in `src/config/brand.ts` is the shared artwork; regenerate the
  favicon/PWA/social assets with `node scripts/generate-logo-assets.mjs`. The full legal name
  remains in metadata, structured data and the footer copyright. Do not add symbols, descriptors
  or slogans to the mark without a new owner decision.
- **GA4 operational (owner-confirmed 2026-10-03):** after the container was found empty, the owner
  published GTM Version 3 (`GTM-KSQ26HMG`) with one Google tag, 12 event tags, 12 triggers and 7
  data-layer variables. GA4 `G-LG222LQRQ2` receives page views, `estimate_start` and all three
  inquiry events end-to-end (site confirmation + owner email + GA4 event); all three are key
  events; Enhanced Measurement form interactions are disabled; consent tests passed. The prepared
  import files (`docs/analytics/gtm-import/*.json`, generated by `scripts/generate-gtm-import.mjs`,
  checked by `npm run validate`) remain a rebuild reference. The live account configuration is
  authoritative — never republish/overwrite it or add a second Google tag.
- **Attribution repair (2026-10-03):** first-touch is captured once; latest-touch updates only for
  a genuinely new campaign/ad click. Internal navigation, refreshes and direct views never erase
  campaign context, and same-domain referrers are never referrals. Lead emails label first-touch
  and latest-touch source/medium/campaign/content separately
  (`docs/operations/LEAD-NOTIFICATION-FORMAT.md`). The fix applies to future attribution only;
  already-delivered emails are unchanged.
- **Advance reservations and gift certificates (2026-10-03):** requests are bounded to a
  configurable 60-day window (`src/config/scheduling.ts`) with no priority tier; reservation
  statuses and the private ledger workflow live in `docs/operations/RESERVATION-TRACKING.md`.
  Gift certificates are live in **request mode only** (`enabled: false`): Stripe Checkout and the
  signature-verified webhook exist but are dormant until the owner approves terms/denominations
  and configures the secrets; the printable certificate tool is `npm run gift:certificate`
  (output in git-ignored `gift-out/`). Never enable sales or advertise amounts without the written
  owner decisions in `docs/launch/OWNER-INPUT-REQUIRED.md` (G1–G5).
- **Lead-notification format (2026-10-02):** owner emails are built by
  `src/lib/forms/lead-notification.ts` (ordered sections, customer email as reply-to, mismatch
  action warning, raw technical codes separated). Format and testing:
  `docs/operations/LEAD-NOTIFICATION-FORMAT.md`. Never weaken the `extra_ref` trap, error
  classification or Turnstile retry handling from the submission fix.
- **Founder portrait + representative imagery (2026-10-03):** the About page presents the
  owner-supplied portrait of Hayli (`src/assets/images/hayli-founder.webp`, converted from the
  owner's `public/Headshot.jpg`) with the visible identification "Hayli, Founder & Owner-Operator"
  and natural portrait proportions — genuine owner material, never cropped to a stock ratio and
  not reused on unrelated pages. Licensed stock interiors (Pexels License, no cost) remain on the
  homepage, labeled representative — never presented as our work. Source/licence register:
  `docs/design/IMAGE-SOURCE-REGISTER.md`. Replace remaining stock with genuine, permissioned
  photography when it exists.
- **Provisional (internal only, publication flags off):** add-on pricing surface, multi-add-on
  incentive, response guarantee, appreciation discounts, add-on bundles, Founding-10 program and
  market comparisons. The promotion engine applies at most one discount, never below the minimum
  job, and always fails closed without owner-approved terms. Financial review:
  `docs/launch/PROMOTION-PROPOSALS.md`; regenerate with `npm run promotions:impact`.
- **Pending owner input:** legal entity spelling/suffix, insurance/bonding/licensing claims,
  Instagram verification, the deferred
  YouTube channel (Google Workspace eligibility), Umami website ID, final cancellation
  percentages, marketing-launch approvals (M2–M7; M1 deployed 2026-10-03), the Resend
  customer-email setup (`RESEND_API_KEY` + sender-domain verification — `DEPLOYMENT.md` §4a) and
  any marketing claim not yet supplied. (Google Business Profile is **verified with its profile +
  review links captured**, owner-supplied 2026-10-08.)
- Current platform details: `docs/operations/PLATFORM-STATUS.md`. Owner checklist:
  `docs/launch/OWNER-INPUT-REQUIRED.md` (marketing approvals are grouped there as M2–M7).
