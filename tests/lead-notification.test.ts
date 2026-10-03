// Lead-notification presentation tests — the owner email must be readable,
// complete, and honest. Run with: npm test (type-stripped TS).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildLeadNotification } from '../src/lib/forms/lead-notification.ts';

const estimatorBase: Record<string, string> = {
  request_type: 'reservation_request',
  estimate_status: 'estimated',
  service_type: 'standard',
  property_type: 'house',
  square_feet: '1600',
  bedrooms: '3',
  full_baths: '2',
  half_baths: '0',
  frequency: 'biweekly',
  condition: 'maintained',
  last_cleaned: 'within_month',
  pets: 'none',
  addon_ids: 'inside_oven',
  addons: 'Inside oven',
  estimate_low: '180',
  estimate_high: '220',
  estimate_confidence: 'high',
  travel_mode: 'routed',
  travel_zone: 'core',
  travel_qualification: 'verified_route',
  travel_method: 'route',
  travel_provider: 'mapmap',
  travel_distance_miles: '12',
  travel_duration_minutes: '16',
  travel_destination_source: 'address_geocode',
  address_method: 'manual',
  service_address: '100 S Baylen St',
  address_city: 'Pensacola',
  address_state: 'FL',
  zip: '32502',
  address_confirmed: 'yes',
  pin_precision: 'exact',
  pin_latitude: '30.41108',
  pin_longitude: '-87.21641',
  preferred_date: '2026-12-15',
  arrival_preference: 'morning',
  name: 'Synthetic Customer',
  phone: '8500000000',
  email: 'synthetic@example.com',
  quoted_price: '200',
  quote_reference: 'SS-20261002-ABC123',
  quote_config_version: '2026-10-01.option-c.v1',
  quoted_range: '$180–$220',
  received_at: '2026-10-02T21:00:00.000Z',
  verification_path: 'server_relay',
  verification_status: 'authoritative',
  quote_verified: 'verified',
  verified_price: '200',
  server_config_version: '2026-10-01.option-c.v1',
  config_version_match: 'match',
  quote_reference_valid: 'true',
  pin_check: 'ok',
  base_price: '195.91',
  extras_subtotal: '25.2',
  extras_detail: 'Inside oven $25.20',
  addon_incentive: 'None',
  minimum_job_applied: 'false',
  estimated_labor_hours: '4.66',
  applied_rate_per_labor_hour: '42',
  pricing_category: 'recurring_maintenance',
  first_utm_source: 'facebook',
  first_utm_medium: 'organic_social',
  first_utm_campaign: 'recurring',
  first_utm_content: 'feed',
  latest_utm_source: 'facebook',
  latest_utm_medium: 'organic_social',
  latest_utm_campaign: 'recurring',
  latest_utm_content: 'feed',
  landing_page: '/recurring-cleaning/',
  referrer_origin: 'https://www.facebook.com',
};

test('a recurring reservation reads as an ordered business summary', () => {
  const notification = buildLeadNotification(estimatorBase);
  const labels = Object.keys(notification);

  assert.match(notification['Inquiry — Type'] ?? '', /Reservation request/);
  assert.equal(notification['Inquiry — Service'], 'House cleaning (standard)');
  assert.equal(notification['Inquiry — Frequency'], 'Every two weeks');
  assert.equal(notification['Contact — Name'], 'Synthetic Customer');
  assert.equal(notification['Contact — Phone'], '8500000000');
  assert.equal(notification['Contact — Email'], 'synthetic@example.com');
  assert.equal(notification['Location — Address'], '100 S Baylen St');
  assert.equal(notification['Location — City / State / ZIP'], 'Pensacola, FL 32502');
  assert.match(notification['Location — Destination confirmed'] ?? '', /Yes/);
  assert.equal(notification['Home — Property type'], 'House');
  assert.equal(notification['Home — Approximate size'], '1600 sq ft');
  assert.equal(notification['Home — Rooms'], '3 bed · 2 full bath');
  assert.equal(notification['Home — Condition'], 'Maintained');
  assert.equal(notification['Extras — Selected'], 'Inside oven');
  assert.equal(notification['Pricing — Customer-proposed price'], '$200');
  assert.match(notification['Pricing — Verification result'] ?? '', /VERIFIED/);
  assert.match(notification['Travel — Status'] ?? '', /Verified route/);
  assert.equal(notification['Travel — One-way'], '12 mi · 16 min');
  assert.ok(notification['Inquiry — Submitted']?.includes('Central'), 'submitted time is human-readable');

  // Sections keep their intended reading order.
  const inquiryIndex = labels.indexOf('Inquiry — Type');
  const contactIndex = labels.indexOf('Contact — Name');
  const pricingIndex = labels.indexOf('Pricing — Customer-proposed price');
  const internalIndex = labels.indexOf('Internal — Quote reference');
  assert.ok(inquiryIndex < contactIndex && contactIndex < pricingIndex && pricingIndex < internalIndex);
  assert.equal(notification['Internal — Quote reference'], 'SS-20261002-ABC123');
});

test('a one-time estimate without a quote is labeled as unpriced, not verified', () => {
  const notification = buildLeadNotification({
    request_type: 'residential_estimate',
    service_type: 'deep',
    frequency: 'one_time',
    condition: 'average',
    name: 'Synthetic Customer',
    phone: '8500000000',
    email: 'synthetic@example.com',
    estimate_status: 'estimated',
  });
  assert.match(notification['Inquiry — Type'] ?? '', /not a booking/);
  assert.equal(notification['Inquiry — Service'], 'Deep cleaning');
  assert.equal(notification['Inquiry — Frequency'], 'One-time');
  assert.equal(notification['Pricing — Verification result'], undefined, 'no invented verification verdict');
  assert.equal(notification['Pricing — ACTION REQUIRED'], undefined);
});

test('a mismatch produces an explicit action-required warning', () => {
  const notification = buildLeadNotification({
    ...estimatorBase,
    quote_verified: 'mismatch',
    client_price: '200',
    verified_price: '235',
    verification_note: 'The submitted price $200 is different from our verified calculation $235.',
  });
  assert.match(notification['Pricing — Verification result'] ?? '', /MISMATCH/);
  assert.match(notification['Pricing — ACTION REQUIRED'] ?? '', /Review the scope and confirm the correct price/i);
  assert.equal(notification['Pricing — Server recalculated price'], '$235');
});

test('a preliminary verdict is visible without claiming verification', () => {
  const notification = buildLeadNotification({
    ...estimatorBase,
    quote_verified: 'preliminary',
    travel_qualification: 'preliminary_zone',
    travel_destination_source: 'zip_centroid',
  });
  assert.match(notification['Pricing — Verification result'] ?? '', /PRELIMINARY/);
  assert.doesNotMatch(notification['Pricing — Verification result'] ?? '', /VERIFIED/);
  assert.match(notification['Travel — Status'] ?? '', /Preliminary zone/);
  assert.match(notification['Travel — Destination source'] ?? '', /ZIP centroid/);
});

test('an out-of-area inquiry is delivered with manual-review wording', () => {
  const notification = buildLeadNotification({
    request_type: 'residential_estimate',
    service_type: 'standard',
    frequency: 'one_time',
    condition: 'maintained',
    name: 'Synthetic Customer',
    phone: '8500000000',
    estimate_status: 'custom_confirmation_required',
    travel_mode: 'zone',
    travel_qualification: 'manual_review',
    travel_zone: 'outside',
    address_city: 'Atlanta',
    address_state: 'GA',
    zip: '30301',
  });
  assert.match(notification['Travel — Status'] ?? '', /Manual review/);
  assert.equal(notification['Inquiry — Estimate status'], 'custom_confirmation_required');
  assert.equal(notification['Contact — Email'], undefined);
});

test('commercial form fields are grouped for a walkthrough request', () => {
  const notification = buildLeadNotification({
    journey: 'commercial',
    organization: 'Example Church',
    name: 'Facilities Lead',
    phone: '8500000000',
    email: 'facilities@example.com',
    facility_type: 'church',
    square_feet: '12000',
    frequency: 'weekly',
    time_preference: 'Evenings after 6 PM',
    preferred_days: 'Tuesday & Friday',
    walkthrough_date: '2026-12-01',
    current_situation: 'Currently using a rotating crew.',
    notes: 'Two buildings and a fellowship hall.',
  });
  assert.match(notification['Inquiry — Type'] ?? '', /Commercial walkthrough/);
  assert.equal(notification['Contact — Organization'], 'Example Church');
  assert.match(notification['Inquiry — Service'] ?? '', /Commercial — Church/);
  assert.equal(notification['Inquiry — Frequency'], 'Weekly');
  assert.equal(notification['Scheduling — Time preference'], 'Evenings after 6 PM');
  assert.equal(notification['Scheduling — Preferred days'], 'Tuesday & Friday');
  assert.equal(notification['Notes — Current situation'], 'Currently using a rotating crew.');
});

test('short-term-rental form fields are grouped for a turnover request', () => {
  const notification = buildLeadNotification({
    name: 'Host',
    phone: '8500000000',
    email: 'host@example.com',
    property_location: '12 Beach Rd, Pensacola Beach, FL 32561',
    bedrooms: '2',
    full_baths: '2',
    beds: '3',
    turnover_frequency: 'per_stay',
    same_day_turnovers: 'yes',
    checkout_time: '10:00 AM',
    checkin_time: '4:00 PM',
    laundry: 'Yes — on site',
    consumables: 'Yes — we keep a supply closet',
    checklist: 'yes',
    photos: 'yes',
    issue_report: 'yes',
    recurring: 'yes',
  });
  assert.match(notification['Inquiry — Type'] ?? '', /Short-term rental/);
  assert.equal(notification['Location — Address'], '12 Beach Rd, Pensacola Beach, FL 32561');
  assert.equal(notification['Home — Rooms'], '2 bed · 2 full bath');
  assert.equal(notification['Home — Beds to reset'], '3');
  assert.equal(notification['Inquiry — Frequency'], 'Turnovers: Every turnover');
  assert.equal(notification['Scheduling — Checkout time'], '10:00 AM');
  assert.equal(notification['Scheduling — Photos requested'], 'Yes');
  assert.equal(notification['Scheduling — Interested in recurring'], 'Yes');
});

test('customer notes are preserved verbatim, including long text', () => {
  const longNote =
    'We have two dogs and a cat. The back gate sticks — please lift it. ' +
    'Park in the driveway, not the street. Please focus on the kitchen and the master bath. '.repeat(4).trim();
  const notification = buildLeadNotification({
    ...estimatorBase,
    notes: longNote,
  });
  assert.equal(notification['Notes — Customer (verbatim)'], longNote);
  assert.ok((notification['Notes — Customer (verbatim)'] ?? '').length > 300);
});

test('unmapped fields are preserved under More details, and the trap never appears', () => {
  const notification = buildLeadNotification({
    ...estimatorBase,
    custom_field: 'kept',
    internal_marker: 'also kept',
    extra_ref: 'bot-fill',
  });
  assert.equal(notification['More details — Custom field'], 'kept');
  assert.equal(notification['More details — Internal marker'], 'also kept');
  assert.equal(notification['More details — Extra ref'], undefined);
  assert.ok(!Object.keys(notification).some((label) => /extra ref/i.test(label)));
});

test('empty optional fields are omitted instead of adding blank noise', () => {
  const notification = buildLeadNotification({
    request_type: 'residential_estimate',
    service_type: 'standard',
    frequency: 'one_time',
    condition: 'maintained',
    name: 'Synthetic Customer',
    phone: '8500000000',
    email: 'synthetic@example.com',
  });
  for (const [label, value] of Object.entries(notification)) {
    assert.ok(value.trim() !== '', `label "${label}" must not be empty`);
  }
  assert.equal(notification['Home — Approximate size'], undefined);
  assert.equal(notification['Notes — Customer (verbatim)'], undefined);
});

test('no private infrastructure or credential material is ever introduced', () => {
  const notification = buildLeadNotification(estimatorBase);
  const serialized = JSON.stringify(notification);
  assert.doesNotMatch(serialized, /TRAVEL_ORIGIN|ROUTES_API_KEY|MAPMAP_API_KEY|WEB3FORMS_ACCESS_KEY/);
});

test('first-touch and latest-touch attribution are clearly labeled without duplication', () => {
  const notification = buildLeadNotification(estimatorBase);
  assert.equal(notification['Attribution — First-touch source'], 'facebook');
  assert.equal(notification['Attribution — First-touch medium'], 'organic_social');
  assert.equal(notification['Attribution — First-touch campaign'], 'recurring');
  assert.equal(notification['Attribution — First-touch content'], 'feed');
  assert.equal(notification['Attribution — Latest-touch source'], 'facebook');
  assert.equal(notification['Attribution — Latest-touch medium'], 'organic_social');
  assert.equal(notification['Attribution — Latest-touch campaign'], 'recurring');
  assert.equal(notification['Attribution — Latest-touch content'], 'feed');
  assert.equal(notification['Attribution — Latest-touch landing page'], '/recurring-cleaning/');
  assert.equal(notification['Attribution — Latest-touch referrer'], 'https://www.facebook.com');

  const labels = Object.keys(notification);
  assert.ok(
    !labels.some((label) => /More details — .*(utm|attribution)/i.test(label)),
    'attribution fields never fall through to More details',
  );
  assert.equal(labels.filter((label) => /Attribution — .*source/.test(label)).length, 2);
});

test('a different latest-touch campaign is shown beside the preserved first touch', () => {
  const base = { ...estimatorBase };
  delete base.referrer_origin;
  base.first_utm_source = 'facebook';
  base.first_utm_campaign = 'facebook_page';
  base.latest_utm_source = 'nextdoor';
  base.latest_utm_campaign = 'neighborhood';
  base.latest_utm_content = 'sponsored';
  base.gclid = 'gclid-123';

  const notification = buildLeadNotification(base);
  assert.equal(notification['Attribution — First-touch source'], 'facebook');
  assert.equal(notification['Attribution — First-touch campaign'], 'facebook_page');
  assert.equal(notification['Attribution — Latest-touch source'], 'nextdoor');
  assert.equal(notification['Attribution — Latest-touch campaign'], 'neighborhood');
  assert.equal(notification['Attribution — Latest-touch content'], 'sponsored');
  assert.equal(notification['Attribution — Google click id'], 'gclid-123');
  assert.equal(notification['Attribution — Google click id']?.includes('gclid-123'), true);
  const serialized = JSON.stringify(notification);
  assert.equal(serialized.match(/gclid-123/g)?.length, 1, 'the click id appears exactly once');
});

test('legacy plain UTM fields still map to latest-touch labels', () => {
  const notification = buildLeadNotification({
    request_type: 'contact',
    name: 'Synthetic Customer',
    phone: '8500000000',
    email: 'synthetic@example.com',
    utm_source: 'facebook',
    utm_medium: 'organic_social',
    utm_campaign: 'legacy_campaign',
    utm_content: 'ad',
  });
  assert.equal(notification['Attribution — Latest-touch source'], 'facebook');
  assert.equal(notification['Attribution — Latest-touch medium'], 'organic_social');
  assert.equal(notification['Attribution — Latest-touch campaign'], 'legacy_campaign');
  assert.equal(notification['Attribution — Latest-touch content'], 'ad');
  assert.equal(notification['More details — Utm source'], undefined);
});
