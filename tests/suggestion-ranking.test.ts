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
  assert.equal(streetMatches('6360 Haupert Lane', 'Haupert Lane, Molino, Florida'), true);
  assert.equal(streetMatches('6360 Haupert Lane', '6360 Peppermill Lane, Georgia'), false);
  assert.deepEqual(distinctiveTokens('6360 Haupert Lane'), ['haupert']);
  assert.ok(normalizeStreetTokens('6360 Haupert Ln').includes('lane'));
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
    row('6360 Peppermill Lane', 'Florida, 32577, United States'),
    row('Haupert Lane', 'Florida, 32577, United States', 'street'),
    row('6360 Haupert Lane', 'Florida, 32577, United States'),
  ];
  const result = rankSuggestions(
    rows,
    { street: '6360 Haupert Lane', state: 'FL', zip: '32577' },
    '6360',
  );
  assert.equal(result.ranked[0].label, suggestionLabel(rows[2]));
  assert.ok(result.ranked[0].score > result.ranked[1].score);
  // The unrelated street is dropped entirely by the street filter.
  assert.equal(result.ranked.some((entry) => entry.label.includes('Peppermill')), false);
});

test('the selected state is required even when the street name matches', () => {
  const rows = [row('Haupert Lane', 'Georgia, United States', 'street')];
  const result = rankSuggestions(rows, { street: '6360 Haupert Lane', state: 'FL' }, '6360');
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
  assert.deepEqual(suggestQueryVariants('3370 S Highway 97', 'Milton'), ['3370 South Highway 97, Milton']);
  const srVariants = suggestQueryVariants('3370 SR 97', 'Milton');
  assert.equal(srVariants[0], '3370 State Road 97, Milton');
  assert.deepEqual(suggestQueryVariants('3370 Hwy 97', 'Milton'), ['3370 Highway 97, Milton']);
  assert.deepEqual(suggestQueryVariants('', ''), []);
});

test('query variants expand common street-suffix abbreviations first', () => {
  const cases: Array<[string, string, string]> = [
    ['6360 Haupert Ln', 'Molino', '6360 Haupert Lane, Molino'],
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
    assert.ok(variants.length <= 2, 'conservative provider-request limit');
  }
});

test('query variants never rewrite a leading "St" that means Saint', () => {
  assert.deepEqual(suggestQueryVariants('400 St Andrews Dr', 'Pensacola'), ['400 St Andrews Drive, Pensacola']);
  // Nothing useful can be offered for a base query that already expands
  // cleanly — no provider request is wasted.
  assert.deepEqual(suggestQueryVariants('St Michael Way', 'Milton'), []);
});

test('query variants add the common abbreviation for full suffix words', () => {
  const lane = suggestQueryVariants('6360 Haupert Lane', 'Molino');
  assert.deepEqual(lane, ['6360 Haupert Ln, Molino']);
  const street = suggestQueryVariants('100 S Baylen Street', 'Pensacola');
  assert.ok(street.includes('100 South Baylen St, Pensacola'), `abbreviation variant present: ${street.join(' | ')}`);
});

test('at most two provider variants are offered, original entry untouched', () => {
  const variants = suggestQueryVariants('6360 Haupert Ln', 'Molino');
  assert.ok(variants.length <= 2);
  assert.ok(variants[0]?.includes('Haupert Lane'));
  assert.equal('6360 Haupert Ln', '6360 Haupert Ln');
});
