import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { branchConfigs } from '../src/config/branches.ts';
import { zipReference } from '../src/config/geography.ts';
import { zipTaxJurisdictions } from '../src/config/tax.ts';

const snapshot = JSON.parse(fs.readFileSync('scripts/data/census-zcta-counties.json', 'utf8')) as {
  entries: Record<string, { branch: string; counties: string[] }>;
};

test('every approved service-area ZIP has an authoritative Census county record', () => {
  for (const zip of Object.keys(zipReference)) {
    assert.ok(snapshot.entries[zip], `Pensacola ZIP ${zip} is missing from the Census audit`);
    assert.ok(snapshot.entries[zip]!.counties.length > 0, `Pensacola ZIP ${zip} has no county`);
  }
  for (const zip of branchConfigs.branch_tampa.serviceAreaZips) {
    assert.ok(snapshot.entries[zip], `Tampa ZIP ${zip} is missing from the Census audit`);
    assert.ok(snapshot.entries[zip]!.counties.length > 0, `Tampa ZIP ${zip} has no county`);
  }
});

test('live Pensacola tax counties agree with the Census audit', () => {
  for (const zip of Object.keys(zipReference)) {
    const tax = zipTaxJurisdictions[zip];
    assert.ok(tax, `live ZIP ${zip} has no tax jurisdiction`);
    const counties = snapshot.entries[zip]!.counties;
    if (zip === '32561') {
      assert.equal(tax.county, null, 'split Gulf Breeze / Pensacola Beach ZIP must require the address county');
      assert.deepEqual([...counties].sort(), ['Escambia', 'Santa Rosa']);
      continue;
    }
    if (counties.length === 1) assert.equal(tax.county, counties[0], `ZIP ${zip} tax county disagrees with Census`);
  }
  assert.equal(zipTaxJurisdictions['32534']?.county, 'Escambia');
  assert.equal(zipTaxJurisdictions['32577']?.county, 'Escambia');
});

test('Tampa cross-county ZIPs are explicitly recorded for launch review', () => {
  const crossCounty = Object.entries(snapshot.entries)
    .filter(([, entry]) => entry.branch === 'branch_tampa' && entry.counties.length > 1)
    .map(([zip]) => zip)
    .sort();
  assert.ok(crossCounty.length > 0, 'the snapshot must expose Tampa cross-county coverage rather than hiding it');
  assert.deepEqual(snapshot.entries['34609']?.counties, ['Hernando'], 'Spring Hill 34609 must be recorded as Hernando County');
});
