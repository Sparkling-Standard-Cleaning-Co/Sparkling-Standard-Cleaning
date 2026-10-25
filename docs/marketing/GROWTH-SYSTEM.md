# Sparkling Standard growth system — the spine

This is the master document for the customer-acquisition and growth system. It ties together the
existing marketing documentation into one flywheel, states where each subsystem lives, and reduces
the week to a small, executable loop. **Strategy is sophisticated; execution is simple.**

Objective: turn Sparkling Standard from “a new cleaning company” into a recognizable local premium
cleaning brand that systematically generates first-time customers, converts them into recurring
customers, generates referrals, builds neighborhood density, accumulates proof, and compounds its
local reputation.

Nothing here invents facts. Business facts come from `src/config/business.ts`; pricing from
`src/config/estimators/pricing-values.ts` + `pricing.ts`; platforms from `docs/marketing/PLATFORM-REGISTER.md`.
Every number that is an assumption is labelled as one.

---

## 1. The flywheel

```
LOCAL PROSPECTING → ATTENTION → TRUST → FIRST CLEAN → EXCELLENT EXPERIENCE
→ RECURRING SERVICE → REVIEW → REFERRAL → NEIGHBORHOOD DENSITY
→ MORE SOCIAL PROOF → LOWER ACQUISITION COST → MORE RECURRING CUSTOMERS → …
```

Every subsystem in this folder exists to move one stage of this loop or make the loop spin faster:

| Stage | What moves it | Where it lives |
| --- | --- | --- |
| Local prospecting | Neighborhood scoring, routes, 4,000-door plan | `CANVASSING-SYSTEM.md`, `field-acquisition/ROUTE-PLANNING.md`, `ACQUISITION-CHANNELS.md` |
| Attention | Transformation content, hooks, platform roles | `CONTENT-ENGINE.md`, `MULTIPLATFORM-OPERATING-PLAN.md` |
| Trust | Visual proof, founder story, reviews, local authority | `CONTENT-ENGINE.md`, `CUSTOMER-LIFECYCLE.md`, `LOCAL-AUTHORITY.md` |
| First clean | Clear pricing, low-friction inquiry, door offer | `field-acquisition/CONVERSION-STRATEGY.md`, `ACQUISITION-CHANNELS.md` |
| Excellent experience | CX system, checklist, arrival, follow-up | `CUSTOMER-LIFECYCLE.md`, `docs/operations/` |
| Recurring service | Recurring offer presentation, retention | `CUSTOMER-LIFECYCLE.md`, `ECONOMIC-MODEL.md` |
| Review | Ethical review engine | `REVIEW-GROWTH-SYSTEM.md`, `CUSTOMER-LIFECYCLE.md` |
| Referral | Referral engine + economics | `REFERRAL-PROGRAM.md`, `CUSTOMER-LIFECYCLE.md` |
| Neighborhood density | Cluster model, “we clean nearby” | `ACQUISITION-CHANNELS.md` |
| Lower CAC / more recurring | Measurement, experiments, economics | `LEAD-MEASUREMENT-MODEL.md`, `WEEKLY-SCORECARD.md`, `ECONOMIC-MODEL.md` |

## 2. What already existed (do not replace)

Audited 2026-10-07. These systems are sound and remain the operating base:

- `CONTENT-OPERATING-SYSTEM.md` — canonical channel roles, 12 pillars, 4:1 value-to-offer ratio, $0 budget.
- `MULTIPLATFORM-OPERATING-PLAN.md` — priority tiers, weekly cadence, repurposing matrix, “rules that never bend”.
- `CONTENT-PRODUCTION-SYSTEM.md` — “30 Days. 30 Details.” concept + 16-post four-week plan (proposed).
- `LEAD-MEASUREMENT-MODEL.md` + `LEAD-LEDGER-TEMPLATE.csv` — tracking loop, hierarchy, 33-column ledger.
- `WEEKLY-SCORECARD.md` — Sunday measurement ritual + staffing trigger.
- `REVIEW-GROWTH-SYSTEM.md` — ethical review workflow and templates.
- `REFERRAL-PROGRAM.md` — owner-gated referral options.
- `COMMERCIAL-OUTREACH.md`, `STR-HOST-OUTREACH.md` — segment playbooks.
- `COMPETITIVE-COMPARISON.md` — factual competitor audit.
- `CANVASSING-SYSTEM.md` + `field-acquisition/ROUTE-PLANNING.md` — route intelligence and the canonical route engine.
- `SOCIAL-ACCOUNT-SETUP.md`, `PLATFORM-REGISTER.md` — account reality and status discipline.
- `90-DAY-LAUNCH-PLAN.md` — phased launch with owner-approval gates.

## 3. What this system adds

| New document | Covers |
| --- | --- |
| `COMPETITIVE-STRATEGY.md` | How a small startup beats established cleaners; premium-without-pretending; the moat |
| `CONTENT-ENGINE.md` | “The Details Are…” platform, 6-level hierarchy, visual proof engine, hooks, scoring, kill rules, recycling, seasonal, the upgraded 20-post campaign |
| `FIELD-CONTENT-CAPTURE.md` | Practical before/during/after capture SOP and privacy rules |
| `VIDEO-DIRECTING-SHEETS.md` | Ready-to-film directing sheets for the highest-value videos |
| `CUSTOMER-LIFECYCLE.md` | Lifecycle stages, recurring engine, CX, review/referral upgrades, reactivation, psychology |
| `ACQUISITION-CHANNELS.md` | Channel ranking, do-not-waste-time matrix, door-knocking system + experiments, density, partnerships, 4,000-door plan |
| `LOCAL-AUTHORITY.md` | Local SEO + GBP engine, authority library, PR system, local recognition |
| `ECONOMIC-MODEL.md` | Formulas, scenarios, recurring value model, CAC/LTV, sensitivity |

## 4. Platform roles (explicit)

| Role | Platforms | What it means |
| --- | --- | --- |
| **Primary** | Google Business Profile, Google organic (site/SEO), Instagram, TikTok, door-to-door (print suite) | Most weekly effort; these produce customers |
| **Secondary** | Facebook, Nextdoor, reviews/referrals, direct outreach (realtors, STR, commercial) | Regular but lower effort; strong local trust |
| **Repurpose-only** | Pinterest, Rumble, Gab, Parler, Locals, X/Threads (when supplied) | Reuse existing assets; no original production |
| **Low priority** | YouTube (deferred by Workspace eligibility), LinkedIn/Alignable (commercial only), Yelp/Bing/Reddit (when eligible), paid ads | Only when a specific reason and capacity exist |

This table labels the priorities already set in `MULTIPLATFORM-OPERATING-PLAN.md` and
`PLATFORM-REGISTER.md`; it does not replace them.

## 5. Hayli’s week (the whole system in one loop)

**Execution front door:** `WEEKLY-EXECUTION-PLAYBOOK.md` — the one-page daily/weekly operating
version of this loop. Start there on a normal week; this section is the strategy behind it.

The strategy is large; the week is not. Minimum viable week (≈2–3 focused hours plus the work):

| # | Block | Time | What “done” means |
| --- | --- | --- | --- |
| 1 | **Field** | 2–4 h (route days) | Knock the planned route; log doors in the tracking CSV |
| 2 | **Service** | Jobs | Deliver the standard; complete the final walkthrough |
| 3 | **Proof** | 10 min per job | Capture the before/during/after set (see `FIELD-CONTENT-CAPTURE.md`) |
| 4 | **Content** | 60–90 min | Publish one strong asset; repurpose it once |
| 5 | **Sales** | 20 min/day | Reply to every inquiry; follow up leads per cadence |
| 6 | **Retention** | 15 min | Present recurring at the first clean; follow up day 2 |
| 7 | **Reviews** | 10 min | One legitimate review request (post-satisfaction) |
| 8 | **Referrals** | 10 min | Hand one referral card after a great job |
| 9 | **Learning** | 15 min Sunday | Fill the weekly scorecard; pick 3 decisions |
| 10 | **Optimization** | 10 min | Change next week based on evidence, not mood |

If a week collapses: **one video + one local/GBP post + one outreach block + one review ask** (the
existing minimum viable week) still keeps the flywheel spinning.

## 6. KPI dashboard (one screen)

**Primary (business outcomes):** doors · conversations · leads · booked cleans · completed cleans ·
first-clean revenue · recurring customers · recurring revenue · churn (and retention) · referrals ·
reviews · attributable revenue · acquisition cost.

Door-knocking: doors · conversations · leads · bookings · first cleans · recurring customers ·
revenue per 100 doors · recurring customers per 1,000 doors · time per 100 doors.

Social: reach · profile visits · tracked-link visits · inquiries · bookings · qualified leads.

SEO/GBP: impressions · clicks · calls · website leads · GBP actions.

The full ritual, definitions and field-level detail live in `WEEKLY-SCORECARD.md`,
`LEAD-MEASUREMENT-MODEL.md` and `ECONOMIC-MODEL.md`; this dashboard is the summary, not a second
ledger. The question it must answer: **is Sparkling Standard actually becoming a stronger
business?**

## 7. Experimentation cadence

Every two weeks, review the experiment log (kept in the weekly scorecard or a copy of
`LEAD-LEDGER-TEMPLATE.csv`): door script, offer, flyer/QR, hook, format, platform, CTA, recurring
pitch, review ask, referral ask, retention. Promote what wins, retire what does not. The calendar is
a hypothesis; the market is the truth. Experiment detail: `ACQUISITION-CHANNELS.md` §7.

## 8. Startup advantages to use aggressively

Young brand · founder accessibility · speed of experimentation · direct relationships · neighborhood
targeting · full documentation · rapid improvement · distinctive brand · no bureaucracy. These are
temporary; use them while they exist (`COMPETITIVE-STRATEGY.md` §Startup advantage).

## 9. 12-month roadmap (no revenue promises)

Every phase is tied to measurable operating outcomes, not elapsed time. Phases overlap; a phase is
"done" when its outcomes are visible in the scorecard, not when the calendar says so.

| Phase | Months | Focus | Measurable outcomes |
| --- | --- | --- | --- |
| **1 — Foundation + route execution** | 1–3 | First customers through door-to-door, content and outreach; proof library started; systems running | Routes worked weekly; first completed cleans; first recurring conversations; scorecard filled every week; first permissioned proof assets |
| **2 — Recurring conversion + reviews + referrals** | 3–6 | Turn first cleans into recurring customers; earn the first genuine reviews; start referrals | Recurring conversion rate tracked; active recurring households growing; review link live and first genuine reviews; referral cards handed; first referred bookings |
| **3 — Neighborhood density + partnerships** | 6–9 | Concentrate routes around customers; activate realtor/STR/property-manager channels | Recurring customers per worked route rising; 3+ customer clusters; partnership pipeline tracked; commercial/STR walkthroughs converted |
| **4 — Local authority + SEO + PR** | 9–12 | GBP maturity, organic growth, earned local coverage | GBP posts/reviews compounding; Search Console impressions and branded search rising; PR coverage landed; inquiries from organic/GBP growing |
| **5 — Operational scale** | 12+ | Capacity, systems, economics | Staffing trigger evaluated on workload; gross revenue per labor-hour calibrated; route efficiency improving; recurring revenue predictable month over month |

Do not assume growth occurs automatically. Each phase depends on the previous phase's outcomes —
density without retention is just scattered work, and authority without proof is just claims.

## 10. Rules that never bend

1. No fabricated reviews, customers, numbers, press, services or geography.
2. No promotion is printed or published without the owner’s written terms and the publication flag
   (`docs/launch/PROMOTION-PROPOSALS.md`).
3. Customer homes are never humiliated, identified or used without permission
   (`docs/privacy/PHOTO-PRIVACY-SOP.md`).
4. The private operating origin is never published.
5. Attribution before spending; measurement before claiming.
6. Owner approval precedes any committed schedule or campaign.

## 11. Read order

New to the system? `GROWTH-SYSTEM.md` (this file) → `COMPETITIVE-STRATEGY.md` →
`CONTENT-ENGINE.md` → `ACQUISITION-CHANNELS.md` → `CUSTOMER-LIFECYCLE.md` → `ECONOMIC-MODEL.md` →
`LOCAL-AUTHORITY.md`. Operational detail stays in the existing docs listed in §2.
