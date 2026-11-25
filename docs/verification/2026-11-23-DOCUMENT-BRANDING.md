# Document Branding Restoration — 2026-11-23

**Status:** implemented and verified locally. **Not deployed.** No historical
executed agreement, approved template or issued signing request was modified.

## Investigation

The original professional appearance came from the **renderer**, not from the
stored legal templates:

- `scripts/render-legal-docs.mjs` applied the approved circular logo, brand name,
  slogan, metadata panel, rose/gold typography, table styling and PDF footer.
- Production `document_templates` contain **57 legacy text templates and 0 rich
  HTML templates**. They store the legal body only.
- The WYSIWYG editor, signing reader and executed PDF rendered the stored body
  without the original renderer’s brand layer.
- The executed PDF used dependency-free text primitives only and had no image
  XObject support, so it could not print the logo.
- Legacy Markdown tables were parsed as ordinary paragraph lines, so the
  corrected preview showed literal `| Item | Detail |` text.
- Technical metadata lines such as Document ID, Version and Status could leak
  into the corrected preview until they were explicitly filtered.

This was **not only an editor presentation issue**: the customer signing screen
and executed PDF had also lost the original logo/letterhead. The legal wording
itself was intact.

## Corrections

- Added `src/lib/documents/branding.ts` as the shared brand layer:
  approved circular logo, company name, slogan, contact details, rose/gold
  palette, serif body typography, letterhead, footer, table styling, signature
  placement styling and print/mobile rules.
- Admin editor now shows a non-editable branded letterhead/footer around the
  editable body. The editable body remains the only stored content.
- Admin packet preview and editor live preview use the same branded renderer as
  the customer signing screen.
- Customer signing dialog now renders the branded document.
- Executed PDF now embeds the approved circular logo as a real PDF image XObject
  on every page, with a branded first-page letterhead, contact details, rose
  headings and a logo/footer/page-number line.
- Added legacy Markdown table parsing and rendering for HTML and PDF.
- Technical metadata lines are filtered from customer-facing output.
- No template content was republished. No signing request was invalidated.

## Automated verification

- Unit suite: **1,079 tests (1,078 pass, 1 pre-existing skip)**.
- Browser suite: **260/260 pass**.
- `astro check`: 0 errors. Build: 40 pages. Validation: 2,569 internal links.
  Smoke: 21 pages.
- `tests/document-branding.test.ts`: logo/letterhead/footer HTML, wording
  preservation, legacy tables, metadata suppression, embedded PDF logo,
  image-stream decompression, brand header/footer and page numbers.
- `tests/rich-text.test.ts`: legacy parsing, internal notice handling, Markdown
  rendering.
- `tests/document-pdf-clean.test.ts` and `tests/document-agreement.test.ts`:
  executed PDF text, signature evidence and internal-content guards.
- `tests/browser/admin-document-editor.test.mjs`: editable branded frame and
  live preview logo/name.
- `tests/browser/document-signing-ux.test.mjs`: customer signing dialog logo/name
  and signing flow.

## Rendered evidence

- `docs/verification/2026-11-23-document-branding/original-approved-render.png`
- `docs/verification/2026-11-23-document-branding/corrected-branded-render.png`
- `docs/verification/2026-11-23-document-branding/original-vs-corrected-final.png`
- `docs/verification/2026-11-23-document-branding/corrected-executed-pdf-page1.png`
- `docs/verification/2026-11-23-document-branding/corrected-executed-pdf-page2.png`

The comparison uses the approved Residential Deep Cleaning Agreement wording
from production with sample customer/property values for rendering only. The
templates and production records were not changed.

## Configuration

`src/lib/documents/branding.ts` is the single source for:

- logo asset (`/brand/sparkling-standard-circular-logo-1024.png`)
- company/legal identity and slogan
- contact block
- brand colours and typography
- header/footer content and spacing

The PDF logo is a generated 128×128 RGB derivative of the same approved circular
asset (`src/lib/documents/brand-logo.ts`), used because the Cloudflare Function
runtime cannot run an image processor.

## Not changed

- No production deployment.
- No database migration.
- No template republish.
- No historical executed agreement, signature, price snapshot or signing request
  was modified.
- No customer email or PDF was sent.
