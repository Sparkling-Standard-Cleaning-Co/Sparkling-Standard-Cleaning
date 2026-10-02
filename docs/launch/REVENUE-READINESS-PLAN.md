# Revenue-readiness plan and implementation queue

Prepared 2026-10-01 after the live production audit. This is an execution plan, not a rebuild:
the site is deployed and technically sound; the blockers below are configuration, accounts and
genuine content. Nothing here changes pricing, indexing or public claims without owner approval.

## 1. Current state (verified 2026-10-01)

- Production: `https://sparkling-standard.com` serving from the Git-connected Cloudflare Pages
  project; every push to `main` deploys (Cloudflare Pages check-run verified).
- All 18 pages return 200 with correct canonicals; **the site is indexable** (`index, follow`,
  `Allow: /`). The owner has not yet recorded final launch authorization — nothing in this plan
  changes indexing.
- Forms: **cannot deliver a lead yet.** `/api/lead` returns `503 not_configured` (server key
  absent) and the client key is empty in the build (verified in the deployed bundle). The
  corrected honest failure message is live (deployed 2026-10-01).
- Travel: `/api/travel` returns `503 origin_not_configured`; the estimator works in offline zone
  mode meanwhile.
- Analytics: architecture active; GTM `GTM-KSQ26HMG` is configured and consent-gated, Umami has no ID (no analytics request is made before consent;
  banner hidden).
- Performance (mobile-throttled Chromium, 4× CPU): LCP 1.26–1.65 s, CLS ≤ 0.038, ~96 KB/page.
- Accessibility: axe WCAG 2.0/2.1/2.2 A+AA, 0 violations across representative pages.

## 2. Immediate revenue blocker — Web3Forms (owner, ~10 minutes)

Until this is done, no form on the site can deliver an inquiry. The correct behavior on failure
is already deployed (honest message + call/email alternatives — never a fake success).

1. In Cloudflare → Pages project `sparkling-standard-cleaning` → Settings → Environment variables
   (Production):
   - Add **`WEB3FORMS_ACCESS_KEY`** as type **Secret** — the owner's existing Web3Forms access key.
   - Add **`PUBLIC_WEB3FORMS_ACCESS_KEY`** as type **Text** — the **same** key (it is a public
     client-side identifier by design).
   - Optional: add **`TRAVEL_ORIGIN`** (Secret, `"lat,lng"`) at the same time.
2. Trigger a new deployment (Retry deployment in the dashboard, or push any commit) so the
   Functions receive the bindings and the client bundle is rebuilt with the public key.
3. Verify:
   ```
   curl -i -X POST https://sparkling-standard.com/api/lead \
     -H "Content-Type: application/json" \
     --data '{"subject":"test","fields":{"phone":"8500000000"}}'
   ```
   Expect `200 {"ok":true}` once configured (currently `503 not_configured`).
4. Authorized live tests — submit one clearly marked test per category through the real forms
   (residential/contact, instant estimate, commercial, STR) and confirm each arrives at
   `owner@sparkling-standard.com`. Engineering cannot confirm inbox delivery from here; record
   results in the platform-status register.

If only the server secret is set, the relay path works. If only the public key is set, the
static fallback works (the client now correctly honors the server's `503 not_configured` signal
and falls through). Setting both is recommended.

## 3. Travel accuracy (owner, optional but valuable)

- `TRAVEL_ORIGIN` = the private operating coordinates (`"lat,lng"`) — never published.
- Optional: `ROUTES_PROVIDER=google|mapbox` + `ROUTES_API_KEY` for real road durations instead
  of the straight-line × 1.18 estimate (the response labels which method was used).
- Optional: `EIA_API_KEY` for the live Gulf Coast fuel reference (otherwise
  `REFERENCE_GAS_PRICE`).
- Verify after deploy:
  `curl -X POST https://sparkling-standard.com/api/travel -H "Content-Type: application/json" --data '{"zip":"32503"}'`
  → `200` with `method: "route"` (provider) or `"straight_line_estimate"`.

## 4. Lead pipeline (low-cost, no CRM)

Use `docs/marketing/LEAD-LEDGER-TEMPLATE.csv` with the field definitions in
`docs/marketing/LEAD-MEASUREMENT-MODEL.md`. Copy it **outside** the repository (lead data never
enters git).

Stages: `new → contacted → quoted → confirmed → completed → review_requested → review_received
→ recurring / referral`, plus `lost` with a reason. Recommended operating cadence (matches the
existing content operating system):

| When | Action |
| --- | --- |
| Same day | Log every inquiry (form, call, text); reply; move to `contacted` |
| Within 24 h | Send the quote; move to `quoted`; schedule the follow-up reminder |
| Day 3 / Day 7 | Follow up once per the documented estimate sequence |
| After the job | Mark `completed`, record revenue/labor hours (feeds estimator calibration) |
| +1–2 days | Request a review via the documented workflow (GBP link once it exists) |
| Monthly | Review the weekly scorecard; flag recurring conversions and referral sources |

## 5. Activation runbook (use this company's own accounts only)

Order matters: delivery → local presence → measurement → content.

1. **Web3Forms** — section 2 above. Blocking.
2. **Google Business Profile** — create as a **service-area business** (private address hidden),
   categories: house cleaning / commercial cleaning; service area: Pensacola, Cantonment,
   surrounding communities; add the tracked GBP links from
   `docs/marketing/UTM-MASTER-LINKS.md`; then set `business.reviews.profileUrl` and
   `business.reviews.submissionUrl` and update the footer/schema on the next deploy.
3. **Google Search Console** — verify the domain property, submit
   `https://sparkling-standard.com/sitemap-index.xml`, confirm coverage.
4. **GTM + GA4** — create the container and property; load only after consent (the site already
   implements Basic Consent Mode). Set `PUBLIC_GTM_CONTAINER_ID`; configure the events listed in
   `docs/analytics/ANALYTICS-SETUP.md`; mark the lead event as a key event.
5. **Umami** — create the site; set `PUBLIC_UMAMI_WEBSITE_ID`.
6. **Cloudflare Turnstile** — create the widget; set `PUBLIC_TURNSTILE_SITE_KEY` (build) and
   `TURNSTILE_SECRET_KEY` (runtime secret).
7. **Bing Webmaster Tools + Bing Places** — verify the site, sync the local listing.
8. After each step: record the status and date in `docs/operations/PLATFORM-STATUS.md`; never
   claim "live" without a verification step.

Paid advertising stays off until delivery, measurement and GBP are active.

## 6. Visual upgrade proposals (owner review required before implementation)

Based on live desktop/mobile screenshots taken 2026-10-01. The existing identity (blush/rose,
warm cream, floral mark, Fraunces headings) is cohesive and distinct from both comparison sites;
these are targeted improvements, not a redesign.

| Priority | Proposal | Rationale | Dependency |
| --- | --- | --- | --- |
| 1 | **Hero founder portrait slot** — replace the empty right-column space with a genuine portrait (or a warm, real detail photo) | The hero has unused space and no human element; founder credibility is a competitor strength | Owner photo + publication permission |
| 2 | **Activate the proof band** — the "Proof, not polished marketing" section currently renders four empty placeholder boxes | Empty slots look unfinished; genuine before/after photos are the strongest trust signal in this category | Owner photos; never stock or fabricated |
| 3 | **Genuine reviews section** — appears automatically when real reviews exist | Competitor shows named testimonials; our policy forbids invented ones | GBP + review workflow |
| 4 | **"Typical range" transparency block** on service pages (e.g., "most 3-bedroom homes fall in $X–$Y") | Competitor publishes starting prices; honest ranges reduce price anxiety | Owner must approve wording after the estimator calibrates on real jobs |
| 5 | **STR page turnover documentation** — a sample turnover report layout (photos, restock notes) using genuine jobs | STR hosts buy verification; the service already promises documentation | First genuine turnover + host permission |
| 6 | **Founder introduction video slot** — a short welcome clip on About/estimate | Warmth and trust; already aligned with brand | Owner video |

Implementation notes: photo slots will use Astro `image()` fields with required alt text (the
schema already enforces it); no stock imagery; no fabricated proof; every visual change ships as
its own commit with before/after screenshots for owner review.

## 7. Implementation queue (small, reviewable, separate commits)

| # | Change | State | Risk | Deploy effect |
| --- | --- | --- | --- | --- |
| 1 | 503 fallback honoring + channel-accurate failure copy + 7 tests | **done** — commit `edac89e` | low | live |
| 2 | Platform status + verification + comparison + plan docs | this commit | none | docs only |
| 3 | Committed Playwright harness (smoke/axe/forms) | needs owner approval for the devDependency | low | dev-only |
| 4 | Hero portrait slot + proof/review rendering once genuine content lands | waiting on owner photos/reviews | medium (visual) | owner review first |
| 5 | "Typical range" blocks | waiting on owner pricing approval + calibration | medium | owner review first |
| 6 | SMS CTAs | waiting on a verified text | low | after verification |
| 7 | Repeat-customer quick request | optional, after leads flow | medium | later |

## 8. Verification commands

```
npm run verify         # type check + build + links/SEO/QR/checklist validation
npm test               # 52 tests (estimator + function fail-safes + failure copy)
npm run pending        # no placeholder facts in the build
npm run smoke          # static structure across pages
```

Live checks after any deploy: `/robots.txt`, page meta robots, canonical, `/api/travel` POST,
`/api/lead` POST, one authorized form submission per category, and a mobile pass over the
estimate wizard. Record results in `docs/verification/VERIFICATION.md` and status changes in
`docs/operations/PLATFORM-STATUS.md`.
