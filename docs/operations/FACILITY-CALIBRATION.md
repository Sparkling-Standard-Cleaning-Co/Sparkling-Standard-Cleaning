# Facility pricing calibration (Initiative 6.4 completion)

**Date:** 2026-10-25
**Status:** completed initial calibration; hypothetical scenarios, not completed jobs.
**Model:** $60.00/labor-hour gross;
$35.00/hour owner-labour cost;
$125.00 minimum; 22% overhead allowance;
commercial calibration 1.00;
church calibration 1.00.

## Method

- ISSA-style workloading: area ÷ production rate + setup + fixture minutes +
  breakroom, then flooring, condition, traffic and first-clean factors.
- All rows use the **same shared functions** used by the website and
  `facility-verify.ts`; they are not a separate spreadsheet.
- The church discount is applied after the $125 minimum and the $5 facility
  presentation step, then retained to the cent. The matching engine calibration
  factor applies after the discount and never to travel.
- Tier A = one preliminary number; Tier B = ±15% range; Tier C = custom review
  with no invented number. Specialty work is always custom.
- Travel is a separately stated pass-through; it is excluded from the
  operating-profit calculation. Monthly equivalents use the scenario's visits
  per week and are not per-visit prices.
- **Do not compare per-visit and monthly $/sqft as the same unit.** The local
  market references used in research have ambiguous units; the calibration
  reports effective per-visit $/sqft and monthly equivalent separately.

## Summary

| Engine | Scenarios | Tiers | Numeric | Minimum-floor | Aggregate operating margin | Average per-visit $/sqft |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| Commercial | 26 | A: 15, B: 9, C: 2 | 24 | 7 | 24% | $0.055 |
| Church (10% discount) | 20 | A: 10, B: 8, C: 2 | 18 | 3 | 15% | $0.041 |

The modelled margin is operating profit after owner-labour cost and the 22%
overhead allowance; it is not a promise of net profit. Minimum-floor rows are
valid small-job outcomes, not pricing defects. Tier C/specialty rows are
deliberately excluded from revenue and profit figures because no price is
offered; their labour estimate remains visible for planning.

## Commercial scenario matrix

| ID | Scenario | sqft | Fixtures | Schedule | Hours | Tier | Service | Travel | Profit | $/sqft/visit | Monthly | Customer estimate |
| --- | --- | ---: | ---: | --- | ---: | :---: | ---: | ---: | ---: | ---: | ---: | --- |
| c01 | Small office 800 sqft | 800 | 2 | weekly | 0.69 | A | $125.00 | $0.00 | $73.35 | $0.160 | $541.25 | $125.00 per visit |
| c02 | Small office 1,200 sqft | 1,200 | 4 | weekly | 1.07 | A | $125.00 | $0.00 | $60.05 | $0.100 | $541.25 | $125.00 per visit |
| c03 | Small office 2,000 sqft | 2,000 | 6 | weekly | 1.68 | A | $125.00 | $0.00 | $38.70 | $0.060 | $541.25 | $125.00 per visit |
| c04 | Medium office 3,500 sqft | 3,500 | 8 | weekly | 2.36 | A | $145.00 | $0.00 | $30.50 | $0.040 | $627.85 | $145.00 per visit |
| c05 | Medium office 5,000 sqft high traffic | 5,000 | 10 | weekly | 3.51 | B | $215.00 | $0.00 | $44.85 | $0.040 | $930.95 | $182.75–$247.25 per visit |
| c06 | Larger office 7,500 sqft | 7,500 | 14 | weekly | 4.23 | B | $255.00 | $0.00 | $50.85 | $0.030 | $1104.15 | $216.75–$293.25 per visit |
| c07 | Larger office 10,000 sqft | 10,000 | 16 | weekly | 6.02 | B | $365.00 | $0.00 | $74.00 | $0.040 | $1580.45 | $310.25–$419.75 per visit |
| c08 | Retail store 2,500 sqft | 2,500 | 4 | weekly | 1.66 | A | $125.00 | $0.00 | $39.40 | $0.050 | $541.25 | $125.00 per visit |
| c09 | Retail store 6,000 sqft | 6,000 | 8 | weekly | 3.51 | B | $215.00 | $0.00 | $44.85 | $0.040 | $930.95 | $182.75–$247.25 per visit |
| c10 | Salon 1,400 sqft | 1,400 | 4 | weekly | 1.31 | A | $125.00 | $0.00 | $51.65 | $0.090 | $541.25 | $125.00 per visit |
| c11 | Salon 2,200 sqft overdue | 2,200 | 6 | weekly | 2.04 | A | $125.00 | $0.00 | $26.10 | $0.060 | $541.25 | $125.00 per visit |
| c12 | Gym 4,000 sqft | 4,000 | 8 | weekly | 3.29 | B | $200.00 | $0.00 | $40.85 | $0.050 | $866.00 | $170.00–$230.00 per visit |
| c13 | Gym 7,000 sqft heavy use | 7,000 | 12 | weekly ×2/wk | 5.83 | B | $350.00 | $0.00 | $68.95 | $0.050 | $3031.00 | $297.50–$402.50 per visit |
| c14 | Professional office 3,000 sqft | 3,000 | 6 | weekly ×2/wk | 2.06 | A | $125.00 | $0.00 | $25.40 | $0.040 | $1082.50 | $125.00 per visit |
| c15 | Professional suite 5,000 sqft 2x/week | 5,000 | 10 | weekly ×2/wk | 3.51 | B | $215.00 | $0.00 | $44.85 | $0.040 | $1861.90 | $182.75–$247.25 per visit |
| c16 | Community facility 6,000 sqft | 6,000 | 12 | weekly | 3.55 | B | $215.00 | $0.00 | $43.45 | $0.040 | $930.95 | $182.75–$247.25 per visit |
| c17 | High-restroom office 2,000 sqft / 18 fixtures | 2,000 | 18 | weekly | 2.40 | A | $145.00 | $0.00 | $29.10 | $0.070 | $627.85 | $145.00 per visit |
| c18 | High-restroom facility 4,000 sqft / 24 fixtures | 4,000 | 24 | weekly | 3.84 | C | — | $0.00 | — | — | — | Custom scope review |
| c19 | High-traffic office 3,000 sqft 3x/week | 3,000 | 8 | weekly ×3/wk | 2.50 | A | $150.00 | $0.00 | $29.50 | $0.050 | $1948.50 | $150.00 per visit |
| c20 | Heavy-condition office 2,500 sqft | 2,500 | 6 | weekly | 2.83 | A | $170.00 | $0.00 | $33.55 | $0.070 | $736.10 | $170.00 per visit |
| c21 | Initial clean office 4,000 sqft | 4,000 | 8 | weekly | 3.45 | B | $210.00 | $0.00 | $43.05 | $0.050 | $909.30 | $178.50–$241.50 per visit |
| c22 | Monthly office 5,000 sqft | 5,000 | 8 | monthly | 2.67 | A | $165.00 | $0.00 | $35.25 | $0.030 | $165.00 | $165.00 per visit |
| c23 | Carpeted office 3,500 sqft | 3,500 | 8 | weekly | 2.46 | A | $150.00 | $0.00 | $30.90 | $0.040 | $649.50 | $150.00 per visit |
| c24 | Hard-floor office 3,500 sqft | 3,500 | 8 | weekly | 2.27 | A | $140.00 | $0.00 | $29.75 | $0.040 | $606.20 | $140.00 per visit |
| c25 | Extended-travel office 3,000 sqft | 3,000 | 8 | weekly | 2.17 | A | $135.00 | $11.21 | $29.35 | $0.050 | $633.09 | $146.21 per visit |
| c26 | Post-construction office 2,500 sqft | 2,500 | 6 | weekly | 3.82 | C | — | $0.00 | — | — | — | Custom scope review |

## Church scenario matrix (10% discount applied)

| ID | Scenario | sqft | Fixtures | Schedule | Hours | Tier | Service | Travel | Profit | $/sqft/visit | Monthly | Customer estimate |
| --- | --- | ---: | ---: | --- | ---: | :---: | ---: | ---: | ---: | ---: | ---: | --- |
| h01 | Small church 1,500 sqft | 1,500 | 4 | weekly | 1.06 | A | $112.50 | $0.00 | $50.65 | $0.080 | $487.13 | $112.50 per visit |
| h02 | Small church 2,200 sqft | 2,200 | 6 | weekly | 1.62 | A | $112.50 | $0.00 | $31.05 | $0.050 | $487.13 | $112.50 per visit |
| h03 | Small church 3,000 sqft with kitchen | 3,000 | 6 | weekly | 2.14 | A | $117.00 | $0.00 | $16.36 | $0.040 | $506.61 | $117.00 per visit |
| h04 | Medium church 4,000 sqft | 4,000 | 8 | weekly | 2.66 | A | $144.00 | $0.00 | $19.22 | $0.040 | $623.52 | $144.00 per visit |
| h05 | Medium church 6,000 sqft high traffic | 6,000 | 10 | weekly | 4.13 | B | $225.00 | $0.00 | $30.95 | $0.040 | $974.25 | $191.25–$258.75 per visit |
| h06 | Medium church 8,000 sqft | 8,000 | 12 | weekly | 4.53 | B | $247.50 | $0.00 | $34.50 | $0.030 | $1071.68 | $210.38–$284.63 per visit |
| h07 | Active church 9,000 sqft 2x/week | 9,000 | 14 | weekly ×2/wk | 5.05 | B | $274.50 | $0.00 | $37.36 | $0.030 | $2377.17 | $233.33–$315.68 per visit |
| h08 | Larger church 12,000 sqft overdue | 12,000 | 16 | weekly | 7.26 | B | $396.00 | $0.00 | $54.78 | $0.030 | $1714.68 | $336.60–$455.40 per visit |
| h09 | Large church campus 18,000 sqft | 18,000 | 24 | weekly | 9.30 | C | — | $0.00 | — | — | — | Custom scope review |
| h10 | Monthly church 5,000 sqft | 5,000 | 8 | monthly | 2.65 | A | $144.00 | $0.00 | $19.57 | $0.030 | $144.00 | $144.00 per visit |
| h11 | Heavy-use church 7,000 sqft | 7,000 | 10 | weekly | 6.07 | B | $328.50 | $0.00 | $43.78 | $0.050 | $1422.41 | $279.23–$377.78 per visit |
| h12 | Initial deep clean church 3,200 sqft | 3,200 | 6 | weekly | 3.00 | A | $162.00 | $0.00 | $21.36 | $0.050 | $701.46 | $162.00 per visit |
| h13 | Carpeted sanctuary 4,500 sqft | 4,500 | 8 | weekly | 2.98 | A | $162.00 | $0.00 | $22.06 | $0.040 | $701.46 | $162.00 per visit |
| h14 | Hard-floor fellowship hall 4,500 sqft | 4,500 | 8 | weekly | 2.76 | A | $153.00 | $0.00 | $22.74 | $0.030 | $662.49 | $153.00 per visit |
| h15 | Church with nursery 6,000 sqft 2x/week | 6,000 | 12 | weekly ×2/wk | 4.27 | B | $234.00 | $0.00 | $33.07 | $0.040 | $2026.44 | $198.90–$269.10 per visit |
| h16 | Church classrooms 10,000 sqft | 10,000 | 18 | weekly | 5.69 | B | $310.50 | $0.00 | $43.04 | $0.030 | $1344.47 | $263.93–$357.08 per visit |
| h17 | Small church 2,500 sqft | 2,500 | 4 | weekly | 1.73 | A | $112.50 | $0.00 | $27.20 | $0.050 | $487.13 | $112.50 per visit |
| h18 | Large church 15,000 sqft | 15,000 | 20 | weekly | 7.84 | B | $427.50 | $0.00 | $59.05 | $0.030 | $1851.08 | $363.38–$491.63 per visit |
| h19 | Complex church 11,000 sqft / 22 fixtures | 11,000 | 22 | weekly | 7.27 | C | — | $0.00 | — | — | — | Custom scope review |
| h20 | Extended-travel church 4,000 sqft | 4,000 | 8 | weekly | 2.66 | A | $144.00 | $13.70 | $19.22 | $0.040 | $682.84 | $157.70 per visit |

## Findings

1. Ordinary Tier A/B commercial scenarios are numeric and positive after labour
   and overhead; Tier B spans roughly 3–8 labour hours.
2. Higher-restroom, larger or specialty scopes correctly become custom reviews
   rather than misleading numbers.
3. Ordinary church scenarios use the exact 10% discount. Example:
   $145.00 − $14.50 = $130.50. No upward re-rounding occurs.
4. The matching engine calibration factor scales service revenue without
   changing the church discount or travel charge; the shared tests cover
   0.90/1.00/1.10 for each engine.
5. Travel is visible separately (c25 and h20); it is not discounted.
6. The model is deliberately conservative on production rates and uses a
   $60/hour gross rate within the researched local $50–75/hour band. No rate
   change was made merely to make the matrix look better.

## Limitations

- These are research-based simulations, not completed jobs. Actual job hours
  should be monitored as a quality check; that monitoring is not a prerequisite
  to using the calibrated model.
- Market $/sqft references are not a single comparable unit; the report avoids
  that false comparison.
- Tier B is an uncertainty band, not a guaranteed range; travel, condition and
  access can change the final scope.
- Specialty, high-fixture and very large projects remain owner-reviewed.
- The CSV contains all calculated fields, including setup/fixture/breakroom
  labour split, labour cost, overhead, contribution and reconciliation.
