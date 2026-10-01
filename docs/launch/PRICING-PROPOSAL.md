# Pricing proposal — market research and recommended matrix

**Status:** proposal only — awaiting owner approval. No production rate has been changed.
`src/config/pricing.ts` still uses the original provisional model ($55 gross revenue per
labor-hour, $125 minimum, $5 rounding). Implementing any option below requires a follow-up code
change plus a re-run of the estimator tests.

**Prepared:** October 2026 (market data checked 2026-10-01). **Audience:** owner (Hayli).

## What this document decides

1. Whether the **recurring** (weekly / biweekly / monthly) gross rate should differ from the
   one-time / deep / move-out rate.
2. Whether the current provisional targets stay as-is or move toward the competitive range for
   faster customer acquisition, without dropping below the founder's $35/labor-hour pay floor.

## The founder's constraint (non-negotiable)

- Founder labor target: **≈$35 per labor-hour** for her own work.
- Plus business operating expenses and an economically reasonable margin.
- Labor-hour anchors stay real: a maintained 3/2 takes her **≈4.5–5.0 labor-hours**; a first clean
  of the same home **≈6**. This is the product — the detail standard — and it is roughly 1.5–2×
  the labor time a rushed production crew spends in the same home.

## Market research summary (checked 2026-10-01)

| Source | What it says |
| --- | --- |
| Care.com — Pensacola cost guide (Sep 2026) | Average starting rate **$18.92/hr**, max average **$24.67/hr** for independent cleaners; Cantonment $22.33–$26.17/hr; Gulf Breeze $23.31–$26.77/hr. Marketplace rates for solo independents. |
| Angi / HomeGuide / HomeAdvisor (2026, via CleanerHQ) | Company hourly rates **$25–$50 per cleaner per hour**; standard visits **$118–$238**, averaging **$176** for a 2,000 sq ft 3/2. |
| helloCleaners 2026 US index | Professional companies **$35–$75/hr per cleaner**; standard 3/2 visit **$150–$220**; deep clean **$250–$400**; move-out **$250–$600**. |
| Deep/move-out guides (2026) | Deep cleaning **$250–$450** typical; move-out 3-bedroom **$300–$500**; both run **1.25–2×** a standard visit. |
| Commercial cleaning quotes, Pensacola (2026) | General office **$0.09–$0.17 per sq ft/month**; hourly crews **$25–$75 per worker/hr**. Frequency changes the total more than any other variable. |
| STR turnover data (2026) | Per turnover: studio **$35–$60**, 2-bedroom **$55–$95** (+$15–$25 per extra bedroom); most 2-bedroom turnovers **$100–$150**; premium/hospitality-standard services **$150–$250**. Airbnb average cleaning fee for a 2-bedroom: **$141.60**. |
| Add-ons (national 2026) | Inside fridge or oven **$25–$60 each**; interior windows **$50–$150**. |

**Reading the local market honestly:** Pensacola-area independents charge roughly $19–$26/hr;
professional companies $25–$50 per cleaner per hour. Our model is deliberately at the premium end
because it funds a slower, more detailed standard and real overhead — but a 3/2 at ~4.9
labor-hours is priced at ~$250–270 at the current $55 rate, above the typical local company visit.

## Direct local benchmark — Refresh Cleaning LLC (public site, checked 2026-10-01)

The closest public local competitor (Cantonment; serves Pensacola + Baldwin County AL) publishes
starting prices on its website. Recorded here as **one benchmark, not the market**:

| Service | Published starting price | Notes |
| --- | --- | --- |
| Bi-weekly / basic cleaning | **$160** | "\*Prices based on 2000 sq ft and below. Free Quotes Available!" |
| Monthly cleaning | **$200** | same size basis |
| One-time / drop-in (incl. move-in/move-out) | **$300** | same size basis |
| Gift certificate | **$200** | purchased via Venmo / CashApp / PayPal |

Implications for this proposal:

- Their biweekly floor (**$160**) sits ~22% below our Option C ($196) and ~27% below Option B
  ($219) for a 3/2 — and roughly **38% below** the current $257 model. Their "starts at" pricing
  is a lighter-scope floor; our model prices ~4.7 labor-hours of detail work at the founder's
  $35/hr floor.
- Their one-time **$300** closely matches our **deep-clean** band ($336–370) and sits near our
  standard one-time ($246–270), suggesting the one-time/deep end of our model is competitive,
  while **recurring is the price-sensitive battleground**.
- The gift-certificate benchmark ($200 face value) is useful if the owner pursues Phase-7 gift
  certificates; it implies a face value around one deep clean or two recurring visits.

No price is published or changed by this document; it exists for owner decision-making only.

## Current model output (actual estimator engine, internal math)

Generated with `src/lib/estimate/` at the current provisional $55/labor-hour target (core ZIP,
no travel adjustment). These are the *expected* prices before the ±range spread.

| Scenario | Labor hrs | Expected price | Public range | Effective $/labor-hr |
| --- | --- | --- | --- | --- |
| 3/2 1600 maintained — one-time standard | 4.91 | $270 | $250–300 | $55 |
| 3/2 1600 maintained — weekly standard | 4.52 | $248 | $230–280 | $55 |
| 3/2 1600 maintained — biweekly standard | 4.66 | $257 | $235–285 | $55 |
| 3/2 1600 average — first clean (standard) | 5.56 | $306 | $280–345 | $55 |
| 3/2 1600 never-professional — biweekly reset | 5.60 | $308 | $285–345 | $55 |
| 3/2 1600 average — deep clean | 6.72 | $370 | $340–415 | $55 |
| 3/2 1600 average — move-in/move-out | 6.94 | $382 | $350–430 | $55 |
| 4/3 2400 average — deep clean | 8.40 | $462 | $425–520 | $55 |
| STR 2/2 1200, 2 beds — turnover | 3.59 | $197 | $180–220 | $55 |

**Position check**

- **Deep, move-out and first-clean prices are well positioned** for a premium local provider
  ($370 deep, $382 move-out sit mid-market for a detailed 3/2).
- **Recurring maintenance is the acquisition risk:** $248–257 per visit is above the $150–220
  typical local company range. Recurring is also the customer-lifetime-value engine.
- **STR at $197 per turnover** is above the $100–150 typical 2-bedroom range but inside the
  $150–250 premium/hospitality range; it includes linen reset and verification photos.

## Options (pick one — no change happens until you decide)

Prices below are expected values at each gross rate; public ranges spread ±~10%. The founder's
$35/hr is unchanged in every option.

| Scenario (labor hrs) | **A: keep $55 everywhere** | **B: recurring $47 / one-time $55** *(recommended)* | **C: acquisition $42 recurring / $50 one-time** |
| --- | --- | --- | --- |
| Weekly 3/2 (4.52) | $248 | **$212** | $190 |
| Biweekly 3/2 (4.66) | $257 | **$219** | $196 |
| Monthly 3/2 (≈4.81) | $265 | **$226** | $202 |
| One-time standard 3/2 (4.91) | $270 | $270 | $246 |
| First clean 3/2 (5.56) | $306 | $306 | $278 |
| Deep 3/2 (6.72) | $370 | $370 | $336 |
| Move-out 3/2 (6.94) | $382 | $382 | $347 |
| Deep 4/3 (8.40) | $462 | $462 | $420 |
| STR 2/2 (3.59) | $197 | $197 | $180 |

**What the business keeps above the founder's $35/hr (per labor-hour):**

| Option | Gross rate | Above founder pay | Comment |
| --- | --- | --- | --- |
| A | $55 | $20/hr | Strongest margin, slowest acquisition, premium positioning. |
| B | $47 recurring / $55 one-time | $12/hr recurring | Recurring stays sustainable while moving toward market. |
| C | $42 recurring / $50 one-time | $7/hr recurring | Only works with dense routes and lean overhead; highest acquisition pull, thinnest cushion. |

### Recommendation — Option B

- Recurring maintenance: **$47/labor-hour** — biweekly 3/2 lands at **≈$219** (range ≈$200–245),
  close enough to local company pricing to win the comparison without sacrificing the pay floor.
- One-time, deep, move-out: **keep $55** — these are project jobs where the detail standard sells
  itself and the local market supports it.
- STR turnover: **keep $55** (premium hospitality standard, linen reset, photo verification).
- Monthly (homes drift more between visits): **$50** or keep monthly as one-time pricing — owner
  preference.
- **Keep** the $125 minimum and $5 rounding.
- **No intro discounts** for now; the first clean is already priced as the detailed reset it is.

### Second recommendation — commercial and church

Keep commercial and church cleaning **custom-quoted after a walkthrough** (no instant price), with
internal planning anchored to the market bands above: general office $0.09–0.17/sq ft/month,
hourly crews $25–75/worker/hr. Frequency must be quoted together with the range.

## If Option B is approved — implementation notes (engineering)

1. `src/config/pricing.ts`: add a per-frequency gross-rate field (e.g. `recurringGrossRate` =
   `provisional(47, …)`) alongside `targetGrossRevenuePerLaborHour` (one-time remains $55), and a
   monthly rate if it differs.
2. `src/lib/estimate/calculate.ts`: choose the rate by frequency; keep the minimum, rounding and
   travel logic unchanged.
3. `tests/estimator.test.ts`: update the frequency expectations and add an anchor test that
   recurring jobs still clear the $35/labor-hour floor after overhead assumptions.
4. Re-run `npm run verify`, `npm test`, and regenerate printed QR/price material if any exists.
5. Documentation: update `docs/operations/ESTIMATOR-CALIBRATION.md` with the approved rates and the
   first-30-jobs recalibration plan.
6. No public price list is published — the estimator continues to show ranges only.

## Sources

- Care.com Pensacola house-cleaning cost guide (September 2026): care.com/cost/house-cleaning/pensacola-fl
- Care.com Pensacola cleaning marketplace listings (September 2026): care.com/house-cleaning/pensacola-fl
- CleanerHQ, "House Cleaning Pricing Guide 2026" (June 29, 2026), citing Angi/HomeAdvisor/HomeGuide
- helloCleaners, "House Cleaning Prices 2026: US Cost Index by City" (July 19, 2026)
- Kurlon move-out and deep-cleaning cost guides (July 23, 2026)
- CostGuideHQ, "Move-Out Cleaning Cost 2026" (July 2026)
- LeadDuo, "House Cleaning Prices in 2026" and "Move-Out Cleaning Prices 2026"
- CommercialCleaningQuotes, "Commercial Cleaning in Pensacola, FL" (2026)
- RentTools, "What to pay your short-term-rental cleaner" (May 7, 2026)
- Breasy, "Airbnb Cleaning Cost: 2026 Pricing Guide" (August 20, 2026)
- Ready Rental Cleaning, "Airbnb Cleaning Statistics (2026)" (July 10, 2026), citing AirDNA/Skift
