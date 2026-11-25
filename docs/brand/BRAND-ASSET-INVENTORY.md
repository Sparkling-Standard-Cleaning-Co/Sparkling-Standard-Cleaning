# Sparkling Standard brand asset inventory

**Status:** authoritative (2026-11-25)
**Approved identity:** circular Sparkling Standard wordmark
**Approved slogan:** Standards That Sparkle.

This is the single inventory for active product brand artwork. Anything not
listed as active here must not be used in the website, admin, email, generated
documents, marketing or print output.

## Active artwork

| Asset | Path | Role |
| --- | --- | --- |
| Primary vector | `public/brand/logo-primary.svg` | Authoritative artwork |
| Mark vector | `public/brand/logo-mark.svg` | Compact mark use |
| Soft mark vector | `public/brand/logo-mark-soft.svg` | Low-contrast mark use |
| 1024 raster master | `public/brand/sparkling-standard-circular-logo-1024.png` | Rendered from the vector with embedded official fonts (SHA-256 `0253b65fba7a90e63325b00bda5dfb15fb6d08f049e3f680c0a75895518ba237`) |
| Apple touch icon | `public/brand/apple-touch-icon.png` | Browser/PWA kit |
| PWA icon 192 | `public/brand/icon-192.png` | Browser/PWA kit |
| PWA icon 512 | `public/brand/icon-512.png` | Browser/PWA kit |
| Maskable icon | `public/brand/icon-maskable-512.png` | Browser/PWA kit |
| Social preview | `public/brand/og-default.png` | Open Graph/Twitter card |

Browser icons (`public/favicon.ico`, `public/favicon.svg` and the `favicon-*.png`
set) are generated from the same artwork and listed by the generator.

Regenerate every browser/PWA/social raster from the approved vector with:

```powershell
node scripts/generate-logo-assets.mjs
```

## Typography

- Great Vibes: script "Sparkling".
- Fraunces: "STANDARD" wordmark and display headings.
- Nunito Sans: body and interface copy.

Font files live in `public/fonts/` and are self-hosted.

## Design tokens

Approved color, spacing, type and radius tokens live in
`src/styles/tokens.css`. Do not introduce raw colors or spacing in components.

## Retired artwork

| Retired asset | Original path | Archive path | SHA-256 | Reason |
| --- | --- | --- | --- | --- |
| Gold "S" monogram with floral imagery | `public/brand/approved-icon-master-1024.png` | `docs/brand/archive/retired-gold-s-monogram-1024.png` | `364ebc8350559d39f77d36bc22d559e98b332dc6354d3c4bbdced11f7b877e26` | Superseded by the owner-approved circular wordmark. The misleading name suggested it was current and caused reuse in marketing material. |

Rules for the retired asset:

- It is preserved only as history. It is not served by the website.
- It must never appear in a legal document, email, invoice, receipt, signing
  evidence, marketing asset or print piece.
- Do not restore the original filename. Do not copy it back into `public/`.
- The circular wordmark is the only approved identity.

Historical executed agreements, invoices, receipts and signing evidence keep
their original artwork and are never rewritten.

## Enforcement

`tests/legal-document-quality.test.ts` proves:

- the circular vector/raster are present with the approved raster hash;
- the retired monogram is absent from `public/brand/`;
- the archived copy exists and differs from the approved mark;
- every file in `public/brand/` is described in this inventory;
- the legal renderer references only the approved circular raster.

`docs/brand/LOGO-AUTHORITY.md` records the ownership decision and the raster
correction history.
