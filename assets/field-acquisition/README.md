# Field-acquisition assets (approved, non-sensitive only)

This folder holds durable, non-sensitive assets for the physical acquisition system. Never place
addresses, coordinates, household data, canvassing results or credentials here.

## `masters/`

The eight accepted **editable PowerPoint masters** in the recommended production variant:

| File | Piece |
| --- | --- |
| `business-card-neighbor.pptx` | Business card (front + back slides) |
| `quarter-sheet-neighbor.pptx` | Quarter sheet |
| `door-hanger-neighbor.pptx` | Door hanger |
| `qr-estimate-card-utility.pptx` | QR estimate card |
| `event-poster-editorial.pptx` | Event poster |
| `foam-board-editorial.pptx` | Foam board |
| `community-leave-behind-neighbor.pptx` | Community leave-behind |
| `realtor-card-utility.pptx` | Realtor referral card |

These are generated, not hand-edited: regenerate with `npm run print:pptx` (byte-identical across
runs) and verify with `npm run pptx:verify`. Editing rules and the owner workflow live in
`docs/marketing/field-acquisition/OWNER-EDITING-GUIDE.md`. Final print PDFs always come from
`npm run print:build` + `npm run print:verify`; a PPTX is an editing master, not a press-ready file.

## What belongs here

- Approved brand sources that the generator consumes and that must not live in a personal folder.
- Masters and other accepted, reproducible, non-sensitive deliverables.

## What never belongs here

- `canvass-out/` data, route printouts, tracking CSVs, owner names, coordinates, `.env` values,
  credentials or tokens.
