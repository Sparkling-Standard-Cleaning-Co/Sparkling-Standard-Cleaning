# Field acquisition changelog

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
