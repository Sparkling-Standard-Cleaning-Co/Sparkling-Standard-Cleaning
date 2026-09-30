# Content guide — how to edit the site safely

Everything on this site comes from three kinds of sources. Know which one you are editing.

| Kind | Location | Examples |
| --- | --- | --- |
| **Facts** | `src/config/business.ts`, `src/config/pricing.ts`, `src/config/geography.ts` | Phone, email, hours, payments, service area, prices, policies |
| **Copy** | `src/content/` (Markdown) | Page text, service descriptions, FAQs, checklists |
| **Markup/design** | `src/pages/`, `src/components/`, `src/styles/` | Layout, sections, styles |

## The one unbreakable rule

**Never turn a `PENDING` fact into a public claim.** If the owner has not confirmed it, it stays
`PENDING` in `src/config/business.ts`. Production deployment is blocked until the critical facts
exist (`node scripts/validate-production-env.mjs`).

## Editing page copy (`src/content/site/*.md`)

One file per page: `home.md`, `about.md`, `contact.md`, `service-area.md`, `estimate.md`.
Frontmatter supplies SEO (`metaTitle`, `metaDescription`) and section copy; the page template
renders it. Business facts inside copy are inserted by the template — never type a phone number
or price into these files.

After any edit:

```bash
npm run verify
```

## Editing a service page (`src/content/services/*.md`)

Frontmatter drives the page structure:

- `includes` → "What's normally included" checklist
- `goodFor` → "Who this is for" card
- `notIncluded` → honest boundaries section (leave it honest; add exclusions rather than hype)
- `faqIds` → FAQ entries shown on the page (ids = FAQ filenames without `.md`)
- `related` → related service paths
- `checklistId` → matching checklist entry (only `visibility: public` renders)

The Markdown body is the long-form content under the hero.

## Editing FAQs (`src/content/faqs/*.md`)

One question per file. `answer` is plain text. `category` controls grouping on `/faq/`.
Keep answers honest and specific — no invented policies, no guaranteed outcomes. The
`exclusions` category is written professionally, never hostile.

## Editing checklists (`src/content/checklists/*.md`)

- `visibility: public` renders on the matching service page.
- `visibility: internal` is operational documentation and **must never render publicly**
  (enforced by `npm run validate`).

## Adding a genuine review (`src/content/reviews/*.md`)

Only real customer reviews supplied by the owner. No gating "only happy customers", no
incentivized reviews, no invented names. The review section and nav stay hidden until at least
one entry exists. See `docs/marketing/REVIEW-GROWTH-SYSTEM.md`.

## Adding real work proof (`src/content/proof/*.md`)

Real jobs only — real before/after photos, permission obtained, privacy checked against
`docs/privacy/PHOTO-PRIVACY-SOP.md`. Place images next to the entry, run `node scripts/photo.mjs`,
and write factual captions (no outcome claims). Staged dirt or stock photos are forbidden.

## Changing pricing or policies

All in `src/config/pricing.ts`. Values are `provisional` until the owner approves them. To
publish a previously internal value, flip the matching `pricing.publication.*` flag — but only
with the owner's explicit approval recorded in the same change.

## Changing business facts

`src/config/business.ts` (or a public env var where the file reads one). Then:

```bash
npm run verify
npm run pending      # confirms the placeholder facts are gone from the build
```
