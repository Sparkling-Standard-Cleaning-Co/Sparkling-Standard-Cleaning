# Verification status

What has actually been verified, what has not, and the exact commands. Never report partial
work as complete; update this file when verification runs.

## Verified (October 2026, branded pre-launch build)

Recovery note: this work was verified in the recovered standalone repository
(`Sparkling-Standard-Cleaning`) cloned from the original development directory with full history.
Windows clones must have `core.autocrlf=false` (or honour the committed `.gitattributes`) — the
generated marketing documents are byte-compared by validation.

| Check | Command | Result |
| --- | --- | --- |
| TypeScript diagnostics | `npm run check` | 0 errors, 0 warnings, 0 hints |
| Production build | `npm run build` | 18 pages + sitemap, no errors |
| Estimator unit tests | `npm test` | 27/27 pass (anchors, frequencies, add-ons, minimums, travel, thresholds, malformed input) |
| Internal links | `npm run links` | 1018 links across 18 pages, all resolve (fewer than the pre-brand 1037 because unverified SMS CTAs are now hidden) |
| SEO checks | `npm run seo` | unique titles/descriptions across 18 pages, canonicals, robots, JSON-LD, sitemap |
| Marketing registry + QR decode | `npm run marketing:verify` | registry valid, docs in sync, 13 QR asset groups decode-verified against `https://sparkling-standard.com` URLs |
| Internal checklist leak check | `npm run validate` | 2 internal checklists verified absent from public build |
| Static smoke test | `npm run smoke` | 17 required pages, layout shell, estimate flow structure, form variants |
| Fake-testimonial detector | `npm run testimonials` | clean |
| No-fabrication audit | `npm run audit:facts` | no unsupported claims |
| PENDING-fact gate | `npm run pending` | **passes** — approved facts (name, domain, phone, email) are in source; no placeholders in the build |
| JSON-LD PENDING guard | `npm run pending` (extended) | verified with a positive control: the pre-fix build failed with "JSON-LD contains a PENDING value"; passes after filtering unconfirmed social URLs |
| Preview noindex behavior | `PUBLIC_PREVIEW_MODE=true npm run build` + `robots.txt` | verified: `noindex, nofollow`, `Disallow: /` |
| Production robots behavior | default build | verified: `Allow: /` + sitemap at the real domain |
| Brand asset regeneration | `node scripts/generate-brand-images.mjs` | favicons, apple-touch-icon, icon-512, OG image regenerated with the confirmed name and tagline |

## Pending (cannot be verified in this environment — owner or tooling required)

| Item | Why pending | How to verify |
| --- | --- | --- |
| Live form delivery | Requires the Web3Forms key and inbox | Owner-authorized test submission per form category after configuring `WEB3FORMS_*`; confirm it arrives at `owner@sparkling-standard.com` |
| Live Turnstile | Requires Cloudflare keys | Enable, submit, confirm challenge appears server-side |
| Real route distance / EIA price | Requires `TRAVEL_ORIGIN` + provider keys | `POST /api/travel` after deployment with keys |
| Cloudflare preview deployment | Requires Cloudflare account access | Connect the repository, deploy, verify pages + Pages Functions |
| Real-device mobile smoke | This environment cannot run a browser | Manual pass on a phone: estimate flow, sticky bar, tap-to-call |
| Browser-level layout checks | No browser automation available in this environment yet | Run the smoke/visual scripts against the deployed preview; screenshots for owner review |
| Visual review (founder eye) | Generated images cannot be visually inspected here | Owner reviews preview and brand assets; change requests tracked in git |
| Lighthouse lab metrics | Needs a deployed URL and Chrome | Run PageSpeed Insights on the production preview |
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
npm run pending                            # should pass on the branded build
node scripts/validate-production-env.mjs   # still expected to fail until owner launch inputs land
```
