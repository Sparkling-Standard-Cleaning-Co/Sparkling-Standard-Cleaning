# Print specifications — field acquisition suite

All pieces are generated from one system (`scripts/print/print-system.mjs`) and share the brand
tokens, fonts, crest and QR registry. Colors are specified as RGB hex; ask the print shop to
convert to CMYK and match to the website. Gold/champagne is an accent only.

## Global rules

- **Bleed:** 0.125 in on all sides (`*-bleed.pdf`, with corner crop marks). Use `*-trim.pdf` when an
  online printer supplies its own bleed template.
- **Safe margin:** keep all text ≥0.15 in inside the trim edge (the artwork already does).
- **Resolution:** PNG previews are exactly 300 DPI at trim size.
- **Fonts:** Fraunces (display), Nunito Sans (body), Great Vibes (script) — self-hosted in
  `public/fonts/` and embedded in the PDFs.
- **Colors:** cream `#fdfbf8`, warm ink `#302429`, rose primary `#93475b`, rose soft `#e8b3bf`,
  champagne `#c6a369`, sand border `#e4d5c7`, taupe `#6f5f57`.
- **QR:** dark `#3d3036` on white with a 4-module quiet zone; minimum printed size 0.85 in
  (business/realtor cards); most pieces are 1.4–5.4 in.

## Piece specifications

| Piece | Trim | Stock recommendation | Print | Notes |
| --- | --- | --- | --- | --- |
| Business card | 3.5 × 2 in | 16 pt matte or soft-touch, uncoated | Double-sided | Front: identity + contact. Back: value + QR. Order 500–1,000. |
| Quarter sheet | 4.25 × 5.5 in | 100 lb matte text | Single-sided | Neighborhood handouts, community boards. |
| Door hanger | 3.5 × 8.5 in | 14–16 pt coated | Single-sided | **Die-cut: 1.25 in hole centered 0.925 in from the top.** The dashed circle on the artwork is the die guide; the top 1.75 in is kept clear. |
| QR estimate card | 4 × 6 in | 14–16 pt matte | Single-sided | The largest QR (1.95 in) for quick scanning at events and on doors. |
| Event poster | 11 × 17 in | 100 lb gloss text or 8 mil poster | Single-sided | Portrait appears here intentionally. |
| Foam board | 24 × 36 in | 3/16 in white foam core, matte laminate | Single-sided | Event tables/booths; QR is 5.4 in. |
| Community leave-behind | 5 × 7 in | 14–16 pt matte | Single-sided | Keep-on-desk card for HOAs, community centers, local businesses. |
| Realtor referral card | 3.5 × 2 in | 16 pt matte | Single-sided | Realtor desk card; links to the move-out page. |

## Quantities for a first run (cost-controlled)

| Piece | First run |
| --- | --- |
| Business card | 1,000 |
| Quarter sheet | 250 |
| Door hanger | 500 (targeted routes only) |
| QR estimate card | 500 |
| Event poster | 5 |
| Foam board | 2 |
| Community leave-behind | 250 |
| Realtor referral card | 250 |

Print locally where possible; no online service is required. Compare a local shop's quote for the
full run (usually cheapest per piece) and keep one PDF set for reorders.

## QR → destination map (verified)

`node scripts/print/verify-print-qrs.mjs` decodes every rendered preview and must pass before
printing. Destinations are the live site pages with the piece's tracked UTM parameters; see
`docs/marketing/field-acquisition/README.md` for the exact table.
