# Conversion engineering — physical pieces

The objective is recurring residential customers, not discount-driven one-time cleans. This
document evaluates the offer options and records what the system actually prints.

## Options evaluated

| Option | Trust impact | Conversion impact | Margin impact | Recurring adoption | Verdict |
| --- | --- | --- | --- | --- | --- |
| 25% off first clean | Negative — reads as a discount brand; conflicts with "premium standard" | High initial response, low-quality leads | Severe: ~$50 off a typical first clean, on top of the first-clean labor premium | Poor: full-price second visit creates churn risk | **Rejected** |
| $40 off first clean | Mildly negative | Moderate-high | Moderate (~$40) | Moderate; still trains discount expectation | Owner-gated variant only |
| $50 off first clean | Negative at premium positioning | High | High | Poor | Rejected for now |
| Priority scheduling ("next available route slot") | Positive — honest, owner-operated capacity | Moderate; strongest for motivated homeowners | None | Strong: reinforces the recurring route model | **Recommended (default)** |
| Neighborhood route availability ("now scheduling in your neighborhood") | Positive — real logistics, not a gimmick | Strong for canvassing: relevance + timing | None | Strong: builds route density, which lowers cost per visit | **Recommended (default)** |
| Limited route openings (numbered scarcity) | Risky — only honest if the owner genuinely caps slots | High but pressure-based | None | Mixed | Not used until the owner sets a real cap |

## What the printed system does (shipped default)

- No discount, no percentage, no coupon language anywhere.
- Primary action: **scan the QR for a free instant estimate** (the estimator is honest: a proposed
  range, confirmed personally).
- Secondary action: **call or text (850) 426-8479**.
- Relevance line: **"Now scheduling in your neighborhood"** on the poster/foam board, and the
  door hanger speaks to the street ("A cleaning standard your neighbors can see.").
- Trust line on every piece: **"Hayli confirms every request personally"** — the real differentiator
  against franchises and gig cleaners.
- Recurring framing everywhere: weekly, biweekly or monthly plans; "the details stay done."

## Why this is the strongest option

1. **Margin:** zero discount cost; every booked job is priced by the existing labor-hour model.
2. **Positioning:** protects the premium standard the website sells; a discount card would contradict
   "The Details Are Our Standard."
3. **Recurring adoption:** route availability and priority scheduling are structural — they reward
   the behavior the business wants (density, recurring visits) instead of a one-time price cut.
4. **Compliance:** no promotion is approved; the shipped artwork therefore contains none. This keeps
   the system consistent with the repo's publication discipline.
5. **Field reality:** in a 15–60 second porch conversation, "we're cleaning this street / I can get
   you a price in a minute" beats "25% off" for trust.

## Owner-gated variants (prepared, not printed)

If the owner later approves a first-clean offer (with terms in `docs/launch/PROMOTION-PROPOSALS.md`
and the promotion engine's written terms), the print system can render an alternate business-card
back / quarter-sheet headline:

- `$40 off the first recurring clean` (recommended amount if any discount is used: keeps margin and
  matches the typical add-on value), or
- `Priority scheduling + first clean at the recurring rate`.

Do not print any variant until: (a) the owner approves exact terms in writing, (b) the promotion
config is enabled with a `configVersion` bump, and (c) the pieces are rebuilt and re-verified.

## Measurement

Scans arrive with piece-level UTMs; inquiries arrive in the owner inbox; bookings and recurring
customers are recorded in `canvass-out/performance_tracking.csv` (or the workbook tab). The metric
that decides the next print run is **recurring customers per 100 doors (or per 100 scans)** by
piece, route and neighborhood — never raw scan counts.
