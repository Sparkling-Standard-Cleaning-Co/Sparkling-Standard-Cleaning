# Acquisition channels

How Sparkling Standard gets in front of local homeowners and converts them, with the door-to-door
system as the central proactive engine. It connects the existing canvassing infrastructure
(`CANVASSING-SYSTEM.md`, `CANVASSING-ROUTES-OVERVIEW.md`, `field-acquisition/ROUTE-PLANNING.md`)
to the growth flywheel in `GROWTH-SYSTEM.md`. All quantitative outcomes in this document are
**planning scenarios — not forecasts**; the full model, assumptions and sensitivity live in
`ECONOMIC-MODEL.md`.

## 1. Channel roles and ranking

Preserves the hierarchy in `MULTIPLATFORM-OPERATING-PLAN.md`; the table adds the acquisition lens.

| Priority | Channel | Role | Why it ranks here |
| --- | --- | --- | --- |
| **Primary** | Google Business Profile | Local discovery and trust | Highest-intent local search; reviews compound here. **Verified — profile + review links captured (owner-supplied 2026-10-08)** |
| **Primary** | Google organic / website SEO | Long-term local acquisition | Owning pages per service cluster; the estimator converts attention |
| **Primary** | Instagram | Visual brand, transformation proof, discovery | The proof engine's home; verification in progress (URL not published) |
| **Primary** | TikTok | Attention and satisfying detail proof | Live with tracked link placed; discovery engine |
| **Primary** | **Direct door-to-door** | Proactive customer acquisition | Immediate, geographic, measurable, zero cash cost; feeds density |
| **Secondary** | Facebook | Local trust, families, community | Confirmed profile; genuine local updates |
| **Secondary** | Nextdoor | Neighborhood credibility and recommendations | Confirmed profile; cheap local relevance |
| **Secondary** | Referrals | Highest-trust acquisition | Compound density; architecture in `REFERRAL-PROGRAM.md` |
| **Secondary** | Reviews | Trust conversion | Earned only; `REVIEW-GROWTH-SYSTEM.md` |
| **Secondary** | Customer advocacy | Reviews + referrals + word of mouth | The flywheel's multiplier |
| **Repurpose-only** | Pinterest, Rumble, Gab, Parler, Locals, X/Threads (when supplied) | Adapted distribution | Reuse existing assets; no original production |
| **Low priority** | YouTube (deferred), LinkedIn/Alignable (commercial only), Yelp/Bing/Reddit (when eligible), paid ads (not authorized) | Specific reasons only | No major workstreams |

Direct outreach to realtors, STR hosts, property managers, churches and commercial prospects is
handled by the existing playbooks (`COMMERCIAL-OUTREACH.md`, `STR-HOST-OUTREACH.md`) and appears in
§6 as the partnership layer.

## 2. The door-to-door system (central acquisition engine)

Door knocking is not a side tactic. For an owner-operated company with no ad budget, it is the
fastest way to create local awareness, first cleans, recurring customers and neighborhood density
at once.

**Why it works here specifically:**

- The route system already tells Hayli exactly which doors to knock, in what order
  (`CANVASSING-ROUTES-OVERVIEW.md`).
- The offer is honest and needs no discount: route availability + a free instant estimate
  (`field-acquisition/CONVERSION-STRATEGY.md`).
- Every conversation is a data point (tracked per address); every customer makes the next door on
  the street easier.
- The print suite is already built, QR-attributed and verified (`field-acquisition/README.md`).

**The verified infrastructure (do not re-invent):**

| Fact | Value |
| --- | --- |
| Routes | **66** (Priority A: 36, Priority B: 30, Priority C: 0) |
| Target homes mapped | **4,241** (owner-occupied: **3,892**) |
| Average route size | ~64 homes |
| Estimated canvassing time | ~141.4 hours at ~30 homes/hour incl. travel |
| Closest clusters (0–5 mi) | 42 routes / 2,572 homes |
| 5–10 mi | 2 routes / 140 homes |
| 10–15 mi | 19 routes / 1,354 homes |
| 20+ mi | 3 routes / 175 homes (Chandelle First) |

**Running a block (existing procedure):**

1. Open `canvass-out/Canvassing-Workbook.xlsx` (Neighborhood Summary → Route Summary).
2. Pick the next Priority A route; drive to its Start_Address.
3. Print the matching page from `canvass-out/route_sheets.html` (one route per page).
4. Knock every listed home; record Result / Notes / Follow-up on the sheet or in the Performance
   Tracking tab (`canvass-out/performance_tracking.csv`).
5. After the block, update the tracking file. The deciding metric is **recurring customers per 100
   doors** by route, street and neighborhood — never raw doors or scan counts.

**Tracking columns already defined:** Door_Knocked, No_Answer, Conversation, Homeowner,
Interested, Phone_Captured, Estimate_Requested, Estimate_Sent, Booked, Recurring_Customer,
Retention_Status, Revenue, Notes, Follow_Up_Date (`CANVASSING-SYSTEM.md` §5).

**Attribution:** scans from printed pieces carry piece-level UTMs from the registry
(`src/config/marketing-links.ts`, `docs/marketing/WHERE-TO-PASTE-UTM-LINKS.md`); door conversations
are logged manually in the tracking CSV and the lead ledger with source = door. Never send
address-level data into analytics — lead records are the owner's private system
(`LEAD-MEASUREMENT-MODEL.md`).

**Follow-up discipline:** an estimate requested at the door goes out the same day or next morning;
log `Follow_Up_Date`; a no-answer door gets the community leave-behind (never a second knock the
same day); interested-but-not-now doors get one follow-up at the recorded date. Follow the lead
cadence in `CUSTOMER-LIFECYCLE.md` §4.

## 3. The 4,000-door execution plan

Objective: work **4,000 doors** through the existing 66-route system, converting a planning
scenario share into first cleans and recurring customers. Every output below is a planning
scenario — not a forecast.

**Pace arithmetic (verified inputs: 4,241 homes, 66 routes, ~64 homes/route, ~30 homes/hour):**

| Pace | Days for 4,000 doors | Days/week | Calendar weeks |
| --- | --- | --- | --- |
| 50 doors/day | **80 days** | 4 | ~20 weeks |
| 50 doors/day | 80 days | 5 | ~16 weeks |
| 75 doors/day | **~54 days** | 4 | ~13–14 weeks |
| 75 doors/day | 54 days | 5 | ~11 weeks |

Route mapping: 4,000 doors ≈ **62 of the 66 routes** at the current average route size; the full
4,241-door system is the complete plan. Working one route per block (~2–4 hours) is the natural
unit.

**Sequencing (existing priority order, refined by distance):**

1. **Priority A routes first** (36 routes), starting with the 0–5 mi clusters (Bell Ridge Forest,
   Bristol Creek, Brookhaven, Daniels Grove, Dunleith, Glenmoor Trail, Nature Trail, Iron Rock,
   Huntington Creek, and the Preserve At Deer Run area).
2. Then the remaining A routes (Cordova Park, Lavallet at 10–15 mi).
3. Then Priority B routes by proximity band (5–10 mi, then 10–15 mi).
4. Chandelle First (20+ mi) last — it costs the most drive time per door.
5. Complete a route before starting the next; same-street completion is built into the engine.

**Tracking and attribution per block:** doors, conversations, leads, estimates sent, booked first
cleans, completed cleans, recurring customers, revenue — recorded in the tracking CSV/workbook by
route, street and neighborhood. QR scans carry piece-level UTMs. The two ratios that drive
decisions: **conversations per 100 doors** and **recurring customers per 100 doors**.

**Planning scenarios for 4,000 doors** (assumptions, sensitivity and economics in
`ECONOMIC-MODEL.md` §5 — change numbers there first, then here):

| Planning scenario | Conversations | Leads | Booked first cleans | Completed first cleans | Recurring customers | Recurring per 1,000 doors |
| --- | --- | --- | --- | --- | --- | --- |
| Conservative | ~600 | ~48 | ~14 | ~12 | **~5** | ~1.2 |
| Base | ~800 | ~80 | ~32 | ~27 | **~14** | ~3.4 |
| Strong | ~1,000 | ~120 | ~54 | ~49 | **~27** | ~6.7 |
| Exceptional | ~1,400 | ~210 | ~105 | ~95 | **~57** | ~14.2 |

**Planning scenario — not a forecast.** The conversion assumptions (contact, lead, booking,
completion, recurring rates) are planning inputs, not observed results; the ranges exist to show
what the variables do, not to promise an outcome. The first real numbers come from the tracking
CSV after the first blocks — replace assumptions with actuals then.

**Density feedback loop (how marketing performance changes route priority):**

1. When a customer books, record their route/street.
2. That route — and its immediate neighboring routes — rises in the next week's work order.
3. Remaining doors on a route with an active customer get first attention (neighbors see the
   result; referrals concentrate).
4. Routes with no conversations after a full pass are deprioritized in favor of clusters where the
   data is working.
5. This is a **work-order priority**, not a re-derivation: the canonical route object and its
   order are never changed by marketing data
   (`docs/marketing/field-acquisition/ROUTE-PLANNING.md`).

## 4. Neighborhood density (the compounding asset)

A cleaning company should not just maximize customer count; it should maximize **customers per
useful geographic cluster**, because density improves:

- drive time and route efficiency; daily capacity; fuel and travel economics
- referral probability (neighbors see the work); neighborhood recognition
- door-knocking efficiency (a known name opens doors); social proof
- customer convenience (easy scheduling, same-street days)
- overall economics (more revenue per hour of driving)

**The cluster loop, applied to the existing route system:**

1. **Record the location** — every acquired customer maps to a route/street in the workbook.
2. **Identify surrounding stops** — the route object already lists the neighboring doors.
3. **Prioritize nearby prospecting** — knock the customer's street and adjacent streets next.
4. **Seek neighboring referrals** — ask the happy customer (referral moment,
   `CUSTOMER-LIFECYCLE.md` §6).
5. **Increase local proof** — neighborhood-specific content ("we're cleaning on this street"),
   GBP relevance, door-knocking relevance.
6. **Build the cluster** — planning guidance: aim for 3+ customers within a route before expanding
   outward; the exact threshold is a planning input, not a rule.
7. **Expand outward** — only after the core area's density is working.

## 5. Partnerships

Each category is evaluated, not assumed. "Potential economics" means the opportunity shape, not a
promise. Existing playbooks carry the operating detail: `COMMERCIAL-OUTREACH.md` (realtors,
property managers, churches, commercial), `STR-HOST-OUTREACH.md` (hosts), and the
`field-acquisition/` print suite for materials. Never claim a relationship that does not exist.

| Partner category | Why they care | What we provide | What we receive | Outreach / tracking / follow-up |
| --- | --- | --- | --- | --- |
| **Realtors** | Closings depend on presentation; move-out/move-in timing | Reliable move-out cleans, photo-ready results, fast turnaround | Recurring referrals at the transaction moment; move-out jobs | Move-out packet + tracked realtor referral card; ledger `referral_source`; follow-up after 5 days; repeat monthly |
| **Property managers** | Turnovers, common areas, tenant satisfaction | Scheduled service, documented completion, one vendor | Recurring contracts, multi-unit density | Presentation binder; commercial quote form; walkthrough offer; follow-up cycle on non-converts |
| **Home organizers** | Their clients want clean homes before/after organizing | Detail cleaning that preserves their systems | Referrals from an adjacent premium service | Personal introduction; cross-referral card; track source |
| **Interior designers** | Finished spaces need cleaning that respects materials | Careful, material-aware cleaning; photo-ready staging support | Referrals to design clients (high-value homes) | Portfolio note + detail proof; track source |
| **Movers** | Move day sequencing; customers need cleaning before/after | Move-in/move-out cleans scheduled around the truck | Referrals at the highest-intent moment | Simple card exchange; track source |
| **Home stagers** | Listings need to photograph and show clean | Pre-photo detail cleans, fast turns | Referral flow tied to listings | Pre-listing checklist; track source |
| **Contractors / trades** | Post-renovation dust is a real customer pain | Post-construction detail cleans | Referrals after remodels | Trade card exchange; track source |
| **Local businesses** | Their teams and spaces need cleaning; cross-promotion | Commercial cleaning; local-business support | Commercial accounts; community goodwill | Walkthrough offer; commercial playbook |
| **Event / wedding professionals** | Hosts want the home ready before and reset after | Pre-event and post-event cleans | Seasonal referral spikes | Seasonal outreach window; track source |
| **Senior-focused communities** | Residents need reliable, trustworthy help | Vetted, respectful service; family coordination | Recurring customers with stable schedules | Community contact; track source |
| **Student / college communities (where appropriate)** | Move-in/move-out cycles, shared housing | Move-out cleans, seasonal resets | Seasonal density near campus areas | Seasonal campaign; track source |
| **STR operators** | Review risk; same-day turnovers | Hospitality-standard turnovers with verification photos | Recurring per-property work; host cluster density | Host playbook; STR tracked link; supervised first turnover |

Outreach rules: one segment per week in the existing cadence
(`MULTIPLATFORM-OPERATING-PLAN.md` §6); every touch in the lead ledger with its outreach UTM; no
bulk spray-and-pray; no claimed partnership before it is real.

## 6. Channel economics (strategic comparison)

No invented performance data — this compares structural properties. Measured results replace
judgment as data accumulates (`WEEKLY-SCORECARD.md` source-attribution table).

| Channel | Effort | Cash cost | Speed | Scalability | Trust | Recurring potential | Geographic density | Attribution difficulty |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Door knocking** | High (time) | ~$0 (print owner-funded) | Immediate | Time-bound | High (face-to-face) | High | **Highest (by design)** | Low–medium (manual + UTMs) |
| **GBP** | Low–medium | $0 | Steady (verified; active) | High | High | Medium | Medium (service area) | Medium |
| **Google organic / SEO** | Medium | $0 | Slow (compounds) | High | High | Medium–high | Medium | Medium (GA4/UTM) |
| **Instagram / TikTok** | Medium | $0 | Medium | High reach | Medium | Low–medium | Low | Medium (tracked links) |
| **Referrals** | Low | $0 (until approved rewards) | Fast | Low–medium | **Highest** | High | **Highest** | Low (tracked card + ledger) |
| **Partnerships** | Medium | $0 | Medium | Medium | High (third-party) | High (STR/PM) | Medium–high (clusters) | Low–medium (partner UTMs) |
| **PR / local authority** | Medium | $0 | Slow, bursty | Low | High | Low–medium | Low | High |
| **Paid advertising** | Medium | Cash (not authorized) | Immediate | High | Low–medium | Low | Targeting-dependent | Medium |

Strategic read: door knocking and referrals win on density, trust and recurring potential at near
zero cash cost — they deserve the most owner time at this stage. GBP and SEO are the compounding
local layers. Social is the proof amplifier, not the acquisition engine by itself. Paid ads remain
unauthorized.

## 7. Experiment engine

Every two weeks, pick a small number of experiments (one or two, not ten). The framework:
**Hypothesis → Test → Result → Decision.** Keep the log in the weekly scorecard or a copy of
`LEAD-LEDGER-TEMPLATE.csv`.

**Experiment variables (change one at a time):**

- Door-knocking opener and script
- Flyer/piece headline and QR destination (piece-level UTMs already exist)
- Offer framing (route availability vs. priority scheduling — no discounts without approval)
- Social hook and before/after format
- Recurring pitch wording at the first clean
- Review ask wording/timing (once the link is live)
- Referral ask wording
- Follow-up timing (day 2 vs. day 3, etc.)

**Log format:**

| Date | Channel | Hypothesis | Test (what changed) | Sample | Result | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| | | "X will raise Y" | one variable | doors/posts/leads | measured outcome | keep / retest / kill |

**Sample discipline (protect against noise):** do not judge a door experiment on fewer than a full
route (~60+ doors) or a content experiment on fewer than 4–6 posts. A single bad day or post is
weather, not climate. Kill rules for content: `CONTENT-ENGINE.md` §7.

## 8. What not to waste time on

| Activity | Why it is currently a waste | Do instead |
| --- | --- | --- |
| Bespoke content for repurpose-only networks (Pinterest, Rumble, Gab, Parler, Locals, X/Threads) | They receive adaptations, not production lines | Reuse the week's master asset |
| Paid advertising | No authorization; funnel attribution not yet proven at scale | Door knocking + GBP/SEO + referrals |
| Overproduced video (cinematic edits, hired production) | The proof, not the polish, converts; zero-spend default | The repeatable 20–45 s format |
| Generic AI-generated content and city pages | Violates no-fabrication and doorway policies; reads as spam | Real work, real local relevance |
| Vanity follower growth tactics (follow/unfollow, engagement pods) | Followers are not customers | Qualified local attention, tracked links |
| Spammy SEO (keyword stuffing, mass city pages) | Doorway policy; risks the domain | One owning page per query cluster (`docs/seo/SEO-STRATEGY.md`) |
| Endless redesigns of the site | The site converts; traffic is the constraint | Route execution + GBP + content |
| Unnecessary automation (CRM, schedulers, complex tools) | Current volume is handled by the ledger + scorecard | Keep the manual loop until volume justifies it |
| Excessive documentation | Time spent writing is time not spent knocking | This system, once read, is enough |
| Buying reviews or review incentives | Platform violation and brand destruction | Earned-review workflow only |
| Competing on price | Destroys the margin that funds the detail standard | Detail proof + route availability |

The purpose of this matrix is to protect Hayli's time — the scarcest resource in the system.

## 9. Rules that never bend

1. The route engine and its canonical order are not modified by marketing data — only work-order
   priority changes.
2. No discount, offer or promotion without owner-approved terms and publication flags.
3. Address-level canvassing data stays in git-ignored `canvass-out/`; the private operating origin
   never appears in committed files.
4. Never fabricate a conversation, lead, customer or partnership.
5. One variable per experiment; patterns, not single results, drive decisions.
6. All quantitative outcomes are planning scenarios — not forecasts.
