# Field acquisition system (physical customer acquisition)

One brand, three suite variants, eight printed pieces, one measurement loop. Built from the live
brand system (`src/config/business.ts`, `src/config/brand.ts`, `src/styles/tokens.css`,
`src/components/Logo.astro`) and the marketing-link registry — no new brand, no new tracking stack,
no fabricated claims.

- Creative system and production mix: `DESIGN-DECISIONS.md`
- Piece/variant manifest (generated): `manifest.json`
- Per-piece specifications: `PRINT-SPECIFICATIONS.md`
- QR assignments: `QR-ASSIGNMENTS.md`
- Owner editing (PPTX + print files): `OWNER-EDITING-GUIDE.md`
- Privacy and data handling: `PRIVACY-AND-DATA-HANDLING.md`
- Canvassing routes: `docs/marketing/CANVASSING-SYSTEM.md`, `ROUTE-PLANNING.md`
- Change history: `CHANGELOG.md`

## Variants and pieces

| Variant | Label | Recommended for |
| --- | --- | --- |
| `neighbor` | From a Neighbor | business card, quarter sheet, door hanger, community leave-behind |
| `utility` | The Detail Standard | QR estimate card, realtor referral card |
| `editorial` | The Standard | event poster, foam board |

Every piece is generated in all three variants (27 sides). The recommended first print run uses the
mix above; see `DESIGN-DECISIONS.md`.

## Build and verify

```
npm run print:build      # renders PDFs, 300 DPI previews, boards and specs into the output root
npm run print:verify     # PDF boxes, crop marks, QR decode, safe margins, die clearance, PII
npm run print:pptx       # editable PowerPoint masters (production variant)
npm run pptx:verify      # opens every master in PowerPoint and exports slide 1 as a PNG
npm run marketing:verify # registry documents + QR decode
npm run test:print       # manifest/QR/output structural tests
```

The default output root is `~/Downloads/Door Knocking - Stage 2 Review`; override with
`PRINT_OUT_DIR` or `--out`. The original `~/Downloads/Door Knocking` packet is never written to.

The build fails if print facts drift from `business.ts`/`brand.ts`, if a QR no longer resolves through
the registry, or if any verification check fails. Do not print a failed run.
