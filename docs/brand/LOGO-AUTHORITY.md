# Authoritative Sparkling Standard logo

**Determined:** 2026-11-19
**Raster corrected:** 2026-11-22

## Authoritative artwork

The current owner-approved logo is the **circular Sparkling Standard mark**:

- Script "Sparkling" above spaced "STANDARD" inside a gold ring with sparkles.
- No "Cleaning Co." descriptor and no slogan inside the mark.
- Live website, favicon/PWA kit, social preview and the owner's
  `02 BRANDING & DESIGN/.../Approved-Brand-Assets` folder all use this artwork.

Source files:

| Use | File |
| --- | --- |
| Vector master | `public/brand/logo-primary.svg` (identical artwork: `logo-mark.svg`, `logo-mark-soft.svg`) |
| Official brand fonts | `public/fonts/great-vibes-normal-latin.woff2` (script "Sparkling") and `public/fonts/fraunces-normal-latin.woff2` (STANDARD) |
| High-resolution raster master | `public/brand/sparkling-standard-circular-logo-1024.png` (rendered directly from `logo-primary.svg` with the embedded official fonts; SHA-256 `0253b65fba7a90e63325b00bda5dfb15fb6d08f049e3f680c0a75895518ba237`) |
| Obsolete raster (do not use) | `public/brand/approved-icon-master-1024.png` — the earlier stylized S mark. It is retained only as history and must not be embedded in a legal document. |
| Browser/PWA icons | `public/brand/icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `favicon.*` |
| Owner master archive | `C:\Users\thoma\Downloads\SPARKLING STANDARD - MASTER\02 BRANDING & DESIGN\Brand Assets\02_Logos_and_Identity\Approved-Brand-Assets\` |

Regenerate the browser/PWA/social assets, including the 1024 raster master, only with:

```powershell
node scripts/generate-logo-assets.mjs
```

## 2026-11-22 branding correction

The legal package's prior `sparkling-standard-circular-logo-1024.png` was a bad
raster render: the SVG text was rasterized with fallback lettering instead of
the approved Great Vibes script and Fraunces wordmark. The official vector
(`logo-primary.svg`) and fonts were correct and were not changed. The raster was
re-rendered from that official vector with `document.fonts.ready` and the
embedded Great Vibes/Fraunces font files, producing SHA-256
`0253b65fba7a90e63325b00bda5dfb15fb6d08f049e3f680c0a75895518ba237`.
The old fallback-font raster is preserved only in the private legal revision
backup. Both the repository master and the owner's
`02 BRANDING & DESIGN\Brand Assets\02_Logos_and_Identity\Approved-Brand-Assets\`
copy now carry the corrected SHA-256. The corrected raster is embedded in all 27
active legal DOCX masters and their review PDFs, all employee documents, the
sample packets and the contact sheet. The legal wording was not changed by this
correction.

## Candidate that is NOT approved

The `Elegant Gold S Floral Emblem.png` candidate (added 2026-11-08) has been
moved out of the product repository to the owner archive at
`02 BRANDING & DESIGN\Brand Assets\02_Logos_and_Identity\Candidate-Not-Approved\`.
It is an untracked raster concept: a gold "S" with a floral corner and a
photographic interior background. It is **not** in the Approved-Brand-Assets
folder, is not referenced by the website, and is not approved for legal
documents.

It is preserved untouched as an owner candidate. If the owner wants to adopt it,
that requires a new explicit brand decision, a proper vector/transparent asset,
and regeneration of the logo kit. Until then, legal documents and email use the
approved circular mark only.

## Obsolete artwork

`public/brand/approved-icon-master-1024.png` is the earlier stylized **S** mark.
It was mistakenly used by the abbreviated 2026-11-22 legal candidates. Do not
use it for a legal document, email header, packet cover or generated PDF. It is
retained only as historical inventory. The corrected documents use
`sparkling-standard-circular-logo-1024.png`, rendered from the approved
`logo-primary.svg` circular artwork.

## Legal document rule

`scripts/render-legal-docs.mjs` and the final approval package embed
`public/brand/sparkling-standard-circular-logo-1024.png` at the top of every
rendered agreement and use **Sparkling Standard Cleaning Co.** with
**Standards That Sparkle.** The legal entity remains **Sparkling Standard LLC**.
Any document that embeds the old stylized S mark is rejected and must be
regenerated.
