# Local authority — GBP, local SEO and PR

Local authority is what makes the company easier to find and easier to trust: the Google Business
Profile, the organic website, genuine reviews, real local presence and earned local press. This
document is the operating layer for those systems. The canonical technical SEO rules remain in
`docs/seo/SEO-STRATEGY.md` — do not duplicate or override them here. All numbers in this document
are planning guidance, not forecasts.

## 1. Google Business Profile (the local discovery layer)

**Status (verified — owner-confirmed 2026-10-08):** the profile is **VERIFIED and publicly
visible**, and its exact public profile URL and "Ask for reviews" link are **captured and
configured** (`business.socials.googleProfile`, `business.reviews.profileUrl`,
`business.reviews.submissionUrl` — owner-supplied, used exactly as provided). Never modify,
shorten or reconstruct these URLs. The `/leave-review/` page is live with the real review CTA.

Active operating standard (owner actions):

| Item | Standard |
| --- | --- |
| Category | Cleaning service (primary) with accurate secondary categories |
| Service area | The approved `business.serviceArea` language only — no invented radius claims |
| Hours | `business.hours` (seven days, 8 AM–6 PM; commercial outside the window) |
| Phone / website | Owner-confirmed facts; website link uses the GBP campaign link from the registry |
| Photos | Real work only (permissioned, privacy-scrubbed): before/after, detail shots, founder |
| Posts | Weekly-ish local update: availability, a detail proof, a service explainer, a seasonal note |
| Q&A | Seed honest answers to the real questions (scope, area, recurring, estimates) |
| Reviews | Earned only; reply to every review (`REVIEW-GROWTH-SYSTEM.md`) |

**GBP rhythm (weekly, ~15 min):** one post (photo + short honest text + tracked link), reply to
any reviews, add 1–3 real photos from the week's jobs. Never post fabricated results; never claim
a service the company does not offer.

**Measurement:** profile views, calls, direction requests, website clicks (GBP insights); GBP
campaign link clicks (GA4); inquiries attributed to GBP in the weekly scorecard. GBP actions are
diagnostic; inquiries and bookings are the outcome.

## 2. Google organic / website SEO (the compounding layer)

The site already owns one page per query cluster and follows the no-doorway policy
(`docs/seo/SEO-STRATEGY.md`). The local-authority layer adds only what earns trust and relevance:

- **Service pages** stay the owning pages; improve them with genuine proof (real photos, real
  case material) as it exists — never with invented claims or keyword stuffing.
- **Internal linking** follows the existing rules; new content links to its owning page, never
  creates a competing one.
- **Real local relevance:** genuinely local content (neighborhood presence, local questions,
  seasonal local context) only when substantive. No mass-produced city pages, ever.
- **FAQ growth** from real customer questions is the highest-value, lowest-risk SEO content
  (existing future-content policy).
- **Structured data** follows the verified decisions in `docs/seo/SEO-STRATEGY.md`:
  `LocalBusiness`,
  `Service`, `FAQPage`, `BreadcrumbList`; no review markup until genuine reviews exist.
- **Proof on-site** (when genuine material exists): real before/after and review content feed
  conversion; the reviews collection stays empty until real entries exist.

**Measurement:** Search Console impressions/clicks/queries (free), GA4 organic sessions and
campaign attribution, inquiries by source. Branded-search growth (company name queries) is the
long-term signal that authority is building.

## 3. Citations and directories

- **Bing Places** — create now (GBP is verified; it imports from Google) using the exact same
  NAP facts.
- **Yelp, Apple Business Connect, local directories** — only when eligible and free; consistent
  name, phone, website from `src/config/business.ts`.
- **No invented listings, no paid directories, no fake reviews on any platform.**
- NAP consistency is the rule: one name, one phone, one website everywhere.

## 4. The authority library (assets that earn trust)

Build the library from real work; every item must be genuine:

| Asset | Source | Used for |
| --- | --- | --- |
| Founder story (long + short) | `VIDEO-DIRECTING-SHEETS.md` Sheet 1; owner-approved facts | PR pitches, GBP, social, website About |
| Detail proof library | Permissioned captures (`FIELD-CONTENT-CAPTURE.md`) | GBP photos, social, door-knocking proof, future site proof |
| Transformation pairs | Real paired jobs | Highest-trust content and press visuals |
| Process/checklist material | Real internal checklists, sanitized | Education content; "what's included" answers |
| Service explainers | Existing site copy | FAQ/GBP Q&A; decision content |
| Genuine reviews | Earned (`REVIEW-GROWTH-SYSTEM.md`) | GBP, site (when enough), social proof |
| Case studies | Real recurring relationships (with permission) | PR, website, partnerships |

The library grows with every real job; nothing enters it without permission and privacy review.

## 5. Local PR system

The pitch is never "we are a cleaning company." It is: **"Here is why this founder is building
this company and what is happening locally because of it."**

**Verified story angles (only owner-approved facts; never embellish):**

- **Founder story:** an 18-year-old college student who started the company to give customers the
  detailed attention rushed cleaning does not allow (`src/config/business.ts` founder block).
- **Family craft:** grew up around a grandmother who owned a cleaning business; worked in it, then
  for established local companies, doing the work and inspecting quality.
- **The standard thesis:** she saw rushed production cleaning leave the small things undone — and
  built something better.
- **Design trajectory:** studies interior design and plans to grow into related home services.
- **Local angle:** building an owner-operated premium cleaning company in Cantonment serving
  Pensacola; hiring and economic activity follow if growth continues (never promise headcount).

**Targets (evaluate, do not assume):** local newspapers and community publications; neighborhood
publications and HOA newsletters; the local chamber and community organizations; local events and
markets; entrepreneurship/student-business publications (the college angle); relevant local
groups where rules allow genuine contribution.

**Pitch mechanics:**

- One-page pitch: the founder story, two real photos, the standard thesis, one local hook.
- Offer an interview, not an ad. Never offer payment for coverage.
- Track every pitch in a simple press log (date, outlet, contact, angle, outcome).
- When coverage lands: reply to comments, share it honestly, and note the referral traffic (referrer
  in GA4; the owner inbox). Do not add UTMs to a journalist's editorial URL; supply a tracked link
  only when the outlet asks for one.
- One follow-up per pitch, then move on.

**Do not:** fabricate credentials or milestones, pay for "features," mass-email identical pitches,
or claim awards, memberships or partnerships that do not exist.

## 6. Community presence and local recognition

- **Chambers / community organizations:** join only when the value is real and cost is zero or
  owner-approved; attend, contribute, do not advertise at people.
- **Local events:** the event poster and foam board already exist with tracked QR links
  (`event_poster_estimate`, `community_leave_behind` in the registry) — use them where events
  allow.
- **Neighborhood presence:** the route system is the recognition engine — a clean vehicle, a
  visible brand, and real work on the street do more than any ad.
- **Local business support:** genuinely support neighboring businesses; cross-referral where
  natural (never a paid scheme without approval).
- **Vehicle / signage / presentation:** the brand should be recognizable on the street. Any
  purchase is owner-funded and owner-approved; zero-spend default stands.

## 7. Measurement

| Layer | Metric | Source |
| --- | --- | --- |
| GBP | Profile views, calls, direction requests, website clicks | GBP insights |
| Organic | Impressions, clicks, queries, branded search | Search Console (free) |
| Website | Sessions, campaign attribution | GA4 (consent-gated) |
| Inquiries | GBP/organic/referral attribution | Owner inbox + lead ledger |
| Reviews | Reviews received, replies, rating trend | GBP (live; review link captured) |
| PR | Pitches sent, coverage, referral traffic | Press log + GA4 referrers |

Authority metrics are diagnostic; inquiries, bookings and recurring customers are the outcomes
(`LEAD-MEASUREMENT-MODEL.md`). Record the numbers in `WEEKLY-SCORECARD.md`.

## 8. Rules that never bend

1. The GBP profile and review links are exact owner-supplied facts — never modify, shorten or
   substitute them, and never claim review counts that do not exist.
2. No fabricated credentials, milestones, press, partnerships or reviews.
3. No doorway/thin city pages; one owning page per cluster.
4. No paid coverage, no review incentives, no invented citations.
5. Editorial URLs are never tagged with UTMs by us; only supply registry links when asked.
6. Zero additional spending without explicit owner authorization.
