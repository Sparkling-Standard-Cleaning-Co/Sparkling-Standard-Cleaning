# AGENTS.md — Sparkling Standard Cleaning Co. Digital Operating System

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

- Marketing, estimate and lead-capture website for **Sparkling Standard Cleaning Co.** (public
  brand "Sparkling Standard"), an owner-operated residential and commercial cleaning company based
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
  confirmed); Cloudflare Turnstile optional; GTM container `GTM-KSQ26HMG` consent-gated; SMS
  enabled (`business.flags.smsEnabled: true`, owner-verified); Facebook + Nextdoor profiles
  confirmed; owner-approved 2026-10-02 favicon/PWA icon kit installed.
- **Formal launch checklist still outstanding (owner sign-off):** legal entity spelling, insurance/
  bonding/licensing claims, genuine review links, final cancellation percentages, and any profile
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
  `proof` and `reviews` (intentionally empty until genuine material exists), `site` (page copy).
- Pages are thin wrappers. The estimator engine lives in `src/lib/estimate/`; travel logic in
  `src/lib/travel/`; address/location logic in `src/lib/location/`. Arithmetic never lives in pages.
- The estimate flow collects a **confirmed destination**: GPS "Use My Current Location" first, with
  an expandable manual address section (closed by default), MapMap suggestions through
  `/api/geocode`, a manual fallback, and a lazy-loaded MapLibre GL + OpenFreeMap pin confirmation.
  A confirmed pin is the only destination source — never let a ZIP centroid silently replace it.
  GPS/manual modes are isolated: the selected method is the only source of the submitted address.
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
- Brand assets: browser/PWA icons come from the owner-approved 2026-10-02 favicon kit
  (`public/favicon.ico`, `favicon.svg`, `favicon-16/32/48/64/96/128/256.png`,
  `public/brand/apple-touch-icon.png`, `icon-192/512.png`, `icon-maskable-512.png`,
  `public/site.webmanifest`). `scripts/generate-brand-images.mjs` intentionally does NOT regenerate
  those; it only regenerates `og-default.png` and `logo-mark-soft.svg`. Do not overwrite the
  approved icons.

## System map — where the source of truth lives

| System | Source of truth | Detailed docs |
| --- | --- | --- |
| Business facts, contact, socials, launch/publication flags | `src/config/business.ts`, `.env` | `docs/launch/OWNER-INPUT-REQUIRED.md` |
| Pricing, labor model, add-ons, promotions, discounts | `src/config/pricing.ts` | `docs/launch/PRICING-PROPOSAL.md`, `docs/operations/OWNER-SETTINGS-GUIDE.md` |
| Travel economics, included miles, zone adjustments | `src/config/travel.ts`, `src/config/geography.ts` | `docs/operations/ESTIMATOR-LOCATION-ENGINE.md` |
| Location selection, geocoding, GPS/manual modes | `src/scripts/address-finder.ts`, `src/lib/location/`, `functions/api/geocode.ts` | `docs/operations/ESTIMATOR-LOCATION-ENGINE.md` |
| Quote calculation and server verification | `src/lib/estimate/` (`calculate.ts`, `quote.ts`, `verify.ts`, `validation.ts`) | `docs/verification/VERIFICATION.md` |
| Lead capture, notification fields, provider relay | `functions/api/lead.ts`, `src/lib/forms/` | `docs/verification/VERIFICATION.md` |
| Services, FAQs, checklists, page copy | `src/content/`, `src/content/site/` | `docs/CONTENT-GUIDE.md` |
| SEO, structured data, sitemap, robots, page ownership | `src/components/BaseHead.astro`, `src/lib/schema.ts`, page files | `docs/seo/SEO-STRATEGY.md`, `docs/operations/SEARCH-CONSOLE-SETUP.md` |
| Analytics, consent, event taxonomy, attribution | `src/scripts/consent-controller.ts`, `src/lib/analytics/`, `src/lib/attribution.ts` | `docs/analytics/ANALYTICS-SETUP.md` |
| Visual design, tokens, images, icons, OG image | `src/styles/`, `public/brand/` | `docs/design/DESIGN-SYSTEM.md`, `docs/design/IMAGE-GUIDE.md` |
| Photo privacy rules | `docs/privacy/PHOTO-PRIVACY-SOP.md` |
| UTM links and QR assets | `src/config/marketing-links.ts` | `docs/marketing/UTM-MASTER-LINKS.md`, `docs/marketing/WHERE-TO-PASTE-UTM-LINKS.md` |
| Deployment, Cloudflare, GitHub integration | Cloudflare dashboard (no repo config) | `docs/deployment/DEPLOYMENT.md` |
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
| `npm test` | Estimator/unit tests (Node test runner, type-stripped TS) |
| `npm run test:browser` | Playwright browser regression suite (builds first) |
| `npm run verify` | `check` + `build` + `validate` — minimum bar for any change |
| `npm run validate` | Links, SEO, marketing registry, QR decode, checklist leak checks |
| `npm run links` / `npm run seo` | Focused broken-link / SEO checks on `dist/` |
| `npm run pending` | PENDING-fact gate (fails while genuine blockers remain) |
| `npm run testimonials` | Fake-testimonial / fixture detector |
| `npm run audit:facts` | No-fabrication claim audit |
| `npm run smoke` | Static smoke test over `dist/` |
| `npm run validate:production` | Production environment gate (formal pre-launch checklist) |
| `npm run marketing:links` | Regenerate UTM docs + decode-verified QR codes |
| `node scripts/generate-brand-images.mjs` | Regenerate `og-default.png` + soft mark (NOT the approved icons) |
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

- **Operational:** production site and deploy pipeline, estimator (GPS + manual), MapMap geocode
  and routing, Web3Forms delivery, GTM consent-gated analytics, SMS, Facebook + Nextdoor profiles,
  approved favicon kit, sitemap/robots, quote verification and owner notification.
- **Provisional (internal only, publication flags off):** add-on pricing surface, multi-add-on
  incentive, response guarantee, appreciation discounts, founding promotion, market comparisons.
  Each requires explicit owner approval before activation; never publish an unapproved promise.
- **Pending owner input:** legal entity spelling/suffix, insurance/bonding/licensing claims, review
  profile/submission links, remaining social URLs, final cancellation percentages, and any
  marketing claim not yet supplied.
- Current platform details: `docs/operations/PLATFORM-STATUS.md`. Owner checklist:
  `docs/launch/OWNER-INPUT-REQUIRED.md`.
