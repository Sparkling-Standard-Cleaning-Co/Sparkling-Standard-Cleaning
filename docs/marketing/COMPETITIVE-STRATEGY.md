# Competitive strategy — how a small startup wins locally

Sparkling Standard is a new, owner-operated cleaning company competing against franchise chains,
established local production companies, gig-marketplace cleaners and other independents. This
document defines how the company competes without pretending to be bigger than it is, and why its
advantages compound. It does not replace `docs/marketing/COMPETITIVE-COMPARISON.md` (the factual
audit of specific public sites) — it explains the strategy that audit implies.

## 1. The moat (different from the reference architecture)

Sunshine Climate Solutions' moat is technical authority plus real field evidence — a different
industry and business model, used in this repository as a read-only architecture reference only.

**Sparkling Standard's moat is different:**

```
VISUAL PROOF + EXCELLENT CUSTOMER EXPERIENCE + RECURRING CUSTOMERS
+ REVIEWS + REFERRALS + NEIGHBORHOOD DENSITY + RECOGNIZABLE LOCAL BRAND
```

None of these can be copied quickly by a competitor:

- **Visual proof** — real before/after detail work, captured on real jobs, cannot be faked and
  compounds into a library (`CONTENT-ENGINE.md`).
- **Customer experience** — the final walkthrough, honest arrival windows, "make it right" policy
  (`CUSTOMER-LIFECYCLE.md`) produce the reviews that produce the next customers.
- **Recurring customers** — a route-dense recurring base lowers drive time and cost per visit; a
  competitor with scattered one-time jobs cannot match the economics.
- **Reviews and referrals** — earned only, never gamed (`REVIEW-GROWTH-SYSTEM.md`,
  `REFERRAL-PROGRAM.md`).
- **Neighborhood density** — every customer makes the next door easier to knock
  (`ACQUISITION-CHANNELS.md` §5).
- **Recognizable local brand** — a founder people can name, on streets people recognize.

## 2. Premium without pretending

The brand is premium; the behavior is honest. Premium here means **detail and care**, not inflated
claims:

| Premium claim we make | What backs it |
| --- | --- |
| A slower, more detailed standard | The labor-hour model: a maintained 3/2 takes ~4.5–5.0 founder labor-hours, a first clean ~6 (internal model, `docs/launch/PRICING-PROPOSAL.md`) |
| Personal confirmation, never instant booking | Requests are confirmed personally; `business.flags.instantBooking` is false by design |
| The founder does the work | Owner-operated; the founder is the face of the marketing |
| A real estimate, not a guess | Six-step estimator + server-side verification; a browser price is a proposal |

What we never do:

- Never invent years in business, certifications, insurance, bonding, client counts, reviews or
  guarantees — anything unconfirmed is `PENDING` in `src/config/business.ts` and excluded from
  public claims (the no-fabrication rule in `AGENTS.md`).
- Never publish a price list that has not been approved; provisional pricing stays internal.
- The GBP profile and review links are exact owner-supplied facts (`src/config/business.ts`) —
  never modify, shorten or substitute them, and never claim a review count that does not genuinely
  exist.
- Never use discount language as the identity — the shipped print system contains no coupon
  (`field-acquisition/CONVERSION-STRATEGY.md`).

## 3. Who we actually compete against (categories, not inventions)

| Category | Their strengths | Their opening | How we win the door |
| --- | --- | --- | --- |
| Franchise chains | Brand recognition, staffing capacity | Rushed production cleans; rotating crews; the small details get skipped | The detail standard and the same person every visit |
| Established local companies | Reviews, years of relationships | Price anchored to volume; scope creep and inconsistency | Honest scope, walkthrough standard, no surprise charges |
| Gig marketplaces | Cheap and fast to book | No standard, no accountability, no process | A real business with a real standard, payment after the work, a person who answers |
| Other independents | Personal service | Capacity of one; often no proof system | Founder accessibility plus a documented quality system |

The documented public competitor benchmark (Refresh Cleaning LLC, checked 2026-10-01) shows the
market publishes starting prices and room-by-room checklists; Sparkling Standard's differentiators
are the estimator, the detail standard, the founder story and a working conversion path — not
underbidding. See `COMPETITIVE-COMPARISON.md` for the factual comparison.

## 4. Startup advantages (temporary — use them now)

- **Founder accessibility** — Hayli is the face, the estimator, and the person who answers. No
  layer between the customer and the owner.
- **Speed of experimentation** — one decision changes the whole system; no committee
  (`ACQUISITION-CHANNELS.md` §6).
- **Direct relationships** — every first customer is a real relationship, not a ticket.
- **Neighborhood targeting** — the route system concentrates effort where the data says it counts
  (`CANVASSING-TOP-NEIGHBORHOODS.md`).
- **Documented systems** — this repository is itself an advantage competitors do not have.
- **Rapid improvement** — weekly scorecard decisions compound; a chain changes quarterly.
- **No bureaucracy** — pricing, scheduling and quality decisions take minutes.
- **Distinctive brand** — premium feminine presentation in a category that mostly looks generic.

These advantages disappear as the company grows. The 12-month roadmap (`GROWTH-SYSTEM.md` §9) is
built to convert them into durable assets (density, reviews, referrals, SEO) before they expire.

## 5. What we do not compete on

- **Price wars** — a discount race destroys the margin that funds the detail standard.
- **Paid advertising** — not used; zero additional spending is the default. It may only be tested
  with explicit owner authorization, after attribution and the funnel are proven
  (`MULTIPLATFORM-OPERATING-PLAN.md` §7).
- **Volume posting** — content exists to acquire customers, not to fill calendars
  (`CONTENT-ENGINE.md` kill rules).
- **Review gimmicks** — no gating, no incentives, no fabrication, ever.
- **Geographic sprawl** — expansion follows profitable density, not a map
  (`ACQUISITION-CHANNELS.md` §5).

## 6. Positioning rules that never bend

1. The details are the product. Never trade detail quality for volume.
2. Every claim is verifiable or absent.
3. Requests are confirmed personally; no fake booking mechanics.
4. The customer's home is treated with the care the brand promises (payment after the work is
   complete; satisfaction fixed before any review request).
5. Measurement before claiming; attribution before spending.
6. Owner approval precedes any campaign, schedule or promotion.

Read next: `CONTENT-ENGINE.md` (how the proof advantage is produced) and
`ACQUISITION-CHANNELS.md` (how it is distributed and converted).
