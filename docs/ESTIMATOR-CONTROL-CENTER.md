# ESTIMATOR CONTROL CENTER

The owner/operator manual for every setting that shapes a Sparkling Standard
estimate. It is written to be read on a phone as well as a desktop. No
calculator-function edits are required for the routine values listed here.

**Use this with:** [START HERE — OWNER CONTROL CENTER](../START-HERE-OWNER-CONTROL-CENTER.md)
and the [owner operations manual](OWNER-OPERATIONS-MANUAL.md).

> **Public repository warning.** Rates, assumptions and proposed promotions in
> these files are readable by anyone. Never put API keys, passwords, customer
> data or private operating coordinates in Git. Production secrets stay in
> Cloudflare.

## Where the estimator lives

| Layer | File | Who edits |
| --- | --- | --- |
| Raw owner values | `src/config/estimators/pricing-values.ts` | **Owner** |
| Input options and UI limits | `src/config/estimators/input-definitions.ts` | **Owner** for labels/options; engineer for new calculation values |
| Travel assumptions and policy | `src/config/estimators/travel.ts` | **Owner** with review |
| Commercial/church switch and tier triggers | `src/config/estimators/commercial.ts` | **Owner** for the switch; engineer for tier logic |
| Typed approval/notes wrapper | `src/config/pricing.ts` | Developer |
| ZIP → zone reference and approved area copy | `src/config/geography.ts` | Owner for approved copy; engineer for ZIP data |
| Date window and recurring first-visit policy | `src/config/scheduling.ts` | Owner policy change; keep client/server aligned |
| Service/frequency compatibility | `src/lib/estimate/service-matrix.ts` | Developer when the product offering changes |
| Calculation functions | `src/lib/estimate/` | Developer only |

`src/config/estimators/index.ts` is a re-export map, not a second source of
truth.

---

## A. Master variable directory

### A1. Global residential pricing

| Human name | Internal variable | Current value | Unit | Engines | Affects price? | File | Dependencies / safe range |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| Recurring labour rate | `hourlyRates.recurring` | 55 | USD per labour-hour | Residential | Yes | `pricing-values.ts` | Must stay above `ownerLaborTarget`; owner-approved Option C |
| Other-services labour rate | `hourlyRates.otherServices` | 55 | USD per labour-hour | Residential, STR | Yes | `pricing-values.ts` | Must stay above owner floor; normally equal to recurring |
| Founder labour target | `hourlyRates.ownerLaborTarget` | 35 | USD per labour-hour | All | Indirect | `pricing-values.ts` | Must stay below both rates; guard test |
| Minimum job | `minimumJob` | 125 | USD | All priced engines | Yes | `pricing-values.ts` | Do not set below cost; affects discount headroom |
| Global estimate factor | `globalEstimateFactor` | 1.00 | multiplier | All | Yes | `pricing-values.ts` | Supported 0.50–1.50; applies to service subtotal only, never travel/tax |
| Supportive Home enabled | `supportiveHomeDiscount.enabled` | true | boolean | Residential | Yes | `pricing-values.ts` | Owner-approved program; never auto-applied |
| Supportive Home percent | `supportiveHomeDiscount.percent` | 10 | percent | Residential | Yes | `pricing-values.ts` | Never stack; minimum-floor reconciliation |
| Supportive Home terms version | `supportiveHomeDiscount.termsVersion` | `2026-10-25.supportive10.v2` | text | Residential | No, provenance | `pricing-values.ts` | Bump if eligibility terms change |
| Supportive eligible services | `supportiveHomeDiscount.eligibleServices` | standard, deep, move_in_out | service list | Residential | Yes | `pricing-values.ts` | Never commercial/church/STR |
| Church discount enabled | `churchDiscount.enabled` | true | boolean | Church | Yes | `pricing-values.ts` | Owner-directed; never a donation/tithe |
| Church discount percent | `churchDiscount.percent` | 10 | percent | Church | Yes | `pricing-values.ts` | Never stacks; applied after minimum |
| Base labour: standard | `baseLaborHours.standard` | 2.0 | labour-hours | Residential | Yes | `pricing-values.ts` | Calibration anchor |
| Base labour: deep | `baseLaborHours.deep` | 3.2 | labour-hours | Residential | Yes | `pricing-values.ts` | Deep is one-time |
| Base labour: move-in/out | `baseLaborHours.move_in_out` | 3.4 | labour-hours | Residential | Yes | `pricing-values.ts` | One-time |
| Base labour: STR turnover | `baseLaborHours.str_turnover` | 1.2 | labour-hours | STR | Yes | `pricing-values.ts` | Per turnover |
| Square-foot labour | `laborUnits.sqftHoursPerThousand` | 1.1 | hours per 1,000 sqft | Residential | Yes | `pricing-values.ts` | Applied to property size |
| Full-bath labour | `laborUnits.fullBathHours` | 0.5 | hours per bath | Residential | Yes | `pricing-values.ts` | |
| Half-bath labour | `laborUnits.halfBathHours` | 0.25 | hours per bath | Residential | Yes | `pricing-values.ts` | |
| Extra bedroom labour | `laborUnits.bedroomHours` | 0.15 | hours per bedroom | Residential | Yes | `pricing-values.ts` | Bedrooms beyond the included count |
| Bedrooms included | `laborUnits.bedroomsIncludedInBase` | 2 | bedrooms | Residential | Yes | `pricing-values.ts` | Affects base/extra split |
| STR bath labour | `laborUnits.strBathHours` | 0.35 | hours per bath | STR | Yes | `pricing-values.ts` | |
| STR bed reset labour | `laborUnits.strBedHours` | 0.2 | hours per bed | STR | Yes | `pricing-values.ts` | |
| STR square-foot labour | `laborUnits.strSqftHoursPerThousand` | 0.8 | hours per 1,000 sqft | STR | Yes | `pricing-values.ts` | |
| Condition: maintained | `conditionFactors.maintained` | 1.00 | multiplier | Residential, facility | Yes | `pricing-values.ts` | Must be ≥1; ordered guard test |
| Condition: average | `conditionFactors.average` | 1.10 | multiplier | Residential, facility | Yes | `pricing-values.ts` | |
| Condition: needs attention | `conditionFactors.needs_attention` | 1.25 | multiplier | Residential, facility | Yes | `pricing-values.ts` | |
| Condition: heavy | `conditionFactors.heavy` | 1.45 | multiplier | Residential, facility | Yes | `pricing-values.ts` | |
| Condition: severe | `conditionFactors.severe` | 2.00 | multiplier | Residential | Triggers review | `pricing-values.ts` | Severe routes to custom confirmation |
| Last clean: within month | `lastCleanFactors.within_month` | 1.00 | multiplier | Residential | Yes | `pricing-values.ts` | |
| Last clean: 1–3 months | `lastCleanFactors.one_to_three_months` | 1.03 | multiplier | Residential | Yes | `pricing-values.ts` | |
| Last clean: 3–12 months | `lastCleanFactors.three_to_twelve_months` | 1.08 | multiplier | Residential | Yes | `pricing-values.ts` | |
| Last clean: over a year | `lastCleanFactors.over_a_year` | 1.15 | multiplier | Residential | Yes | `pricing-values.ts` | |
| Last clean: never | `lastCleanFactors.never_professional` | 1.20 | multiplier | Residential | Yes | `pricing-values.ts` | First-professional-clean anchor |
| Last clean: not sure | `lastCleanFactors.not_sure` | 1.05 | multiplier | Residential | Yes | `pricing-values.ts` | Flagged for review |
| Frequency: weekly | `frequencyFactors.weekly` | 0.92 | multiplier | Residential | Yes | `pricing-values.ts` | Labour efficiency, not a marketing discount |
| Frequency: biweekly | `frequencyFactors.biweekly` | 0.95 | multiplier | Residential | Yes | `pricing-values.ts` | |
| Frequency: monthly | `frequencyFactors.monthly` | 0.98 | multiplier | Residential | Yes | `pricing-values.ts` | |
| Frequency: one-time | `frequencyFactors.one_time` | 1.00 | multiplier | Residential | Yes | `pricing-values.ts` | Baseline |
| Estimate range low | `range.lowFactor` | 0.92 | multiplier | Residential, STR | Display only | `pricing-values.ts` | Must bracket 1 |
| Estimate range high | `range.highFactor` | 1.12 | multiplier | Residential, STR | Display only | `pricing-values.ts` | Must bracket 1 |
| Rounding step | `rounding.roundToNearest` | 5 | USD | All | Yes | `pricing-values.ts` | Prices round DOWN |

### A2. Offer/verification policy (typed wrapper)

| Setting | Current value | File | Notes |
| --- | --- | --- | --- |
| Proposed-price experience | `enabled: true` | `src/config/pricing.ts` | A request, never a booking |
| Binding offers | `false` | `src/config/pricing.ts` | Do not enable without verification + owner approval |
| Quote configuration version | `2026-10-25.global-factor-supportive-tax.v1` | `src/config/pricing.ts` | Bump when an effective price rule changes |
| Offered-price selection | `expected` | `src/config/pricing.ts` | Never the low end |
| Margin floor | 1.0 | `src/config/pricing.ts` | Discards candidates below expected |
| Verification validity | 336 hours | `src/config/pricing.ts` | Owner notification only; not a customer hold |
| Cancellation notice | 24 hours / 0% | `src/config/pricing.ts` | Owner-approved |
| Satisfaction reporting | 24 hours | `src/config/pricing.ts` | Corrective cleaning for verified missed scope |

### A3. Add-ons

All add-ons are labour-based unless `fixedPriceUsd` is set. Specialty items
must stay `customQuote: true` with no labour or fixed price.

| Add-on | Internal id | Charge basis | Labour-hours | Specialty? |
| --- | --- | --- | ---: | --- |
| Inside refrigerator | `inside_fridge` | labour | 0.50 | No |
| Inside oven | `inside_oven` | labour | 0.60 | No |
| Inside cabinets | `inside_cabinets` | labour | 0.80 | No |
| Interior windows | `interior_windows` | labour | 0.60 | No |
| Ground-floor exterior windows | `exterior_windows_ground` | labour | 0.80 | No |
| Laundry | `laundry` | labour | 0.70 | No |
| Dishes | `dishes` | labour | 0.40 | No |
| Bed linen change | `bed_linen_change` | labour | 0.40 | No |
| General organization | `organization_general` | labour | 0.80 | No |
| Pantry organization | `pantry_organization` | labour | 0.60 | No |
| Closet organization | `closet_organization` | labour | 0.60 | No |
| Pet-hair intensive | `pet_hair_intensive` | labour | 0.70 | No |
| Detailed wall spot-cleaning | `detailed_walls` | labour | 0.80 | No |
| Detailed baseboards | `detailed_baseboards` | labour | 0.70 | No |
| Carpet cleaning | `carpet_cleaning` | custom quote | — | Yes |
| Upholstery cleaning | `upholstery_cleaning` | custom quote | — | Yes |
| Pressure washing | `pressure_washing` | custom quote | — | Yes |
| Garage cleaning | `garage_cleaning` | custom quote | — | Yes |
| Patio / porch cleaning | `patio_cleaning` | custom quote | — | Yes |

Add-on labels and descriptions are in the same records. `fixedPriceUsd`
replaces the charge only; labour still counts toward scheduled time.

### A4. Commercial and church workload pricing

| Human name | Internal variable | Current value | Unit | Affects | File |
| --- | --- | ---: | --- | --- | --- |
| Facility gross rate | `commercialPricing.grossRatePerHour` | 60 | USD per labour-hour | Commercial, church | `pricing-values.ts` |
| Office production | `productionSqftPerHour.office` | 3,000 | sqft per hour | Commercial | `pricing-values.ts` |
| Retail production | `productionSqftPerHour.retail` | 3,200 | sqft per hour | Commercial | `pricing-values.ts` |
| Salon production | `productionSqftPerHour.salon` | 2,800 | sqft per hour | Commercial | `pricing-values.ts` |
| Gym production | `productionSqftPerHour.gym` | 2,500 | sqft per hour | Commercial | `pricing-values.ts` |
| Community production | `productionSqftPerHour.community` | 3,000 | sqft per hour | Commercial | `pricing-values.ts` |
| Church production | `productionSqftPerHour.church` | 2,800 | sqft per hour | Church | `pricing-values.ts` |
| Fixture minutes | `commercialPricing.fixtureMinutes` | 3 | minutes per fixture | Both | `pricing-values.ts` |
| Breakroom minutes | `commercialPricing.breakroomMinutes` | 10 | minutes per breakroom | Both | `pricing-values.ts` |
| Setup minutes | `commercialPricing.setupMinutes` | 20 | minutes fixed | Both | `pricing-values.ts` |
| First-clean factor | `commercialPricing.firstCleanFactor` | 1.35 | multiplier | Both | `pricing-values.ts` |
| Preliminary range spread | `commercialPricing.rangeSpreadPercent` | 15 | ± percent | Tier B | `pricing-values.ts` |
| Tier A threshold | `commercialPricing.tierAHours` | 3 | workload hours | Both | `pricing-values.ts` |
| Tier B threshold | `commercialPricing.tierBHours` | 8 | workload hours | Both | `pricing-values.ts` |
| Numeric estimates enabled | `commercialTierConfig.numericEstimatesEnabled` | true | boolean | Both | `estimators/commercial.ts` |
| Restroom Tier C trigger | `tierC_triggers.restroomsOver` | 4 | count | Legacy tier reference | `estimators/commercial.ts` |
| Overhead allowance | `commercialPricing.overheadRatePercent` | 22% | service revenue | Commercial, church | `estimators/pricing-values.ts` |
| Specialty Tier C trigger | `tierC_triggers.specialtyServices` | six values | list | Both | `estimators/commercial.ts` |

The three threshold categories are **hour-based**: Tier A ≤3 hours, Tier B >3
and ≤8, Tier C >8 or specialty/high-fixture. The square-foot tier constants in
`commercial.ts` are legacy reference only.

### A5. Promotions and discounts

All prepared programs except SPARKLE100 are disabled. The engine applies at
most one promotion; travel is never discounted.

| Program | State | Terms | File |
| --- | --- | --- | --- |
| Add-on incentive | Disabled | 5% at 2 add-ons, 8% at 3+, cap $75 | `pricing-values.ts` |
| Response guarantee | Disabled | 1 business hour, 25%, cap $50 | `pricing-values.ts` |
| Appreciation discounts | Disabled | No approved terms | `pricing-values.ts` |
| Add-on bundles | Disabled | No approved values | `pricing-values.ts` |
| Founding-10 | Disabled | No mechanism selected | `pricing-values.ts` |
| SPARKLE100 | **Enabled** | $100 off first clean; new weekly/biweekly recurring; claim required; no expiry | `pricing-values.ts` |

Do not enable or publish a disabled program without written owner terms, the
financial review, and a configuration-version bump where the effective price
changes.

### A6. Customer input definitions and limits

| Input | Options / limit | File |
| --- | --- | --- |
| Residential services | residential, deep, move-in/out, STR turnover | `input-definitions.ts` |
| Property types | house, apartment, condo, townhome, other | `input-definitions.ts` |
| Square footage | 200–20,000, step 50 | `input-definitions.ts` |
| Bedrooms | 0–12 | `input-definitions.ts` |
| Full baths | 0–12 | `input-definitions.ts` |
| Half baths | 0–12 | `input-definitions.ts` |
| Rental properties | 1–50 | `input-definitions.ts` |
| Beds to reset | 1–30 | `input-definitions.ts` |
| Cleaning frequency | weekly, biweekly, monthly, one-time (residential only) | `input-definitions.ts` |
| Turnover rhythm | per stay, weekly, biweekly, occasional, seasonal | `input-definitions.ts` |
| Linen preference | host provides, on-site laundry, off-site laundry, not sure | `input-definitions.ts` |
| Condition | maintained, average, needs attention, heavy, severe | `input-definitions.ts` |
| Last professional clean | six options | `input-definitions.ts` |
| Pets | none, one, multiple/heavy shedding | `input-definitions.ts` |
| Arrival preference | first appointment, morning, afternoon, flexible | `input-definitions.ts` |
| Commercial facility type | eight options | `input-definitions.ts` |
| Facility condition | four options | `input-definitions.ts` |
| Facility frequency | daily → not sure | `input-definitions.ts` |
| Flooring | mixed, carpet, hard | `input-definitions.ts` |
| First clean | yes/no | `input-definitions.ts` |
| Breakroom/kitchen | none, small, full | `input-definitions.ts` |
| Traffic | ordinary, light, high | `input-definitions.ts` |
| Specialty need | five options | `input-definitions.ts` |
| Service window | early morning, daytime, evening, after hours, flexible | `input-definitions.ts` |
| Church partnership | five optional, never preselected | `input-definitions.ts` |
| Sanctuary seats | 0–5,000 | `input-definitions.ts` |
| Restroom fixtures | 0–60 | `input-definitions.ts` |
| Classrooms | 0–60 | `input-definitions.ts` |
| Workstations | 0–500 | `input-definitions.ts` |

The actual question wording and help text live in the two form components:
`src/components/EstimateWizard.astro` and
`src/components/FacilityEstimateForm.astro`. Change labels there only when the
meaning is unchanged; changing a value or adding a new option also requires
checking the calculation and server validation.

### A7. Travel and service area

| Setting | Current | File |
| --- | ---: | --- |
| Vehicle MPG | 24 | `estimators/travel.ts` |
| Wear per mile | $0.12 | `estimators/travel.ts` |
| Included one-way miles | 17.5 (35-mile round trip) | `estimators/travel.ts` |
| Fallback gasoline price | $3.10/gal | `estimators/travel.ts` |
| Route cache | 21,600 seconds | `estimators/travel.ts` |
| Ordinary driving boundary | 60 minutes | `estimators/travel.ts` |
| Review band | 15 additional minutes | `estimators/travel.ts` |
| Hard distance cap without duration | 45 miles | `estimators/travel.ts` |
| Zone policy | core/surrounding instant; extended/outside/unknown manual | `geography.ts` |
| ZIP reference table | Pensacola, Cantonment, surrounding FL, select AL | `geography.ts` |

The private origin and provider keys are **not** in these files. They are
Cloudflare secrets.

### A8. Scheduling and product rules

| Setting | Current | File |
| --- | ---: | --- |
| Advance reservation window | 60 days | `scheduling.ts` |
| Required initial Deep Cleaning for new recurring residential | true | `scheduling.ts` |
| Service/frequency matrix | standard has rhythms; deep/move/STR one-time | `service-matrix.ts` |
| Tax rates | none configured | `src/lib/estimate/tax.ts` |
| Tax treatment | residential/STR non-taxable; commercial taxable pending; church exemption pending | `tax.ts` |

Tax is never invented: the site shows “+ applicable tax” and the final quote
confirms the amount for the address. Do not add a rate without the owner’s
confirmed tax setup.

---

## B. Pricing configuration guide

### Change the hourly rate

1. Open `src/config/estimators/pricing-values.ts`.
2. Find `hourlyRates` under section 1.
3. Change `recurring` and/or `otherServices`. Keep `ownerLaborTarget` below both.
4. Commit. Run `npm test` and `npm run estimate:quotes`.
5. If the effective price changes, bump `instantQuote.configVersion` in
   `src/config/pricing.ts` so old quotes are not reused.
6. After deployment, verify a representative estimate.

### Change the minimum, rounding or global factor

Edit `minimumJob`, `rounding.roundToNearest`, or
`globalEstimateFactor`. These affect every engine (the global factor applies to
service subtotal only). Always run the full unit and browser suites.

### Change a discount

Edit the relevant block in `pricing-values.ts`. Never set a discount live
without written terms. The engine allows at most one discount; travel and tax
are excluded. Reconcile church/supportive discounts exactly in tests.

### Change commercial/church behaviour

Use `commercialPricing` for labour economics and `estimators/commercial.ts` for
the numeric-price kill switch/triggers. Tier A/B numbers are preliminary; Tier C
must never invent a price.

### Change travel

Edit `estimators/travel.ts`; `src/config/pricing.ts` and
`functions/api/travel.ts` consume the same module. Do not duplicate the values.
The private origin is a Cloudflare secret.

### Add or change an add-on

Add a record to `addons` with a unique snake_case id, label, blurb, labourHours
(and optional positive fixedPriceUsd) or `customQuote: true`. Do not give a
specialty add-on a price. Check `tests/config.test.ts` and the estimate quote
preview.

---

## C. Input configuration guide

### Add or remove a dropdown option

1. Edit the relevant array in `src/config/estimators/input-definitions.ts`.
2. If the calculator understands the value (for example, an existing facility
   type or condition), no calculation change is needed.
3. If it is a new business rule, the calculation, server verification and
   tests need engineering review.
4. Run `npm run check` and `npm test`.

### Change wording or a default

- Option label/description: `input-definitions.ts`.
- Question/help text around a control: the matching form component.
- Default value: set `selected`/`value` in the form component or the default in
  the input definition.

### Change an allowed range

Edit `RESIDENTIAL_INPUT_LIMITS` or `FACILITY_INPUT_LIMITS`. The HTML attributes
are driven from these values. The server still performs its own validation;
changing only the browser attribute is not sufficient for a new business rule.

### Conditional inputs

The service/frequency compatibility matrix is in
`src/lib/estimate/service-matrix.ts`. Adding a new service or rhythm is a
product change: update the matrix, form, calculation, server verification and
tests together.

---

## D. Worked examples

### Example 1 — raise the recurring labour rate from $55 to $58

- Edit `hourlyRates.recurring` in `pricing-values.ts` to `58`.
- Bump `instantQuote.configVersion` in `pricing.ts`.
- Run `npm test`, `npm run estimate:quotes`, `npm run check`.
- Commit and push. Verify a weekly/biweekly estimate and the owner notification.

### Example 2 — change the included one-way travel from 17.5 to 20 miles

- Edit `includedOneWayMiles: 20` in `estimators/travel.ts`.
- Update the explanatory wording in the owner documentation and any customer
  copy that states the assumption.
- Run `npm test` and check a surrounding-area estimate.

### Example 3 — add a commercial dropdown label that maps to an existing rate

- Add `{ value: 'medical-office', label: 'Medical office' }` to
  `COMMERCIAL_FACILITY_TYPES`.
- If `commercial.ts` does not recognise the value, add it to the explicit
  mapping that selects the production rate; otherwise the calculator uses its
  safe default.
- Run the facility tests and a commercial estimate.

### Example 4 — change the church invitation wording

- Edit `CHURCH_PARTNERSHIP_OPTIONS` in `input-definitions.ts`.
- Keep the five values stable unless the request payload is intentionally
  changed. Check the owner notification still labels the responses.

### Example 5 — temporarily retract numeric facility pricing

- Open `estimators/commercial.ts` and set `numericEstimatesEnabled: false`.
- The browser and server both remove every numeric facility price.
- Run `npm test` and check Commercial/Church on mobile and desktop.

---

## E. Safety rules

**Safe to change independently (then run tests):** labels, help text, option
descriptions, add-on labels, non-price copy, approved public area wording.

**Requires reconciliation:** hourly rates, minimum, global factor, labour
hours, production rates, condition/frequency/last-clean factors, range,
rounding, discounts, add-on hours, travel assumptions, tier thresholds,
scheduling window, service/frequency matrix, tax treatment.

**Never change casually:** `instantQuote.binding` (must stay false), the server
verification logic, the owner kill switch enforcement, R2/Resend code, or
anything in `functions/api/`. These are security/operational boundaries.

**Always verify after a price change:**

1. `npm run check`
2. `npm test`
3. `npm run estimate:quotes`
4. `npm run test:browser`
5. `npm run verify`
6. A real desktop and mobile estimate, plus the owner notification.

**Do not publish** a provisional/internal rate or a disabled promotion as a
public promise. Prices are proposals until the owner confirms them.
