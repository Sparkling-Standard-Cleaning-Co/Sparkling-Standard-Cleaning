# Field acquisition system (physical customer acquisition)

One design system, eight printed pieces, one measurement loop. Built from the live brand system
(`src/styles/tokens.css`, `src/components/Logo.astro`, `src/config/business.ts`) and the existing
marketing-link registry — no new brand, no new tracking stack, no fabricated claims.

- Brand audit and reference-concept analysis: `docs/brand/PHYSICAL-BRAND-SYSTEM-AUDIT.md`
- Per-piece print specifications: `docs/marketing/field-acquisition/PRINT-SPECIFICATIONS.md`
- Offer/conversion engineering: `docs/marketing/field-acquisition/CONVERSION-STRATEGY.md`
- Owner procurement + usage guide: `docs/marketing/field-acquisition/OWNER-GUIDE.md`
- Canvassing routes and targeting: `docs/marketing/CANVASSING-SYSTEM.md`

## Pieces and their tracking links

Every piece carries a QR from the generated registry (`public/marketing/qr/`), so scans are
attributed to the piece, not just "print". The printed domain is the clean canonical domain;
typed visits are intentionally unattributed (the QR carries tracking).

| Piece | Size (trim) | QR registry id | Tracked destination |
| --- | --- | --- | --- |
| Business card (front/back) | 3.5 × 2 in | `business-card` | `/estimate/` (`business_card/print/business_card`) |
| Quarter sheet | 4.25 × 5.5 in | `quarter-sheet` | `/recurring-cleaning/` (`quarter_sheet/print/neighborhood`) |
| Door hanger | 3.5 × 8.5 in, 1.25 in die-cut | `door-hanger` | `/recurring-cleaning/` (`door_hanger/print/door_hanger`) |
| QR estimate card | 4 × 6 in | `qr-estimate-card` | `/estimate/` (`qr_card/print/estimate_card`) |
| Event poster | 11 × 17 in | `event-poster` | `/estimate/` (`event_poster/print/community_event`) |
| Foam board | 24 × 36 in | `foam-board` | `/estimate/` (`foam_board/print/community_event`) |
| Community leave-behind | 5 × 7 in | `community-leave-behind` | `/estimate/` (`community_leave_behind/print/community`) |
| Realtor referral card | 3.5 × 2 in | `realtor-packet` | `/move-in-move-out-cleaning/` (`realtor/outreach/moveout`) |

## Build and verify

```
node scripts/print/print-system.mjs      # renders every piece into ~/Downloads/Door Knocking/
node scripts/print/verify-print-qrs.mjs  # decodes each rendered QR and checks the exact URL
npm run marketing:links                  # regenerate registry docs + QR assets after link changes
```

The print system fails the build if `scripts/print/print-facts.mjs` drifts from
`src/config/business.ts` / `Logo.astro`. QR verification fails the build if a rendered QR does not
decode to its exact tracked URL.

## Output folder (`~/Downloads/Door Knocking/`)

```
README.md                  owner procurement + usage guide (copy of OWNER-GUIDE.md)
Print-Ready-PDF/           *-bleed.pdf (crop marks, print shop) and *-trim.pdf (online printers)
PNG-Previews/              300 DPI PNGs for proofing and quick print
Editable-Sources/          generated HTML + local fonts, portrait and QR assets
Specifications/            print specifications, asset manifest
Canvassing/                workbook, route sheets, tracking CSV and route map
```

## Future maintenance

1. Change facts in `src/config/business.ts` (never in the print files) and re-run the build; the
   drift check forces the update.
2. Add a new piece: add its link + QR in `src/config/marketing-links.ts`, regenerate, then add the
   piece definition in `scripts/print/print-system.mjs`.
3. Never add a discount, guarantee, review count, insurance or licensing claim to artwork without
   the owner's written approval and the corresponding publication flag.
4. Re-run `node scripts/print/verify-print-qrs.mjs` after every rebuild; do not print a failed run.
