# Premium icon register

Authoritative record of the owner-supplied premium vector icon collection installed on
2026-10-24. The artwork is original, hand-built SVG illustration provided directly by the
owner — no third-party licensing applies, and no substitution (stock icons, emoji, redrawn
approximations) is ever permitted. The official company logo is untouched by this system.

## Registry

| Business meaning | Source file (package) | Repository path | Component | Variant | Rendered size | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Recurring Residential Cleaning | `01_Service_Tiles_SVG/recurring-residential.svg` | `src/assets/icons/premium/recurring-residential.svg` | `HomeServiceCard.astro`, `ServiceCard.astro`, `[service].astro` | Tile | 3.4rem (54px) card / page | Approved, live |
| Deep Cleaning | `01_Service_Tiles_SVG/deep-cleaning.svg` | `src/assets/icons/premium/deep-cleaning.svg` | same as above | Tile | 3.4rem | Approved, live |
| Move-in/Move-out Cleaning | `01_Service_Tiles_SVG/move-in-move-out.svg` | `src/assets/icons/premium/move-in-move-out.svg` | same as above | Tile | 3.4rem | Approved, live |
| Short-term Rental Turnover | `01_Service_Tiles_SVG/short-term-rental.svg` | `src/assets/icons/premium/short-term-rental.svg` | same as above | Tile | 3.4rem | Approved, live |
| Commercial Cleaning | `01_Service_Tiles_SVG/commercial-cleaning.svg` | `src/assets/icons/premium/commercial-cleaning.svg` | same as above | Tile | 3.4rem | Approved, live |
| Church Cleaning | `01_Service_Tiles_SVG/church-cleaning.svg` | `src/assets/icons/premium/church-cleaning.svg` | `[service].astro` (church page) | Tile | 3.4rem | Approved, live |
| Locally Owned | `02_Values_Tiles_SVG/locally-owned.svg` | `src/assets/icons/premium/locally-owned.svg` | `TrustChips.astro` | Tile | 3rem | Approved, live |
| Flexible Scheduling | `02_Values_Tiles_SVG/flexible-scheduling.svg` | `src/assets/icons/premium/flexible-scheduling.svg` | `TrustChips.astro` | Tile | 3rem | Approved, live |
| Christian Values | `02_Values_Tiles_SVG/christian-values.svg` | `src/assets/icons/premium/christian-values.svg` | `TrustChips.astro` | Tile | 3rem | Approved, live |
| Competitive Pricing | `02_Values_Tiles_SVG/competitive-pricing-WIDE-RECOMMENDED.svg` | `src/assets/icons/premium/competitive-pricing-WIDE-RECOMMENDED.svg` | `TrustChips.astro` | WIDE tile (256×128) | 4.4rem × 2.2rem | Approved, live |

Transparent variants (`03_Transparent_Icons_SVG/*-transparent.svg`) are stored alongside
the tiles in `src/assets/icons/premium/` for future use on colored CSS panels; the current
design uses the self-contained tiles.

## Architecture

- `src/lib/premium-icons.ts` — the `PremiumIconName` type registry and the service-slug
  list the services content schema accepts. ONE registry; no competing icon systems.
- `src/components/PremiumIcon.astro` — the single render component. It imports each SVG
  as raw text and inlines it, preserving the artwork's gradients, drop shadows and gold
  accents exactly. Sizes are set on the wrapper; the tile's aspect ratio is preserved
  (the WIDE pricing asset renders at half height).
- Services content `icon:` frontmatter holds the premium slugs (validated by the Zod
  enum in `src/content.config.ts`).

## Design rules

- **Double-background prevention:** the tiles carry their own rose/ivory gradient
  backgrounds, inner strokes and drop shadows. The site's former CSS icon chips
  (`card__icon` gradient plates, white trust-strip plates) were removed for these icons
  — never nest one colored rounded tile inside another. The `.premium-icon` wrapper is
  transparent.
- **Brand color treatment:** rose gradient (`#d28c9d → #a34e6d → #692b47`) with ivory
  (`#fffdfa → #f3dbe0`) and champagne-gold (`#fff2cb → #ce9765`) accents, all defined
  inside the SVG assets themselves.
- **Sizes:** service tiles render at 3.4rem (54px) — comfortably within the collection's
  designed 48–64px range; value tiles at 3rem; the WIDE pricing tile at 4.4rem × 2.2rem.
- **Responsive:** the trust banner is a single column on phones and two columns from
  tablet up (the Christian Values card carries three KJV passages and needs the room);
  tiles keep ≥44px on mobile. No horizontal overflow at 390px.
- **Accessibility:** the icons are decorative — every icon sits beside the heading that
  names its service/value, so the SVG is `aria-hidden="true"` with `focusable="false"`.
  The optional `label` prop adds `role="img"` + `aria-label` when an icon ever stands
  alone.
- **Future updates:** replace the SVG in `src/assets/icons/premium/` (same filename) or
  add a new slug to `src/lib/premium-icons.ts` + the Zod enum. Never bypass
  `PremiumIcon.astro`.

## Approved copy carried with this collection (2026-10-24)

- **Competitive Pricing:** "Quality service at an affordable price" — icon shows four
  dollar signs, exactly one filled and three outlined (the owner-recommended WIDE asset).
- **Christian Values** (heading unchanged), three KJV New Testament excerpts:
  - "…by love serve one another." — Galatians 5:13 (KJV, excerpt)
  - "Thou shalt love thy neighbour as thyself." — Mark 12:31 (KJV)
  - "And whatsoever ye do, do it heartily, as to the Lord…" — Colossians 3:23 (KJV, excerpt)
- **Estimator scheduling helper** (under Preferred date, the only helper line):
  "Requests can be made up to 60 days in advance." — the previous confirmation sentence
  was removed by owner direction; the 60-day window and arrival dropdown are unchanged.

## Related documentation

- `docs/design/DESIGN-SYSTEM.md` — overall visual system.
- `docs/design/IMAGE-SOURCE-REGISTER.md` — photography (icons are not photos).
- Business HQ authoritative package + asset record:
  `01_BUSINESS_ADMIN/Brand_Assets/Premium_Icon_Collection_2026-10-24/`.
