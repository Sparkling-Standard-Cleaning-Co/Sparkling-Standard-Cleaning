# Competitive comparison and gap analysis

Factual comparison of three publicly accessible websites, prepared 2026-10-01. Only publicly
observable facts are recorded. No competitor content, imagery, testimonials or branding was
copied into this repository, and no claim is made about any competitor's business performance.

Properties examined:

- **Sparkling Standard** — `https://sparkling-standard.com` (this project; deployed and indexable)
- **Refresh Cleaning LLC** — `https://www.refreshcleaningllc.net/` (public site, read-only)
- **Sunshine Climate Solutions** — public GitHub repository and public site (architecture
  reference only; a different industry and business, never copied)

## 1. Factual three-site comparison

| Dimension | Sparkling Standard | Refresh Cleaning LLC (public site) | SCS (public architecture) |
| --- | --- | --- | --- |
| Industry | Residential + commercial cleaning, STR turnovers | Residential + commercial + deep cleaning | HVAC |
| Service-area model | Service-area business, Cantonment origin, ~1 hour drive | Cantonment, FL; serves Pensacola + Baldwin County AL | Service-area business |
| Published starting prices | **No fixed price list**; instant estimate ranges + custom quote | **Yes**: biweekly $160, monthly $200, one-time/drop-in $300, gift certificate $200 (*based on ≤2000 sq ft; free quotes) | Published service-call/maintenance prices |
| Online instant estimate | **Yes** — six-step wizard, labor-based ranges, travel handling, manual-confirmation routing | No — quotes by Facebook message/contact | No online estimate (services + request form) |
| Public service checklists | Service-scope sections per page; detailed checklists maintained internally (never leaked) | **Yes** — itemized "what we offer each cleaning" room-by-room | Service descriptions |
| Testimonials on site | None yet (genuine-only policy; review workflow documented) | **Yes** — three named testimonials, links to Facebook reviews | Owner-approved; fundraiser layer separate |
| Founder credibility | Founder band + About page (Hayli's approved background) | "About Me" — mother of twins, 15+ years experience | Founder disclosures limited to one page |
| Contact simplicity | Working `tel:`, working email, four forms, sticky mobile call bar | Facebook DM is the primary booking path; `tel:`/`mailto:`/`sms:` links on the page are malformed (`tel:+12345678910`, `mailto:info@site.com`) | `tel:` + form |
| Gift certificates | Not offered (Phase 7 assessment) | **Yes** — $200, purchased via Venmo/CashApp/PayPal | Not offered |
| Payments | Stripe confirmed; method list pending owner confirmation | Venmo, CashApp, PayPal | Card/ACH etc. |
| Booking semantics | Honest: requests confirmed personally; no instant-booking claim | "Book Today!" button leads to Facebook | Request form |
| Analytics/consent | Consent-gated architecture implemented; **IDs not configured** | None observable | Full GTM/GA4 + Umami, consent-gated |
| Attribution/QR system | Registry + 13 decode-verified QR groups | None | Full UTM/QR registry + verification |
| SEO infrastructure | Canonicals, sitemap, JSON-LD, page ownership, verify scripts | Basic (Mobirise builder; little structure observable) | Extensive SEO documentation + verification |
| Accessibility (measured) | axe WCAG 2.0/2.1/2.2 A+AA: **0 violations** across 15 pages (2026-10-01) | Not measured here | Documented target |
| Performance (measured) | LCP 1.26–1.65 s, CLS ≤ 0.038 on mobile-throttled Chromium (2026-10-01) | Not measured here | Documented target |
| Lead capture reliability | **Blocked**: no forms deliver until the Web3Forms key is configured (verified live) | Facebook DM path works; on-page email/tel links are broken | Working (Web3Forms) |
| Content freshness | Honest placeholders; real photos/reviews pending | Facebook + photo galleries | Ongoing content system |

**What this comparison does and does not say.** Refresh Cleaning publishes prices, checklists and
testimonials, which are useful trust signals; its direct contact links are broken and its booking
depends on a social platform. Sparkling Standard has stronger technical foundations (estimate
engine, structured data, accessible markup, attribution, measured performance) but currently
cannot capture a lead at all because the form provider key is not configured. No claim is made
that any design change will outperform either competitor; that requires measured traffic and
conversion data after launch.

## 2. Categorized gap analysis

### A. Existing and verified (working today)

- 18-page site, all 200, correct canonicals, `index, follow` on every page.
- Instant estimate engine with labor-based ranges, travel handling and honest
  manual-confirmation routing (27 estimator tests + live browser flow).
- Pages Functions deployed and validating (`/api/lead` 400 on bad input; `/api/travel` 503
  until configured).
- Fail-safe form behavior that never fakes success; newly corrected channel-accurate failure
  copy (deployed 2026-10-01).
- Accessibility: axe 0 violations on representative pages; no horizontal overflow at 360 px.
- Performance: mobile-throttled LCP 1.26–1.65 s, CLS ≤ 0.038, ~96 KB per page.
- UTM/QR attribution registry with decode verification; marketing documentation set.
- Consent-gated analytics architecture (inert until IDs exist).
- Operations hub, platform-status register, automation register, deployment guide.
- 52 automated tests passing (estimator, API fail-safes, failure copy).

### B. Implemented but not activated (owner or account action required)

| Capability | Blocker | Exact action |
| --- | --- | --- |
| Form delivery (residential, estimate, commercial, STR) | `WEB3FORMS_ACCESS_KEY` runtime secret + `PUBLIC_WEB3FORMS_ACCESS_KEY` build variable not set | Add both (same key) in Cloudflare → redeploy → authorized live test |
| Real travel routing + live fuel price | `TRAVEL_ORIGIN`, optional `ROUTES_PROVIDER`/`ROUTES_API_KEY`, `EIA_API_KEY` not set | Add secrets → redeploy |
| Analytics (GTM/GA4, Umami) | No IDs | Create accounts, add IDs, verify consent behavior |
| Turnstile spam protection | Optional keys not set | Enable in Cloudflare |
| Review system | No Google Business Profile / review link | Create GBP, then activate the documented review workflow |
| Indexing accelerators | IndexNow key not set (site is already indexable) | Optional post-launch |
| SMS CTAs | SMS capability unverified | Verify a real text, then flip `smsEnabled` |

### C. Missing and commercially valuable (recommended)

1. **Form delivery activation** — without it the site cannot capture any lead. Highest priority.
2. **Google Business Profile + review link** — local search and trust; drives calls and reviews.
3. **Founder portrait + genuine photography slots** — the hero and proof band currently carry
   empty placeholder boxes; real photos (with permission) are the largest visual/trust upgrade.
4. **Published "from" pricing transparency** (owner-approved) — competitor publishes starting
   prices; a small, honest "typical range" block on each service page reduces price anxiety
   without publishing the full rate card.
5. **Lead ledger + follow-up cadence** — a CSV template using the existing lead-measurement
   model is ready (`docs/marketing/LEAD-LEDGER-TEMPLATE.csv`); the estimate follow-up sequence
   already exists in the content operating system.
6. **Analytics activation** — no conversion measurement is possible until IDs exist; required to
   judge any future design change.
7. **Gift certificates** — competitor offers them; viable only with a real payment + redemption
   process (owner decision; Stripe supports this).
8. **Repeat-customer request convenience** — a short "request your usual clean" path for
   recurring customers (small form prefill; optional later, after leads flow).

### D. Optional or unnecessary

- A CRM/database — the lead ledger + follow-up cadence covers current volume; revisit only when
  lead volume justifies it.
- Paid advertising before organic/GBP activation — spend without measurement infrastructure and
  form delivery would be wasted.
- Instant booking — the business confirms every job personally; keep requests.
- Stock imagery — prohibited by policy; only genuine photos.
- Rewriting the estimate engine or pricing model before real job data exists.
- Adding frameworks, CMS or bundled dependencies — current stack measured fast and accessible.

## 3. Prioritized immediate-revenue plan (summary)

The full plan, exact owner actions and the implementation sequence live in
`docs/launch/REVENUE-READINESS-PLAN.md`.

1. Configure Web3Forms (both variables) and pass an authorized live test in all four categories.
2. Set `TRAVEL_ORIGIN` (and optionally a routing provider/EIA) so the estimator prices travel
   precisely.
3. Create the Google Business Profile (service-area, private address) and wire the review link +
   review-request workflow.
4. Activate analytics in the order GTM → GA4 → Umami, verify consent first, then confirm the
   conversion events.
5. Collect and publish genuine founder/work photos and the first genuine reviews.
6. Begin the documented marketing cadence (90-day plan, weekly scorecard, lead ledger).

Each step is independently testable, low-cost, and requires no new dependency.
