# Estimator calibration

The estimator is a **provisional model**, not a statistically proven one. It is built to be
recalibrated after real jobs — target: first meaningful pass at **10 completed jobs**, full
re-evaluation around **30**. Never change formulas on feelings.

## Model anchors (where the numbers come from)

| Anchor | Value | Source |
| --- | --- | --- |
| Maintained ~1600 sqft 3/2, standard clean, founder alone | ≈ 4.5–5.0 labor-hours | Owner's professional experience (directive §20) |
| First professional clean, similar home | ≈ 6 labor-hours | Owner's professional experience |
| Target gross revenue per labor-hour | $55 (internal) | Directive §21 provisional — covers overhead, supplies, travel, fees, marketing, admin, callbacks, taxes, profit before owner compensation target |
| Owner labor floor | $35/hr before overheads | Directive §21 |
| Minimum job | $125 | Directive §22 provisional |

All constants live in `src/config/pricing.ts` with `provisional` markers and rationale notes.

## Per-job data to record

For every completed job, log:

| Field | Source |
| --- | --- |
| Quoted amount | CRM/records |
| Actual revenue | Invoice |
| Actual labor-hours (owner) | Time tracking |
| Helper labor-hours | Time tracking |
| Service type / frequency | Job record |
| Square footage / full baths / half baths / bedrooms | Job record |
| Condition (actual vs customer-reported) | Founder judgment |
| Add-ons performed | Job record |
| Drive time / travel miles | Maps |
| Callbacks / rework hours | Records |

## The calibration loop (monthly)

1. Export all completed jobs since the last review.
2. Compute per job: **estimated labor-hours vs actual** and **estimated price vs final revenue**.
3. Group by service type, frequency, condition and bathroom count (do not group primarily by
   bedrooms — the model intentionally under-weights them).
4. Find systematic drift:
   - Consistent **under**-estimating → raise the relevant factor (often
     `conditionFactors` or `baseHours`).
   - Consistent **over**-estimating on recurring → deepen the frequency benefit or lower the
     maintenance base.
   - Travel drift → revisit `travel.includedOneWayMiles`, `perMileWearCost`, zone adjustments.
5. Change **one factor at a time**, in a dedicated commit, with the data posted in the commit
   message or an attached table.
6. Re-run `npm test` — the anchor tests (4.5–5.0 / ≈6 labor-hours) must still hold; if the data
   genuinely disproves an anchor, update the anchor and the test together with the owner.

## Rules

- Minimum 10 jobs before any structural change; prefer 30.
- Never change constants to make a specific quote come out a certain way.
- Provisional values stay marked `provisional` until the owner approves them (`approved`).
- The internal rate (`$55/hr`) and the calculation trace are **never** published or shown to
  customers. Publication flags in `src/config/pricing.ts` enforce what may be displayed.
- Gas price reference: the EIA Gulf Coast weekly series is a regional reference, **not** a
  Pensacola pump price. Review the fallback value (`travel.fallbackGasPrice`) monthly.

## When to send a job to custom confirmation instead

The model deliberately bails out (per `customQuoteThresholds`) for: > 4,500 sqft, > 4 full
baths, > 5 bedrooms, severe condition, specialty add-ons, out-of-range travel, unknown ZIPs.
Do not "fix" this by forcing numbers — those jobs genuinely need eyes.
