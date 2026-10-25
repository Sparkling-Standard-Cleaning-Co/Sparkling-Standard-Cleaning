# Customer lifecycle

The flywheel stage in `GROWTH-SYSTEM.md` §1 that most determines the business: turning a first
clean into a recurring customer, then into an advocate who produces reviews, referrals and
neighborhood density. This document defines the stages, the recurring engine, the follow-up
cadence, reactivation, and the customer psychology the messaging rests on. Review mechanics remain
in `REVIEW-GROWTH-SYSTEM.md`; referral architecture remains in `REFERRAL-PROGRAM.md` — this
document connects them to the lifecycle.

## 1. The stages

```
PROSPECT → LEAD → FIRST CLEAN → SATISFIED CUSTOMER → RECURRING CUSTOMER
        → ADVOCATE → REFERRAL SOURCE
```

| Stage | Goal | Owner actions | Timing | Measure |
| --- | --- | --- | --- | --- |
| **Prospect** | Get seen and trusted | Door knocking, content, GBP, local presence | Ongoing | Doors, reach, profile visits |
| **Lead** | Deliver a real estimate and reply personally | Answer every inquiry; send the estimator link; confirm details | Same day | Inquiries, estimate starts, reply time |
| **First clean** | Exceed the standard; earn the second visit | Arrive as scheduled; final walkthrough; payment after completion | The job | Completed first cleans, satisfaction |
| **Satisfied customer** | Confirm the result and open the recurring conversation | Day-2 check-in; present recurring honestly at the clean | Day 0–2 | Recurring conversions |
| **Recurring customer** | Make the rhythm effortless and the home consistently better | Confirm schedule; same standard every visit; watch for drift | Ongoing | Active recurring households, retention |
| **Advocate** | Turn satisfaction into public proof | Ask for a genuine review after satisfaction; reply to reviews | After 1–3 visits | Reviews, review replies |
| **Referral source** | Make referring easy and natural | Hand a referral card after a great result; track the source | After visible results | Referrals, referred bookings |

The transitions are the business: the first clean exists to produce the recurring customer; the
recurring customer exists to produce the advocate; the advocate produces the next neighbor.

## 2. The first clean experience (CX standard)

The first clean is the audition. It is also the visit that sets the recurring relationship.

- **Arrival honesty (verified policy):** the first appointment of the day gets an exact arrival
  time; later appointments use an arrival window — "a home takes as long as it takes, and we will
  not rush yours to hit a clock" (`src/config/business.ts`).
- **Walkthrough first:** confirm scope, expectations and any sensitivities before starting; note
  anything the customer flags.
- **The standard is the product:** the detail work (corners, fixtures, edges) is the reason the
  price is what it is. Do not rush it — the brand cannot afford a volume compromise.
- **Final walkthrough:** walk the home with the customer (or send a completion set when they are
  not present). Fix anything they notice before leaving or return to fix it.
- **Payment (verified policy):** payment is due after the cleaning is complete — the customer sees
  the result before paying.
- **Leave-behind:** the completion card; hand a referral card when the result genuinely warrants it
  (`REFERRAL-PROGRAM.md`).

## 3. The recurring engine

Recurring service is the primary business objective — every first clean is a recurring
conversation.

**Offer timing:**

- **At the first clean:** present the recurring options honestly (weekly, biweekly, monthly) as
  part of the walkthrough — the natural question is "how often would you like this to stay this
  way?"
- **Day 2:** follow up with a simple check-in ("How does everything feel?") and, if recurring was
  not decided, ask once more without pressure.
- **Never:** invent a discount, pressure with scarcity that does not exist, or promise priority
  that is not real. The strongest honest hooks are route availability ("we're scheduling in your
  neighborhood") and priority scheduling (`field-acquisition/CONVERSION-STRATEGY.md`).

**Frequencies (verified in the pricing model):** weekly, biweekly, monthly, and one-time.
Present the options; the estimator and personal confirmation handle pricing — never quote a
number that was not confirmed.

**What makes recurring stick:**

- The maintained home visibly stays easier — show the customer what a maintained clean prevents.
- Consistency of standard and person: the same care every visit.
- Convenience: predictable rhythm, honest arrival expectations, easy rescheduling.
- Density: when several customers share a street, scheduling and drive time improve for everyone —
  and the customer sees the company regularly in their neighborhood.

**Retention guardrails:**

- Watch for drift: a rushed visit is the first churn signal. Quality is checked by the founder's
  own walkthrough standard.
- Watch the scorecard's capacity triggers (`WEEKLY-SCORECARD.md`): when recurring obligations
  block desirable new work or weeks run near capacity, evaluate helper capacity — not by cutting
  the standard.

## 4. Follow-up cadence (recommended operating guidance)

A simple cadence, kept in the lead ledger / scorecard. It is planning guidance, not a customer
promise:

| When | Touch | Channel |
| --- | --- | --- |
| Same day | Delivery confirmation / thank-you | SMS or email |
| Day 2 | Satisfaction check + recurring question if open | SMS |
| After satisfaction (review link live only) | Genuine review request | SMS/email (`REVIEW-GROWTH-SYSTEM.md`) |
| +3 days (once) | One review reminder, then stop | SMS |
| After a great result | Referral card, hand-delivered | In person |
| Recurring customers | Between-visit tip or seasonal note (occasional, useful) | SMS/email/social |
| 30/60/90 days dormant | One reactivation touch per window, maximum | SMS/email |

Rules: one reminder maximum for reviews; never tie a referral reward to a review; never message a
customer more than the cadence allows; personal, short, human.

## 5. Review integration (earned only)

The workflow, templates and hard rules live in `REVIEW-GROWTH-SYSTEM.md`. Lifecycle placement:

- **Ask when:** after the customer confirms satisfaction (in person or same-day), never before a
  concern is fixed.
- **Review-link state (2026-10-08):** the Google Business Profile is **verified** and the exact
  review link is **captured** (`business.reviews.submissionUrl` =
  `https://g.page/r/CXAcv1Pp7OI2ECE/review`). Review requests are unblocked: ask after
  satisfaction, one reminder, then stop. Never modify or hand-build the URL.
- **After a review:** reply publicly to every review; negative reviews get acknowledgment,
  responsibility and a make-it-right offer — never an argument.
- **Reuse:** genuine review content becomes social proof on GBP, the site (when enough exist) and
  content — never fabricated or gated.

## 6. Referral integration (owner-gated)

Architecture and options live in `REFERRAL-PROGRAM.md`; no reward is promised until the owner
approves terms.

- **Referral moment:** after a visibly great result and an expressed satisfaction — the moment a
  customer says "this looks amazing."
- **Mechanism:** hand a referral card (the QR resolves through the tracked `referral_card_qr`
  link) and say plainly what the program is once approved; until approval, hand the card as a
  simple "know a neighbor who'd want this?" without any promised reward.
- **Tracking:** record `referral_source` in the lead record and count referrals in the weekly
  scorecard.
- **Neighborhood strategy:** referrals are the highest-density acquisition source — a referred
  home is usually within walking distance, which strengthens the cluster
  (`ACQUISITION-CHANNELS.md` §5).

## 7. Reactivation, dormant customers and churn recovery

- **Dormant:** no booking in 90 days and no active recurring plan.
- **Reactivation:** one honest touch per window (30/60/90 days) — a seasonal reason, a new detail
  proof, or a simple "we have room in your neighborhood this month." No guilt, no fake urgency.
- **Churn reasons:** record the lost reason from the ledger taxonomy (price / availability / scope
  / other). Patterns decide fixes — a pricing pattern is a strategy question, a quality pattern is
  an operations emergency.
- **Lost after a first clean:** one make-it-right offer ("tell me what wasn't right and I'll fix
  it") is worth more than any discount. If the answer is price, note it and move on — the model
  does not win price wars.
- **Never:** re-message an opted-out customer, invent a reason to reach out, or buy back a
  customer with an unapproved discount.

## 8. Customer psychology (why people actually hire a cleaner)

The real drivers, in the customers' own terms: lack of time, overwhelm, embarrassment, guilt,
exhaustion, busy family schedules, work demands, moving, hosting, life transitions, wanting
consistency, wanting the house to feel better, wanting time back.

Messaging principles:

- **Reduce shame, increase relief.** Never imply a home is disgusting; every home has a season.
  The pitch is "you deserve the help," not "your house is a problem."
- **Sell the outcome, not the chore:** time back, relief, consistency, a home that feels finished.
- **Keep it premium and believable.** No melodrama, no over-promising, no exaggerated emotional
  language. The proof (the detail) carries the emotion.
- **The product truth:** cleaning is the deliverable; **time + relief + consistency + a
  better-feeling home** is what the customer buys.
- **Honesty is the premium signal:** personal confirmation, payment after completion, no hidden
  fees, no invented reviews.

## 9. Lifecycle KPIs

Tracked weekly in `WEEKLY-SCORECARD.md` and the lead ledger
(`LEAD-MEASUREMENT-MODEL.md`):

- First cleans completed → recurring conversions (the core ratio).
- Active recurring households, recurring revenue scheduled, retention/churn.
- Reviews received/replied; referrals received and their bookings.
- Dormant customers reactivated; lost reasons recorded.
- Review request → review conversion (review link is live).

## 10. Rules that never bend

1. Fix satisfaction before asking for anything (review, referral, next booking).
2. Never fabricate a review, testimonial, or customer relationship.
3. No review gating, no review incentives, no reward tied to a review.
4. No unapproved discounts or promotions, ever.
5. Customer privacy is absolute (`docs/privacy/PHOTO-PRIVACY-SOP.md`).
6. One reminder maximum; a no is a no.
