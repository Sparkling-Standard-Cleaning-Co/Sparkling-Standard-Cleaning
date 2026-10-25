# Commercial estimate tier model — PROPOSAL for owner review

> **SUPERSEDED 2026-10-24 by Initiative 6.1.** The implemented model is the
> evidence-based facility workload estimate described in
> `docs/operations/COMMERCIAL-PRICING-RESEARCH.md` and
> `docs/operations/ESTIMATOR-ENGINES.md`: **$60 gross labour/hour**, **$125
> minimum job**, **workload-hour tiers** (A ≤3 hours, B ≤8 hours, C scope
> review), fixture-based restrooms, and the 10% church discount. This document
> is retained as the PRE-6.1 proposal and historical analysis; its $55 rate,
> square-foot thresholds, rounding direction and "disabled" status are no
> longer current. Do not use it to configure or quote prices.

Status: **historical proposal — superseded by Initiative 6.1.** The current
implementation is enabled as nonbinding provisional Tier A/B pricing, with the
owner kill switch `commercialTierConfig.numericEstimatesEnabled` enforcing a
scope-review-only experience when false. The historical methodology below is
kept only for the decision record.

## Tiers (customer-facing language is owner-specified)

| Tier | Customer heading | Meaning | Threshold (proposed) |
| --- | --- | --- | --- |
| A | Preliminary Cleaning Estimate | A single calculated preliminary number | ≤ 2,500 cleanable sqft, no specialty triggers, ≤ 4 restrooms |
| B | Estimated Price Range | A low/high band | ≤ 6,000 cleanable sqft, no specialty triggers |
| C | Request a Custom Cleaning Quote | Walkthrough / personal quote | Anything larger, > 4 restrooms, or any specialty service |

All thresholds are configurable in ONE place (`commercialTierConfig`) — never
buried in components. The 2,500 sqft figure is the owner's proposed starting
boundary, presented here for analysis, not yet company policy.

## Proposed economics (grounded in approved company numbers)

The residential estimator's approved economics are the only approved pricing
substrate: **$55 per productive labor-hour**, **$125 minimum job**, **floor
rounding to $5**, plus the **35-mile round-trip** travel assumption. A
commercial Tier A estimate would build on a labor-hours model:

```
laborHours = baseMinutes/60
           + cleanableSqft × sqftMinutesPer1000/60
           + restroomCount × restroomMinutes/60
           + breakroom ? breakroomMinutes/60 : 0
laborHours × conditionFactor (0.9 maintained … 1.6 heavy)
price      = roundDown5(max(minimumJob, laborHours × $55) + travelAdjustment)
```

Market reasonableness check (research, not policy): typical published
commercial-cleaning productivity for light office work falls in the
2,500–4,000 sqft/labor-hour band for routine maintenance (higher for nightly
service, lower for one-time deep work). At 3,000 sqft/hour, a 2,500 sqft
one-time office clean ≈ 0.85 base hours before condition/restrooms — around
$47 labor before multipliers, which lands **below the $125 minimum** for
maintained one-time work; condition factors and restrooms push a typical
one-time job toward the $150–$250 zone and recurring visits below it. The
owner should confirm:

1. The `baseMinutes`, `sqftMinutesPer1000`, `restroomMinutes` and
   `breakroomMinutes` constants (proposed starting point: 30 base minutes,
   20 min/1,000 sqft, 25 min/restroom, 15 min breakroom — i.e. ≈3,000
   sqft/hour for maintained office work).
2. Whether recurring commercial visits price at the recurring rate with a
   frequency-efficiency factor (as residential does) or flat.
3. The Tier A/B sqft ceilings after reviewing real local jobs.

**Historical note (pre-6.1): no number was shown until those constants were
owner-approved.** The intake form already collected the data (cleanable sqft,
restrooms, breakroom, condition, specialty needs) so the owner notification
carried a complete picture even in Tier C.

## What was live before Initiative 6.1 (historical)

- Commercial/Church request flow: enhanced intake (cleanable sqft, restrooms,
  kitchen/breakroom, condition, specialty needs) → owner notification with
  every field labeled. Customer-facing heading was "Request a Walkthrough" —
  an honest Tier C.
- The legacy `resolveCommercialTier()` square-foot resolver returned Tier C for
  everything while `numericEstimatesEnabled` was false. It is retained as
  reference only; the live 6.1 engine tiers by workload hours.

## Original enablement checklist (completed and superseded by Initiative 6.1)

1. Owner approves the labor constants + ceilings (this document, in writing).
2. Add `commercial` to the estimator service matrix with the approved
   frequency set (e.g. one_time + weekly/biweekly/monthly as supported).
3. Add `commercial` base-hours to `estimators/pricing-values.ts` (owner-edited values).
4. Flip `numericEstimatesEnabled: true`, wire Tier A/B rendering into the
   estimator, extend server validation, add reconciliation tests, bump the
   quote `configVersion`.

The implemented 6.1 model uses $60/hour, a $125 minimum, workload-hour tiers
and fixture-based restrooms as documented in
`docs/operations/COMMERCIAL-PRICING-RESEARCH.md`.
