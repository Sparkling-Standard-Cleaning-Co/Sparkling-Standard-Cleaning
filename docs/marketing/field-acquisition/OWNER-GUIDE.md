# Door Knocking — owner guide

This folder is the complete physical customer-acquisition kit for Sparkling Standard. Everything
was generated from the live website brand system, so every piece matches sparkling-standard.com
exactly: same crest, same wordmark, same fonts, same colors, same phone number, same domain.

## What is in this folder

| Folder | What it is |
| --- | --- |
| `Print-Ready-PDF/` | The files to print. `*-bleed.pdf` has crop marks and 0.125 in bleed (use at a local print shop). `*-trim.pdf` is the exact finished size (use with online printers that supply their own bleed template). |
| `PNG-Previews/` | 300 DPI images to check before ordering and for quick one-off printing. |
| `Editable-Sources/` | The HTML source of each piece plus its fonts, portrait and QR images, for a designer to edit later. |
| `Specifications/` | Sizes, paper stock, quantities, and the QR-to-destination map. |
| `Canvassing/` | The neighborhood targeting system: workbook, printable route sheets, performance tracking and the route map. |

## How to order prints (simplest path)

1. Open `Specifications/PRINT-SPECIFICATIONS.md` and pick the quantities you want.
2. Send the print shop the `*-bleed.pdf` files. Tell them:
   - full color, double-sided only for the business card,
   - matte stock as listed,
   - the door hanger needs a 1.25 in hole die-cut centered 0.925 in from the top.
3. Ask for one proof of each piece before the full run; compare the proof against the PNG previews.
4. Start with the smallest sensible run (business cards + door hangers + quarter sheets). Reorder
   from the same PDFs — the design never changes unless the website brand changes.

If you use an online printer (VistaPrint, GotPrint, etc.), use the `*-trim.pdf` files and follow
that printer's upload instructions. Never let a printer redesign the logo or re-type the phone
number.

## How to use the pieces

- **Business card** — always carry them. Front gives your name and contact; the back QR opens the
  instant estimate. Hand one to every conversation.
- **Door hanger** — for canvassing routes only (use the `Canvassing/` workbook to pick the street).
  Hang on the door handle; the top area is kept clear for the die-cut hole.
- **Quarter sheet** — neighborhood handouts, community boards, local bulletin boards, leave with a
  friendly neighbor who will share it.
- **QR estimate card** — the fastest scan: hand it over when someone is interested but busy; the QR
  opens the estimate in about a minute.
- **Event poster (11×17)** — tape up at school fairs, markets, community events (ask first).
- **Foam board (24×36)** — your table display at events; it shows your real portrait and the QR.
- **Community leave-behind (5×7)** — leave with HOAs, community centers, local businesses, realtors'
  offices; it lists all services and invites them to keep it.
- **Realtor referral card** — give to realtors for their move-out clients; the QR opens the move-out
  page.

## How the QR codes are measured

Each piece has its own QR that points to a live page with tracking, so you can see which pieces
produce visits and inquiries:

- business card → estimate page
- quarter sheet and door hanger → recurring-cleaning page
- QR estimate card, event poster, foam board, community leave-behind → estimate page
- realtor card → move-in/move-out page

The exact URLs are in `Specifications/PRINT-SPECIFICATIONS.md`. When a scan becomes an inquiry, the
lead email shows the campaign, so you can tell where the customer came from. Bookings and recurring
customers are recorded in `Canvassing/performance_tracking.csv` (or the workbook's Performance
Tracking tab). The number that matters is **recurring customers per 100 doors or scans**, not raw
views.

## What is deliberately NOT on the pieces

- **No discount or percentage off.** No promotion is approved yet, and a discount would work against
  the premium standard. If you decide to run a first-clean offer, tell your developer; approved
  variants can be generated (see `docs/marketing/field-acquisition/CONVERSION-STRATEGY.md`).
- **No insurance, bonding or licensing claims** until the documents exist.
- **No review counts or testimonials** until real reviews exist.
- **No street address** (service-area business).

## Rebuilding this folder

From the repository:

```
node scripts/print/print-system.mjs      # regenerate everything
node scripts/print/verify-print-qrs.mjs  # prove every QR still scans correctly
```

If your phone number, email, domain or logo ever changes on the website, rebuild this folder so the
prints stay consistent. The build refuses to run if the print facts drift from the website.
