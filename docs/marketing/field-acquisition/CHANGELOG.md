# Field acquisition changelog

## Redesign release — slogan, SPARKLE100 quarter sheet, card redesign (2026-10-23)

- New official slogan "Standards That Make Your Space Sparkle." flows into every piece from
  `src/config/brand.ts`; poster headline typography retuned for the longer sentence.
- Business cards redesigned (front: centered circular logo + slogan + contact rule; back:
  founder note, concise service line, contacts with hours, one estimate CTA).
- Quarter sheet redesigned for the door-knock campaign: headline "Your Home Deserves a
  Sparkling Standard." plus the owner-approved SPARKLE100 offer panel with exact config copy
  and the pre-claiming promotion QR (`quarter-sheet-sparkle100`, all three variants).
- Service naming aligned with the renamed "Recurring Residential Cleaning" collection;
  `print-facts.mjs` now verifies the campaign (enabled, $100, approved terms) at build time.
- All 27 sides rebuilt and re-verified (boxes, crop marks, margins, QR decode, die clearance,
  PII); 8 PPTX masters rebuilt and opened in PowerPoint; HQ print folder replaced in place
  with legacy previews/boards/drafts archived under `99_ARCHIVE/Historical_Research/`.

## Stage 2 — physical suite productionization and canonical routes (2026-10-06, local branch `stage2/door-knocking-system`)

Print
- Production generator `scripts/print/print-system.mjs`: 8 pieces × 3 variants (27 sides), versioned
  output root (never the original packet), correct crop marks, real TrimBox/BleedBox, separate die
  guide, scaled QR captions, distinct large-format compositions.
- Shared brand module `src/config/brand.ts` consumed by `Logo.astro` and the print system; extended
  fact verification in `scripts/print/print-facts.mjs` (service-area derivation, palette vs
  `tokens.css`, services vs content collection, Logo usage).
- Registry-driven QR mapping (`scripts/print/qr-map.mjs`); comprehensive verifier
  (`scripts/print/verify-print.mjs`) plus `pdf-boxes.py` and `verify-crop-marks.py`.
- Editable PowerPoint masters (`scripts/print/build-pptx.mjs`, `scripts/print/verify-pptx.ps1`).
- Tests: `tests/print/*.test.ts`; npm scripts `print:build`, `print:verify`, `print:pptx`, `pptx:verify`.

Routes
- Canonical route engine `scripts/canvass/route_engine.py` (Method B): contiguous balanced clustering,
  origin orientation, NN + same-street preference + 2-opt + efficiency-bounded street completion.
- One ordered route object drives sheets, workbook, tracking, map lines and numbered markers.
- `build_outputs.py` rewritten: ordered sheets with date/method/totals/map link, escaped map popups,
  priority filter, route jump, tile-failure notice.
- Verification `scripts/canvass/verify_routes.py`; synthetic tests `tests/routes/` (12 engine tests +
  privacy test). Benchmark: 101.6 mi vs 310.7 mi record-order (same 4,241 stops), 34 long edges vs 941,
  287 street re-entries vs 1,279.

Docs
- Added DESIGN-DECISIONS, QR-ASSIGNMENTS, ROUTE-PLANNING, OWNER-EDITING-GUIDE,
  PRIVACY-AND-DATA-HANDLING, CHANGELOG and the generated manifest.json.

## Stage 1 — discovery and design (2026-10-05/06)

- Packet audit, discrepancy register, QR matrix, route diagnosis, three design directions and the
  owner-approved Stage 2 authorization. Review package: `~/Downloads/Door Knocking - Stage 1 Review`.
