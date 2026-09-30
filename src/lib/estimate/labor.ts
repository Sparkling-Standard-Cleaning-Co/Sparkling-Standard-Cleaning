// Labor-hour model — converts property facts into expected labor-hours.
//
// Anchors (directive §20): a maintained 3/2 home ≈ 4.5–5.0 labor-hours for the
// founder alone; a first clean of a similar home ≈ 6 labor-hours. All numbers
// live in src/config/pricing.ts so the model can be recalibrated without
// touching this file.
//
// The estimator reasons in LABOR-HOURS, never wall-clock time: two cleaners
// halve the clock, not the labor (directive §20).

import { pricing } from '../../config/pricing.ts';
import { conditionFactor, lastCleanFactor } from './conditions.ts';
import { frequencyFactor } from './frequency.ts';
import type { CalculationTraceEntry, NormalizedEstimateInput } from './types.ts';

export interface LaborResult {
  /** Total labor-hours including discrete add-on time. */
  hours: number;
  /** Hours before add-ons — useful for calibration records. */
  baseHours: number;
  addonHours: number;
  trace: CalculationTraceEntry[];
}

function computeBaseHours(input: NormalizedEstimateInput): { hours: number; trace: CalculationTraceEntry[] } {
  const model = pricing.laborModel;
  const trace: CalculationTraceEntry[] = [];

  let subtotal = 0;
  if (input.serviceType === 'str_turnover') {
    const base = model.baseHours.str_turnover.value;
    const sqft = (input.squareFeet / 1000) * model.strSqftHoursPerThousand.value;
    const baths = input.fullBaths * model.strBathHours.value;
    const beds = (input.beds ?? 0) * model.strBedHours.value;
    subtotal = base + sqft + baths + beds;
    trace.push(
      { step: 'labor:str_base', detail: 'STR turnover base', value: base },
      { step: 'labor:str_sqft', detail: `${input.squareFeet} sqft`, value: sqft },
      { step: 'labor:str_baths', detail: `${input.fullBaths} full bath(s)`, value: baths },
      { step: 'labor:str_beds', detail: `${input.beds ?? 0} bed(s)`, value: beds },
    );
  } else {
    const base = model.baseHours[input.serviceType].value;
    const sqft = (input.squareFeet / 1000) * model.sqftHoursPerThousand.value;
    const fullBaths = input.fullBaths * model.fullBathHours.value;
    const halfBaths = input.halfBaths * model.halfBathHours.value;
    const extraBedrooms = Math.max(0, input.bedrooms - model.bedroomsIncludedInBase.value);
    const bedrooms = extraBedrooms * model.bedroomHours.value;
    subtotal = base + sqft + fullBaths + halfBaths + bedrooms;
    trace.push(
      { step: 'labor:base', detail: `${input.serviceType} base`, value: base },
      { step: 'labor:sqft', detail: `${input.squareFeet} sqft`, value: sqft },
      { step: 'labor:full_baths', detail: `${input.fullBaths} full bath(s)`, value: fullBaths },
      { step: 'labor:half_baths', detail: `${input.halfBaths} half bath(s)`, value: halfBaths },
      { step: 'labor:bedrooms', detail: `${extraBedrooms} extra bedroom(s)`, value: bedrooms },
    );
  }

  const condition = conditionFactor(input.condition);
  const lastClean = lastCleanFactor(input.lastClean);
  const frequency = frequencyFactor(input.frequency, input.serviceType);

  const hours = subtotal * condition * lastClean * frequency;
  trace.push(
    { step: 'labor:subtotal', detail: 'Before multipliers', value: subtotal },
    { step: 'labor:condition', detail: `Condition "${input.condition}"`, value: condition },
    { step: 'labor:last_clean', detail: `Last clean "${input.lastClean ?? 'not provided'}"`, value: lastClean },
    { step: 'labor:frequency', detail: `Frequency "${input.frequency}"`, value: frequency },
  );

  return { hours, trace };
}

export function computeLaborHours(input: NormalizedEstimateInput, addonHours: number): LaborResult {
  const { hours: baseHours, trace } = computeBaseHours(input);
  trace.push({ step: 'labor:addons', detail: 'Discrete add-on time', value: addonHours });
  return {
    hours: baseHours + addonHours,
    baseHours,
    addonHours,
    trace,
  };
}
