import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PENSACOLA_ZIP_COUNTIES,
  pensacolaServiceAreaGroups,
  pensacolaServiceAreaSummary,
} from '../src/config/service-area-pensacola.ts';
import { zipReference } from '../src/config/geography.ts';

test('the configured Pensacola inventory matches the approved ZIP reference', () => {
  const zips = Object.keys(zipReference).sort();
  assert.equal(zips.length, 35);
  assert.deepEqual(zips, Object.keys(PENSACOLA_ZIP_COUNTIES).sort());
  const summary = pensacolaServiceAreaSummary(zips);
  assert.equal(summary.total, 35);
  assert.equal(summary.direct, 22);
  assert.equal(summary.arrangement, 13);
  assert.equal(summary.crossCounty, 3);
});

test('the inventory distinguishes direct, arrangement and cross-county territories', () => {
  const groups = pensacolaServiceAreaGroups(Object.keys(zipReference));
  const escambiaFl = groups.find((group) => group.key === 'escambia-fl');
  const santaRosaFl = groups.find((group) => group.key === 'santa-rosa-fl');
  const baldwinAl = groups.find((group) => group.key === 'baldwin-al');
  const crossCounty = groups.find((group) => group.key === 'cross-county');
  assert.equal(escambiaFl?.entries.length, 14);
  assert.equal(santaRosaFl?.entries.length, 7);
  assert.equal(baldwinAl?.entries.length, 11);
  assert.deepEqual(crossCounty?.entries.map((entry) => entry.zip), ['32561', '36426', '36502']);
  assert.equal(groups.find((group) => group.key === 'escambia-fl')?.entries.every((entry) => entry.direct), true);
  assert.equal(groups.find((group) => group.key === 'baldwin-al')?.entries.every((entry) => entry.arrangement), true);
});
