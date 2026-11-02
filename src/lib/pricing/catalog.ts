// Owner-editable pricing catalog.
//
// This is the single allow-list of pricing values the Pricing & Estimator
// Control tab may change. Paths are resolved against a pricing snapshot
// ({ owner, travel }) — never executed as code. Structural rules (how hours,
// discounts and rounding are applied) remain developer-owned and are listed in
// the documentation, not exposed as editable formulas.

import { ownerPricing } from '../../config/estimators/pricing-values.ts';

export type PricingEngine = 'residential' | 'str' | 'commercial' | 'church' | 'shared';

export interface PricingCatalogEntry {
  /** Dot path inside the snapshot, e.g. `owner.hourlyRates.recurring`. */
  path: string;
  label: string;
  description: string;
  unit: string;
  kind: 'number' | 'boolean';
  min?: number;
  max?: number;
  step?: number;
  /** True when the field may be blank (stored as null). */
  allowNull?: boolean;
  engines: PricingEngine[];
  category: string;
  impact: string;
  example: string;
}

function num(
  path: string,
  label: string,
  description: string,
  unit: string,
  engines: PricingEngine[],
  category: string,
  impact: string,
  example: string,
  bounds: { min?: number; max?: number; step?: number; allowNull?: boolean } = {},
): PricingCatalogEntry {
  return { path, label, description, unit, kind: 'number', engines, category, impact, example, ...bounds };
}

function bool(
  path: string,
  label: string,
  description: string,
  engines: PricingEngine[],
  category: string,
  impact: string,
  example: string,
): PricingCatalogEntry {
  return { path, label, description, unit: 'on/off', kind: 'boolean', engines, category, impact, example };
}

const ALL: PricingEngine[] = ['residential', 'str', 'commercial', 'church'];
const RESIDENTIAL: PricingEngine[] = ['residential', 'str'];
const FACILITY: PricingEngine[] = ['commercial', 'church'];
const RESIDENTIAL_ONLY: PricingEngine[] = ['residential'];

export const pricingCatalog: PricingCatalogEntry[] = [
  // ── Rates and minimums ───────────────────────────────────────────────────
  num('owner.hourlyRates.recurring', 'Recurring labor-hour rate', 'Internal gross revenue used for weekly, biweekly and monthly maintenance visits.', 'USD / labor-hour', ['residential'], 'Rates & minimums', 'Every recurring maintenance price moves with this rate. The first required Deep Cleaning uses the non-recurring rate.', 'Raising this from $55 to $60 increases the ongoing per-visit price for a recurring clean by about 9%.', { min: 0, max: 500, step: 0.01 }),
  num('owner.hourlyRates.otherServices', 'One-time labor-hour rate', 'Internal gross revenue used for one-time, deep, move-in/move-out and commercial/church cleaning.', 'USD / labor-hour', ALL, 'Rates & minimums', 'Drives the first-visit Deep Cleaning price and every facility labor-hour. Never shown to customers.', 'At $55, 5 labor-hours is $275 before extras and travel.', { min: 0, max: 500, step: 0.01 }),
  num('owner.hourlyRates.ownerLaborTarget', 'Owner labor target', 'Internal owner-compensation floor used to judge whether a price is economically rational. It does not directly price a customer quote.', 'USD / labor-hour', ALL, 'Rates & minimums', 'Does not change the calculated customer price; it is a business-health reference.', 'A $35 target means the $55 billing rate leaves $20 per labor-hour for overhead and profit.', { min: 0, max: 500, step: 0.01 }),
  num('owner.minimumJob', 'Minimum job value', 'The lowest cleaning subtotal the estimator will present, before travel and tax.', 'USD', ALL, 'Rates & minimums', 'Small jobs are raised to this value. Larger discounts and calibration can still reduce the final total.', 'A small job modeled at $90 is presented at the $125 minimum.', { min: 0, max: 5000, step: 1 }),

  // ── Residential adjustments ───────────────────────────────────────────────
  num('owner.residentialExtras.priceFactor', 'Residential extras multiplier', 'Applied exactly once to each residential optional-extra charge. STR, commercial and church extras are unaffected.', 'multiplier', RESIDENTIAL_ONLY, 'Residential pricing', '0.85 means residential extras are 15% lower. Bundles calculate from the reduced extras subtotal.', 'A $30 fridge add-on becomes $25.50 at 0.85.', { min: 0.1, max: 2, step: 0.01 }),
  num('owner.estimatorCalibration.residential', 'Residential calibration', 'Owner calibration applied to the discounted residential service subtotal, after the minimum and before travel and tax.', 'multiplier', RESIDENTIAL_ONLY, 'Residential pricing', '1.00 leaves prices unchanged; 1.10 raises eligible service prices by 10%. Travel and tax are untouched.', 'A $300 service subtotal at 1.05 becomes $315 before travel and tax.', { min: 0.5, max: 1.5, step: 0.01 }),
  num('owner.estimatorCalibration.str', 'STR / turnover calibration', 'Owner calibration applied to the STR turnover service subtotal.', 'multiplier', ['str'], 'STR pricing', 'Independent from residential. Travel and tax are untouched.', 'A $280 turnover subtotal at 0.95 becomes $266.', { min: 0.5, max: 1.5, step: 0.01 }),

  // ── Labor model ───────────────────────────────────────────────────────────
  num('owner.baseLaborHours.standard', 'Standard clean base hours', 'Labor-hours already included before size, bathrooms and bedrooms are added.', 'labor-hours', RESIDENTIAL_ONLY, 'Labor model', 'Raising this adds the same time to every standard residential estimate.', 'A 1,600 sqft home prices from this base plus square footage and room time.', { min: 0, max: 24, step: 0.01 }),
  num('owner.baseLaborHours.deep', 'Deep clean base hours', 'Base labor-hours for a deep cleaning, including trim/baseboard detail time.', 'labor-hours', ['residential', 'str'], 'Labor model', 'Also sets the required first-visit price for a new recurring arrangement.', 'Every new weekly customer receives a deep first visit priced from this base.', { min: 0, max: 24, step: 0.01 }),
  num('owner.baseLaborHours.move_in_out', 'Move-in/move-out base hours', 'Base labor-hours for an empty or nearly empty home with inside-cabinet and appliance attention.', 'labor-hours', ['residential'], 'Labor model', 'Changes move-in/move-out estimates only.', 'A 2/2 move-out starts from this base plus square footage and rooms.', { min: 0, max: 24, step: 0.01 }),
  num('owner.baseLaborHours.str_turnover', 'STR turnover base hours', 'Base labor-hours for a short-term-rental reset before size, baths and beds.', 'labor-hours', ['str'], 'Labor model', 'Changes every STR turnover estimate.', 'A 2/2 rental with two beds adds the turnover base, square footage, baths and beds.', { min: 0, max: 24, step: 0.01 }),
  num('owner.laborUnits.sqftHoursPerThousand', 'Residential hours per 1,000 sq ft', 'Additional labor-hours for each 1,000 square feet of residential home.', 'labor-hours / 1,000 sq ft', RESIDENTIAL_ONLY, 'Labor model', 'Square footage is the strongest size driver in residential pricing.', 'A 2,000 sqft home adds twice this value over a 1,000 sqft home.', { min: 0, max: 10, step: 0.01 }),
  num('owner.laborUnits.fullBathHours', 'Hours per full bathroom', 'Additional labor-hours per full bathroom.', 'labor-hours / bath', RESIDENTIAL_ONLY, 'Labor model', 'Bathrooms are the most labor-dense rooms.', 'Three full baths add three times this value.', { min: 0, max: 10, step: 0.01 }),
  num('owner.laborUnits.halfBathHours', 'Hours per half bathroom', 'Additional labor-hours per half bathroom.', 'labor-hours / bath', RESIDENTIAL_ONLY, 'Labor model', 'Normally about half the full-bath value.', 'A powder room adds one half-bath unit.', { min: 0, max: 10, step: 0.01 }),
  num('owner.laborUnits.bedroomHours', 'Hours per extra bedroom', 'Labor-hours per bedroom beyond the included bedroom count.', 'labor-hours / bedroom', RESIDENTIAL_ONLY, 'Labor model', 'Bedroom count matters less than square footage by design.', 'A five-bedroom home adds three extra-bedroom units when two are included.', { min: 0, max: 10, step: 0.01 }),
  num('owner.laborUnits.bedroomsIncludedInBase', 'Bedrooms included in base', 'How many bedrooms are already inside every base service time.', 'bedrooms', RESIDENTIAL_ONLY, 'Labor model', 'Raising this removes bedroom time from larger homes.', 'At 2, a four-bedroom home is charged for two extra bedrooms.', { min: 0, max: 12, step: 1 }),
  num('owner.laborUnits.strBathHours', 'STR hours per full bath', 'STR turnover labor-hours per full bathroom reset.', 'labor-hours / bath', ['str'], 'Labor model', 'Changes STR turnover estimates only.', 'A 2.5-bath rental adds 2.5 times this value.', { min: 0, max: 10, step: 0.01 }),
  num('owner.laborUnits.strBedHours', 'STR hours per bed', 'STR turnover labor-hours per bed reset (linens and presentation).', 'labor-hours / bed', ['str'], 'Labor model', 'Changes STR turnover estimates only.', 'A four-bed rental adds four times this value.', { min: 0, max: 10, step: 0.01 }),
  num('owner.laborUnits.strSqftHoursPerThousand', 'STR hours per 1,000 sq ft', 'STR turnover labor-hours per 1,000 square feet.', 'labor-hours / 1,000 sq ft', ['str'], 'Labor model', 'Turnover is a reset, so this is normally lower than the residential rate.', 'A 2,000 sqft rental adds twice this value.', { min: 0, max: 10, step: 0.01 }),

  // ── Condition, history and frequency ─────────────────────────────────────
  num('owner.conditionFactors.maintained', 'Maintained condition', 'Multiplier applied to labor when the home is recently and regularly cleaned.', 'multiplier', ALL, 'Condition & frequency', 'A higher multiplier raises every estimate for that condition.', '1.00 leaves maintained homes unchanged.', { min: 0.1, max: 5, step: 0.01 }),
  num('owner.conditionFactors.average', 'Average condition', 'Multiplier for a lived-in home with normal buildup.', 'multiplier', ALL, 'Condition & frequency', 'Directly changes the calculated labor-hours for this answer.', '1.10 adds 10% to modeled labor.', { min: 0.1, max: 5, step: 0.01 }),
  num('owner.conditionFactors.needs_attention', 'Needs attention condition', 'Multiplier for a noticeably overdue home.', 'multiplier', ALL, 'Condition & frequency', 'Directly changes calculated labor-hours.', '1.25 adds 25% to modeled labor.', { min: 0.1, max: 5, step: 0.01 }),
  num('owner.conditionFactors.heavy', 'Heavy buildup condition', 'Multiplier for heavy buildup needing detail work in multiple areas.', 'multiplier', ALL, 'Condition & frequency', 'Directly changes calculated labor-hours.', '1.45 adds 45% to modeled labor.', { min: 0.1, max: 5, step: 0.01 }),
  num('owner.conditionFactors.severe', 'Severe condition', 'Multiplier for severe condition. Severe jobs still require personal review and never show an instant price.', 'multiplier', ALL, 'Condition & frequency', 'The severe answer always routes to custom confirmation; this value does not publish a price.', '2.00 would double modeled labor if the job were instantly priced.', { min: 0.1, max: 5, step: 0.01 }),
  num('owner.lastCleanFactors.within_month', 'Last clean: within a month', 'Labor multiplier when the home was professionally cleaned within the last month.', 'multiplier', RESIDENTIAL, 'Condition & frequency', 'Changes first-visit pricing for this answer.', '1.00 leaves the estimate unchanged.', { min: 0.5, max: 3, step: 0.01 }),
  num('owner.lastCleanFactors.one_to_three_months', 'Last clean: 1–3 months', 'Labor multiplier for a one-to-three-month gap.', 'multiplier', RESIDENTIAL, 'Condition & frequency', 'Changes first-visit pricing for this answer.', '1.03 adds 3%.', { min: 0.5, max: 3, step: 0.01 }),
  num('owner.lastCleanFactors.three_to_twelve_months', 'Last clean: 3–12 months', 'Labor multiplier for a three-to-twelve-month gap.', 'multiplier', RESIDENTIAL, 'Condition & frequency', 'Changes first-visit pricing for this answer.', '1.08 adds 8%.', { min: 0.5, max: 3, step: 0.01 }),
  num('owner.lastCleanFactors.over_a_year', 'Last clean: over a year', 'Labor multiplier when the home has not had professional cleaning in over a year.', 'multiplier', RESIDENTIAL, 'Condition & frequency', 'Changes first-visit pricing and can trigger a reset recommendation.', '1.15 adds 15%.', { min: 0.5, max: 3, step: 0.01 }),
  num('owner.lastCleanFactors.never_professional', 'Last clean: never professional', 'Labor multiplier for a home that has never had professional cleaning.', 'multiplier', RESIDENTIAL, 'Condition & frequency', 'Changes first-visit pricing for this answer.', '1.20 adds 20%.', { min: 0.5, max: 3, step: 0.01 }),
  num('owner.lastCleanFactors.not_sure', 'Last clean: not sure', 'Conservative multiplier used when the customer is unsure.', 'multiplier', RESIDENTIAL, 'Condition & frequency', 'Changes the estimate and records a review flag.', '1.05 adds 5% until the owner confirms the history.', { min: 0.5, max: 3, step: 0.01 }),
  num('owner.frequencyFactors.weekly', 'Weekly frequency factor', 'Labor-efficiency multiplier for weekly maintenance. This is not a marketing discount.', 'multiplier', RESIDENTIAL, 'Condition & frequency', 'Changes the ongoing per-visit price for weekly service.', '0.92 reduces modeled labor by 8%.', { min: 0.5, max: 1.5, step: 0.01 }),
  num('owner.frequencyFactors.biweekly', 'Biweekly frequency factor', 'Labor-efficiency multiplier for every-other-week maintenance.', 'multiplier', RESIDENTIAL, 'Condition & frequency', 'Changes the ongoing per-visit price for biweekly service.', '0.95 reduces modeled labor by 5%.', { min: 0.5, max: 1.5, step: 0.01 }),
  num('owner.frequencyFactors.monthly', 'Monthly frequency factor', 'Labor-efficiency multiplier for monthly maintenance.', 'multiplier', RESIDENTIAL, 'Condition & frequency', 'Changes the ongoing per-visit price for monthly service.', '0.98 reduces modeled labor by 2%.', { min: 0.5, max: 1.5, step: 0.01 }),
  num('owner.frequencyFactors.one_time', 'One-time frequency factor', 'Baseline multiplier for one-time service. Normally 1.00.', 'multiplier', RESIDENTIAL, 'Condition & frequency', 'Changes one-time estimates.', '1.00 leaves one-time labor unchanged.', { min: 0.5, max: 1.5, step: 0.01 }),

  // ── Presentation rounding ─────────────────────────────────────────────────
  num('owner.range.lowFactor', 'Estimate range low factor', 'Multiplier used for the low end of the presented estimate range.', 'multiplier', ALL, 'Presentation', 'Changes the displayed low estimate, not the single offered price.', '0.92 shows a low end 8% below the model price.', { min: 0.5, max: 1.5, step: 0.01 }),
  num('owner.range.highFactor', 'Estimate range high factor', 'Multiplier used for the high end of the presented estimate range.', 'multiplier', ALL, 'Presentation', 'Changes the displayed high estimate, not the single offered price.', '1.12 shows a high end 12% above the model price.', { min: 0.8, max: 2, step: 0.01 }),
  num('owner.rounding.roundToNearest', 'Price rounding step', 'Final presented prices round DOWN to this increment.', 'USD', ALL, 'Presentation', 'Changes only the final rounding adjustment.', 'At $5, a $248.45 total becomes $245.', { min: 1, max: 100, step: 1 }),

  // ── Discounts and campaigns ───────────────────────────────────────────────
  bool('owner.supportiveHomeDiscount.enabled', 'Community Support discount on', 'Enables the self-attested Community Support eligibility discount.', ['residential'], 'Discounts & campaigns', 'When off, eligible customers receive no Community Support discount.', 'Turn off to pause the program without deleting its terms.'),
  num('owner.supportiveHomeDiscount.percent', 'Community Support discount', 'Percentage off eligible residential cleaning for Community Support customers. Public Terms and marketing copy are separate; review them before changing this value.', 'percent', ['residential'], 'Discounts & campaigns', 'Applies after the minimum rule to the cleaning subtotal; never travel or tax.', '10 means 10% off eligible residential service.', { min: 0, max: 100, step: 0.01 }),
  bool('owner.churchDiscount.enabled', 'Church discount on', 'Enables the owner-directed church cleaning discount.', ['church'], 'Discounts & campaigns', 'When off, church estimates show no discount.', 'Turn off only on a later owner decision.'),
  num('owner.churchDiscount.percent', 'Church discount', 'Percentage off the eligible church cleaning subtotal after the minimum rule. Public Terms and marketing copy are separate; review them before changing this value.', 'percent', ['church'], 'Discounts & campaigns', 'Never applies to travel or third-party costs and never stacks.', '10 means 10% off eligible church cleaning.', { min: 0, max: 100, step: 0.01 }),
  num('owner.estimatorCalibration.commercial', 'Commercial calibration', 'Owner calibration applied to the commercial service subtotal.', 'multiplier', ['commercial'], 'Facility pricing', 'Independent from church. Travel is untouched.', 'A $400 facility subtotal at 1.05 becomes $420.', { min: 0.5, max: 1.5, step: 0.01 }),
  num('owner.estimatorCalibration.church', 'Church calibration', 'Owner calibration applied to the church service subtotal after the church discount.', 'multiplier', ['church'], 'Facility pricing', 'Independent from commercial. Travel is untouched.', 'A $400 church subtotal at 0.95 becomes $380.', { min: 0.5, max: 1.5, step: 0.01 }),
  bool('owner.promotions.customThreeExtraBundle.enabled', 'Three-extra bundle on', 'Enables the 20%-off exactly-three-residential-extras bundle.', ['residential'], 'Discounts & campaigns', 'Competes with other bundles under the single-discount rule.', 'Turn off to stop offering the three-extra bundle.'),
  num('owner.promotions.customThreeExtraBundle.percent', 'Three-extra bundle discount', 'Fraction off the eligible extras subtotal when exactly three eligible residential extras are selected.', 'fraction (0.20 = 20%)', ['residential'], 'Discounts & campaigns', 'Applies to extras only, never base cleaning, travel or tax.', '0.20 gives 20% off the three selected extras.', { min: 0, max: 1, step: 0.01 }),

  // ── Commercial / church workload ─────────────────────────────────────────
  num('owner.commercialPricing.grossRatePerHour', 'Facility labor-hour rate', 'Gross revenue per facility labor-hour used for commercial and church estimates.', 'USD / labor-hour', FACILITY, 'Facility pricing', 'Drives every facility cleaning subtotal before discounts, calibration and travel.', 'A 4-hour office at $60 is $240 before rounding.', { min: 0, max: 500, step: 0.01 }),
  num('owner.commercialPricing.productionSqftPerHour.office', 'Office production rate', 'Square feet cleaned per labor-hour in an office.', 'sq ft / hour', ['commercial'], 'Facility pricing', 'Higher rates reduce labor-hours and price; lower rates increase them.', '3,000 sqft at 3,000/hr is one labor-hour of area work.', { min: 100, max: 10000, step: 10 }),
  num('owner.commercialPricing.productionSqftPerHour.retail', 'Retail production rate', 'Square feet cleaned per labor-hour in retail space.', 'sq ft / hour', ['commercial'], 'Facility pricing', 'Higher rates reduce labor-hours and price.', '3,200 sqft at 3,200/hr is one labor-hour of area work.', { min: 100, max: 10000, step: 10 }),
  num('owner.commercialPricing.productionSqftPerHour.salon', 'Salon production rate', 'Square feet cleaned per labor-hour in a salon or barbershop.', 'sq ft / hour', ['commercial'], 'Facility pricing', 'Higher rates reduce labor-hours and price.', 'A 2,800 sqft salon is one hour of area work at this rate.', { min: 100, max: 10000, step: 10 }),
  num('owner.commercialPricing.productionSqftPerHour.gym', 'Gym production rate', 'Square feet cleaned per labor-hour in a gym or fitness facility.', 'sq ft / hour', ['commercial'], 'Facility pricing', 'Higher rates reduce labor-hours and price.', 'A 2,500 sqft gym is one hour of area work at this rate.', { min: 100, max: 10000, step: 10 }),
  num('owner.commercialPricing.productionSqftPerHour.community', 'Community space production rate', 'Square feet cleaned per labor-hour in apartment common areas or community space.', 'sq ft / hour', ['commercial'], 'Facility pricing', 'Higher rates reduce labor-hours and price.', 'A 3,000 sqft community room is one hour of area work at this rate.', { min: 100, max: 10000, step: 10 }),
  num('owner.commercialPricing.productionSqftPerHour.church', 'Church production rate', 'Square feet cleaned per labor-hour in a church facility.', 'sq ft / hour', ['church'], 'Facility pricing', 'Higher rates reduce labor-hours and price.', 'A 2,800 sqft sanctuary is one hour of area work at this rate.', { min: 100, max: 10000, step: 10 }),
  num('owner.commercialPricing.fixtureMinutes', 'Minutes per restroom fixture', 'Restroom cleaning minutes per fixture (toilet, urinal or sink).', 'minutes / fixture', FACILITY, 'Facility pricing', 'More fixtures add labor-hour time; changing this changes every restroom.', '20 fixtures at 3 minutes add one labor-hour.', { min: 0, max: 60, step: 0.1 }),
  num('owner.commercialPricing.breakroomMinutes', 'Breakroom detail minutes', 'Additional minutes when a breakroom or kitchen is selected.', 'minutes', FACILITY, 'Facility pricing', 'Adds fixed labor time to facility estimates.', '10 minutes adds 0.17 labor-hours.', { min: 0, max: 120, step: 1 }),
  num('owner.commercialPricing.setupMinutes', 'Setup minutes per visit', 'Arrival, equipment and close-out time per facility visit.', 'minutes', FACILITY, 'Facility pricing', 'Adds fixed labor time to every facility estimate.', '20 minutes adds 0.33 labor-hours.', { min: 0, max: 120, step: 1 }),
  num('owner.commercialPricing.firstCleanFactor', 'First-clean factor', 'Multiplier for an initial facility detail clean versus routine maintenance.', 'multiplier', FACILITY, 'Facility pricing', 'Applies only when the customer marks the facility as a first clean.', '1.35 adds 35% labor to a first clean.', { min: 1, max: 3, step: 0.01 }),
  num('owner.commercialPricing.rangeSpreadPercent', 'Tier B range spread', 'Percentage band shown above and below a Tier B facility estimate.', 'percent', FACILITY, 'Facility pricing', 'Changes presentation of a Tier B range, not the single Tier A price.', '15 shows a range from −15% to +15% of the estimate.', { min: 0, max: 50, step: 0.1 }),
  num('owner.commercialPricing.tierAHours', 'Tier A hour limit', 'Facility workload hours up to this amount show one preliminary price.', 'labor-hours', FACILITY, 'Facility pricing', 'Raising this moves more jobs from a range to a single price.', 'At 3 hours, a 2.5-hour job shows one price.', { min: 0.5, max: 24, step: 0.1 }),
  num('owner.commercialPricing.tierBHours', 'Tier B hour limit', 'Facility workload hours up to this amount show a preliminary range; above this is a scope review.', 'labor-hours', FACILITY, 'Facility pricing', 'Lowering this sends more jobs to personal scope review.', 'At 8 hours, a 6-hour job shows a range.', { min: 0.5, max: 40, step: 0.1 }),
  num('owner.commercialPricing.overheadRatePercent', 'Facility overhead allowance', 'Overhead allowance used in calibration and profit reporting, not the customer price.', 'percent', FACILITY, 'Facility pricing', 'Changing this does not change the customer quote; it changes internal reporting.', '22 keeps 22% of the facility rate as operating overhead.', { min: 0, max: 100, step: 0.1 }),

  // ── Travel economics ──────────────────────────────────────────────────────
  num('travel.includedOneWayMiles', 'Included one-way miles', 'Miles each way included in the base price before travel adjustment.', 'miles', ALL, 'Travel', 'Only miles beyond this are charged. Raising it lowers long-distance travel charges.', 'At 17.5, a 10-mile destination has no travel charge.', { min: 0, max: 200, step: 0.1 }),
  num('travel.mpg', 'Vehicle miles per gallon', 'Fuel economy used to convert gasoline price into a travel cost.', 'miles / gallon', ALL, 'Travel', 'Lower MPG increases the fuel portion of travel.', 'At 24 MPG, a 30-mile round trip uses 1.25 gallons.', { min: 1, max: 100, step: 0.1 }),
  num('travel.wearPerMile', 'Vehicle wear per mile', 'Non-fuel wear allowance per round-trip mile (tires, oil, depreciation).', 'USD / mile', ALL, 'Travel', 'Added directly to the travel adjustment for miles beyond the included allowance.', '$0.12 on 20 extra round-trip miles adds $2.40.', { min: 0, max: 5, step: 0.01 }),
  num('travel.fallbackGasPrice', 'Fallback gasoline price', 'Reference gasoline price used when the live fuel feed is unavailable.', 'USD / gallon', ALL, 'Travel', 'Changes travel cost only when the live fuel price is unavailable.', 'At $3.10, 1.25 gallons is $3.88.', { min: 0, max: 20, step: 0.01 }),
  num('travel.maxDrivingMinutes', 'Instant-estimate driving limit', 'Routed driving minutes allowed for an ordinary instant estimate.', 'minutes', ALL, 'Travel', 'Beyond this, the estimate is marked for personal confirmation.', 'At 60, a 75-minute drive enters the review band.', { min: 5, max: 300, step: 1 }),
  num('travel.reviewBandMinutes', 'Driving review band', 'Additional minutes beyond the limit that still show an estimate with a confirmation flag.', 'minutes', ALL, 'Travel', 'Widens or narrows the personal-confirmation band.', 'At 15, a 75-minute drive is inside the 60+15 band.', { min: 0, max: 120, step: 1 }),
  num('travel.maxInstantDistanceMiles', 'Maximum routed distance', 'Hard distance cap used when the provider returns distance but no duration.', 'miles one way', ALL, 'Travel', 'Beyond this, the estimate requires personal confirmation.', 'At 45, a 50-mile route is not instantly priced.', { min: 1, max: 500, step: 1 }),
];

// Add-on labor and fixed-price entries are generated from the baseline add-on
// list. Add-on ids, labels, custom-quote status and categories are structural
// and are never editable through the pricing tab.
for (const [index, addon] of ownerPricing.addons.entries()) {
  const base = `owner.addons.${index}`;
  if (addon.customQuote) continue;
  pricingCatalog.push(
    num(`${base}.laborHours`, `${addon.label}: labor hours`, `Labor-hours added when ${addon.label.toLowerCase()} is selected. Still counts toward scheduled time even when a fixed price is set.`, 'labor-hours', ['residential', 'str', 'commercial', 'church'], 'Optional extras', 'Raises the add-on charge and the scheduled labor time.', `${addon.laborHours ?? 0} hours at $55 adds $${Math.round((addon.laborHours ?? 0) * 55)} before the residential extras factor.`, { min: 0, max: 24, step: 0.01 }),
    num(`${base}.fixedPriceUsd`, `${addon.label}: fixed price`, `Optional flat charge that replaces labor-hours × rate for the charge only. Blank uses labor-based pricing.`, 'USD', ['residential', 'str', 'commercial', 'church'], 'Optional extras', 'A positive value replaces the calculated charge; labor time is unchanged.', 'Leave blank to price the add-on from its labor-hours.', { min: 0, max: 10000, step: 0.01, allowNull: true }),
  );
}

for (const [index, bundle] of ownerPricing.promotions.addonBundles.entries()) {
  const base = `owner.promotions.addonBundles.${index}`;
  const engine: PricingEngine[] = bundle.requiresRecurring ? ['residential'] : ['residential', 'str'];
  pricingCatalog.push(
    bool(`${base}.enabled`, `${bundle.label}: on`, `Enables the ${bundle.label}.`, engine, 'Add-on bundles', 'When off, the bundle never applies.', 'Turn off only when the bundle is withdrawn.'),
    num(`${base}.value`, `${bundle.label}: discount`, `Fraction off the eligible add-on subtotal for the ${bundle.label}.`, 'fraction (0.10 = 10%)', engine, 'Add-on bundles', 'Applies to the required extras only, never base cleaning, travel or tax.', '0.10 gives 10% off the required extras.', { min: 0, max: 1, step: 0.01 }),
    num(`${base}.maxDiscountUsd`, `${bundle.label}: maximum discount`, `Maximum dollar discount for the ${bundle.label}.`, 'USD', engine, 'Add-on bundles', 'Caps the bundle discount.', '30 means the bundle saves at most $30.', { min: 0, max: 10000, step: 1 }),
  );
}

export const pricingCatalogByPath = new Map(pricingCatalog.map((entry) => [entry.path, entry]));

export function getPathValue(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const token of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

export function setPathValue(target: unknown, path: string, value: unknown): boolean {
  const tokens = path.split('.');
  let current: unknown = target;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (current === null || typeof current !== 'object') return false;
    const token = tokens[index]!;
    const next = (current as Record<string, unknown>)[token];
    if (next === null || typeof next !== 'object') return false;
    current = next;
  }
  const finalToken = tokens[tokens.length - 1]!;
  if (current === null || typeof current !== 'object') return false;
  (current as Record<string, unknown>)[finalToken] = value;
  return true;
}
