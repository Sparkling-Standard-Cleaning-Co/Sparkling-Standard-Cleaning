# Initiative 6.10 verification evidence

**Scope:** activate the owner-confirmed Instagram, YouTube and X profiles in the Follow Us section.

## Evidence

| File | Shows |
| --- | --- |
| `follow-us-desktop.png` | Twelve circular logo buttons in four columns and three balanced rows |
| `follow-us-mobile.png` | Same twelve profiles in four columns (4 + 4 + 4) without overflow |

## Automated checks

- `npm run check` — 165 files, 0 errors.
- `npm test` — 564 tests, 563 passed, 1 pre-existing skip, 0 failed.
- `npm run test:browser` — 150 passed, 0 failed.
- `npm run verify` — 28 pages; all internal links and SEO checks passed (run after the final build).
- Social browser regression — 4/4 passed, including 12 links, correct hrefs, accessible names,
  new-tab/noopener behavior, no UTMs, 4 + 4 + 4 wrapping and 12 unique `sameAs` URLs.
