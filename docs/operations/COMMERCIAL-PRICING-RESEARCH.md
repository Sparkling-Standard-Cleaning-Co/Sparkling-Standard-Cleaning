# Commercial & church pricing research (2026-10-25)

Provisional methodology implemented in `src/lib/estimate/commercial.ts`. These
are RESEARCH-BASED preliminary estimates, not empirically calibrated jobs.

## Industry method (ISSA)
- Cleaning time = area ÷ production rate × 60; fixtures are timed per fixture,
  not per room. ISSA's published restroom example: 10 fixtures × 3 min = 30 min.
- Routine office production ≈ 4,200 sqft/hour (ISSA 612-derived calculators);
  bundled spot-clean example 5,355 sqft/hour; average cross-task rate ≈ 3,289.
- Workloading adds task/area times per visit and multiplies by frequency.
- Sources: issa.com/articles/how-to-calculate-cleaning-times/,
  issa.com/articles/workloading-finding-the-right-balance/,
  access.issa.com/wp-content/uploads/ISSA-Cleaning-Workload-Fact-Sheet.pdf.

## Local market evidence
- Cynsational Clean published comparison ranges: **$50–75/hour** and
  **$0.11–0.25/sqft** (unit ambiguous; treat as a benchmark, not this company's
  rate). Source: cynsationalclean.com/how-much-does-commercial-cleaning-cost-in-pensacola-what-to-look-for-in-a-quote/
- Competitors surveyed (Pensacola Maids, Pensacola Cleaner, Dirt Busters,
  The Cleaning Authority, 360clean): most quote privately; not used as prices.
- Selected provisional rate: **$60/hour** (middle of the local range) to cover
  owner labour, travel/setup, supplies, insurance/admin and a modest margin.

## Cost anchor
- BLS May 2025 national janitors/cleaners: median **$17.71/hr**, mean $18.64
  (bls.gov/ooh/building-and-grounds-cleaning/janitors-and-building-cleaners.htm).
- Existing owner labour target remains **$35/hour**; $60 gross therefore leaves
  $25/productive hour for non-labour costs, non-productive time and margin.

## Implemented model
setup 20 min + cleanable area ÷ conservative effective production rate
(office 3,000, retail 3,200, salon 2,800, gym 2,500, community 3,000,
church 2,800 sqft/hr — deliberately below ISSA routine benchmarks to protect
the detailed owner-operated standard, obstacles and nonproductive time)
+ restroom fixtures × 3 min + breakroom 10 min; then mixed/carpet flooring
factor, condition and traffic factors, and a 1.35 first-clean factor.
Minimum job $125 (before church discount), commercial prices round UP to the
next $5 (never below the modelled amount), travel from the shared 55¢/mile wear
+ fuel model beyond 17.5 included one-way miles.

Tiers: A ≤ 3 labour hours (single price), B ≤ 8 hours (range ±15%), C larger,
specialty or >20 fixtures → scope review with no invented price.

Church: same workload with a blended church production rate and the
owner-directed 10% discount applied to the cleaning subtotal AFTER the minimum
rule, never stacked, travel/third-party excluded.

## Calibration (completed initial model, 2026-10-25)
`npm run commercial:calibration` now exercises **26 commercial** and **20 church**
hypothetical scenarios across offices, retail, salons, gyms, community
facilities, restroom-heavy plans, conditions, floors, frequencies, first cleans,
travel and specialty review. `npm run calibration:report` writes the committed
matrix (`docs/operations/FACILITY-CALIBRATION.md`) and full-field CSV
(`docs/verification/FACILITY-CALIBRATION-2026-10-25.csv`).

Results: ordinary Tier A/B jobs are numeric and positive after owner labour and
the 22% overhead allowance; Tier C/specialty jobs are deliberately custom
reviews; church rows reconcile the exact 10% discount to the cent. The model is
complete for initial operation. Monitoring actual job hours against estimates
continues as a quality check — it is not a prerequisite or an excuse to defer
the estimator.
