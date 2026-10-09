// Customer-facing request summary.
//
// Pure and dependency-free. Shared by the customer confirmation email and the
// on-page thank-you summary so both present the same facts with the same
// honesty rules:
//  - a submitted request is never a booking;
//  - a provisional estimate is never a final price;
//  - nothing internal (labor hours, rates, verification codes) is shown.
//
// Only values the customer themselves submitted are presented; every field is
// optional and empty rows are omitted.

export type RequestKind = 'reservation' | 'estimate' | 'commercial' | 'str' | 'gift' | 'contact';

export interface SummaryRow {
  label: string;
  value: string;
}

export interface EstimateLine {
  label: string;
  value: string;
  note: string;
}

export interface RequestSummary {
  kind: RequestKind;
  /** Customer-facing title, e.g. "Reservation request". */
  title: string;
  rows: SummaryRow[];
  /** Booking/quote reference when the submission carried one. */
  reference: string;
  /** Provisional or server-checked estimate, when one exists. */
  estimate: EstimateLine | null;
}

const SERVICE_LABELS: Record<string, string> = {
  standard: 'House cleaning (standard)',
  deep: 'Deep cleaning',
  move_in_out: 'Move-in / move-out cleaning',
  str_turnover: 'Short-term rental turnover',
  house: 'House cleaning (standard)',
};

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: 'Weekly',
  biweekly: 'Every two weeks',
  monthly: 'Monthly',
  one_time: 'One-time',
  per_stay: 'Every turnover',
  as_needed: 'As needed',
  nightly: 'Every night',
};

const ARRIVAL_LABELS: Record<string, string> = {
  'first-appointment': 'First appointment (exact time)',
  morning: 'Morning window',
  afternoon: 'Afternoon window',
  flexible: 'Flexible',
};

const FACILITY_LABELS: Record<string, string> = {
  office: 'Office',
  church: 'Church',
  salon: 'Salon / studio',
  gym: 'Gym / fitness',
  retail: 'Retail',
  restaurant: 'Restaurant',
  medical: 'Medical / dental',
  warehouse: 'Warehouse / industrial',
  other: 'Other',
};

function text(fields: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return '';
}

function humanizeKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** ISO date (YYYY-MM-DD) → "Tuesday, December 15, 2026"; anything else unchanged. */
export function formatSummaryDate(raw: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  try {
    const date = new Date(`${raw}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return raw;
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(date);
  } catch {
    return raw;
  }
}

function money(value: string): string {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return value;
  return `$${parsed.toFixed(2).replace(/\.00$/, '')}`;
}

function kindOf(fields: Record<string, string>): RequestKind {
  if (text(fields, 'recipient_name')) return 'gift';
  if (text(fields, 'facility_type') || text(fields, 'organization')) return 'commercial';
  if (text(fields, 'turnover_frequency') || text(fields, 'property_location') || text(fields, 'checkout_time')) {
    return 'str';
  }
  if (text(fields, 'request_type') === 'reservation_request') return 'reservation';
  if (text(fields, 'request_type') === 'residential_estimate') return 'estimate';
  if (text(fields, 'message')) return 'contact';
  return 'estimate';
}

const TITLES: Record<RequestKind, string> = {
  reservation: 'Reservation request',
  estimate: 'Estimate request',
  commercial: 'Commercial walkthrough request',
  str: 'Short-term rental turnover request',
  gift: 'Gift certificate request',
  contact: 'Website message',
};

function serviceValue(fields: Record<string, string>): string {
  const service = text(fields, 'service_type');
  if (service) return SERVICE_LABELS[service] ?? humanizeKey(service);
  const facility = text(fields, 'facility_type');
  if (facility) return `Commercial — ${FACILITY_LABELS[facility] ?? humanizeKey(facility)}`;
  return '';
}

function homeValue(fields: Record<string, string>): string {
  const parts: string[] = [];
  const size = text(fields, 'square_feet');
  if (size) parts.push(`${size} sq ft`);
  const bedrooms = text(fields, 'bedrooms');
  const fullBaths = text(fields, 'full_baths');
  if (bedrooms) parts.push(`${bedrooms} bed`);
  if (fullBaths) parts.push(`${fullBaths} full bath`);
  return parts.join(' · ');
}

function addressValue(fields: Record<string, string>): string {
  const street = text(fields, 'service_address', 'property_location');
  const city = text(fields, 'address_city');
  const state = text(fields, 'address_state');
  const zip = text(fields, 'zip');
  const region = [city, state].filter(Boolean).join(', ');
  const cityLine = [region, zip].filter(Boolean).join(' ');
  return [street, cityLine].filter(Boolean).join(', ');
}

function estimateFor(fields: Record<string, string>, kind: RequestKind): EstimateLine | null {
  if (kind !== 'reservation' && kind !== 'estimate') return null;
  const verifiedRange = text(fields, 'verified_range');
  if (verifiedRange) {
    return {
      label: 'Server-checked estimate range',
      value: verifiedRange,
      note: 'Checked against your confirmed address. Final scope, price and travel are confirmed personally before anything is scheduled.',
    };
  }
  const quotedRange = text(fields, 'quoted_range');
  if (quotedRange) {
    return {
      label: 'Provisional estimate range',
      value: quotedRange,
      note: 'Provisional — final scope and price are confirmed personally before anything is scheduled.',
    };
  }
  const low = text(fields, 'estimate_low');
  const high = text(fields, 'estimate_high');
  if (low && high) {
    return {
      label: 'Provisional estimate range',
      value: `${money(low)} – ${money(high)}`,
      note: 'Provisional — final scope and price are confirmed personally before anything is scheduled.',
    };
  }
  const quoted = text(fields, 'quoted_price', 'proposed_total');
  if (quoted) {
    return {
      label: 'Provisional estimate',
      value: money(quoted),
      note: 'Provisional — final scope and price are confirmed personally before anything is scheduled.',
    };
  }
  return null;
}

/**
 * Builds the customer-facing summary of a submitted request. Only submitted
 * values are used; unknown services/frequencies are humanized rather than
 * guessed.
 */
export function buildRequestSummary(fields: Record<string, string>): RequestSummary {
  const kind = kindOf(fields);
  const rows: SummaryRow[] = [];
  const add = (label: string, value: string): void => {
    if (value && value.trim() !== '') rows.push({ label, value: value.trim() });
  };

  add('Service', serviceValue(fields));
  const frequency = text(fields, 'frequency', 'turnover_frequency');
  if (frequency) {
    const label = FREQUENCY_LABELS[frequency] ?? humanizeKey(frequency);
    add(text(fields, 'turnover_frequency') ? 'Turnovers' : 'Frequency', label);
  }
  if (kind === 'gift') {
    add('Recipient', text(fields, 'recipient_name'));
    add('Gift value', text(fields, 'gift_value'));
  } else if (kind !== 'contact') {
    add('Home', homeValue(fields));
    add('Service address', addressValue(fields) || 'To be confirmed with you');
  }
  const preferredDate = text(fields, 'preferred_date', 'walkthrough_date');
  if (preferredDate) add('Preferred date', formatSummaryDate(preferredDate));
  const arrival = text(fields, 'arrival_preference');
  if (arrival) add('Arrival preference', ARRIVAL_LABELS[arrival] ?? humanizeKey(arrival));

  return {
    kind,
    title: TITLES[kind],
    rows,
    reference: text(fields, 'quote_reference'),
    estimate: estimateFor(fields, kind),
  };
}
