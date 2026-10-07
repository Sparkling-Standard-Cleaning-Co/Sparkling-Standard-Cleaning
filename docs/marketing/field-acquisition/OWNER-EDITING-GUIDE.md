# Owner editing guide — PowerPoint masters + print files

The print system produces **editable PowerPoint masters** for owner edits and **print-ready PDFs**
from a deterministic generator. A PPTX is an editing master, not a press-ready file.

## What you get

| Folder (in the Stage 2 output root) | What it is |
| --- | --- |
| `Print-Ready-PDF/<variant>/` | `*-bleed.pdf` (crop marks + TrimBox) for local print shops; `*-trim.pdf` for online printers |
| `PNG-Previews/<variant>/` | 300 DPI previews (foam board 150 DPI) for proofing |
| `Editable-Masters/` | One `.pptx` per piece in the recommended production variant |
| `Suite-Boards/` | Overview boards for each variant |
| `Specifications/` | Print specs, production mix, printer notes, asset manifest, die guide |

Default output root: `~/Downloads/Door Knocking - Stage 2 Review`. The original
`~/Downloads/Door Knocking` packet is never touched.

## Five-minute edit

1. Install the five free font files once (see below).
2. Open the piece's `.pptx` in PowerPoint.
3. Click any text (name, phone, headline, bullets, captions) and type — ordinary text stays text;
   panels and rules are ordinary editable shapes; the lockup, portrait and QR are linked images.
4. Save. If you only need a trim-size PDF for an online printer: File → Export → PDF.
5. For a print shop (bleed + crop marks + TrimBox), send the generated `*-bleed.pdf` instead and have
   the developer re-sync the edited copy (a short, documented step).

## Fonts (one-time, free)

The brand fonts are self-hosted and open-licensed (`docs/design/FONT-LICENSES.md`):

- `public/fonts/fraunces-normal-latin.woff2`, `fraunces-italic-latin.woff2`
- `public/fonts/nunito-sans-normal-latin.woff2`, `nunito-sans-italic-latin.woff2`
- `public/fonts/great-vibes-normal-latin.woff2`

Convert/install them on your machine (right-click → Install, or install the TTF/OTF versions from the
same family). Until they are installed, PowerPoint substitutes other fonts — the layout is unaffected
but the type will not match the website.

## Rules

- Never retype or approximate the logo; never recolor or crop a QR.
- Never add a discount, guarantee, review count, insurance or licensing claim without written owner
  approval.
- Final print files must come from `npm run print:build` (verified) or a PowerPoint trim export; never
  hand-edit a PDF.
- Re-run `npm run print:verify` after any generator change; do not print a failed run.
