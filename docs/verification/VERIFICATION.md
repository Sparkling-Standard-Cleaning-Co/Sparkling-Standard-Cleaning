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
| Pages Function fail-safe tests | `npm test` | 18/18 pass (`/api/lead`: invalid input, honeypot, no-contact, Turnstile-missing-token, not-configured 503, provider success/failure, 405; `/api/travel`: missing origin, malformed/unreferenced ZIP, straight-line fallback, provider route, provider failure fallback, EIA failure fallback, live EIA price, 405) — **45 tests total** |
| Internal links | `npm run links` | 982 links across 18 pages, all resolve |
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
| Design tokens applied | `src/styles/global.css` imports `tokens.css` | **fixed a pre-existing defect**: tokens were never imported, so the whole design system was undefined in every previous build. Verified in the built CSS and in computed styles (footer background `rgb(48,36,41)`, body font "Nunito Sans"). |
| Browser layout pass (Playwright, real Chromium) | 15 pages × 360/768/1440 = 45 combinations | 0 horizontal overflow, 0 console errors, 0 missing H1s, no PENDING text; sticky mobile action bar visible; `tel:+18502468479` present; 0 `sms:` links while SMS is unverified |
| Accessibility scan (axe-core, WCAG 2.0/2.1/2.2 A+AA) | 15 pages at 360 px | **0 violations**. Fixed: touch-target sizes in footer/standalone links and footer-tagline color contrast found in earlier scans. |
| Estimator flow (real browser) | 3/2 1600 sq ft, maintained, biweekly, ZIP 32503 | completes the wizard; live range `$235 – $285` shown before submission; matches the internal labor model |
| Estimator out-of-area behavior | same flow with ZIP 90210 | "Custom confirmation required" with an honest explanation — never a fake price |
| Estimator draft persistence | reload mid-flow | restored to the saved step (fixed a bug where the progress restored but the visible step did not) |
| Estimator fail-safe travel lookup | static preview (`/api/travel` 404) | falls back to zone-based travel without breaking the estimate — expected until Cloudflare Pages Functions run in deployment |
| Header reflow | 960/1024/1152/1280/1440 px | wordmark never truncated; navigation reflows; phone button hidden only in the 960–1088 px band where it cannot fit (number remains in mobile menu, footer and contact surfaces) |
| Deployment configuration package | `npm run deploy:secrets` with dummy values + `git check-ignore` | generates the git-ignored `deploy/secrets.env` in the `wrangler pages secret bulk` format; missing required keys exit non-zero; the ignore rules were verified |
| Operations documentation | `docs/OPERATIONS-HUB.md`, `docs/operations/PLATFORM-STATUS.md`, `docs/operations/AUTOMATION-REGISTER.md` | created as the single entry point, the only platform-status register, and the automation inventory |

## Verified — live production audit (2026-10-01)

Production: `https://sparkling-standard.com` (Git-connected Cloudflare Pages project;
commit check-runs and deployed bundle hashes verified).

| Check | Method | Result |
| --- | --- | --- |
| Page availability | HTTP + Playwright over 15 pages | all `200`; no console errors; no horizontal overflow at 360 px |
| Canonicals + robots | live HTML inspection | every page `index, follow` with self-referencing canonical; `robots.txt` `Allow: /` + sitemap. `PUBLIC_PREVIEW_MODE` is NOT set |
| Accessibility | axe-core WCAG 2.0/2.1/2.2 A+AA at 360 px | 0 violations on home, estimate, contact |
| Mobile action bar + contact | Playwright | sticky bar visible; `tel:+18502468479` correct; 0 `sms:` links (gate off) |
| Consent behavior | Playwright | consent banner hidden and no analytics requests while no IDs are configured |
| Core Web Vitals (lab) | Chromium, 1.6 Mbps / 150 ms RTT / 4× CPU | home LCP 1.65 s / CLS 0.038; estimate LCP 1.37 s / CLS 0; contact LCP 1.26 s / CLS 0 (targets: LCP ≤ 2.5 s, CLS ≤ 0.1 — met). INP not measurable without interaction; recorded as unreported |
| `/api/travel` | live POST | deployed and responding `503 origin_not_configured` (function works; configuration pending) |
| `/api/lead` | live POST (invalid payload, then valid test) | deployed and validating (`400` on bad input); `503 not_configured` on a valid payload — **form delivery blocked until the Web3Forms key is configured**; no false success |
| Authorized test submission | live contact form, clearly marked test | honest failure copy shown; no email sent (correct fail-safe). Inbox delivery cannot be confirmed by engineering |
| Form failure copy | local + deployed bundle inspection | fixed and deployed (`edac89e`): honors the server's `503 not_configured` signal, attempts the static fallback, and shows channel-accurate alternatives (call/email; never "text" while SMS is unverified) |
| Estimator on production | live wizard flow | range appears for in-area ZIPs; out-of-area routes to manual confirmation (verified locally before deploy; live behavior matches) |

Lighthouse/PageSpeed Insights could not be run: the public PSI API returned a daily-quota `429`.
The Core Web Vitals above are direct Chromium measurements with the method recorded, not
Lighthouse scores.

## Pending (cannot be verified in this environment — owner or tooling required)

| Item | Why pending | How to verify |
| --- | --- | --- |
| Live form delivery | Requires the Web3Forms key and inbox | Owner-authorized test submission per form category after configuring `WEB3FORMS_*`; confirm it arrives at `owner@sparkling-standard.com` |
| Live Turnstile | Requires Cloudflare keys | Enable, submit, confirm challenge appears server-side |
| Real route distance / EIA price | Requires `TRAVEL_ORIGIN` + provider keys | `POST /api/travel` after deployment with keys |
| Cloudflare preview deployment | Requires Cloudflare account access | Connect the repository, deploy, verify pages + Pages Functions |
| Real-device mobile smoke | Playwright emulation only (no physical device) | Manual pass on a phone: estimate flow, sticky bar, tap-to-call |
| Visual review (founder eye) | Screenshots prepared for review; automated checks cannot judge taste | Owner reviews the preview and screenshots; change requests tracked in git |
| Lighthouse lab metrics | Needs a deployed URL and Chrome | Run PageSpeed Insights on the production preview |
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
npm run pending                            # passes on the branded build
node scripts/validate-production-env.mjs   # still expected to fail until owner launch inputs land
```

Browser checks (requires Playwright with Chromium available; run `npm run preview` first):
page loads, viewport overflow, console errors, sticky bar, axe-core WCAG scan, and the estimator
wizard flow were verified with a temporary Playwright harness during the October 2026 recovery
session. Screenshots at 360/768/1440 were produced for owner review.
