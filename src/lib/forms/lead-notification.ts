// Owner lead-notification presentation layer.
//
// The form provider (Web3Forms, free tier) renders the submitted field names
// and values in order; it does NOT support custom HTML templates on the free
// plan. This module therefore turns the flat, technical field map into an
// ordered, human-readable business summary with clear sections while
// preserving EVERY collected value:
//
//   Inquiry → Contact → Location → Home → Extras → Pricing →
//   Scheduling & notes → Internal verification → More details
//
// Rules:
//  - Pure and dependency-free so it can be unit-tested under `node --test`.
//  - Values stay plain text; no HTML is ever produced or parsed here.
//  - Nothing private is added: no operating origin, no server credentials.
//  - Empty fields are omitted (no "irrelevant/blank question" noise), but any
//    field this module does not explicitly map is preserved under
//    "More details" so information can never be lost.
//  - The customer's notes are passed through verbatim.

const SERVICE_LABELS: Record<string, string> = {
  standard: 'House cleaning (standard)',
  deep: 'Deep cleaning',
  move_in_out: 'Move-in / move-out cleaning',
  str_turnover: 'Short-term rental turnover',
  house: 'House cleaning (standard)',
};

const REQUEST_LABELS: Record<string, string> = {
  reservation_request: 'Reservation request — proposed price, subject to personal confirmation',
  residential_estimate: 'Residential estimate request — not a booking',
  commercial: 'Commercial walkthrough request',
  str: 'Short-term rental turnover request',
  contact: 'Website message',
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

const PROPERTY_LABELS: Record<string, string> = {
  house: 'House',
  apartment: 'Apartment',
  condo: 'Condo',
  townhome: 'Townhome',
  other: 'Other',
};

const CONDITION_LABELS: Record<string, string> = {
  maintained: 'Maintained',
  average: 'Average',
  needs_attention: 'Needs attention',
  heavy: 'Heavy buildup',
  severe: 'Severe — custom review required',
};

const LAST_CLEAN_LABELS: Record<string, string> = {
  within_month: 'Within the last month',
  one_to_three_months: '1–3 months ago',
  three_to_twelve_months: '3–12 months ago',
  over_a_year: 'More than a year ago',
  never_professional: 'Never professionally cleaned',
  not_sure: 'Not sure',
};

const PET_LABELS: Record<string, string> = {
  none: 'No pets',
  one: 'One pet',
  multiple_shedding: 'Multiple pets / heavy shedding',
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

const YES_NO_LABELS: Record<string, string> = {
  yes: 'Yes',
  no: 'No',
};

const ARRIVAL_LABELS: Record<string, string> = {
  'first-appointment': 'First appointment (exact time)',
  morning: 'Morning window',
  afternoon: 'Afternoon window',
  flexible: 'Flexible',
};

const VERIFICATION_LABELS: Record<string, string> = {
  verified: 'VERIFIED — price and travel confirmed by the server',
  preliminary: 'PRELIMINARY — delivered; needs personal review',
  mismatch: 'MISMATCH — submitted price differs from the server recalculation',
  unverifiable: 'UNVERIFIABLE — could not be checked; review manually',
};

/** Compact verdict labels for the at-a-glance summary line. */
const VERIFICATION_SHORT: Record<string, string> = {
  verified: 'VERIFIED',
  preliminary: 'PRELIMINARY',
  mismatch: 'MISMATCH',
  unverifiable: 'UNVERIFIABLE',
};

const QUALIFICATION_LABELS: Record<string, string> = {
  verified_route: 'Verified route to the confirmed address',
  preliminary_route: 'Preliminary route (address or pin not fully verified)',
  preliminary_zone: 'Preliminary zone estimate (no live route)',
  manual_review: 'Manual review — location could not be verified',
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

function formatCentral(iso: string): string {
  if (!iso) return '';
  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
    return `${formatted} Central`;
  } catch {
    return iso;
  }
}

function formatCoordinate(latRaw: string, lngRaw: string): string {
  const lat = Number.parseFloat(latRaw);
  const lng = Number.parseFloat(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function money(value: string): string {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return value;
  return `$${parsed.toFixed(2).replace(/\.00$/, '')}`;
}

function requestType(fields: Record<string, string>): string {
  const explicit = text(fields, 'request_type');
  if (explicit && REQUEST_LABELS[explicit]) return REQUEST_LABELS[explicit] as string;
  if (text(fields, 'recipient_name')) {
    return 'Gift certificate request — confirm details and send a payment link (no payment taken yet)';
  }
  if (text(fields, 'facility_type') || text(fields, 'organization')) {
    return 'Commercial walkthrough request';
  }
  if (text(fields, 'turnover_frequency') || text(fields, 'property_location') || text(fields, 'checkout_time')) {
    return 'Short-term rental turnover request';
  }
  if (text(fields, 'message')) return 'Website message';
  if (explicit) return humanizeKey(explicit);
  return 'Cleaning inquiry';
}

/** Compact request label for the at-a-glance summary line. */
function requestTypeShort(fields: Record<string, string>): string {
  const explicit = text(fields, 'request_type');
  if (explicit === 'reservation_request') return 'Reservation request';
  if (explicit === 'residential_estimate') return 'Estimate request';
  if (explicit === 'commercial') return 'Commercial walkthrough request';
  if (explicit === 'str') return 'STR turnover request';
  if (explicit === 'contact') return 'Website message';
  if (text(fields, 'recipient_name')) return 'Gift certificate request';
  if (text(fields, 'facility_type') || text(fields, 'organization')) return 'Commercial walkthrough request';
  if (text(fields, 'turnover_frequency') || text(fields, 'property_location') || text(fields, 'checkout_time')) {
    return 'STR turnover request';
  }
  if (text(fields, 'message')) return 'Website message';
  if (explicit) return humanizeKey(explicit);
  return 'Cleaning inquiry';
}

function serviceLine(fields: Record<string, string>): string {
  const service = text(fields, 'service_type');
  if (service) return SERVICE_LABELS[service] ?? humanizeKey(service);
  const facility = text(fields, 'facility_type');
  if (facility) return `Commercial — ${FACILITY_LABELS[facility] ?? humanizeKey(facility)}`;
  return '';
}

function frequencyLine(fields: Record<string, string>): string {
  const frequency = text(fields, 'frequency', 'turnover_frequency');
  if (!frequency) return '';
  const label = FREQUENCY_LABELS[frequency] ?? humanizeKey(frequency);
  if (text(fields, 'turnover_frequency')) return `Turnovers: ${label}`;
  return label;
}

function locationLines(fields: Record<string, string>): Array<[string, string]> {
  const lines: Array<[string, string]> = [];
  const street = text(fields, 'service_address', 'property_location');
  if (street) lines.push(['Location — Address', street]);
  const unit = text(fields, 'address_unit');
  if (unit) lines.push(['Location — Unit', unit]);
  const city = text(fields, 'address_city');
  const state = text(fields, 'address_state');
  const zip = text(fields, 'zip');
  const region = [city, state].filter(Boolean).join(', ');
  const cityLine = [region, zip].filter(Boolean).join(' ');
  if (cityLine) lines.push(['Location — City / State / ZIP', cityLine]);
  const method = text(fields, 'address_method');
  if (method) {
    lines.push([
      'Location — Address entered via',
      { manual: 'Typed address', gps: 'Device location', pin: 'Map pin' }[method] ?? humanizeKey(method),
    ]);
  }
  const confirmed = text(fields, 'address_confirmed');
  if (confirmed) {
    const precision = text(fields, 'pin_precision');
    const precisionNote =
      precision === 'street'
        ? ' (street-level pin — exact property to confirm personally)'
        : precision === 'gps'
          ? ' (device location pin)'
          : '';
    lines.push(['Location — Destination confirmed', `${confirmed === 'yes' ? 'Yes' : 'No'}${precisionNote}`]);
  }
  const coordinate = formatCoordinate(text(fields, 'pin_latitude'), text(fields, 'pin_longitude'));
  if (coordinate) {
    const adjusted = text(fields, 'pin_adjusted') === 'yes' ? ' (customer moved the pin)' : '';
    lines.push(['Location — Map pin', `${coordinate}${adjusted}`]);
  }
  return lines;
}

function pricingLines(fields: Record<string, string>): Array<[string, string]> {
  const lines: Array<[string, string]> = [];
  const quoted = text(fields, 'quoted_price', 'client_price');
  const proposedTotal = text(fields, 'proposed_total');
  const verifiedTotal = text(fields, 'verified_price');
  if (quoted) lines.push(['Pricing — Customer-proposed price', money(quoted)]);
  // The breakdown total is only shown when it adds information beyond the
  // server-recalculated price line.
  if (proposedTotal && (!verifiedTotal || money(proposedTotal) !== money(verifiedTotal))) {
    lines.push([quoted ? 'Pricing — Server total (breakdown)' : 'Pricing — Proposed price', money(proposedTotal)]);
  }
  const range = text(fields, 'quoted_range');
  if (range) lines.push(['Pricing — Estimated range', range]);
  const estimateRange = [text(fields, 'estimate_low'), text(fields, 'estimate_high')].filter(Boolean);
  if (!range && estimateRange.length === 2) {
    lines.push(['Pricing — Estimate range', `$${estimateRange[0]} – $${estimateRange[1]}`]);
  }
  const base = text(fields, 'base_price');
  if (base) lines.push(['Pricing — Base cleaning price', money(base)]);
  const extras = text(fields, 'extras_subtotal');
  if (extras) lines.push(['Pricing — Extras subtotal', money(extras)]);
  const discountLabel = text(fields, 'addon_incentive');
  const discountAmount = text(fields, 'discount_amount');
  if (discountLabel && discountLabel !== 'None') {
    lines.push([
      'Pricing — Discount applied',
      discountAmount ? `${discountLabel} (−${money(discountAmount)})` : discountLabel,
    ]);
  }
  const rounded = text(fields, 'rounding_adjustment');
  if (rounded && rounded !== '0.00' && rounded !== '0') {
    lines.push(['Pricing — Rounding adjustment', money(rounded)]);
  }
  const verified = text(fields, 'verified_price');
  if (verified) lines.push(['Pricing — Server recalculated price', money(verified)]);
  const verifiedRange = text(fields, 'verified_range');
  if (verifiedRange) lines.push(['Pricing — Server recalculated range', verifiedRange]);
  const verdict = text(fields, 'quote_verified');
  if (verdict) {
    lines.push(['Pricing — Verification result', VERIFICATION_LABELS[verdict] ?? humanizeKey(verdict)]);
  }
  if (verdict === 'mismatch') {
    lines.push([
      'Pricing — ACTION REQUIRED',
      'The submitted price differs from the server recalculation. Review the scope and confirm the correct price with the customer before scheduling.',
    ]);
  }
  const minimum = text(fields, 'minimum_job_applied');
  if (minimum === 'true') lines.push(['Pricing — Minimum job applied', 'Yes']);
  return lines;
}

function travelLines(fields: Record<string, string>): Array<[string, string]> {
  const lines: Array<[string, string]> = [];
  const qualification = text(fields, 'travel_qualification');
  if (qualification) {
    lines.push(['Travel — Status', QUALIFICATION_LABELS[qualification] ?? humanizeKey(qualification)]);
  }
  const miles = text(fields, 'travel_distance_miles');
  const minutes = text(fields, 'travel_duration_minutes');
  if (miles || minutes) {
    lines.push([
      'Travel — One-way',
      [miles ? `${miles} mi` : '', minutes ? `${minutes} min` : ''].filter(Boolean).join(' · '),
    ]);
  }
  const method = text(fields, 'travel_method');
  const provider = text(fields, 'travel_provider');
  if (method || provider) {
    lines.push(['Travel — Method', [method, provider].filter(Boolean).join(' · ')]);
  }
  const source = text(fields, 'travel_destination_source');
  if (source) {
    lines.push([
      'Travel — Destination source',
      {
        address_geocode: 'Server-geocoded address',
        zip_centroid: 'ZIP centroid (preliminary)',
        customer_pin: 'Customer-confirmed pin',
        none: 'None',
      }[source] ?? humanizeKey(source),
    ]);
  }
  return lines;
}

/**
 * Builds the ordered, human-readable notification body from the sanitized
 * field map. Field names become email labels; nothing is HTML.
 */
export function buildLeadNotification(fields: Record<string, string>): Record<string, string> {
  const used = new Set<string>();
  const notification: Record<string, string> = {};
  const add = (label: string, value: string, ...consumed: string[]): void => {
    for (const key of consumed) used.add(key);
    if (value && value.trim() !== '') notification[label] = value.trim();
  };
  const addLines = (lines: Array<[string, string]>, consumed: string[]): void => {
    for (const [label, value] of lines) add(label, value);
    for (const key of consumed) used.add(key);
  };

  // ── At a glance (the first rows the owner sees in the inbox) ────────────
  // A compact triage view; the full detail sections follow below. Values are
  // the same facts, never a second interpretation.
  const summaryRequest = [requestTypeShort(fields), serviceLine(fields), frequencyLine(fields)]
    .filter(Boolean)
    .join(' · ');
  add('Summary — Request', summaryRequest);
  const summaryCustomer = [
    text(fields, 'name'),
    text(fields, 'organization'),
    text(fields, 'phone'),
    text(fields, 'email'),
  ]
    .filter(Boolean)
    .join(' · ');
  add('Summary — Customer', summaryCustomer);
  const summaryRegion = [text(fields, 'address_city'), text(fields, 'address_state')]
    .filter(Boolean)
    .join(', ');
  const summaryLocation = [
    text(fields, 'service_address', 'property_location'),
    [summaryRegion, text(fields, 'zip')].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');
  add('Summary — Location', summaryLocation);

  const summaryPriceParts: string[] = [];
  const proposedPrice = text(fields, 'quoted_price', 'client_price');
  const verifiedPrice = text(fields, 'verified_price');
  if (proposedPrice) summaryPriceParts.push(`Proposed ${money(proposedPrice)}`);
  if (verifiedPrice && (!proposedPrice || money(verifiedPrice) !== money(proposedPrice))) {
    summaryPriceParts.push(`Server ${money(verifiedPrice)}`);
  }
  const estimateRange = text(fields, 'quoted_range');
  const estimateLow = text(fields, 'estimate_low');
  const estimateHigh = text(fields, 'estimate_high');
  if (!proposedPrice && !verifiedPrice && estimateRange) {
    summaryPriceParts.push(`Estimate ${estimateRange}`);
  } else if (!proposedPrice && !verifiedPrice && estimateLow && estimateHigh) {
    summaryPriceParts.push(`Estimate $${money(estimateLow)}–$${money(estimateHigh)}`);
  }
  const verdict = text(fields, 'quote_verified');
  if (verdict && VERIFICATION_SHORT[verdict]) summaryPriceParts.push(VERIFICATION_SHORT[verdict] as string);
  add('Summary — Price', summaryPriceParts.join(' · '));

  const actions: string[] = [];
  if (verdict === 'mismatch') {
    actions.push('Price mismatch — confirm the correct price before scheduling');
  }
  if (verdict === 'unverifiable' || text(fields, 'verification_status') === 'authoritative_error') {
    actions.push('Verification could not complete — review manually');
  }
  if (verdict === 'preliminary') actions.push('Travel check pending — confirm the final price');
  if (text(fields, 'travel_qualification') === 'manual_review') {
    actions.push('Location needs manual review (out of area or unverified)');
  }
  if (text(fields, 'preferred_date_note')) actions.push('Preferred date was invalid and discarded');
  if (text(fields, 'pin_precision') === 'street') actions.push('Street-level pin — confirm the exact property');
  if (text(fields, 'recipient_name')) {
    actions.push('Gift request — confirm details and send the payment link (no payment taken)');
  }
  if (!text(fields, 'recipient_name') && (text(fields, 'facility_type') || text(fields, 'organization'))) {
    actions.push('Schedule the walkthrough');
  }
  if (text(fields, 'turnover_frequency')) actions.push('Confirm turnover details and the first date');
  add('Summary — Action', actions.join(' · '));

  // ── A. New cleaning inquiry ─────────────────────────────────────────────
  add('Inquiry — Type', requestType(fields), 'request_type', 'facility_type');
  add('Inquiry — Service', serviceLine(fields), 'service_type');
  add('Inquiry — Frequency', frequencyLine(fields), 'frequency', 'turnover_frequency');
  add('Inquiry — Submitted', formatCentral(text(fields, 'received_at')), 'received_at');
  const preferredDate = text(fields, 'preferred_date', 'walkthrough_date');
  add('Inquiry — Preferred date', preferredDate, 'preferred_date', 'walkthrough_date');
  add('Inquiry — Estimate status', text(fields, 'estimate_status'), 'estimate_status');

  // ── B. Customer contact ─────────────────────────────────────────────────
  add('Contact — Name', text(fields, 'name'), 'name');
  add('Contact — Organization', text(fields, 'organization'), 'organization');
  add('Contact — Phone', text(fields, 'phone'), 'phone');
  add('Contact — Email', text(fields, 'email'), 'email');

  // ── Gift certificate request (no payment has been taken) ────────────────
  add('Gift — Recipient name', text(fields, 'recipient_name'), 'recipient_name');
  add('Gift — Recipient email', text(fields, 'recipient_email'), 'recipient_email');
  add('Gift — Preferred value', text(fields, 'gift_value'), 'gift_value');
  add('Gift — Requested delivery date', text(fields, 'delivery_date'), 'delivery_date');
  add('Gift — Personal message', text(fields, 'gift_message'), 'gift_message');

  // ── C. Job location ─────────────────────────────────────────────────────
  addLines(locationLines(fields), [
    'service_address',
    'property_location',
    'address_unit',
    'address_city',
    'address_state',
    'zip',
    'address_method',
    'address_confirmed',
    'pin_precision',
    'pin_latitude',
    'pin_longitude',
    'pin_adjusted',
  ]);

  // ── D. Cleaning requirements ────────────────────────────────────────────
  const property = text(fields, 'property_type');
  add('Home — Property type', PROPERTY_LABELS[property] ?? (property ? humanizeKey(property) : ''), 'property_type');
  add('Home — Approximate size', text(fields, 'square_feet') ? `${text(fields, 'square_feet')} sq ft` : '', 'square_feet');
  const bedrooms = text(fields, 'bedrooms');
  const fullBaths = text(fields, 'full_baths');
  const halfBaths = text(fields, 'half_baths');
  const rooms = [
    bedrooms ? `${bedrooms} bed` : '',
    fullBaths ? `${fullBaths} full bath` : '',
    halfBaths && halfBaths !== '0' ? `${halfBaths} half bath` : '',
  ].filter(Boolean);
  add('Home — Rooms', rooms.join(' · '), 'bedrooms', 'full_baths', 'half_baths');
  add('Home — Beds to reset', text(fields, 'beds'), 'beds');
  const condition = text(fields, 'condition');
  add('Home — Condition', CONDITION_LABELS[condition] ?? (condition ? humanizeKey(condition) : ''), 'condition');
  const lastClean = text(fields, 'last_cleaned');
  add('Home — Last professional clean', LAST_CLEAN_LABELS[lastClean] ?? (lastClean ? humanizeKey(lastClean) : ''), 'last_cleaned');
  const pets = text(fields, 'pets');
  add('Home — Pets', PET_LABELS[pets] ?? (pets ? humanizeKey(pets) : ''), 'pets');

  // ── E. Requested extras ─────────────────────────────────────────────────
  const addonLabels = text(fields, 'addons');
  const addonIds = text(fields, 'addon_ids');
  add('Extras — Selected', addonLabels || addonIds, 'addons', 'addon_ids');
  if (addonLabels && addonIds) add('Extras — Add-on ids', addonIds);
  add('Extras — Priced detail', text(fields, 'extras_detail'), 'extras_detail');

  // ── F. Pricing summary ──────────────────────────────────────────────────
  addLines(pricingLines(fields), [
    'quoted_price',
    'proposed_total',
    'client_price',
    'quoted_range',
    'estimate_low',
    'estimate_high',
    'base_price',
    'extras_subtotal',
    'addon_incentive',
    'discount_amount',
    'rounding_adjustment',
    'verified_price',
    'verified_range',
    'quote_verified',
    'minimum_job_applied',
  ]);
  addLines(travelLines(fields), [
    'travel_qualification',
    'travel_distance_miles',
    'travel_duration_minutes',
    'travel_method',
    'travel_provider',
    'travel_destination_source',
  ]);

  // ── G. Scheduling and customer notes ────────────────────────────────────
  add('Scheduling — Arrival preference', ARRIVAL_LABELS[text(fields, 'arrival_preference')] ?? text(fields, 'arrival_preference'), 'arrival_preference');
  add('Scheduling — Preferred days', text(fields, 'preferred_days'), 'preferred_days');
  add('Scheduling — Time preference', text(fields, 'time_preference'), 'time_preference');
  add('Scheduling — Checkout time', text(fields, 'checkout_time'), 'checkout_time');
  add('Scheduling — Check-in time', text(fields, 'checkin_time'), 'checkin_time');
  add('Scheduling — Same-day turnovers', text(fields, 'same_day_turnovers'), 'same_day_turnovers');
  add('Scheduling — Laundry', text(fields, 'laundry'), 'laundry');
  add('Scheduling — Consumables', text(fields, 'consumables'), 'consumables');
  add('Scheduling — Checklist requested', YES_NO_LABELS[text(fields, 'checklist')] ?? text(fields, 'checklist'), 'checklist');
  add('Scheduling — Photos requested', YES_NO_LABELS[text(fields, 'photos')] ?? text(fields, 'photos'), 'photos');
  add('Scheduling — Issue report requested', YES_NO_LABELS[text(fields, 'issue_report')] ?? text(fields, 'issue_report'), 'issue_report');
  add('Scheduling — Interested in recurring', YES_NO_LABELS[text(fields, 'recurring')] ?? text(fields, 'recurring'), 'recurring');
  add('Scheduling — Date note', text(fields, 'preferred_date_note'), 'preferred_date_note');
  add('Notes — Customer (verbatim)', text(fields, 'notes'), 'notes');
  add('Notes — Website message', text(fields, 'message'), 'message');
  add('Notes — Current situation', text(fields, 'current_situation'), 'current_situation');

  // ── H. Internal verification and follow-up ──────────────────────────────
  // Raw machine codes are kept here so the owner can search/filter reliably;
  // the readable verdict lives in the Pricing section.
  add('Internal — Verdict code', text(fields, 'quote_verified'), 'quote_verified');
  add('Internal — Destination source code', text(fields, 'travel_destination_source'), 'travel_destination_source');
  add('Internal — Received at (ISO)', text(fields, 'received_at'), 'received_at');
  add('Internal — Quote reference', text(fields, 'quote_reference'), 'quote_reference');
  add('Internal — Config version (quote)', text(fields, 'quote_config_version'), 'quote_config_version');
  add('Internal — Config version (server)', text(fields, 'server_config_version'), 'server_config_version');
  add('Internal — Config match', text(fields, 'config_version_match'), 'config_version_match');
  add('Internal — Reference format valid', text(fields, 'quote_reference_valid'), 'quote_reference_valid');
  add('Internal — Quote review valid through', text(fields, 'quote_valid_through'), 'quote_valid_through');
  add('Internal — Verification path', text(fields, 'verification_path'), 'verification_path');
  add('Internal — Verification status', text(fields, 'verification_status'), 'verification_status');
  add('Internal — Verification note', text(fields, 'verification_note'), 'verification_note');
  add('Internal — Pin check', text(fields, 'pin_check'), 'pin_check');
  add('Internal — Pin distance from geocode (m)', text(fields, 'pin_distance_from_geocode_meters'), 'pin_distance_from_geocode_meters');
  add('Internal — Pin source', text(fields, 'pin_source'), 'pin_source');
  add('Internal — Estimate confidence', text(fields, 'estimate_confidence'), 'estimate_confidence');
  add('Internal — Pricing category', text(fields, 'pricing_category'), 'pricing_category');
  add('Internal — Estimated labor hours', text(fields, 'estimated_labor_hours'), 'estimated_labor_hours');
  add('Internal — Rate per labor hour', money(text(fields, 'applied_rate_per_labor_hour')), 'applied_rate_per_labor_hour');
  add('Internal — Travel zone', text(fields, 'travel_zone'), 'travel_zone');
  add('Internal — Travel mode', text(fields, 'travel_mode'), 'travel_mode');

  // ── Attribution (lead records only; never sent to analytics) ────────────
  // The website stores first-touch and latest-touch context separately
  // (src/lib/attribution.ts); both are shown with unambiguous labels. Plain
  // utm_* keys remain accepted as a fallback for legacy direct submissions.
  add('Attribution — First-touch source', text(fields, 'first_utm_source'), 'first_utm_source');
  add('Attribution — First-touch medium', text(fields, 'first_utm_medium'), 'first_utm_medium');
  add('Attribution — First-touch campaign', text(fields, 'first_utm_campaign'), 'first_utm_campaign');
  add('Attribution — First-touch content', text(fields, 'first_utm_content'), 'first_utm_content');
  add('Attribution — Latest-touch source', text(fields, 'latest_utm_source', 'utm_source'), 'latest_utm_source', 'utm_source');
  add('Attribution — Latest-touch medium', text(fields, 'latest_utm_medium', 'utm_medium'), 'latest_utm_medium', 'utm_medium');
  add('Attribution — Latest-touch campaign', text(fields, 'latest_utm_campaign', 'utm_campaign'), 'latest_utm_campaign', 'utm_campaign');
  add('Attribution — Latest-touch content', text(fields, 'latest_utm_content', 'utm_content'), 'latest_utm_content', 'utm_content');
  add('Attribution — Google click id', text(fields, 'gclid', 'gbraid', 'wbraid'), 'gclid', 'gbraid', 'wbraid');
  add('Attribution — Latest-touch landing page', text(fields, 'landing_page'), 'landing_page');
  add('Attribution — Latest-touch referrer', text(fields, 'referrer_origin'), 'referrer_origin');

  // ── Anything not mapped above is preserved verbatim ─────────────────────
  for (const [key, value] of Object.entries(fields)) {
    if (used.has(key)) continue;
    if (key === 'extra_ref') continue; // the anti-spam trap never reaches here
    if (typeof value !== 'string' || value.trim() === '') continue;
    notification[`More details — ${humanizeKey(key)}`] = value.trim();
    used.add(key);
  }

  return notification;
}
