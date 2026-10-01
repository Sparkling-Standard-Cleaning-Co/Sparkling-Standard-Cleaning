# AGENTS.md — Sparkling Standard Cleaning Co. Digital Operating System

Permanent instructions for AI engineering agents (OpenCode and similar) working in this
repository. Read this file fully before making any change. Every statement below reflects the
verified state of the codebase — if reality and this file disagree, resolve it deliberately with
the owner; never silently work around this file.

## Project identity

- Marketing, estimate and lead-capture website for **Sparkling Standard Cleaning Co.** (public
  brand: "Sparkling Standard"), an owner-operated residential and commercial cleaning company
  based in Cantonment and serving Pensacola, surrounding communities within about an hour of
  Cantonment, and select nearby areas into Alabama.
- **Owner-confirmed facts (October 2026):** company name, domain
  (`https://sparkling-standard.com`), phone (`(850) 246-8479`), email
  (`owner@sparkling-standard.com`), founder (Hayli — 18-year-old founder/owner-operator, approved
  background in `business.founder`), service territory (about one hour of actual driving time
  from the private operating origin), Stripe as payment processor, and a dedicated Cloudflare
  account with the domain active on Cloudflare DNS.
- **Still PENDING (do not invent):** legal entity spelling/suffix, the private operating origin
  (`TRAVEL_ORIGIN`), insurance/bonding/licensing claims, SMS capability (`business.flags.smsEnabled`
  is FALSE until a real text has been received), Web3Forms access key, analytics IDs, review and
  social profile URLs, final cancellation percentages, and owner launch approval
  (`business.launch.productionApproved`). Until these land, the site is preview-only and
  production deployment is blocked by validation. See `docs/launch/OWNER-INPUT-REQUIRED.md`.
- Repo: `Sparkling-Standard-Cleaning-Co/Sparkling-Standard-Cleaning`. **`main` is the production
  branch.**
- Local dev server: http://localhost:4321. Build output: `dist/`.
- Hosting is the owner's dedicated GitHub-connected Cloudflare project (Cloudflare Pages).
  This repository contains **no deployment configuration** — deployment settings live in the
  Cloudflare dashboard. See `docs/deployment/DEPLOYMENT.md`.

## THE NO-FABRICATION RULE (non-negotiable)

**Do not convert a `PENDING` fact into a public claim. Ever.**

Never invent or "fill in" any of: company name, legal name, phone, email, domain, address,
years in business, customer or review counts, certifications, insurance, bonding, licenses,
employee counts, testimonials, commercial clients, guarantees, response times, exact pricing,
social URLs, or review links.

Unknown information must be:

1. centralized as `PENDING` in `src/config/business.ts` (or `.env`),
2. excluded from public claims, and
3. blocked by `scripts/validate-production-env.mjs` + `scripts/check-pending-facts.mjs` before
   any production deployment.

Do not quietly replace unknown information with plausible-looking data.

## Verified architecture — keep it

- **Astro 5, `output: 'static'`, strict TypeScript** (`astro/tsconfigs/strictest` + explicit
  `.ts` import extensions enabled for Node-test compatibility). No client framework, no CSS
  framework, no CMS, no database. Do not add dependencies, databases, CMS platforms or paid
  services without explicit owner approval. The launch budget is ~$350; prefer free, low-cost,
  usage-based, low-lock-in choices.
- `trailingSlash: 'always'`; canonical domain comes from `PUBLIC_SITE_URL`; the sitemap excludes
  404, thank-you and leave-review.
- **`src/config/business.ts` is the single source of truth for every business fact.** Components
  and pages import from it; never hard-code business facts elsewhere. `PENDING` handling uses
  the `Fact<T>` / `isPending()` helpers.
- **`src/config/pricing.ts` is the single source of truth for pricing, labor model, add-ons,
  cancellation/satisfaction policy and publication flags.** All values are marked
  `provisional` or `approved`; provisional values are internal until the owner approves them.
  Publication flags (`pricing.publication.*`) control what may ever be displayed.
- **`src/config/geography.ts`** holds the provisional ZIP→zone reference and zone policy.
- **`src/config/marketing-links.ts`** is the single source of truth for inbound UTM links and
  QR assets. Generated docs and QR files are produced from it — never edit them by hand.
- **Content collections** (`src/content.config.ts`, Zod-validated):
  - `services` → the seven owning pages (house, recurring, deep, move-in/out, STR, commercial,
    church), frontmatter-driven scope + markdown body.
  - `faqs` → categorized Q&As; service pages reference entries by `faqIds`.
  - `checklists` → per-service checklists with `visibility: public | internal`; **internal
    checklists must never render on the public site** (validated by `npm run validate`).
  - `proof` → real before/after work, **intentionally empty** until genuine photos exist.
  - `reviews` → genuine customer reviews only, **intentionally empty** until real ones exist.
  - `site` → editable page copy, one entry per page.
- Pages are thin wrappers over collections/config. The estimator engine lives in
  `src/lib/estimate/` and travel logic in `src/lib/travel/` — arithmetic never lives in pages.
- Client-side JS is minimal, bundled by Astro from `src/scripts/` (no framework). The estimator
  computes in the browser so the instant estimate works on a fully static page.
- Serverless functions live in `functions/api/` (Cloudflare Pages Functions) for travel lookup
  and the lead relay. **Secrets only ever live in the function environment.**
- Styles: `src/styles/tokens.css` (design tokens), `global.css` (all component styles),
  `fonts.css` (generated by `scripts/fetch-fonts.mjs`). Use tokens only — never raw colors,
  spacing or font sizes.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run check` | `astro check` — TypeScript diagnostics (must be 0 errors) |
| `npm test` | Estimator unit tests (Node test runner, type-stripped TS) |
| `npm run verify` | `check` + `build` + `validate` — minimum bar for any change |
| `npm run validate` | Links, SEO, marketing registry, QR decode, checklist leak checks |
| `npm run links` | Broken internal-link check on `dist/` |
| `npm run seo` | SEO checks on `dist/` |
| `npm run pending` | PENDING-fact gate — **fails pre-launch by design** |
| `npm run testimonials` | Fake-testimonial / fixture detector |
| `npm run audit:facts` | No-fabrication claim audit |
| `npm run smoke` | Static smoke test over `dist/` |
| `npm run validate:production` | Production environment gate (needs real facts) |
| `npm run marketing:links` | Regenerate UTM docs + QR codes (decode-verified) |
| `npm run marketing:qr` | Force-regenerate every QR asset |
| `npm run marketing:verify` | Verify registry, docs and QRs without writing |
| `node scripts/generate-brand-images.mjs` | Regenerate favicons/OG image after brand changes |
| `node scripts/fetch-fonts.mjs` | Refresh self-hosted fonts |

Build notices like "The collection 'proof' does not exist or is empty" are **expected and
intentional** while those collections are empty — not errors.

## Git safety and deployment rules

- **Never push without explicit owner approval** — a push to `main` triggers the production
  deployment once the Cloudflare project exists.
- **Line endings are LF-normalized** (`.gitattributes`: `text=auto eol=lf`). The generated
  marketing documents are byte-compared by validation; never commit CRLF variants of them.
  Keep the repository-local `core.autocrlf=false` setting on Windows clones.
- Use the repository-local Git identity only (`git config --local`); never change global config.
- Never, without explicit owner authorization: force push, rewrite history, `git reset`,
  `git clean`, `git stash pop`/`drop`, delete branches, or touch Cloudflare settings or DNS.
- Commit small, per approved phase, with a clear message. Review `git diff --stat` and
  `git diff` before committing. Never stage unrelated or untracked files you did not create.
- Do not run automatic dependency upgrades, `npm audit fix`, or unrelated "cleanup."

## Content editing map

| To change… | Edit |
| --- | --- |
| Any business fact (name, phone, email, hours, area, payments, launch flags) | `src/config/business.ts` (or the matching `.env` value) |
| Any pricing, labor model, add-on, cancellation or satisfaction rule | `src/config/pricing.ts` |
| Service areas / ZIP zones | `src/config/geography.ts` |
| Home/about/contact/service-area/estimate page copy or SEO | `src/content/site/<page>.md` |
| Service pages | `src/content/services/*.md` |
| FAQs | `src/content/faqs/*.md` |
| Customer-facing + operational checklists | `src/content/checklists/*.md` |
| Real work proof (photos + story) | `src/content/proof/*.md` + images next to the entry |
| Genuine customer reviews | `src/content/reviews/*.md` |
| UTM links / QR assets | `src/config/marketing-links.ts`, then `npm run marketing:links` |
| Page copy/markup for static pages | `src/pages/*.astro` |
| Header/footer navigation | `src/components/Header.astro` / `Footer.astro` / `src/lib/site.ts` |

Schemas and how-to: `docs/CONTENT-GUIDE.md`. After content edits run `npm run verify`.

## Page/query ownership (SEO)

One owning page per query cluster. Never create duplicate competing pages or thin city pages:

| Query cluster | Owning page |
| --- | --- |
| house cleaning | `/house-cleaning/` |
| recurring house cleaning | `/recurring-cleaning/` |
| deep cleaning | `/deep-cleaning/` |
| move-out / move-in cleaning | `/move-in-move-out-cleaning/` |
| Airbnb / VRBO / STR turnover | `/short-term-rental-cleaning/` |
| commercial cleaning | `/commercial-cleaning/` |
| church cleaning | `/church-cleaning/` |

Full strategy (including the no-doorway policy and schema decisions): `docs/seo/SEO-STRATEGY.md`.

## Image and photo rules

- Real founder, real work, real details first. No stock "woman with spray bottle" identity
  images, no staged fake dirt, no fake before/after (see `docs/design/IMAGE-GUIDE.md`).
- Collection images live beside their entries and are referenced via `image()` fields so
  Astro optimizes them; `alt` text is required by the schema.
- Never publish identifying or private information in photos — street numbers, mail, documents,
  family photos, alarm panels, prescriptions, screens, plates. Full SOP:
  `docs/privacy/PHOTO-PRIVACY-SOP.md`.
- Marketing use of customer property photos requires permission; operational proof and public
  marketing permission are separate concepts.

## Analytics, consent and privacy rules

- **Nothing analytics-related loads before an explicit analytics consent choice.** Umami and
  GTM/GA4 are both gated by the same consent controller. Advertising consent is never granted
  while the site runs no ads (it never does without owner approval).
- Event names are a closed taxonomy (`src/lib/analytics/events.ts`); payload keys are
  allowlisted. **Never send** names, emails, phones, addresses, ZIP codes, photos, form
  contents or anything you would not publish on a billboard.
- Attribution (UTMs, referrer, ad click ids) is captured for LEAD RECORDS only — never sent to
  analytics.
- If tracking behavior changes, update `/privacy/` in the same commit. The privacy page must
  always describe exactly what the site does.

## UTM rules

- UTMs are for inbound marketing links only. Never add them to internal navigation, canonical
  URLs, sitemap entries, `tel:`/`sms:`/`mailto:` links or review links.
- Lowercase snake_case values; no PII; no manual Google Ads UTMs (auto-tagging only).
- All links live in `src/config/marketing-links.ts`; regenerate with `npm run marketing:links`.
- Every QR is decode-verified against the registry by `npm run marketing:verify`.

## How future AI agents should modify the project

1. Read this file and the relevant docs before editing. The system map is
   `docs/OPERATIONS-HUB.md`; current platform status lives only in
   `docs/operations/PLATFORM-STATUS.md`.
2. Establish repository state (`git status`, `git log -3`) and never overwrite unexpected work.
3. Change the single source of truth — not the generated copies.
4. Add/update focused tests for behavioral changes (`npm test`), update docs where rules live.
5. Run `npm run verify` plus the relevant focused checks. Never claim a pass without running it.
6. Do not push. Report evidence: commands run, actual results, what could not be tested.
