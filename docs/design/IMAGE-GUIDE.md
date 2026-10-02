# Image guide

Real founder and real work dominate. This is a brand built on noticing details — stock imagery
undermines it.

## Hierarchy (prefer the top of this list)

1. Real founder — portraits, on the job, on camera
2. Real cleaning work — actual rooms, actual process
3. Real details — baseboards, fixtures, the "small things"
4. Real before/after pairs from real jobs
5. Real supplies/process shots
6. Selective stock imagery only when nothing real exists yet (never as brand identity)

**Never:** generic "woman with a spray bottle" stock as identity, staged fake dirt, fake
before/afters, AI-generated "proof", photos that imply outcomes that didn't happen.

## Where images live

| Use | Location | Pipeline |
| --- | --- | --- |
| Service/portfolio proof | `src/content/proof/images/` (+ `image()` frontmatter) | Astro optimized, dimensions enforced, alt required |
| Page-copy images | `src/content/site/images/` | Astro optimized via `image()` |
| Direct-reference assets (logo, favicons, OG) | `public/brand/` | not optimized — keep small |
| General public assets | `public/images/` | not optimized |

## Standards

- Naming: lowercase, hyphenated, descriptive —
  `bathroom-grout-detail-cantonment-after.jpg`
- Long edge ≤ 2000px target (hard warning at 4000px), JPEG/WebP, ≤ 500 KB target
- Before/after pairs use `label: before | after` and render as labeled comparisons
- Alt text describes the photo factually; no outcome claims
- `position` (any CSS `object-position`) sets the focal point when crops matter

## Guardrails

```bash
node scripts/photo.mjs <file-or-dir>                  # dimensions/size/format report
node scripts/photo.mjs <file-or-dir> --resize 2000 --write   # downscale in place
```

## Privacy before publishing

Every photo passes the checks in `docs/privacy/PHOTO-PRIVACY-SOP.md` first — no street numbers,
mail, documents, screens, people who have not consented, family photos, codes or plates.

**Permission:** marketing use of a customer's property requires the customer's permission.
Operational/completion proof for the customer is separate from public marketing use. When in
doubt, publish a crop or don't publish.

## Current state

No genuine Sparkling Standard project photos exist yet: the `proof` collection stays empty and the
homepage shows an honest explainer of the proof standard instead of fabricated images.

To strengthen presentation without fabricating proof, the site now uses a small set of **licensed
representative interior photographs** (Pexels License — free commercial use, attribution not
required) on the homepage and about page. Every one is:

- recorded in `docs/design/IMAGE-SOURCE-REGISTER.md` with source, photographer and licence;
- labeled with a visible “representative photograph” caption where it could be mistaken for a
  specific job;
- replaced by genuine, permissioned photography as soon as the owner supplies it.

When the owner supplies photos: run the guardrails, place them beside the proof entry, wire them
with honest alt text and captions, and delete the matching stock file and register row.
