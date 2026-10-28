# Initiative 6.10 verification evidence

**Scope:** activate the owner-confirmed Instagram, YouTube and X profiles in the Follow Us section.
**Release:** commit `eb8b2bc`; Cloudflare Pages deployment
`95b29d45-33fa-4fdf-a695-c058b53bdae2`.
**Production:** https://sparkling-standard.com/

## Evidence

| File | Shows |
| --- | --- |
| `follow-us-desktop.png` | Twelve circular logo buttons in four columns and three balanced rows (local build) |
| `follow-us-mobile.png` | Same twelve profiles at 390 px (4 + 4 + 4) without overflow (local build) |
| `production-follow-us-desktop.png` | The same twelve links on the live site |
| `production-follow-us-mobile.png` | The same twelve links on the live site at phone width |

Production live check: **12 links**, rows **4 + 4 + 4** on desktop and mobile, and **12 unique
`sameAs` URLs** in the LocalBusiness structured data. Instagram, YouTube and X are present with the
exact owner-supplied URLs.

## Automated checks (GitHub release)

- Validate: success (configuration, type check, unit tests, build, validation, smoke, claim audits).
- Browser: **150 passed, 0 failed**.
- Cloudflare Pages: success.

The social regression test verifies the exact 12 URLs, accessible names, new-tab/noopener behavior,
no UTM parameters on outbound links, 52 px circular targets, 4 + 4 + 4 wrapping, and the complete
`sameAs` set without duplicates.
