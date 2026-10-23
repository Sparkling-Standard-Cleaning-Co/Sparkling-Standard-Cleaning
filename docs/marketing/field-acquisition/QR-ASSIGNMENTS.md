# QR assignments — physical pieces

Authoritative registry: `src/config/marketing-links.ts`. QR assets:
`public/marketing/qr/`. The print system resolves every QR through
`scripts/print/qr-map.mjs`; payloads are never hand-edited.

| Piece / side | QR asset | Registry link id | Destination | Placement |
| --- | --- | --- | --- | --- |
| Business card — back | `business-card` | `business_card_estimate` | `/estimate/` | Back panel, with caption |
| Quarter sheet — front | `quarter-sheet-sparkle100` | `quarter_sheet_sparkle100` | `/estimate/?promo=SPARKLE100` | Bottom-left, inside the SPARKLE100 offer panel row |
| Door hanger — front | `door-hanger` | `door_hanger_recurring` | `/recurring-cleaning/` | Lower area, below the die zone |
| QR estimate card — front | `qr-estimate-card` | `qr_card_estimate` | `/estimate/` | Center, QR-first |
| Event poster — front | `event-poster` | `event_poster_estimate` | `/estimate/` | Lower-left |
| Foam board — front | `foam-board` | `foam_board_estimate` | `/estimate/` | Lower-left, large |
| Community leave-behind — front | `community-leave-behind` | `community_leave_behind` | `/estimate/` | Bottom-left |
| Realtor card — front | `realtor-packet` | `realtor_moveout` | `/move-in-move-out-cleaning/` | Right panel |

The quarter sheet's QR is the owner-approved SPARKLE100 welcome offer QR: it opens the estimate
flow with the promotion pre-claimed plus print attribution (`utm_source=quarter_sheet`,
`utm_medium=print`, `utm_campaign=sparkle100`). Its offer copy and eligibility terms come
verbatim from `pricing.ts` at build time — never a separately worded print offer. If the
campaign is disabled in the config, `print-facts.mjs` fails the build rather than printing a
stale offer.

## Verification

```
npm run print:build     # renders PNG previews + PDFs
npm run print:verify    # decodes every generated PNG; compares byte-for-byte with the registry URL
npm run marketing:verify
```

`verify-print` also checks PDF boxes, crop-mark geometry, safe margins, QR minimum sizes, caption
minimum sizes, door-hanger die clearance and PII patterns. It fails closed on any mismatch.

## Rules

- Minimum printed QR size: 0.85 in on cards; larger on other pieces (manifest `qrMin`).
- 4-module quiet zone; dark `#3d3036` on white; never recolor, crop or scale a QR independently.
- A pending registry link must never be printed (`qr-map.mjs` refuses pending links).
- If a mapping is semantically wrong, stop and report it — do not invent a replacement.
