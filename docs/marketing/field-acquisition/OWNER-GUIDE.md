# Door Knocking — owner guide

This is the owner-facing guide to the physical customer-acquisition kit. Everything is generated from
the live website brand system, so every piece matches sparkling-standard.com: same crest, same
wordmark, same fonts, same colors, same phone number, same domain.

## What you get (Stage 2 output root)

| Folder | What it is |
| --- | --- |
| `Print-Ready-PDF/<variant>/` | The files to print. `*-bleed.pdf` has crop marks and 0.125 in bleed (local print shop); `*-trim.pdf` is the exact finished size (online printers) |
| `PNG-Previews/<variant>/` | 300 DPI images to check before ordering |
| `Editable-Masters/` | PowerPoint masters for owner edits (see `OWNER-EDITING-GUIDE.md`) |
| `Suite-Boards/` | One overview board per variant |
| `Specifications/` | Sizes, stock, quantities, printer notes, QR map, die guide |

The three variants are **From a Neighbor** (door-to-door), **The Detail Standard** (QR/utility) and
**The Standard** (large format). The recommended mix is in `Specifications/PRODUCTION-MIX.md`; ask
your developer if you want a different mix.

## How to order prints

1. Open `Specifications/PRINT-SPECIFICATIONS.md` and pick the quantities.
2. Send the print shop the recommended variant's `*-bleed.pdf` files. Tell them:
   - full color; double-sided only for the business card;
   - the door hanger needs a 1.25 in hole centered 0.925 in from the top;
   - matte stock as listed.
3. Ask for one proof of each piece; compare it with the PNG previews.
4. Start with the smallest sensible run (business cards + door hangers + quarter sheets).

Never let a printer redesign the logo or re-type the phone number. Never print
`door-hanger-die-guide.pdf` — it is a placement guide only.

## How to use the pieces

- **Business card** — carry them; hand one to every conversation.
- **Door hanger** — canvassing routes only; use the route sheets to pick the street.
- **Quarter sheet** — neighborhood handouts and community boards.
- **QR estimate card** — hand it to someone interested but busy.
- **Event poster (11×17)** — school fairs, markets, community events (ask first).
- **Foam board (24×36)** — event table display.
- **Community leave-behind (5×7)** — HOAs, community centers, local businesses.
- **Realtor referral card** — realtors, for their move-out clients.

## How the QR codes are measured

Each piece has its own QR pointing at a live page with tracking, so you can see which pieces produce
visits and inquiries. The exact URLs are in `QR-ASSIGNMENTS.md`. When a scan becomes an inquiry, the
lead email shows the campaign. The number that matters is **recurring customers per 100 doors or
scans**, not raw views.

## What is deliberately NOT on the pieces

- No discount or percentage off (no promotion is approved).
- No insurance, bonding or licensing claims until the documents exist.
- No review counts or testimonials until real reviews exist.
- No street address (service-area business).

## Rebuilding

From the repository:

```
npm run print:build      # regenerate everything into the Stage 2 output root
npm run print:verify     # prove boxes, crop marks, QR decode, margins and die clearance
```

If your phone number, email, domain or logo changes on the website, rebuild so the prints stay
consistent. The build refuses to run if the print facts drift from the website.
