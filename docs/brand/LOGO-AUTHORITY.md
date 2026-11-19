# Authoritative Sparkling Standard logo

**Determined:** 2026-11-19

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
| High-resolution raster master | `public/brand/approved-icon-master-1024.png` |
| Browser/PWA icons | `public/brand/icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `favicon.*` |
| Owner master archive | `C:\Users\thoma\Downloads\SPARKLING STANDARD - MASTER\02 BRANDING & DESIGN\Brand Assets\02_Logos_and_Identity\Approved-Brand-Assets\` |

Regenerate the browser/PWA/social assets only with:

```powershell
node scripts/generate-logo-assets.mjs
```

## Candidate that is NOT approved

`public/brand/Elegant Gold S Floral Emblem.png` (added 2026-11-08) is an
untracked raster concept: a gold "S" with a floral corner and a photographic
interior background. It is **not** in the Approved-Brand-Assets folder, is not
referenced by the website, and is not approved for legal documents.

It is preserved untouched as an owner candidate. If the owner wants to adopt it,
that requires a new explicit brand decision, a proper vector/transparent asset,
and regeneration of the logo kit. Until then, legal documents and email use the
approved circular mark only.

## Legal document rule

`scripts/render-legal-docs.mjs` embeds `approved-icon-master-1024.png` at the top
of every rendered agreement and uses **Sparkling Standard Cleaning Co.** with
**Standards That Sparkle.** The legal entity remains **Sparkling Standard LLC**.
