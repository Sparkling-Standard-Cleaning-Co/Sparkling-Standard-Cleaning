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
| Estimator unit tests | `npm test` | Runs the full unit suite in one command (estimator anchors, frequencies, add-ons, minimums, travel, thresholds, malformed input, address ranking, quote verification, promotion engine, Pages Functions) — the exact current count is re-run and recorded at every change, never carried over |
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
| Browser layout pass (Playwright, real Chromium) | 15 pages × 360/768/1440 = 45 combinations | 0 horizontal overflow, 0 console errors, 0 missing H1s, no PENDING text; sticky mobile action bar visible; `tel:+18504268479` present; 0 `sms:` links while SMS is unverified |
| Accessibility scan (axe-core, WCAG 2.0/2.1/2.2 A+AA) | 15 pages at 360 px | **0 violations**. Fixed: touch-target sizes in footer/standalone links and footer-tagline color contrast found in earlier scans. |
| Estimator flow (real browser) | 3/2 1600 sq ft, maintained, biweekly, ZIP 32503 | completes the wizard; live range `$235 – $285` shown before submission; matches the internal labor model |
| Estimator out-of-area behavior | same flow with ZIP 90210 | "Custom confirmation required" with an honest explanation — never a fake price |
| Estimator draft persistence | reload mid-flow | **Intentionally none**: every visit/reload/back-forward starts a fresh blank estimate. Estimated answers are never stored in localStorage; only a per-session travel cache and the consent/attribution keys exist (browser test asserts the fresh start). Earlier documentation claiming draft restore was stale and has been corrected |
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
| Mobile action bar + contact | Playwright | sticky bar visible; `tel:+18504268479` correct; SMS enabled (`business.flags.smsEnabled: true`, owner-verified) so the text link is present |
| Consent behavior | Playwright | consent banner shown until a choice is made; GTM (`GTM-KSQ26HMG`) loads only after explicit analytics consent; no analytics request before it. Umami has no ID configured and does not load. The container's GA4 tags are prepared for owner import (`docs/analytics/GTM-CONTAINER-SETUP.md`) |
| Core Web Vitals (lab) | Chromium, 1.6 Mbps / 150 ms RTT / 4× CPU | home LCP 1.65 s / CLS 0.038; estimate LCP 1.37 s / CLS 0; contact LCP 1.26 s / CLS 0 (targets: LCP ≤ 2.5 s, CLS ≤ 0.1 — met). INP not measurable without interaction; recorded as unreported |
| `/api/travel` | live POST | deployed and verified (`method: route, verified: true` with the configured origin) |
| `/api/lead` | live POST (invalid payload, then valid test) | deployed, validating (`400` on bad input), and delivering via the server relay; owner-confirmed inbox delivery (2026-10-02) |
| Authorized test submission | live contact form, clearly marked test | delivered; failure copy remains channel-accurate (call/email/text) |
| Form failure copy | local + deployed bundle inspection | fixed and deployed (`edac89e`): honors the server's `503 not_configured` signal, attempts the static fallback, and shows channel-accurate alternatives (call/email; never "text" while SMS is unverified) |
| Estimator on production | live wizard flow | range appears for in-area ZIPs; out-of-area routes to manual confirmation (verified locally before deploy; live behavior matches) |

Lighthouse/PageSpeed Insights could not be run: the public PSI API returned a daily-quota `429`.
The Core Web Vitals above are direct Chromium measurements with the method recorded, not
Lighthouse scores.

## Verified — production hotfix (2026-10-01, commit `6afe7a1`)

| Check | Method | Result |
| --- | --- | --- |
| Estimator final-step navigation | Committed browser suite, 360/768/1440 px | steps 1–5 show Continue (+Back from step 2); step 6 shows Back + **exactly one primary action** labelled "Send My Request"; no Continue. Root cause fixed at the stylesheet (`[hidden]{display:none!important}` — `.btn`/`.field` display rules were overriding the `hidden` attribute) |
| Wizard regression suite | `npm run test:browser` | navigation contract at three widths, validation blocks advancement, **fresh start after reload** (no draft is stored), double-submission prevention (button disabled while sending; honest failure; re-enabled), no 360 px overflow |
| Other `hidden` elements | Browser suite | live estimate panel hidden initially; STR-only field hidden for standard service; honeypot unaffected |
| Unit tests | `npm test` | 52/52 pass |
| Deployment | Cloudflare Pages check-run for `6afe7a1` | success; fresh bundle hashes served; site serves the new build |
| Public (build-time) Web3Forms key | masked bundle inspection | present in the deployed bundle (value not logged) |
| Runtime Web3Forms relay | live `/api/lead` marked probe | `200 {"ok":true}` — provider accepted |
| Four live funnels (owner-authorized, clearly marked tests) | real browser submissions | residential, instant estimate, commercial, STR: each `/api/lead` → `200`; correct success message; redirect to `/thank-you/`; estimate final step showed range `$235 – $285` and one primary action |
| Inbox delivery | owner inbox | **pending owner confirmation** — API acceptance is not inbox delivery |

## Verified — lead-submission autofill defect (2026-10-02, commit `fix/lead-submission`)

Owner report: the six-step estimator answered “Your request could not be verified. Please try
again…” and stayed on the form.

| Check | Method | Result |
| --- | --- | --- |
| Root cause reproduction | Real-browser run against production with the honeypot populated | Exact owner message reproduced with **zero `/api/lead` requests**: the client rejected locally. With the trap empty, the request was complete and valid (40 fields, contact present, no honeypot, no Turnstile token) |
| Relay health | Live `POST /api/lead` with a clearly labeled synthetic probe | `HTTP 200 {ok:true}` — the relay and provider delivery work; the probe also proved the server has no Turnstile secret configured (no token was required) |
| Turnstile state | Production HTML inspection | No Turnstile widget/site key in the build, so the failure could not be a Turnstile rejection |
| Root cause resolution | Hidden trap renamed from the autofill-magnet `company_website`/“Company website” to an unintelligible `extra_ref` with password-manager ignore attributes and no label; the old field is no longer a trap so a cached bundle or autofill can never cost a customer their submission | Verified in the built DOM and unit tests |
| Error classification | New distinct reasons: `verification_failed` (security-check copy + widget reset), `spam_rejected`, `invalid_request` (fix-the-form copy); unknown 400/422 no longer masquerades as spam | Browser regression tests |
| Answers preserved | Every failure path leaves all entered values on the page and re-enables retry | Browser regression tests |
| Full suites | `npm run check`, `npm test` (241), `npm run test:browser` (62), `npm run validate`, `audit:facts` | Pass |

One clearly labeled synthetic probe was delivered during diagnosis
(`[TEST - ENGINEERING] Turnstile configuration probe - do not schedule`); inbox receipt awaits
owner confirmation.

## Verified — branding, marketing and lead-notification release (2026-10-02)

| Check | Method | Result |
| --- | --- | --- |
| Premium header lockup | Real Chromium at 320/390/768/1024/1280/1440 px; screenshots inspected | Crest + script “Sparkling” + spaced “STANDARD” + “Cleaning Co.” + tagline; mobile drops the tagline to stay legible; no overflow; `/estimate/` intro spacing reduced |
| Header/nav contract | `npm run test:browser` | 7/7 header-about tests (fit/alignment at four widths, brand identity, mobile lockup, About page) |
| Platform registry | Unit/config + browser tests | 19 platforms prepared; only confirmed profiles render; pending platforms never appear. **Superseded (2026-10-03):** eight confirmed profiles now render — see the social Follow Us section below |
| UTM expansion | `npm run marketing:links` + `npm run marketing:verify` | 51 tracked inbound links (23 ready, 28 prepared and not yet placed — refreshed 2026-10-03); all committed QR assets decode-verified; docs byte-identical on check |
| GA4 mapping | Documentation | Event→key-event mapping added; website **generation** verified. 2026-10-03 discovery: the GTM container had **zero tags**, so GA4 receipt was never possible. Import files + exact dashboard steps prepared (`docs/analytics/GTM-CONTAINER-SETUP.md`). **Superseded:** the owner later published GTM Version 3 and GA4 receipt is now owner-confirmed — see the GA4 section below |
| Lead notification format | `tests/lead-notification.test.ts` (11 cases) + `tests/api-verification.test.ts` | Ordered sections, exact figures, verbatim notes, mismatch ACTION REQUIRED, raw codes separated, no credentials/origin |
| Full suites | `npm run check`, `npm test` (252), `npm run test:browser` (64), `npm run validate`, `pending`, `audit:facts`, `smoke` | All pass |

One clearly labeled production format-review submission is sent after deploy; inbox receipt awaits
owner confirmation.

## Verified — header typography, advance reservations and gift certificates (2026-10-03)

| Check | Method | Result |
| --- | --- | --- |
| Wordmark treatment | Real Chromium at 320–1440 px + `/brand-preview/` (before removal); screenshots inspected | Owner selected **Brand A2** (`romantic-script` + Great Vibes, already the default); crest unchanged; true Fraunces italic self-hosted; no overflow. The temporary `/brand-preview/` page was removed after the decision |
| 60-day advance window | Browser test (attributes + out-of-window rejection) and server test (+90-day date discarded with a note) | Exactly 60 days client-side; server never forwards an out-of-window date |
| Reservation tracking | Documentation + ledger CSV | Six statuses, unique references, Google Sheet setup, gift-redemption accounting |
| Gift page + request flow | Browser tests (desktop/mobile) | Request mode only; honeypot trap works; no checkout attempt; success copy states no payment was taken |
| Redemption + checkout-return pages | Browser tests | Redeem page echoes a valid code and refuses malformed refs with zero API calls; success page is noindex and never claims issuance |
| Certificate artwork + QR | `npm run gift:certificate --sample` + screenshot + jsQR self-check | Printable certificate renders correctly; QR decodes to the exact redeem URL; `gift-out/` git-ignored |
| Stripe security | Unit tests (signature valid/tampered/wrong secret/expired/multi-signature; amount allowlist; disabled/unconfigured/paid-without-notifier gates) | All pass; paid purchase with no notifier returns 500 so Stripe retries |
| Full suites | `npm run check`, `npm test` (274), `npm run test:browser` (69), `npm run validate`, `pending`, `audit:facts`, `smoke` | All pass |

## Verified — GA4 tracking completion package and Brand A2 finalization (2026-10-03)

| Check | Method | Result |
| --- | --- | --- |
| GTM import artifacts | `npm run analytics:gtm` / `analytics:gtm:verify` + JSON parse (13 tags/12 triggers/7 variables full setup; 12/12/7 events-only) | Generated and byte-stable; unique IDs; every event has an exact-match `{{_event}}` trigger, a GA4 event tag and only allowlisted parameters |
| Taxonomy ↔ GTM mapping lock | `tests/gtm-import.test.ts` (6 cases) | Parses `src/lib/analytics/events.ts` and the generated JSON: names, parameters, Data Layer Variables and the Google tag all match; no unexpected parameter keys |
| Website event generation | `tests/browser/analytics-events.test.mjs` (4 cases) | No Google script and no event before consent; one GTM load after consent; `call_click`/`text_click` fire with allowlisted `cta_slot`; `estimate_start`/`estimate_step`/`estimate_complete` fire in the funnel; `cleaning_request_submit` + `booking_request` fire only after provider acknowledgment; a failed submission emits nothing |
| Consent protection preserved | Same browser tests + existing `gps-gtm` consent test | Zero Google requests before a choice; exactly one GTM script after accepting; failed submissions never counted |
| Brand A2 finalization | `npm run check`; header browser tests; build output | `romantic-script` + Great Vibes already the default; temporary `/brand-preview/` page and its sitemap exclusion removed; 7/7 header-about tests pass at 1024–1680 px |
| Gift-certificate pause | Code inspection + full suites | `enabled: false`, no checkout attempt in request mode, page states no payment is taken; Stripe code dormant |
| Full suites | `npm run check` (0 errors), `npm test` (280 pass), `npm run test:browser` (73 pass), `npm run build` (21 pages), `npm run validate` (incl. new GTM artifact check) | All pass |

**Later confirmed (owner, 2026-10-03):** after importing the prepared configuration, the owner
published their reviewed GTM container (Version 3). GA4 `G-LG222LQRQ2` now receives page views,
estimator starts and all three successful inquiry submit events; the residential, commercial and
STR submission tests and the analytics consent tests passed; the three primary key events are
configured. The live account configuration is authoritative and must not be republished or
overwritten without authorization.

## Verified — attribution preservation and lead-notification mapping (2026-10-03)

**Root cause:** `captureAttribution()` ran on every page and unconditionally overwrote the
`latest` touch, so any internal navigation, refresh or direct view replaced a campaign with a
blank touch (and recorded the same-domain referrer as a referral). The lead notification also
mapped plain `utm_*` keys that the collector never emits (`first_utm_*`/`latest_utm_*`), so the
email lost the campaign and leaked `latest_utm_*` into "More details". Existing leads already
delivered are unchanged; the corrections apply to future attribution and notifications.

| Check | Method | Result |
| --- | --- | --- |
| Collector rules | `tests/attribution.test.ts` (8 cases) | Facebook arrival + estimator navigation keeps the campaign; multiple Nextdoor internal visits never erase it; a new campaign updates latest-touch but not first-touch; direct visits seed once and never overwrite; external referrals recorded only without a campaign (same-domain referrers ignored); ad click ids survive navigation and a later campaign; identical-campaign refresh is a no-op; long ids clipped, malformed referrers ignored |
| Notification mapping | `tests/lead-notification.test.ts` (+3 cases; 14 total) | Clear first-touch and latest-touch source/medium/campaign/content labels; landing page/referrer labeled latest-touch; click id appears exactly once; no `More details — *utm*` leakage; legacy plain `utm_*` fallback still maps |
| End-to-end chain | `tests/browser/attribution.test.mjs` (4 cases) | Facebook campaign page → real internal navigation to the estimator → completed request carries `first_utm_source=facebook`, `latest_utm_*`, and the campaign landing page; new campaign vs first-touch; external referral recorded; same-domain navigation never becomes a referral |
| Analytics/consent untouched | `tests/browser/analytics-events.test.mjs`, `gps-gtm.test.mjs` re-run | No change to event names, payloads or consent loading behavior; no customer data added to analytics |
| Full suites | `npm run check` (0 errors), `npm test` (291 pass), `npm run test:browser` (77 pass), `npm run build` (21 pages), `npm run validate`, `pending`, `testimonials`, `audit:facts`, `smoke` | All pass |

## Release status — deployed (2026-10-03)

- **Owner-authorized release deployed:** `origin/main` = **`cdc4971`** (2026-10-03; GitHub Actions
  `validate` runs green; Cloudflare Pages served each build).
- The deployed commit set: `8b8dde4` (GTM import package + Brand A2), `03d6ba8` (UTM counts),
  `53a85aa` (GTM doc cleanup), `0f3c38c` (attribution repair + first/latest labels), `5a4a024`
  (marketing documentation consolidation), `7a51efa` (release closeout documentation) and
  `cdc4971` (six-profile social integration + Follow Us upgrade).
- The earlier five-commit build (`5a4a024`) removed `/brand-preview/` (now 404) and deployed the
  repaired attribution logic; `cdc4971` added the eight confirmed Follow Us profiles.
- **Limitations:** the GA4 account results are owner-confirmed external verification, not
  repository tests. The attribution fix cannot retroactively repair previously clobbered `latest`
  records; it applies to future attribution (existing delivered emails are unchanged). Any
  post-release local documentation follow-up is unpublished until the owner authorizes another
  push.

### Live production acceptance (2026-10-03)

| Check | Method | Result |
| --- | --- | --- |
| Pages + navigation | Live HTTPS + Playwright | Home, estimate, contact, gift certificates, about, recurring and service-area all `200`; header/footer links present; no `brand-preview` links; removed page returns `404` |
| Sitemap | Live fetch | 16 URLs, correct domain, no `brand-preview`/thank-you/leave-review/gift-utility pages |
| GA consent control | Playwright, fresh profiles | 0 Google requests before consent; 0 after refusal; after acceptance exactly **1** GTM container (`gtm.js?id=GTM-KSQ26HMG`) and **1** GA4 tag (`gtag/js?id=G-LG222LQRQ2`, injected by the container) — no duplicate tag, no site-installed `gtag.js` |
| Gift certificates | Live page | Request mode only (`data-gift-status="request"`), no purchase element, page text confirms no payment is taken |
| Reservation window | Live estimator | Preferred-date maximum exactly 60 days out (`2026-12-02` on 2026-10-03) |
| Attribution + notification (one labeled submission) | UTM arrival → internal navigation to `/contact/` → single submission labeled "RELEASE ACCEPTANCE TEST (please ignore)" | Campaign preserved after navigation (`first_utm_source=facebook`, `latest_utm_source=facebook`, `latest_utm_campaign=profile`, `landing_page=/`, no same-origin referrer recorded); `/api/lead` returned `ok:true`; the built notification shows `Attribution — First-touch source: facebook`, `Attribution — Latest-touch source: facebook`, `Attribution — Latest-touch campaign: profile`, `Attribution — Latest-touch landing page: /`, with no attribution leakage into "More details" |
| CI | GitHub Actions | `validate` run `37132056171` completed successfully on the pushed SHA |

One labeled acceptance inquiry was sent (no repeats). Inbox confirmation by the owner remains the
final external check.

## Verified — six new social profiles and the Follow Us upgrade (2026-10-03)

Owner-supplied profiles added: TikTok, Pinterest, Rumble, Gab, Parler and Locals (plus the
existing Facebook and Nextdoor) — **eight confirmed profiles render**. Each supplied URL returned
HTTP 200 on 2026-10-03 (destination reachable; not independent identity verification).

| Check | Method | Result |
| --- | --- | --- |
| Eight confirmed profiles | `tests/browser/social-links.test.mjs` (4 cases) | Correct labels, exact URLs, `target="_blank"`, `rel="noopener noreferrer"`, accessible new-tab text; pending platforms (GBP, Bing Places, Yelp, Instagram, YouTube, X, Threads, LinkedIn, Alignable, Reddit) never render |
| Official brand marks | Browser test + screenshot inspection | Every confirmed profile uses a real mark, never a monogram placeholder; Nextdoor is the official house-"n" favicon geometry in official brand green (`#1B8751`); Gab, Parler and Locals use their official assets (`src/components/SocialIcon.astro` records each source); no counterfeit hand-drawn logos |
| UTMs | Browser test | Outbound profile URLs never carry UTM parameters |
| Responsive layout | Screenshots at 1280/768/390/320 + browser tests | 4-column grid on tablet/desktop (two tidy rows), 2-column on phones, single column under 26rem; zero horizontal overflow at every width; no label truncation at 320px; ≥44px touch targets |
| Locals link registry | `npm run marketing:links` + `npm run marketing:verify` | Locals profile link generated from the registry (`?utm_source=locals&utm_medium=organic_social&utm_campaign=profile`); registry now 51 links (23 active, 28 prepared); documents regenerated and byte-identical on check; QR assets unchanged |
| Scope safety | Git diff + full suites | No changes to GA4/GTM, consent, estimator pricing, customer forms, reservations or payment systems; `functions/` untouched |
| Full suites | `npm run check` (0 errors), `npm test` (291 pass), `npm run test:browser` (78 pass), `npm run build` (21 pages), `npm run validate`, `pending`, `smoke`, `testimonials`, `audit:facts` | All pass |

### Social integration deployment acceptance (2026-10-03, `cdc4971`)

| Check | Method | Result |
| --- | --- | --- |
| CI | GitHub Actions | `validate` run `37139504672` completed successfully on the pushed SHA |
| Deployed build | Live production fetch | The Locals profile link is live; the deployed Follow Us section contains all eight platforms |
| Eight links + destinations | Live Playwright + HTTP checks | Exact owner-supplied hrefs, `target="_blank"`, `rel="noopener noreferrer"`, accessible labels, no UTMs. Seven destinations returned HTTP 200 to the scripted check; Facebook returned HTTP 400 (typical anti-bot response — the owner-confirmed URL is unchanged and was already rendering) |
| Official marks | Live DOM inspection + production screenshots | Nextdoor renders the official house-"n" favicon geometry in `#1B8751`; Gab, Parler and Locals render their official assets; no monogram placeholders among the eight |
| Layout | Production screenshots at 1280/768/390/320 | 4-column desktop/tablet, 2-column phone, single column at 320px; zero horizontal overflow; no truncated labels at any width |
| Consent + unrelated functionality | Live Playwright | 0 Google requests before consent/after refusal; after acceptance exactly 1 GTM + 1 container-injected GA4 tag; home/estimate/contact/gift/about/recurring all `200`; gift certificates still request-only; reservation window still 60 days (`2026-12-02`). No form submissions were made |

## Pending (cannot be verified in this environment — owner or tooling required)

| Item | Why pending | How to verify |
| --- | --- | --- |
| Live form delivery | Requires the Web3Forms key and inbox | Owner-authorized test submission per form category after configuring `WEB3FORMS_*`; confirm it arrives at `owner@sparkling-standard.com` |
| Live Turnstile | Requires Cloudflare keys | Enable, submit, confirm challenge appears server-side |
| Real route distance / EIA price | Requires `TRAVEL_ORIGIN` + provider keys | `POST /api/travel` after deployment with keys |
| Cloudflare preview environments | **Not used by owner decision (2026-10-02).** Production deploys from `main` only; no preview branches, Preview environment variables, preview secrets or Cloudflare Access are configured or required | No action; a temporary `PUBLIC_PREVIEW_MODE=true` staging deploy remains available if ever needed |
| Real-device mobile smoke | Playwright emulation only (no physical device) | Manual pass on a phone: estimate flow, sticky bar, tap-to-call |
| Visual review (founder eye) | Screenshots prepared for review; automated checks cannot judge taste | Owner reviews the live site and provided screenshots; change requests tracked in git |
| Lighthouse lab metrics | Needs a deployed URL and Chrome | Run PageSpeed Insights on the production site |
| Genuine photography | No real Sparkling Standard project photos exist yet; representative licensed interiors are registered in `docs/design/IMAGE-SOURCE-REGISTER.md` | Replace stock files with permissioned real photos, then verify `astro:assets` output and update the register |
| Search indexing | Post-launch | Search Console coverage after sitemap submission |
| GTM container tags | Requires the owner's GTM dashboard | Import `docs/analytics/gtm-import/gtm-ga4-full-setup.json` (or events-only), verify in Preview, publish |
| GA4 event receipt + key events | Requires the owner's GA4 dashboard | DebugView/Realtime while running the documented test journey; mark the three primary key events; turn off Enhanced Measurement form interactions |

## How to re-run everything

```bash
npm install
npm run verify           # check + build + validate
npm test
npm run analytics:gtm:verify
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
