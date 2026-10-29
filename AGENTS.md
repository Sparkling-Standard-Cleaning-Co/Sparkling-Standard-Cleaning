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
  (`GTM-KSQ26HMG` / `G-LG222LQRQ2`; owner reports GTM Version 5, earlier Version 3 receipt of all
  three inquiry key events verified; new church/promotion event receipt pending); SMS enabled (`business.flags.smsEnabled: true`, owner-verified); Stripe Pay Now live-mode readiness true with no live charge test performed; twelve active profiles rendering (Google Business Profile, Facebook, Nextdoor, Instagram, TikTok,
  YouTube, Pinterest, Rumble, Gab, Parler, Locals, X);
  owner-approved circular logo and regenerated favicon/PWA/social assets installed (2026-10-19).
- **Current release:** **`7bb91ff`** is live (Cloudflare Pages deployment `5529baa6-591b-4501-b40f-8d23f6f273b9`; GitHub `validate` and `browser` for run `40783479501`, and Cloudflare checks passed). It includes the booking-hold minute-boundary fix, distributed persisted gift-admin rate limiting, no-store financial-page headers, daily photo-cleanup preparation, immediate gift delivery with future valid-from activation at midnight America/Chicago, the Workers-compatible 100,000-iteration PBKDF2 fix, and the residential pricing work. Gift sales remain disabled; Pay Now remains verified-exact-quote only; no live card charge or Stripe gift refund was performed. Hayli's enrollment succeeded 2026-10-28; verified-email recovery is still an owner test.
- **Prior Initiative 6.8:** live at `6e36c95` plus the HEIC test-stability fix `9fe8764` (Cloudflare Pages deployments `2a0d4f21-8eb8-49b0-b298-f086e3c7473b` and `4afab04f-9f97-47b5-bb2c-778aa7b6f745`; `validate`, `browser` and Cloudflare checks passed). It implements the three-page owner audit: prices stay hidden through every preliminary estimator step and are revealed at the final stage with a shared branded animation across all four engines; the owner-supplied **two-of-four** Competitive Pricing badge is installed; homepage service cards use one equal-height grid; KJV scripture is expanded through a shared component; and all transactional forms require an unchecked-by-default, server-verified terms acceptance with a private R2 record. The public Terms were expanded with Florida cancellation/gift research, condition/access, payment/refund, damage, safety, recurring, commercial/church, dispute and version rules. Gift certificates remain in **request mode** (sales disabled) because no owner-approved denominations/fulfillment activation were supplied; live calendar booking is **not connected**, so preferred dates remain requests and no fake availability is shown. No new cancellation/reassessment fee is active; owner and Florida counsel approval gates are documented in `docs/legal/TERMS-RESEARCH.md` and `docs/launch/OWNER-INPUT-REQUIRED.md`. No pricing mathematics changed.
- **Prior Initiative 6.7:** live at `f111014`; checkout readiness now checks key, webhook secret/endpoint, notifier, ledger and mode; verified-only quotes, explicit price-change acceptance, SHA-256 checkout idempotency with R2 session reuse, durable webhook event claims, retryable notifications, safe cancellation/status pages and no duplicate lead on payment retry. Production `/api/estimate-checkout` is live mode with all readiness checks true. No live card charge or Stripe test-mode transaction was performed.
- **Prior Initiative 6.6:** live at `0b907d4` (Cloudflare Pages deployment `26e3b9f8-7665-426f-8687-7f171588c865`); it completed the 13-page owner audit, approved homepage/Community Support/Deep Cleaning/Service Area copy, FL/AL state restriction, GPS loading, optional facility ZIP, centered facility intros, add-on bundles, and the original Pay Now/reservation path. Private legal records were organized in the master archive.
- **Prior Initiative 6.5:** live at `298c1df` (deployment `f9b4f61a-58d1-4ff3-8535-c375af8789fc`); automatic estimator configuration, validation gate, pricing fingerprint and four-engine impact report remain intact; all calibration factors remain `1.00`.
- **Prior Initiative 6.4:** live at `685031d` (deployment `f9dea1a0-5b55-4cd8-b09e-18efae73c68a`); the 18-county map, reading-glasses/red-white-blue icons, footer/navigation/copy corrections and four `1.00` calibration factors remain intact.
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
  growth vs. local customer acquisition), priority content platforms (Instagram, TikTok and YouTube live; Google Business Profile verified
  with its profile + review links captured; X active), the proposed "30 Days. 30 Details." content plan, the 30-day
  launch schedule and the owner account checklist are documented under `docs/marketing/`. The
  primary business objective is dependable weekly/biweekly residential customers. The owner's
  pending marketing actions live in `docs/launch/OWNER-INPUT-REQUIRED.md` (M2–M7; M1 — the
  software release — was deployed 2026-10-03).
- **Formal launch checklist still outstanding (owner sign-off):** insurance/
  bonding/licensing claims, genuine reviews, final cancellation percentages, and any profile
  URLs not yet supplied. The legal entity spelling is owner-confirmed and supported by the
  Florida Articles certificate in the private master archive. `business.launch.productionApproved` remains `false` as the formal
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
  payment-success, thank-you and leave-review.
- **Single sources of truth** (never hard-code these facts elsewhere):
  - `src/config/business.ts` — every business fact, contact channel, socials, launch flags,
    publication flags.
  - `src/config/estimators/pricing-values.ts` — raw owner-editable pricing, labor model, add-ons,
    promotions, discounts and thresholds.
  - `src/config/pricing.ts` — typed approval/notes wrapper consumed by the estimator.
  - `src/config/estimators/input-definitions.ts` — customer input options and validation limits.
  - `src/config/estimators/commercial.ts` — commercial/church pricing switch and tier triggers.
  - `src/config/estimators/travel.ts` — shared client/server travel economics.
  - `src/config/geography.ts` — ZIP→zone reference and zone policy (preliminary, not addresses).
  - `src/config/marketing-links.ts` — inbound UTM links and QR assets.
- **Content collections** (`src/content.config.ts`, Zod-validated): `services` (seven owning
  pages), `faqs`, `checklists` (`public | internal`; internal must never render publicly),
  `proof` (intentionally empty until genuine material exists), `reviews` (carries the three
  authentic owner-supplied Google reviews since 2026-10-24 — never fabricate more), `site` (page copy).
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
  `docs/launch/PROMOTION-PROPOSALS.md` review; the automatic effective-pricing version changes when the approved terms change.
- Client-side JS is minimal, bundled by Astro from `src/scripts/` (no framework). The estimator
  computes in the browser so the instant estimate works on a fully static page. A browser price is
  a PROPOSAL: every priced reservation request is recalculated server-side
  (`src/lib/estimate/verify.ts` via `functions/api/lead.ts`); client price/coordinate/verdict
  fields are never trusted. A GPS destination without a resolvable ZIP is priced from its confirmed
  pin and stays **preliminary** — never represented as a server-verified street address.
- Serverless functions live in `functions/api/` (Cloudflare Pages Functions) for geocoding, travel
  lookup, the lead relay and server-verified Stripe estimate payments. **Secrets only ever live
  in the function environment** (Cloudflare).
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
| Pricing, labor model, add-ons, owner-approved bundles, promotions, discounts, four engine calibration factors, Community Support discount | `src/config/estimators/pricing-values.ts` (owner-editable values) + `src/config/pricing.ts` (typed config/flags) | `START-HERE-OWNER-CONTROL-CENTER.md`, `docs/ESTIMATOR-CONTROL-CENTER.md`, `docs/launch/PRICING-PROPOSAL.md`, `docs/operations/ESTIMATE-CALCULATION-ORDER.md` |
| Customer input options, labels and limits | `src/config/estimators/input-definitions.ts` + the two estimator form components | `docs/ESTIMATOR-CONTROL-CENTER.md` |
| Travel economics, included miles, zone adjustments | `src/config/estimators/travel.ts`, `src/config/geography.ts` | `docs/ESTIMATOR-CONTROL-CENTER.md`, `docs/operations/ESTIMATOR-LOCATION-ENGINE.md` |
| Location selection, geocoding, GPS/manual modes | `src/scripts/address-finder.ts`, `src/lib/location/`, `functions/api/geocode.ts` | `docs/operations/ESTIMATOR-LOCATION-ENGINE.md` |
| Quote calculation and server verification | `src/lib/estimate/` (`calculate.ts`, `quote.ts`, `verify.ts`, `validation.ts`, `facility-verify.ts`, `tax.ts`) | `docs/verification/VERIFICATION.md`, `docs/operations/TAX-TREATMENT.md`, `docs/operations/ESTIMATE-CALCULATION-ORDER.md` |
| Secure Pay Now / reservation choice | `src/config/payments.ts`, `functions/api/estimate-checkout.ts`, `functions/api/stripe-webhook.ts`, `src/pages/estimate/payment-success.astro`, `src/scripts/payment-success.ts` | `docs/operations/ESTIMATE-PAYMENTS.md` |
| Four estimate engines (residential `/estimate/residential/`, STR `/estimate/str/`, commercial `/estimate/commercial/`, church `/estimate/church/`) + 10% church discount | `src/lib/estimate/engines.ts`, `commercial.ts`, `church-discount.ts`, `src/components/EstimateHub.astro`, `FacilityEstimateForm.astro`, `src/pages/estimate/` | `docs/operations/ESTIMATOR-ENGINES.md` |
| Commercial/church facility pricing (provisional Tier A/B) + owner kill switch + completed initial calibration | `src/config/estimators/commercial.ts` (`numericEstimatesEnabled`), `src/config/estimators/pricing-values.ts` (`commercialPricing`), `src/lib/estimate/calibration.ts`, `npm run commercial:calibration`, `npm run calibration:report` | `docs/operations/ESTIMATOR-ENGINES.md`, `docs/operations/COMMERCIAL-PRICING-RESEARCH.md`, `docs/operations/FACILITY-CALIBRATION.md` |
| Promotions and Founding-10 (disabled) + three owner-approved add-on bundles | `src/lib/estimate/promotions.ts` + `src/config/estimators/pricing-values.ts` | `docs/launch/PROMOTION-PROPOSALS.md`, `docs/operations/ESTIMATE-CALCULATION-ORDER.md` |
| Lead notification formatting | `src/lib/forms/lead-notification.ts` + `functions/api/lead.ts` | `docs/operations/LEAD-NOTIFICATION-FORMAT.md` |
| Customer confirmation + financial workflow + invoicing | `functions/api/lead.ts` (delivery), `src/lib/forms/customer-email.ts` (Resend), `src/lib/forms/customer-confirmation.ts`, `src/lib/forms/request-summary.ts`, `src/lib/forms/submission-receipt.ts`, `src/scripts/thank-you-summary.ts`, `src/lib/invoicing/invoice.ts`, `scripts/customer-confirmation.mjs`, `scripts/commercial-invoice.mjs` | `docs/operations/CUSTOMER-CONFIRMATION-EMAIL.md`, `docs/operations/FINANCIAL-WORKFLOW.md`, `docs/operations/COMMERCIAL-INVOICING.md`, `docs/deployment/DEPLOYMENT.md` §4a |
| Reservation window, statuses, ledger | `src/config/scheduling.ts` + `src/scripts/estimate-wizard.ts` | `docs/operations/RESERVATION-TRACKING.md` |
| Gift certificates (sales disabled pending approval) | `src/config/gift-certificates.ts`, `src/lib/gift/`, `src/pages/gift-certificates/`, `src/pages/gift-admin.astro`, `functions/api/gift-checkout.ts`, `stripe-webhook.ts`, `gift-auth.ts`, `gift-admin.ts`, `gift-balance.ts`, `src/lib/gift/activation.ts`, `src/lib/admin/` | `docs/operations/GIFT-CERTIFICATES.md`, `docs/operations/R2-STORAGE-AND-BACKUP.md` |
| Platform accounts, status, owner actions | `src/config/business.ts` `socials` + `src/components/SocialLinks.astro` | `docs/marketing/PLATFORM-REGISTER.md`, `docs/marketing/MULTIPLATFORM-OPERATING-PLAN.md` |
| Lead capture, notification fields, provider relay | `functions/api/lead.ts`, `src/lib/forms/` | `docs/verification/VERIFICATION.md` |
| Services, FAQs, checklists, page copy | `src/content/`, `src/content/site/` | `docs/CONTENT-GUIDE.md` |
| SEO, structured data, sitemap, robots, page ownership | `src/components/BaseHead.astro`, `src/lib/schema.ts`, page files | `docs/seo/SEO-STRATEGY.md`, `docs/operations/SEARCH-CONSOLE-SETUP.md` |
| Analytics, consent, event taxonomy, attribution | `src/scripts/consent-controller.ts`, `src/lib/analytics/`, `src/lib/attribution.ts` | `docs/analytics/ANALYTICS-SETUP.md`, `docs/analytics/GTM-CONTAINER-SETUP.md` |
| Visual design, tokens, images, icons, OG image | `src/styles/`, `public/brand/`, `src/assets/images/` | `docs/design/DESIGN-SYSTEM.md`, `docs/design/IMAGE-GUIDE.md`, `docs/design/IMAGE-SOURCE-REGISTER.md` |
| Customer photo intake (private R2, metadata stripping, owner links, retention) | `functions/api/photo-upload.ts`, `photo-view.ts`, `photo-cleanup.ts`, `src/lib/photos.ts`, `src/lib/photo-files.ts`, `src/scripts/photo-uploads.ts`, `src/components/PhotoUploadSection.astro` | `docs/operations/PHOTO-UPLOADS.md` |`n| Photo privacy rules (marketing/field photography) | `docs/privacy/PHOTO-PRIVACY-SOP.md` |
| UTM links and QR assets | `src/config/marketing-links.ts` | `docs/marketing/UTM-MASTER-LINKS.md`, `docs/marketing/WHERE-TO-PASTE-UTM-LINKS.md` |
| Marketing strategy, growth engines, platform priorities | — | `docs/marketing/WEEKLY-EXECUTION-PLAYBOOK.md` (execution front door), `docs/marketing/GROWTH-SYSTEM.md` (spine: flywheel, weekly loop, roadmap; subsystems `COMPETITIVE-STRATEGY.md`, `CONTENT-ENGINE.md`, `FIELD-CONTENT-CAPTURE.md`, `VIDEO-DIRECTING-SHEETS.md`, `CUSTOMER-LIFECYCLE.md`, `ACQUISITION-CHANNELS.md`, `LOCAL-AUTHORITY.md`, `ECONOMIC-MODEL.md`), `docs/marketing/MULTIPLATFORM-OPERATING-PLAN.md`, `docs/marketing/CONTENT-OPERATING-SYSTEM.md` |
| Social account setup (owner checklist) | `src/config/business.ts` `socials` | `docs/marketing/SOCIAL-ACCOUNT-SETUP.md`, `docs/marketing/PLATFORM-REGISTER.md` |
| Content production, proposed series, video workflow | — | `docs/marketing/CONTENT-PRODUCTION-SYSTEM.md` |
| Marketing → business reporting hierarchy | `docs/marketing/LEAD-MEASUREMENT-MODEL.md` | `docs/marketing/WEEKLY-SCORECARD.md` |
| Canvassing intelligence (neighborhood scoring, routes, workbook) | `scripts/canvass/` (public county parcel + ACS data; canonical `route_object.json`; outputs in git-ignored `canvass-out/`) | `docs/marketing/CANVASSING-SYSTEM.md`, `docs/marketing/CANVASSING-TOP-NEIGHBORHOODS.md`, `docs/marketing/CANVASSING-ROUTES-OVERVIEW.md`, `docs/marketing/field-acquisition/ROUTE-PLANNING.md` |
| Physical acquisition / print system (8 pieces × 3 variants, PPTX masters, print PDFs) | `scripts/print/` (brand-locked generator; outputs to `~/Downloads/Door Knocking - Stage 2 Review/` by default) + `src/config/brand.ts` mark + `src/config/marketing-links.ts` QR registry | `docs/brand/PHYSICAL-BRAND-SYSTEM-AUDIT.md`, `docs/marketing/field-acquisition/` (design decisions, manifest, specs, QR assignments, owner editing, privacy) |
| Launch schedule and owner approvals | — | `docs/marketing/90-DAY-LAUNCH-PLAN.md`, `docs/launch/OWNER-INPUT-REQUIRED.md` |
| Launch readiness and recovery research | evidence in commits/tests/deployments | `docs/launch/LAUNCH-READINESS.md`, `docs/operations/SMS-RECOVERY-RESEARCH.md` |
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
- Secure estimate payments → `src/config/payments.ts`; live Stripe keys and webhook secret live only in Cloudflare (`docs/operations/ESTIMATE-PAYMENTS.md`).
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
  generation, SMS, twelve active social profiles (Google Business Profile, Facebook, Nextdoor,
  Instagram, TikTok, YouTube, Pinterest, Rumble, Gab, Parler, Locals, X), the owner-approved circular logo/favicon kit (2026-10-19),
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
  captions were removed by owner direction in 6.2; image licensing records remain in
  `docs/design/IMAGE-SOURCE-REGISTER.md`. Proposed prices round
  **DOWN** to the nearest $5 (owner-approved), and travel assumes a 35-mile round trip
  (17.5 one-way included). Quote `configVersion` is an automatic deterministic fingerprint of the effective pricing values + calculation-schema marker; it is never manually bumped for an owner price edit.
- **Four estimate engines (Initiative 6.0; dedicated routes 6.2):** `/estimate/` is a clean selection hub with four cards. The **residential estimator lives at `/estimate/residential/`**; STR at `/estimate/str/`; Commercial at `/estimate/commercial/`; Church at `/estimate/church/`.
  Residential keeps the live instant estimate (including the optional Community Support pathway
  and presets `?service=recurring|deep|move-out|supportive`); legacy `/estimate/?service=` and
  `?promo=` links forward to the dedicated route with their query intact. STR
  (`/estimate/str/`) runs the live per-turnover model; Commercial (`/estimate/commercial/`) and
  Church (`/estimate/church/`) run the shared facility request engine with the SAME address finder,
  travel lookup, relay, owner notification and Turnstile controls. The old embedded StrForm and
  CommercialForm were retired — one request pipeline only. Facility forms are four-step guided
  experiences with progress, back/continue, per-step field-specific validation and keyboard focus
  management. **Facility pricing (Initiative 6.1,
  2026-10-24):** commercial and church numerical pricing is enabled as nonbinding provisional
  estimates — Tier A (≤3 labour hours) shows a single price, Tier B (≤8 hours) a ±15% range, and
  Tier C (larger, specialty or high-fixture) remains a personal scope review. The owner kill switch
  is `commercialTierConfig.numericEstimatesEnabled`; when false, the customer sees a scope-review
  experience and no numeric price survives in the UI, request, owner notification or server
  verification. The server independently enforces the switch in
  `src/lib/estimate/facility-verify.ts`.
  **Church discount:** owner-directed **10% off eligible church cleaning**, applied after the
  minimum-job rule, never stacked, never on travel/third-party costs, explicitly not a donation or
  tithe; terms `2026-10-24.church10.v1` (`src/lib/estimate/church-discount.ts`). Tier A/B show the
  discount and preliminary price; Tier C shows the entitlement and the owner confirms it personally.
  Optional church partnership checkboxes are never preselected and never affect pricing. See
  `docs/operations/ESTIMATOR-ENGINES.md`.
- **Initiative 6.2 (complete-experience release candidate):** dedicated `/estimate/residential/`
  route and a selection-only `/estimate/` hub; legacy residential/STR query links, SPARKLE100
  claims and UTM context forward correctly; a four-step guided facility wizard with field-specific
  validation; Community Support 10% eligibility discount (65+, first responders, veterans,
  disabilities, and other eligible community members; self-attested, no sensitive records; never
  stacked); owner-editable `globalEstimateFactor` applied to the pre-tax service subtotal across
  every engine; exact church-discount reconciliation and two-decimal
  currency; category-specific Florida sales-tax disclosure (no invented tax amount); service-area
  page restructured to title → description → map; representative-photo captions and the Mark 12:31
  quotation removed; larger review stars; footer review actions split into Read and Leave; and the
  premium icon set redesigned as white/gold artwork on rose tiles. The customer-photo intake is
  shared across all four engines with private R2 storage, server-side metadata stripping and
  signed owner links and Resend owner attachments (live). Facility pricing has a completed
  26-commercial/20-church calibration (`docs/operations/FACILITY-CALIBRATION.md`). Research/order/
  tax records: `docs/operations/ESTIMATE-CALCULATION-ORDER.md`, `docs/operations/TAX-TREATMENT.md`.
- **Initiative 6.4 (owner audit + engine calibration, 2026-10-25):** completed the 7-page owner
  audit corrections. The service-area map now uses real Census county geometry across 18 counties
  (green core Escambia/Santa Rosa FL; yellow by-arrangement Baldwin/Escambia AL; neutral context),
  labels “Gulf Of America” over the water, and suppresses county labels on phones to avoid the
  collisions found in audit. White-tile icons now crop their raster canvas margin without adding a
  second frame; icon 08 is reading glasses (large Reviews tile and 24 px footer vector) and icon 17
  is red/white/blue community artwork. The footer has four stacked contact actions (Call, Text,
  Email Us, Contact Form) and the exact review sentence; the founder, Southern Hospitality/Bible
  Belt and shortened Deep Cleaning copy are updated; values are centered; Service Area and FAQ are
  in both navigation layers; the public program name is **Community Support Cleaning** on the
  canonical `/supportive-home-cleaning/` route; and `estimatorCalibration` holds four independent
  residential/STR/commercial/church factors (all `1.00`, range `0.50–1.50`, invalid fails closed).
  Audit source: `sswebsiteaudit.docx` (7 pages, images 16–29); evidence:
  `docs/verification/6.4/`. The 6.3 white-tile icon system, estimator control center, pricing
  mathematics and repository organization remain intact; the single global factor described in the
  6.2 paragraph above was superseded by the four factors.
- **Initiative 6.5 (owner-editable estimator configuration, 2026-10-26):** added
  `src/config/estimators/validation.ts` with hard errors and business warnings,
  a `config:validate` pre-build gate that blocks Cloudflare on invalid values,
  and `src/config/estimators/pricing-version.ts` with a deterministic
  effective-pricing fingerprint replacing manual quote-version bumps. Tests now
  validate structure, ranges, dependencies, identity, client/server agreement
  and metamorphic behavior without freezing current owner numbers; fixed-reference
  arithmetic tests use controlled values. `npm run pricing:impact` reports all
  four engines and supports `--compare <ref>`. Owner workflow is documented in
  `START-HERE-OWNER-CONTROL-CENTER.md`.
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
  - **Customer photos (live):** optional shared
    section on residential, STR, commercial and church estimates (engine-specific categories).
    Uploads POST to functions/api/photo-upload.ts → PRIVATE Cloudflare R2 (`PHOTOS_BUCKET`
    binding), with server-generated keys, magic-byte validation, server-side EXIF/GPS/text
    metadata stripping, 6-photo/8MB/32MB limits, same-origin + rate checks and Turnstile when
    configured. iPhone HEIC converts to JPEG in the browser via heic2any; raw HEIC is rejected.
    Owner retrieval uses time-limited signed links (default 90 days) via functions/api/photo-view.ts;
    `/api/photo-cleanup` enforces the documented retention window. `/api/lead` verifies each
    object with R2 `head`, reads the validated bytes with R2 `get`, and sends the owner a Resend
    notification with real MIME attachments (numbered, request-ID-labelled emails within a
    21.5 MB Base64 budget); Web3Forms remains the links-only fallback. The section stays hidden
    until the GET probe reports `enabled: true`; no mock upload is presented as production.
    Provisioning and exact owner actions: docs/operations/PHOTO-UPLOADS.md.
  - **STR turnover context:** the estimator's STR path adds optional check-out/check-in times and
    a linen/laundry preference (informational — the per-turnover price is unchanged); all three
    travel with the request into the owner notification.
  - **Facility pricing (2026-10-24, Initiative 6.1):** commercial and church numerical pricing is
    enabled as nonbinding provisional estimates for Tier A/B using ISSA-based workloading,
    fixture-based restrooms and a $60/hour gross labour rate. Tier thresholds are workload hours
    (`pricing.commercialPricing.tierAHours` / `tierBHours`); the square-foot values in
    `src/config/estimators/commercial.ts` are legacy reference only. Tier C remains a personal scope
    review. The owner kill switch is `numericEstimatesEnabled` in the same file; it is enforced in
    the browser engine and server verification. The commercial intake form collects cleanable sqft,
    restroom fixtures, flooring, first-clean status, condition and specialty needs — all labeled in
    the owner notification. Research and model analysis:
    `docs/operations/COMMERCIAL-PRICING-RESEARCH.md` and
    `docs/operations/ESTIMATOR-ENGINES.md` (the older
    `docs/archive/launch/COMMERCIAL-ESTIMATE-MODEL-2026-10-24.md` is historical).
  - **Future booking roadmap (documentation only):** docs/operations/BOOKING-ARCHITECTURE.md
    defines the state machine (Estimate → Request Submitted → Owner Approved → Reserved →
    Confirmed → Paid) and the recommended additions. NOTHING is auto-booked. Pay Now is an
    optional exact-quote Stripe step and never holds a calendar slot.
- **White-tile icon collection (2026-10-25, owner-supplied artwork):** the 17 approved
  white-tile icons replace the earlier vector set. Optimized 384px WebP renditions live in
  `src/assets/icons/white-tile/`; the 1254px PNG masters are preserved in the local master
  archive. `PremiumIcon.astro` is the only renderer and `src/lib/premium-icons.ts` the only
  name registry. The tiles keep their white background, rounded border and soft shadow —
  **never recolour, stretch, regenerate or wrap them in another chip/plate**. The renderer clips
  only the saved raster's white canvas margin; the approved artwork itself is not altered. The six services use
  01–06; Community Support uses 07; the Reviews heading uses 08 (reading glasses, replaced
  2026-10-25); the trust banner uses 09–12; the five Community Support/community groups use
  13–17 (17 is red/white/blue community artwork, replaced 2026-10-25). Competitive Pricing keeps
  the exact four-dollar-sign design (first filled gold, three outlined). The small footer review
  button uses the matching reading-glasses vector at 24 px. Church Cleaning is the
  sixth homepage card. Registry: `docs/design/WHITE-TILE-ICON-INVENTORY.md`.
- **Authentic reviews live (2026-10-24, Initiative 5.0):** the homepage reviews section is a
  premium layered editorial carousel (`src/components/Reviews.astro`) rendering ONE prominent
  center review with two recessed-but-readable equal-height neighbours; it is progressively
  enhanced (no-JS shows every review readable), keyboard/swipe navigable, respects
  `prefers-reduced-motion`, and never autoplays.
  Three genuine owner-supplied Google reviews render — **Christina, Richard, Laura** — public
  attributions are **first names only** (never publish surnames in testimonials). Christina and
  Richard carry their authentic 5-star ratings; Laura's rating is verified as five stars
  (owner-supplied Google Maps review, checked 2026-10-24). Review source files are `src/content/reviews/christina.md`,
  `richard.md`, `laura.md` (quote text verbatim; never fabricate or "improve" it). Never
  fabricate additional reviews or aggregate/Review schema; new genuine entries render
  automatically and the verified Google reviews link stays intact.
- **Five-step estimator (owner priority UX directive, 2026-10-28):** the residential and STR
  journey is exactly **When & Where → Service & Home → Condition & Frequency → Optional Extras →
  Your Estimate** (`src/lib/estimate/steps.ts`, `src/lib/estimate/engines.ts`). Step 1 is a
  premium appointment calendar (`BookingCalendar.astro`, `booking-calendar.ts`) with a compact
  First Appointment (7:00–8:30 AM) / Afternoon Appointment (12:30–2:30 PM) hour-and-minute picker,
  followed by an always-visible manual address card. There is **no customer map/pin confirmation
  and no separate address-verification page** for residential; the typed address is resolved in
  the background, the city/state are parsed from the provider label when needed, and a ZIP
  fallback preserves an eligible request when exact geocoding fails. Suggestions are strictly
  FL/AL only server-side (`functions/api/geocode.ts`, `suggestion-ranking.ts`). Photos are
  collected in Condition & Frequency; they are required before booking confirmation, but the
  customer may pay now and confirm later. The Community Support discount is one small eligibility
  checkbox linked to the Terms. The selected date/time is provisional; the final step revalidates
  the real duration against the two-resource scheduler, creates a temporary hold, and offers real
  alternatives. Facility/commercial/church forms remain their own four-step request flows.
- **Service-driven estimator questionnaire (2026-10-23 finishing pass; current map/quote status through 6.4):** the selected cleaning
  service determines which questions exist — `src/lib/estimate/service-matrix.ts` is the single
  source of truth for service/frequency compatibility: **Residential house cleaning** offers
  one-time + weekly/biweekly/monthly; **Deep Cleaning, Move-in/Move-out and STR turnover are
  one-time services** (the rhythm question is hidden, the value normalizes to `one_time`, stale
  values clear on service switches, and the shared validator REJECTS invalid combinations —
  never silently repriced). Commercial/church cleaning use their walkthrough request forms, not
  the instant estimator. The quote display presents **Estimated Price** (one-time) or
  **First Visit — Deep Cleaning** + **Ongoing Visits** (recurring) with a grouped request
  summary (Cleaning details / Schedule / Location, full-width address rows). Quote
  `configVersion` is the automatic effective-pricing fingerprint. The service-area map uses
  real Census county geometry across 18 counties (two core Florida, two by-arrangement Alabama
  and neutral context), collision-aware desktop labels, a water-positioned Gulf Of America label,
  and a phone layout that suppresses county labels rather than letting them overlap; the About page carries no hero CTA, no detail-first slogan
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
  a Southern-hospitality section follows, a community-support spotlight follows the services,
  and the six core service cards are photo cards
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
  URLs (TikTok, Pinterest, Rumble, Gab, Parler, Locals). Instagram, YouTube and X were added
  2026-10-27, so **twelve profiles render** in the Follow Us section (including the verified Google
  Business Profile) as **logo-only 52px circular buttons** in four columns (4 + 4 + 4 on phones). Platform names are visually
  hidden but remain each link's explicit accessible name. Icons use official marks, including
  Nextdoor's house-"n" favicon, the official Gab and Parler marks and the official Locals logo
  (`src/components/SocialIcon.astro` documents each source). **The owner confirms the basic
  tracked UTM links are placed on the original eight** (registry entries active). Instagram, YouTube
  and X are **owner-confirmed active accounts (2026-10-27)** and render; their UTM placements remain
  prepared, not placement-confirmed, until the owner confirms each one. Never render a PENDING
  platform or publish an unconfirmed URL. Tracked links and the checklist: `docs/marketing/SOCIAL-ACCOUNT-SETUP.md`.
- **Circular logo kit (2026-10-19):** the owner replaced the old crest + descriptor + tagline
  lockup with a single circular mark — script "Sparkling" above spaced "STANDARD" inside a gold
  ring with sparkles. `logoSvg()` in `src/config/brand.ts` is the shared artwork; regenerate the
  favicon/PWA/social assets with `node scripts/generate-logo-assets.mjs`. The full legal name
  remains in metadata, structured data and the footer copyright. Do not add symbols, descriptors
  or slogans to the mark without a new owner decision.
- **GA4 operational (owner-confirmed 2026-10-03; Version 5 owner-reported 2026-10-25):** after the
  container was found empty, the owner published GTM Version 3 (`GTM-KSQ26HMG`) with one Google
  tag, 12 event tags, 12 triggers and 7 data-layer variables. The owner now reports **Version 5**
  with one Google tag, 19 event tags, 19 triggers and 13 variables, adding the church and
  promotion events. GA4 `G-LG222LQRQ2` received page views, `estimate_start` and all three inquiry
  events end-to-end under Version 3; all three are key events; Enhanced Measurement form
  interactions are disabled; consent tests passed. Live receipt of the new church/promotion events
  is not yet fully proven; verify in DebugView/Realtime. The prepared import files
  (`docs/analytics/gtm-import/*.json`, generated by `scripts/generate-gtm-import.mjs`, checked by
  `npm run validate`) remain a rebuild reference. The live account configuration is authoritative
  — never republish/overwrite it or add a second Google tag.
- **Attribution repair (2026-10-03):** first-touch is captured once; latest-touch updates only for
  a genuinely new campaign/ad click. Internal navigation, refreshes and direct views never erase
  campaign context, and same-domain referrers are never referrals. Lead emails label first-touch
  and latest-touch source/medium/campaign/content separately
  (`docs/operations/LEAD-NOTIFICATION-FORMAT.md`). The fix applies to future attribution only;
  already-delivered emails are unchanged.
- **Advance reservations and gift certificates (2026-10-03):** requests are bounded to a
  configurable 60-day window (`src/config/scheduling.ts`) with no priority tier; reservation
  statuses and the private ledger workflow live in `docs/operations/RESERVATION-TRACKING.md`.
  Gift certificates are live in **request mode only** (`enabled: false`); approved values are configured but public sales remain gated. Stripe Checkout and the
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
  owner's `assets/owner/Headshot.jpg`) with the visible identification "Hayli, Founder & Owner-Operator"
  and natural portrait proportions — genuine owner material, never cropped to a stock ratio and
  not reused on unrelated pages. Licensed stock interiors (Pexels License, no cost) remain on the
  homepage, labeled representative — never presented as our work. Source/licence register:
  `docs/design/IMAGE-SOURCE-REGISTER.md`. Replace remaining stock with genuine, permissioned
  photography when it exists.
- **Add-on bundles (owner-approved 2026-10-26):** Kitchen Refresh, Deep Detail and Recurring Care
  are enabled as transparent extra-service bundles in `pricing-values.ts`. Every required extra
  must be selected; the discount is calculated on the eligible add-on subtotal; specialty work is
  excluded; the normal single-discount policy still applies. The rest of the prepared promotion
  programs, appreciation discounts and Founding-10 remain disabled until owner terms are approved.
  Financial review: `docs/launch/PROMOTION-PROPOSALS.md`; regenerate with `npm run promotions:impact`.
- **Pending owner input:** insurance/bonding/licensing claims,
  Instagram/YouTube/X UTM placement confirmation, Umami website ID, final cancellation
  percentages, marketing-launch approvals (M2–M7; M1 deployed 2026-10-03), the Resend
  customer-email setup (`RESEND_API_KEY` + sender-domain verification, DEPLOYMENT.md section 4a),
  Stripe Pay Now runtime secrets and a test-mode checkout (`STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`) and any marketing claim not yet supplied. (Google Business Profile is **verified with its profile +
  review links captured**, owner-supplied 2026-10-08.)
- Current platform details: `docs/operations/PLATFORM-STATUS.md`. Owner checklist:
  `docs/launch/OWNER-INPUT-REQUIRED.md` (marketing approvals are grouped there as M2–M7).