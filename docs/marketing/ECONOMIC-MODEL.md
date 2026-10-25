# Economic model

The planning model for Sparkling Standard's growth economics: doors, leads, first cleans,
recurring customers, revenue, acquisition cost and customer value. It exists so decisions can be
made with explicit assumptions instead of vibes — **not** to predict the future.

> **Every projection, probability, conversion rate, customer estimate and revenue figure in this
> document is a planning scenario — not a forecast.** The company has no historical conversion or
> revenue data yet. Verified facts are labelled **VERIFIED**; planning inputs are labelled
> **ASSUMPTION**; calculated outputs are labelled **SCENARIO**. Never blur the three.

This is internal documentation. Never quote these figures to customers, publish them, or present
them as expected results.

## 1. What is verified today

| Fact | Value | Source |
| --- | --- | --- |
| Target homes mapped (owner-occupied) | 4,241 (3,892) | `CANVASSING-ROUTES-OVERVIEW.md` |
| Routes (Priority A / B) | 66 (36 / 30) | same |
| Average route size | ~64 homes | same |
| Canvassing pace (planning model) | ~30 homes/hour incl. travel; ~141.4 h for 4,241 | same |
| Distance bands | 42 routes/2,572 homes (0–5 mi); 2/140 (5–10); 19/1,354 (10–15); 3/175 (20+) | same |
| Recurring frequencies supported | weekly, biweekly, monthly (plus one-time) | `src/config/pricing.ts` |
| Founder labor pay floor | $35/labor-hour (internal) | `docs/launch/PRICING-PROPOSAL.md` |
| Internal provisional price outputs (Option A, current config) | 3/2 weekly $248 (4.52 h), biweekly $257 (4.66 h), monthly ~$265, first clean $306 (5.56 h), deep $370, move-out $382, STR turnover $197 | `docs/launch/PRICING-PROPOSAL.md` — **pricing decision pending; not approved, not public** |
| Measurement systems live | GA4 (consent-gated), lead delivery, UTM attribution, scorecard, tracking CSV | `docs/operations/PLATFORM-STATUS.md` |

## 2. What is not verified (and must stay labelled)

- Contact, lead, booking, completion and recurring-conversion rates — **no observed data exists**.
- Customer retention/churn — **no cohort data exists**.
- Average first-clean and recurring revenue per customer — the internal provisional model exists,
  but no completed-job history calibrates it yet (`docs/operations/ESTIMATOR-CALIBRATION.md`).
- Referral and review volumes — no history yet; the review link is captured (2026-10-08) and
  review requests are unblocked, but no reviews have been earned and counted yet.

The first real numbers will come from `canvass-out/performance_tracking.csv`, the lead ledger and
the weekly scorecard. Replace the assumptions with actuals as soon as they exist (§13).

## 3. Core formulas

```
Conversations        = Doors × contact rate
Leads                = Conversations × lead rate
Booked first cleans  = Leads × booking rate
Completed first cleans = Booked × completion rate
Recurring customers  = Completed × recurring-conversion rate
First-clean revenue  = Completed × average first-clean revenue
Recurring monthly revenue = Recurring customers × average monthly revenue per customer
Revenue per 1,000 doors   = output per 1,000 doors × unit revenue
CAC                  = channel cost ÷ customers acquired (report per first clean and per recurring)
Gross LTV            = monthly revenue per customer × average lifetime months
Implied monthly churn ≈ 1 ÷ average lifetime months
```

All dollar figures are gross revenue unless labelled margin. Margin requires labor calibration
that does not exist yet — do not present LTV:CAC as profit.

## 4. Planning inputs (ASSUMPTION)

| Input | Conservative | Base | Strong | Exceptional | Notes |
| --- | --- | --- | --- | --- | --- |
| Contact rate (doors → conversation) | 15% | 20% | 25% | 35% | Script, time of day, route quality, repeat visits |
| Conversation → lead | 8% | 10% | 12% | 15% | Phone captured / estimate requested |
| Lead → booked first clean | 30% | 40% | 45% | 50% | Follow-up speed and estimate clarity |
| Booked → completed | 80% | 85% | 90% | 90% | Cancellations and scheduling losses |
| Completed → recurring | 40% | 50% | 55% | 60% | Recurring offer at the first clean + day-2 follow-up |
| Avg first-clean revenue | $306 | $306 | $306 | $306 | Internal provisional model; may change with owner pricing decision |
| Avg recurring revenue / customer / month | ~$500 | ~$500 | ~$500 | ~$500 | Mix of weekly ($248/visit × 4.33), biweekly ($257 × 2.17), monthly (~$265 × 1) |
| Founder time value (CAC math) | $35/h | $35/h | $35/h | $35/h | Her verified internal pay floor, used as the opportunity-cost convention |

None of these rates are observed results. They are deliberately ranged because the truth is
unknown.

## 5. The 4,000-door planning scenarios

**Planning scenario — not a forecast.** Funnel math for 4,000 doors; counts rounded; exact values
drive the dollar figures.

| Scenario | Conversations | Leads | Booked | Completed | Recurring customers | Recurring per 1,000 doors |
| --- | --- | --- | --- | --- | --- | --- |
| **Conservative** | ~600 | ~48 | ~14 | ~12 | **~5** | ~1.2 |
| **Base** | ~800 | ~80 | ~32 | ~27 | **~14** | ~3.4 |
| **Strong** | ~1,000 | ~120 | ~54 | ~49 | **~27** | ~6.7 |
| **Exceptional** | ~1,400 | ~210 | ~105 | ~95 | **~57** | ~14.2 |

**Economic outputs (SCENARIO, gross revenue):**

| Scenario | First-clean revenue | Recurring revenue at run-rate | Annualized recurring run-rate |
| --- | --- | --- | --- |
| Conservative | ~$3,500 | ~$2,300/month | ~$28,000/year |
| Base | ~$8,300 | ~$6,800/month | ~$82,000/year |
| Strong | ~$14,900 | ~$13,400/month | ~$160,000/year |
| Exceptional | ~$28,900 | ~$28,400/month | ~$340,000/year |

Read honestly: these are run-rate illustrations at the moment all 4,000 doors are worked and the
recurring base is retained — not first-year totals, and not promises. Doors are worked over weeks
to months; recurring customers arrive gradually; churn is not netted here (see §7).

**Worked example (Base):** 4,000 doors → 800 conversations → 80 leads → 32 booked → 27 completed
→ ~14 recurring. First-clean revenue ≈ 27 × $306 ≈ $8,300. Recurring run-rate ≈ 14 × $500 ≈
$6,800/month. Door-knocking labor ≈ 133 h ≈ $4,700 opportunity cost (print excluded).

## 6. Sensitivity analysis

**Which variables matter most?** At base top-funnel rates (contact 20%, lead 10%, completion 85%),
recurring customers = 68 × booking rate × recurring-conversion rate:

| Booking ↓ / Recurring → | 40% | 50% | 60% |
| --- | --- | --- | --- |
| **30%** | ~8 | ~10 | ~12 |
| **40%** | ~11 | **~14** | ~16 |
| **50%** | ~14 | ~17 | ~20 |

The top of the funnel dominates: contact × lead spans 0.012 (15% × 8%) to 0.0525 (35% × 15%) — a
~4.4× swing, larger than any single downstream variable. Practical reading:

1. **Contact rate is the highest-leverage, most controllable input** — the opener, the time of
   day, the route quality, and a second pass on good streets.
2. **Lead capture at the door** (phone number or estimate request) is the second lever.
3. **Booking and recurring conversion** multiply everything above them; the recurring offer at
   the first clean is the single most valuable conversation in the system.
4. A weak door day is a data point, not a verdict — judge on full routes (~60+ doors), not single
   afternoons.

## 7. Recurring revenue model

| Frequency | Visits/month | Provisional per-visit revenue | Monthly revenue per customer |
| --- | --- | --- | --- |
| Weekly | ~4.33 | $248 | ~$1,074 |
| Biweekly | ~2.17 | $257 | ~$558 |
| Monthly | 1.0 | ~$265 | ~$265 |
| **Planning mix (assumed)** | ~2.2 | — | **~$500** |

- Frequencies are **VERIFIED** as supported options; per-visit revenues are **provisional internal
  model outputs** (Option A, current config — owner pricing decision pending).
- **Churn/retention (ASSUMPTION):** no cohort data exists. Planning assumption: average recurring
  lifetime of 12–24 months (implied monthly churn ~8.3% at 12 months, ~4.2% at 24 months). Track
  real cohorts and replace this immediately when data exists.
- **Retention levers** (not modeled as inputs yet): recurring offer at first clean, day-2
  follow-up, consistent standard, neighborhood density, reactivation touches
  (`CUSTOMER-LIFECYCLE.md`).
- **Referrals and reviews are upside not modeled here** — no rate is assumed. Track referrals
  received, referred bookings and referred revenue in the ledger; reviews become a GBP conversion
  input once genuine reviews exist.

## 8. Customer acquisition cost (CAC)

**Door knocking (labor-equivalent view):** 4,000 doors ÷ 30 doors/hour ≈ 133 hours × $35/hour ≈
**$4,700** (print cost excluded; travel fuel partially covered by travel economics).

| Scenario | CAC per completed first clean | CAC per recurring customer |
| --- | --- | --- |
| Conservative | ~$400 | ~$1,000 |
| Base | ~$170 | ~$340 |
| Strong | ~$100 | ~$175 |
| Exceptional | ~$50 | ~$80 |

Report both views: if the owner's time is not counted as a cost, cash CAC is just the print cost
(owner-funded, recorded when ordered) — but the time is real and this table values it honestly.
Other channels: GBP, SEO, social and referrals have near-zero cash cost; their cost is time, which
should be reported the same way once channel-level time is tracked.

## 9. Customer lifetime value (gross)

Gross LTV = monthly revenue per customer × average lifetime months (ASSUMPTION 12–24 months):

| Monthly revenue mix | LTV at 12 months | LTV at 24 months |
| --- | --- | --- |
| $265 (monthly only) | ~$3,200 | ~$6,400 |
| **$500 (planning mix)** | **~$6,000** | **~$12,000** |
| $1,074 (weekly only) | ~$12,900 | ~$25,800 |

- These are **gross revenue**, not profit. Margin depends on labor calibration
  (`docs/operations/ESTIMATOR-CALIBRATION.md`) and real cost data — not yet available.
- Gross LTV:CAC at base scenario ≈ 18:1 to 35:1 — a planning illustration, not a claim, and not a
  profit ratio.
- The strategic conclusion that does not depend on precision: **recurring customers are worth many
  times a one-time clean, so every acquisition system should be judged on recurring customers
  produced, not jobs sold.**

## 10. Capacity implications (why the scenarios change the business)

Planning visit volume and labor hours per month at each scenario (2.2 visits/month per customer;
4.66 labor-hours per visit from the provisional biweekly 3/2 model):

| Scenario | Recurring customers | Visits/month | Labor-hours/month | ~Hours/workday (21 days) |
| --- | --- | --- | --- | --- |
| Conservative | ~5 | ~10 | ~47 | ~2.2 |
| Base | ~14 | ~30 | ~140 | ~6.7 |
| Strong | ~27 | ~59 | ~275 | ~13 |
| Exceptional | ~57 | ~125 | ~580 | ~28 |

- **Base is solo-feasible while acquiring.** Strong is beyond sustainable solo capacity — helper
  evaluation becomes a real conversation. Exceptional requires a team.
- Customers arrive gradually over the door-working period, so pressure builds month over month.
- The staffing trigger is workload, not a fixed customer count (`WEEKLY-SCORECARD.md`).

## 11. Revenue per 1,000 doors

| Scenario | Completed first cleans | First-clean revenue | Recurring customers |
| --- | --- | --- | --- |
| Conservative | ~2.9 | ~$890 | ~1.2 |
| Base | ~6.8 | ~$2,100 | ~3.4 |
| Strong | ~12.2 | ~$3,700 | ~6.7 |
| Exceptional | ~23.6 | ~$7,200 | ~14.2 |

The deciding metric for door-knocking performance is **recurring customers per 1,000 doors** by
route, street and neighborhood — it directly prices the route system's effort.

## 12. How this model interacts with the rest of the system

- `ACQUISITION-CHANNELS.md` §3 carries the execution plan and the same scenario summary; this
  document is the authoritative math. If numbers change, change them here first.
- `CUSTOMER-LIFECYCLE.md` defines the recurring engine the conversion rates depend on.
- `WEEKLY-SCORECARD.md` records the actuals; `LEAD-MEASUREMENT-MODEL.md` defines the fields.
- `docs/launch/PRICING-PROPOSAL.md` owns pricing decisions; this document never overrides it.

## 13. Replacing assumptions with actuals

1. After the first full routes, pull real contact/lead/booking rates from
   `canvass-out/performance_tracking.csv`.
2. After the first recurring cohorts, compute real conversion and churn.
3. After job calibration, replace the provisional per-visit revenues with measured averages
   (`docs/operations/ESTIMATOR-CALIBRATION.md`).
4. Update this document with dated actuals, keeping the VERIFIED/ASSUMPTION/SCENARIO labels.
5. Never overwrite assumptions with guesses — only with counted records.

## 14. Rules that never bend

1. Planning scenarios are never presented as forecasts or promises.
2. No invented conversion rates, revenue, retention or CAC figures — labels are mandatory.
3. Pricing figures remain provisional and internal until the owner approves them.
4. This document is internal; revenue figures never appear in public screenshots or shared
   marketing material.
5. Measured outcomes replace assumptions as soon as they exist.
