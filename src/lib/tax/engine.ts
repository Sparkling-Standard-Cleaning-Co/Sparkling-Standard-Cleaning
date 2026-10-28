/**
 * Pure service-location sales-tax engine.
 *
 * The taxable base is the service charge for the confirmed cleaning location
 * (cleaning + eligible extras - approved discounts + the separately stated
 * travel adjustment). Gift-certificate credit is a payment method applied
 * after tax, never a discount that reduces the taxable base.
 *
 * The engine never invents a rate. An unknown or unverified jurisdiction
 * returns `review_required` and online payment must be refused for that quote.
 */
import {
  floridaCountyTaxRates,
  taxConfig,
  zipTaxJurisdictions,
  type TaxServiceCategory,
  type TaxTreatment,
} from '../../config/tax.ts';

export type TaxReviewReason =
  | 'engine_disabled'
  | 'service_unknown'
  | 'state_unknown'
  | 'jurisdiction_conflict'
  | 'county_unknown'
  | 'rate_not_verified'
  | 'rate_expired';

export interface ServiceTaxInput {
  serviceType: string;
  /** Confirmed service-address state (two-letter code). */
  state?: string | null;
  /** Confirmed service-address ZIP. */
  zip?: string | null;
  /** The amount the tax applies to, before tax. */
  taxableBase: number;
  /** True only when an owner has verified a current exemption certificate. */
  churchExempt?: boolean;
  /** Sale date; defaults to now. */
  at?: Date;
}

export interface ServiceTaxResult {
  version: 1;
  treatment: TaxTreatment;
  category: TaxServiceCategory;
  jurisdictionKey: string | null;
  jurisdictionLabel: string | null;
  state: 'FL' | 'AL' | null;
  county: string | null;
  ratePercent: number | null;
  stateRatePercent: number | null;
  countySurtaxPercent: number | null;
  taxableBase: number;
  taxAmount: number | null;
  total: number | null;
  effectiveFrom: string | null;
  effectiveThrough: string | null;
  source: string | null;
  /** False means the customer must not pay online until a human resolves tax. */
  canCharge: boolean;
  reviewReason?: TaxReviewReason;
  note: string;
}

const TAX_TIME_ZONE = 'America/Chicago';

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function money(value: number): string {
  return `$${round2(value).toFixed(2)}`;
}

/** Maps a submitted service value to the tax category. */
export function taxServiceCategory(serviceType: string | null | undefined): TaxServiceCategory {
  switch ((serviceType ?? '').trim().toLowerCase()) {
    case 'standard':
    case 'deep':
    case 'move_in_out':
    case 'house':
    case 'residential':
    case 'supportive':
    case 'recurring':
      return 'residential';
    case 'str_turnover':
    case 'str':
      return 'str';
    case 'commercial_cleaning':
    case 'commercial':
      return 'commercial';
    case 'church_cleaning':
    case 'church':
      return 'church';
    default:
      return 'unknown';
  }
}

function normalizeState(value: string | null | undefined): 'FL' | 'AL' | null {
  const normalized = (value ?? '').trim().toUpperCase();
  if (normalized === 'FL' || normalized === 'FLORIDA') return 'FL';
  if (normalized === 'AL' || normalized === 'ALABAMA') return 'AL';
  return null;
}

function normalizeZip(value: string | null | undefined): string | null {
  const match = (value ?? '').trim().match(/^(\d{5})(?:-\d{4})?$/);
  return match ? match[1]! : null;
}

function localDateKey(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TAX_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

function review(
  input: ServiceTaxInput,
  category: TaxServiceCategory,
  reason: TaxReviewReason,
  note: string,
  context: Partial<ServiceTaxResult> = {},
): ServiceTaxResult {
  return {
    version: 1,
    treatment: 'review_required',
    category,
    jurisdictionKey: context.jurisdictionKey ?? null,
    jurisdictionLabel: context.jurisdictionLabel ?? null,
    state: context.state ?? null,
    county: context.county ?? null,
    ratePercent: null,
    stateRatePercent: null,
    countySurtaxPercent: null,
    taxableBase: round2(Math.max(0, input.taxableBase)),
    taxAmount: null,
    total: null,
    effectiveFrom: context.effectiveFrom ?? null,
    effectiveThrough: context.effectiveThrough ?? null,
    source: context.source ?? null,
    canCharge: false,
    reviewReason: reason,
    note,
  };
}

function notTaxable(
  input: ServiceTaxInput,
  category: TaxServiceCategory,
  state: 'FL' | 'AL',
  note: string,
  source: string,
): ServiceTaxResult {
  return {
    version: 1,
    treatment: 'not_taxable',
    category,
    jurisdictionKey: `US-${state}`,
    jurisdictionLabel: state === 'FL' ? 'Florida' : 'Alabama',
    state,
    county: null,
    ratePercent: 0,
    stateRatePercent: 0,
    countySurtaxPercent: 0,
    taxableBase: round2(Math.max(0, input.taxableBase)),
    taxAmount: 0,
    total: round2(Math.max(0, input.taxableBase)),
    effectiveFrom: null,
    effectiveThrough: null,
    source,
    canCharge: true,
    note,
  };
}

/**
 * Calculates the service-location tax. All values are server-owned; a browser
 * may display the same result from the shared module but never supplies a
 * rate, jurisdiction or tax amount that the server accepts.
 */
export function calculateServiceTax(input: ServiceTaxInput): ServiceTaxResult {
  const category = taxServiceCategory(input.serviceType);
  const base = round2(Math.max(0, Number.isFinite(input.taxableBase) ? input.taxableBase : 0));
  if (!taxConfig.enabled) {
    return review(input, category, 'engine_disabled', 'Sales tax is being verified for this service address.');
  }
  if (category === 'unknown') {
    return review(
      input,
      category,
      'service_unknown',
      'The tax treatment for this service is not configured; Sparkling Standard will confirm it personally.',
    );
  }

  const zip = normalizeZip(input.zip);
  const zipInfo = zip ? zipTaxJurisdictions[zip] ?? null : null;
  const statedState = normalizeState(input.state);
  if (zipInfo && statedState && zipInfo.state !== statedState) {
    return review(
      input,
      category,
      'jurisdiction_conflict',
      'The ZIP and state do not agree, so tax cannot be calculated safely. Sparkling Standard will confirm the service jurisdiction.',
      { jurisdictionKey: zipInfo.key, state: statedState, county: zipInfo.county },
    );
  }
  const state = zipInfo?.state ?? statedState;
  if (!state) {
    return review(
      input,
      category,
      'state_unknown',
      'The service state is needed before tax can be calculated. Confirm the service address to continue.',
    );
  }

  if (category === 'residential') {
    return notTaxable(
      input,
      category,
      state,
      'Residential cleaning services are not subject to sales tax.',
      state === 'FL'
        ? 'Rule 12A-1.0091(1)(b), F.A.C.; FDOR GT-800015'
        : 'Ala. Code §40-23-2; ADOR Sales Tax application',
    );
  }
  if (category === 'str') {
    return notTaxable(
      input,
      category,
      state,
      'Cleaning billed to the property owner or host for a residential rental is not taxable. A host’s separately charged mandatory guest cleaning fee is part of the host’s transient-rental charge, not this cleaning charge.',
      state === 'FL'
        ? 'Rule 12A-1.0091(1)(b), F.A.C.; FDOR GT-800015; FDOR TIP 99A01-42'
        : 'Ala. Code §40-23-2; ADOR Sales Tax application',
    );
  }

  if (state === 'AL') {
    if (!taxConfig.alabamaServiceTaxable) {
      return notTaxable(
        input,
        category,
        state,
        'Alabama sales tax applies to retail sales of tangible personal property and public amusements, not to building-cleaning services. No Alabama sales tax is added to this service.',
        'Ala. Code §40-23-2; ADOR Sales Tax application',
      );
    }
    return review(
      input,
      category,
      'rate_not_verified',
      'Alabama service tax treatment needs owner verification before an online charge.',
    );
  }

  // Florida nonresidential cleaning (commercial, and church unless exempt).
  const jurisdictionKey = zipInfo?.key ?? null;
  if (!jurisdictionKey) {
    return review(
      input,
      category,
      'county_unknown',
      'The service county could not be established from the confirmed ZIP. Sparkling Standard will confirm the tax personally before charging.',
      { state, jurisdictionKey: null, jurisdictionLabel: null },
    );
  }
  const rate = floridaCountyTaxRates[jurisdictionKey];
  if (!rate) {
    return review(
      input,
      category,
      'rate_not_verified',
      'The county sales-tax rate is not verified. Sparkling Standard will confirm the tax personally before charging.',
      { state, jurisdictionKey },
    );
  }
  const date = localDateKey(input.at ?? new Date());
  if (date < rate.effectiveFrom || date > rate.effectiveThrough) {
    return review(
      input,
      category,
      'rate_expired',
      'The county sales-tax rate is not verified for this date. Sparkling Standard will confirm the tax personally before charging.',
      {
        state,
        county: rate.county,
        jurisdictionKey,
        effectiveFrom: rate.effectiveFrom,
        effectiveThrough: rate.effectiveThrough,
        source: rate.source,
      },
    );
  }

  if (category === 'church' && input.churchExempt) {
    return {
      version: 1,
      treatment: 'exempt',
      category,
      jurisdictionKey,
      jurisdictionLabel: `${rate.county} County, ${state}`,
      state,
      county: rate.county,
      ratePercent: 0,
      stateRatePercent: 0,
      countySurtaxPercent: 0,
      taxableBase: base,
      taxAmount: 0,
      total: base,
      effectiveFrom: rate.effectiveFrom,
      effectiveThrough: rate.effectiveThrough,
      source: 'Owner-verified Florida Consumer’s Certificate of Exemption (Form DR-14)',
      canCharge: true,
      note: 'Exempt organization certificate on file. Tax is not charged on this service.',
    };
  }

  const taxAmount = round2((base * rate.combinedRatePercent) / 100);
  return {
    version: 1,
    treatment: 'taxable',
    category,
    jurisdictionKey,
    jurisdictionLabel: `${rate.county} County, ${state}`,
    state,
    county: rate.county,
    ratePercent: rate.combinedRatePercent,
    stateRatePercent: rate.stateRatePercent,
    countySurtaxPercent: rate.countySurtaxPercent,
    taxableBase: base,
    taxAmount,
    total: round2(base + taxAmount),
    effectiveFrom: rate.effectiveFrom,
    effectiveThrough: rate.effectiveThrough,
    source: rate.source,
    canCharge: true,
    note:
      category === 'church'
        ? `Nonresidential cleaning is taxable at ${rate.combinedRatePercent}% (${rate.stateRatePercent}% state + ${rate.countySurtaxPercent}% ${rate.county} County surtax) unless a current Florida exemption certificate is on file and the church pays directly.`
        : `Florida sales tax of ${rate.combinedRatePercent}% applies (${rate.stateRatePercent}% state + ${rate.countySurtaxPercent}% ${rate.county} County surtax) in ${rate.county} County.`,
  };
}

/** A compact customer-facing label for an estimate. */
export function taxDisplayLabel(tax: ServiceTaxResult): string {
  if (tax.treatment === 'not_taxable') return 'No sales tax applicable';
  if (tax.treatment === 'exempt') return 'Tax exempt — certificate on file';
  if (tax.treatment === 'review_required') return 'Tax to be confirmed';
  return `Sales tax (${tax.ratePercent}%) ${money(tax.taxAmount ?? 0)}`;
}
