# Verification status

What has actually been verified, what has not, and the exact commands. Never report partial
work as complete; update this file when verification runs.

## Verified (September 2026, pre-launch build)

| Check | Command | Result |
| --- | --- | --- |
| TypeScript diagnostics | `npm run check` | 0 errors, 0 warnings, 0 hints |
| Production build | `npm run build` | 18 pages + sitemap, no errors |
| Estimator unit tests | `npm test` | 27/27 pass (anchors, frequencies, add-ons, minimums, travel, thresholds, malformed input) |
| Internal links | `npm run links` | 1037 links across 18 pages, all resolve |
| SEO checks | `npm run seo` | unique titles/descriptions across 18 pages, canonicals, robots, JSON-LD, sitemap |
| Marketing registry + QR decode | `npm run marketing:verify` | registry valid, docs in sync, 13 QR assets decode-verified |
| Internal checklist leak check | `npm run validate` | 2 internal checklists verified absent from public build |
| Static smoke test | `npm run smoke` | 17 required pages, layout shell, estimate flow structure, form variants |
| Fake-testimonial detector | `npm run testimonials` | clean |
| No-fabrication audit | `npm run audit:facts` | no unsupported claims (4 review-context terms confirmed negative/exclusion usage) |
| PENDING-fact gate | `npm run pending` | **fails as designed** — placeholder brand/domain still PENDING (this is the production gate working) |
| Preview noindex behavior | `PUBLIC_PREVIEW_MODE=true npm run build` + `robots.txt` | verified: `noindex, nofollow`, `Disallow: /`, preview badges shown |
| Production robots behavior | default build | verified: `Allow: /` + sitemap |

## Pending (cannot be verified in this environment — owner or tooling required)

| Item | Why pending | How to verify |
| --- | --- | --- |
| Live form delivery | Requires the real provider key and inbox | Owner-authorized test submission after configuring `WEB3FORMS_*` |
| Live Turnstile | Requires Cloudflare keys | Enable, submit, confirm challenge appears server-side |
| Real route distance / EIA price | Requires `TRAVEL_ORIGIN` + provider keys | `POST /api/travel` after deployment with keys |
| Real-device mobile smoke | This environment cannot run a browser | Manual pass on a phone: estimate flow, sticky bar, tap-to-call |
| Visual review (founder eye) | Screenshots are for human review | Owner reviews preview; gear changes tracked in git |
| Lighthouse lab metrics | Needs a deployed URL and Chrome | Run PageSpeed Insights on production after launch |
| Full axe-core scan | Needs a browser | Run axe on deployed pages; the design system targets WCAG 2.2 AA |
| Image optimization behavior | No real content images exist yet | When the first real photos land, verify `astro:assets` output in the build |
| Search indexing | Post-launch | Search Console coverage after sitemap submission |

## How to re-run everything

```bash
npm install
npm run verify           # check + build + validate
npm test
npm run smoke
npm run testimonials
npm run audit:facts
node scripts/validate-production-env.mjs   # expected to fail while facts are PENDING
npm run pending                            # expected to fail until launch facts exist
```
