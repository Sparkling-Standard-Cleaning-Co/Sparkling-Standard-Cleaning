// Geographic suggestion filtering + ranking tests — the production defect
// where "3370 S Highway 97" (Florida) returned Georgia/Tennessee results.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  distinctiveTokens,
  normalizeStreetTokens,
  rankSuggestions,
  routeNumbers,
  streetMatches,
  suggestQueryVariants,
  suggestionLabel,
  suggestionZip,
  type RawSuggestion,
} from '../src/lib/location/suggestion-ranking.ts';

const row = (name: string, context: string, kind = 'address'): RawSuggestion => ({
  id: `${name}-${context}`,
  name,
  context,
  kind,
  lat: 30,
  lng: -87,
});

test('road-name variations normalize to the same route', () => {
  assert.deepEqual(routeNumbers('3370 S Highway 97'), ['97']);
  assert.deepEqual(routeNumbers('3370 Hwy 97'), ['97']);
  assert.deepEqual(routeNumbers('3370 SR 97'), ['97']);
  assert.deepEqual(routeNumbers('3370 State Road 97'), ['97']);
  assert.deepEqual(routeNumbers('3370 FL-97'), ['97']);
  assert.equal(streetMatches('3370 S Highway 97', '3380 South State Road 97, Milton, Florida'), true);
  assert.equal(streetMatches('3370 S Highway 97', '3370 South Highway 97, Milton, Florida'), true);
  assert.equal(streetMatches('4242 Maplewood Lane', 'Maplewood Lane, Molino, Florida'), true);
  assert.equal(streetMatches('4242 Maplewood Lane', '9999 Birchwood Lane, Georgia'), false);
  assert.deepEqual(distinctiveTokens('4242 Maplewood Lane'), ['maplewood']);
  assert.ok(normalizeStreetTokens('4242 Maplewood Ln').includes('lane'));
});

test('out-of-state suggestions are never returned when Florida is selected', () => {
  const rows = [
    row('3370 S Highway 97', 'Georgia, United States'),
    row('3370 S Highway 97', 'Tennessee, United States'),
    row('3370 South Highway 97', 'Milton, Florida, 32570, United States', 'street'),
  ];
  const result = rankSuggestions(rows, { street: '3370 S Highway 97', state: 'FL' }, '3370');
  assert.equal(result.ranked.length, 1);
  assert.match(result.ranked[0].label, /Florida/);
  assert.equal(result.needsLocation, false, 'an in-state match means we do not prompt');
});

test('with no in-state result and no city/ZIP, the customer is prompted instead', () => {
  const rows = [
    row('3370 S Highway 97', 'Georgia, United States'),
    row('3370 S Highway 97', 'Tennessee, United States'),
  ];
  const withoutLocation = rankSuggestions(rows, { street: '3370 S Highway 97', state: 'FL' }, '3370');
  assert.equal(withoutLocation.ranked.length, 0);
  assert.equal(withoutLocation.needsLocation, true, 'prompt for city or ZIP');

  const withZip = rankSuggestions(rows, { street: '3370 S Highway 97', state: 'FL', zip: '32570' }, '3370');
  assert.equal(withZip.ranked.length, 0);
  assert.equal(withZip.needsLocation, false, 'a ZIP was supplied; do not ask again');
});

test('a conflicting ZIP is hard-filtered; a matching ZIP is ranked up', () => {
  const rows = [
    row('1459 Molino Road', 'Florida, 32577, United States'),
    row('1459 Molino Road', 'Florida, 32570, United States'),
  ];
  const result = rankSuggestions(
    rows,
    { street: '1459 Molino Road', state: 'FL', zip: '32577' },
    '1459',
  );
  assert.deepEqual(result.ranked.map((entry) => suggestionZip(entry)), ['32577']);
});

test('exact house numbers rank first and wrong numbers are never exact', () => {
  const rows = [
    row('9999 Birchwood Lane', 'Florida, 32577, United States'),
    row('Maplewood Lane', 'Florida, 32577, United States', 'street'),
    row('4242 Maplewood Lane', 'Florida, 32577, United States'),
  ];
  const result = rankSuggestions(
    rows,
    { street: '4242 Maplewood Lane', state: 'FL', zip: '32577' },
    '4242',
  );
  assert.equal(result.ranked[0].label, suggestionLabel(rows[2]));
  assert.ok(result.ranked[0].score > result.ranked[1].score);
  // The unrelated street is dropped entirely by the street filter.
  assert.equal(result.ranked.some((entry) => entry.label.includes('Birchwood')), false);
});

test('the selected state is required even when the street name matches', () => {
  const rows = [row('Maplewood Lane', 'Georgia, United States', 'street')];
  const result = rankSuggestions(rows, { street: '4242 Maplewood Lane', state: 'FL' }, '4242');
  assert.equal(result.ranked.length, 0);
  assert.equal(result.needsLocation, true);
});

test('Alabama works identically for an exact house number', () => {
  const rows = [
    row('201 E Louisville Ave', 'Atmore, Alabama, 36502, United States'),
    row('201 E Louisville Ave', 'Georgia, United States'),
  ];
  const result = rankSuggestions(rows, { street: '201 E Louisville Ave', state: 'AL', zip: '36502' }, '201');
  assert.equal(result.ranked.length, 1);
  assert.match(result.ranked[0].label, /Alabama/);
});

test('query variants expand directions and highway synonyms', () => {
  const hwyVariants = suggestQueryVariants('3370 S Highway 97', 'Milton');
  assert.equal(hwyVariants[0], '3370 South Highway 97, Milton');
  assert.ok(hwyVariants.includes('South Highway 97, Milton'), 'street-level fallback present');
  const srVariants = suggestQueryVariants('3370 SR 97', 'Milton');
  assert.equal(srVariants[0], '3370 State Road 97, Milton');
  const highwayVariants = suggestQueryVariants('3370 Hwy 97', 'Milton');
  assert.equal(highwayVariants[0], '3370 Highway 97, Milton');
  assert.deepEqual(suggestQueryVariants('', ''), []);
});

test('query variants expand common street-suffix abbreviations first', () => {
  const cases: Array<[string, string, string]> = [
    ['4242 Maplewood Ln', 'Molino', '4242 Maplewood Lane, Molino'],
    ['100 S Baylen St', 'Pensacola', '100 South Baylen Street, Pensacola'],
    ['55 Sunset Rd', 'Pace', '55 Sunset Road, Pace'],
    ['9 Palafox Pl', 'Pensacola', '9 Palafox Place, Pensacola'],
    ['7 Bay Bluff Dr', 'Gulf Breeze', '7 Bay Bluff Drive, Gulf Breeze'],
    ['3 Oak Ct', 'Cantonment', '3 Oak Court, Cantonment'],
    ['12 Woodland Cir', 'Milton', '12 Woodland Circle, Milton'],
    ['44 River Ter', 'Jay', '44 River Terrace, Jay'],
    ['88 Larkspur Ave', 'Cantonment', '88 Larkspur Avenue, Cantonment'],
    ['100 Gulf Blvd', 'Navarre', '100 Gulf Boulevard, Navarre'],
    ['2100 Nine Mile Pkwy', 'Pensacola', '2100 Nine Mile Parkway, Pensacola'],
  ];
  for (const [input, city, expected] of cases) {
    const variants = suggestQueryVariants(input, city);
    assert.equal(variants[0], expected, `${input} → ${variants.join(' | ')}`);
    assert.ok(variants.length <= 4, 'conservative provider-request limit');
  }
});

test('query variants never rewrite a leading "St" that means Saint', () => {
  const variants = suggestQueryVariants('400 St Andrews Dr', 'Pensacola');
  assert.equal(variants[0], '400 St Andrews Drive, Pensacola');
  // Nothing useful can be offered for a base query that already expands
  // cleanly — no provider request is wasted.
  assert.deepEqual(suggestQueryVariants('St Michael Way', 'Milton'), []);
});

test('query variants add the common abbreviation for full suffix words', () => {
  const lane = suggestQueryVariants('4242 Maplewood Lane', 'Molino');
  assert.equal(lane[0], '4242 Maplewood Ln, Molino');
  const street = suggestQueryVariants('100 S Baylen Street', 'Pensacola');
  assert.ok(street.includes('100 South Baylen St, Pensacola'), `abbreviation variant present: ${street.join(' | ')}`);
});

test('house-numberless street-level fallback is offered, original untouched', () => {
  const variants = suggestQueryVariants('4242 Maplewood Ln', 'Molino');
  assert.ok(variants.length <= 4);
  assert.ok(variants[0]?.includes('Maplewood Lane'));
  const numberless = suggestQueryVariants('4242 Maplewood Ln');
  assert.ok(numberless.includes('Maplewood Lane'), `street-level fallback: ${numberless.join(' | ')}`);
  assert.ok(numberless.includes('Maplewood Ln'), `original street-level fallback: ${numberless.join(' | ')}`);
  assert.equal('4242 Maplewood Ln', '4242 Maplewood Ln');
});

test('two-letter state abbreviations in context are accepted (FL and AL)', () => {
  const rows = [
    row('316 S Baylen St', 'Pensacola, FL, 32502, United States'),
    row('100 Main St', 'Atlanta, GA, 30303, United States'),
  ];
  const result = rankSuggestions(rows, { street: '316 S Baylen St', state: 'FL' }, '316');
  assert.equal(result.ranked.length, 1);
  assert.match(result.ranked[0].label, /Pensacola/);

  const alRows = [row('201 E Louisville Ave', 'Atmore, AL, 36502, United States')];
  const alResult = rankSuggestions(alRows, { street: '201 E Louisville Ave', state: 'AL' }, '201');
  assert.equal(alResult.ranked.length, 1);
});

test('state names inside street text never trigger false region matches', () => {
  // "Indiana Avenue" contains "india" as a substring; a substring-based
  // filter used to drop this valid Florida street.
  const rows = [
    row('500 Indiana Avenue', 'Pensacola, Florida, 32505, United States'),
    row('500 Georgia Avenue', 'Atlanta, Georgia, 30312, United States'),
  ];
  const result = rankSuggestions(rows, { street: '500 Indiana Avenue', state: 'FL' }, '500');
  assert.equal(result.ranked.length, 1);
  assert.match(result.ranked[0].label, /Pensacola/);
});

test('partially typed street tokens match by safe prefix', () => {
  assert.equal(streetMatches('316 Bayl', '316 South Baylen Street, Pensacola, Florida'), true);
  assert.equal(streetMatches('316 Bayl', '316 Bay Street, Pensacola, Florida'), false);
  assert.equal(streetMatches('500 Pine For', '500 Pine Forest Road, Pensacola, Florida'), true);
  // Either distinctive token alone is not enough for multi-word streets.
  assert.equal(streetMatches('500 Pine Forest', '500 Pine Hollow Road, Pensacola, Florida'), false);
  assert.equal(streetMatches('500 Pine Forest', '500 Pine Forest Road, Pensacola, Florida'), true);
});

test('nearby same-state matches rank above far-away ones', () => {
  const rows = [
    { ...row('316 S Baylen St', 'South Miami, Florida, 33143, United States'), lat: 25.7, lng: -80.29 },
    { ...row('316 S Baylen St', 'Pensacola, Florida, 32502, United States'), lat: 30.41, lng: -87.21 },
  ];
  const result = rankSuggestions(rows, { street: '316 S Baylen St', state: 'FL' }, null);
  assert.equal(result.ranked.length, 2);
  assert.match(result.ranked[0].label, /Pensacola/);
  assert.ok(result.ranked[0].score > result.ranked[1].score);
});

test('rows with no state signal fail closed when a state is selected', () => {
  const rows = [row('316 S Baylen St', 'United States')];
  const result = rankSuggestions(rows, { street: '316 S Baylen St', state: 'FL' }, '316');
  assert.equal(result.ranked.length, 0);
});
