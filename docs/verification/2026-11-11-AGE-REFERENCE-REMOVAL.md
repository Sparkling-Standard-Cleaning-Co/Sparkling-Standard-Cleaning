# Hayli age-reference removal (2026-11-11)

## Scope

Public website content, image alt text, SEO metadata, Open Graph metadata and
structured data were audited for direct or indirect references to Hayli's age,
date of birth, youth or age-related marketing. No customer review was altered.
No D1, R2, Stripe or administrative identity/date-of-birth record was read,
changed or removed.

## Public references found and replaced

| Location | Original | Replacement |
| --- | --- | --- |
| `src/config/business.ts` approved background | “An 18-year-old college student who started the company to give customers the detailed attention rushed cleaning does not allow” | “Built the company around detailed attention that rushed cleaning does not allow” |
| same list, family background | “Started in residential cleaning and grew up around a grandmother who owned a cleaning business” | “Started in residential cleaning and learned the trade through a grandmother who owned a cleaning business” |
| `src/content/site/about.md` hero headline | “Young entrepreneur.” | “Founder-led.” |
| `src/content/site/about.md` hero lead | “The founder of this company is 18, studies interior design, and has spent years doing professional cleaning work. She built this business…” | “Hayli is the founder and owner-operator of Sparkling Standard. Shaped by a family cleaning business, she worked directly with customers and inspected cleaning quality before building this company…” |
| `src/content/site/about.md` meta description | “…raised around a family cleaning business…” | “…shaped by a family cleaning business…” |
| `src/content/site/about.md` story heading | “Raised in a cleaning family” | “A family cleaning trade” |
| `src/content/site/about.md` story paragraph | “she grew up around it, learning what real work looked like before she was old enough to be paid for it” | “she learned the work firsthand alongside family, seeing what real standards looked like” |
| `src/content/site/about.md` values paragraph | “a young woman building something her family is proud of” | “a founder building something her family is proud of” |
| `src/content/site/home.md` founder band | “grew up around cleaning — from a grandmother who owned her own cleaning business…” | “learned the trade through a family cleaning business — working alongside a grandmother who owned her own company…” |

## Internal guidance scrubbed to prevent re-publication

These files are not served publicly, but contained the same age angle and could
have seeded future public copy:

| File | Original | Replacement |
| --- | --- | --- |
| `docs/marketing/CONTENT-OPERATING-SYSTEM.md` | “Founder journey — young entrepreneur, real standards” | “Founder journey — experience, real standards” |
| `docs/marketing/LOCAL-AUTHORITY.md` | “an 18-year-old college student who started the company…” | “the founder started the company…” |
| `docs/marketing/LOCAL-AUTHORITY.md` | “Family craft: grew up around a grandmother…” | “Family craft: learned the trade through a grandmother…” |
| `docs/marketing/LOCAL-AUTHORITY.md` | “entrepreneurship/student-business publications (the college angle)” | “entrepreneurship and local-business publications” |
| `docs/marketing/VIDEO-DIRECTING-SHEETS.md` | “grew up around her grandmother’s cleaning business” | “learned the trade through her grandmother’s cleaning business” |

## References reviewed and deliberately preserved

- `docs/marketing/ACQUISITION-CHANNELS.md`: “Student / college communities” is a
  customer-market segment, not a statement about Hayli.
- `docs/marketing/GROWTH-SYSTEM.md`: “Young brand” describes company maturity,
  not Hayli.
- `scripts/gift-certificate.mjs` / gift tests: “Happy birthday!” is a sample gift
  message, not Hayli’s date of birth.
- Code uses of `age` for cache/checkout staleness, cookie `Max-Age` and legal
  wording are unrelated to personal age.

## Metadata and structured data

- `/about/` `<title>`, description, Open Graph title/description and canonical
  URL contain no age or youth language.
- The `LocalBusiness` JSON-LD contains only business facts; it has no founder age
  or birth fields.
- Image alt text identifies Hayli only as founder and owner-operator.
- Rendered `dist/` was scanned after build: no age/youth phrase remains.

## Verification

- Source and internal-guidance search: no exact age/youth references remain.
- Rendered `dist/` search: no age/youth references.
- `npm run check`, build, validate and smoke passed.
- Unit suite: 856 tests (855 pass, 1 pre-existing skip).
- Full browser suite: 214 pass (one unrelated address-suggestion test flaked on
  the first run, passed alone and in the complete rerun).
- About-page browser suite: 10/10 pass.
- No pricing, estimate, booking, payment, review, admin or private record changed.

## Release

- Application code: `PENDING_CODE_SHA`
- Final HEAD: recorded after commit
- Cloudflare Pages production deployment: `PENDING_DEPLOYMENT_ID`
