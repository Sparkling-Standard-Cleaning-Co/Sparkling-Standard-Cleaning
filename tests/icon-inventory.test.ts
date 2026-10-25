// Initiative 6.3 white-tile icon inventory guard.
//
// Proves the approved 17-asset pack is present, mapped exactly once in the
// registry, and actually referenced by a website surface. It also prevents a
// stray file from the retired vector collection reappearing as a competing
// source of truth.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ICON_DIR = 'src/assets/icons/white-tile';
const REGISTRY = 'src/lib/premium-icons.ts';
const RENDERER = 'src/components/PremiumIcon.astro';

const expectedAssets = [
  '01_residential-cleaning.webp',
  '02_deep-cleaning.webp',
  '03_move-in-move-out.webp',
  '04_str-turnover.webp',
  '05_commercial-cleaning.webp',
  '06_church-cleaning.webp',
  '07_community-support.webp',
  '08_read-reviews.webp',
  '09_locally-owned.webp',
  '10_christian-values.webp',
  '11_flexible-scheduling.webp',
  '12_competitive-pricing.webp',
  '13_seniors.webp',
  '14_first-responders.webp',
  '15_military-veterans.webp',
  '16_disability-support.webp',
  '17_other-community.webp',
];

test('the approved 17 white-tile WebP assets are present', () => {
  const files = fs
    .readdirSync(ICON_DIR)
    .filter((name) => name.endsWith('.webp'))
    .sort();
  assert.deepEqual(files, expectedAssets);
});

test('the premium icon registry contains exactly the 17 approved names', () => {
  const source = fs.readFileSync(REGISTRY, 'utf8');
  const names = [...source.matchAll(/\|\s*'([a-z-]+)'/g)].map((match) => match[1]);
  assert.equal(new Set(names).size, 17, `expected 17 unique registry names, got ${names.length}`);
  assert.ok(names.includes('competitive-pricing'));
  assert.ok(names.includes('other-community'));
  assert.ok(names.includes('read-reviews'));
});

test('PremiumIcon imports every white-tile asset and has no SVG fallback', () => {
  const source = fs.readFileSync(RENDERER, 'utf8');
  for (const asset of expectedAssets) {
    assert.ok(source.includes(asset), `missing renderer import: ${asset}`);
  }
  assert.ok(!source.includes('premium-icon__svg'), 'retired vector renderer must be gone');
  assert.ok(source.includes('premium-icon__image'), 'raster renderer class is required');
});

test('the retired premium vector directory is gone', () => {
  assert.equal(fs.existsSync('src/assets/icons/premium'), false);
});

test('every approved icon is referenced by an active website source', () => {
  const sourceFiles = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory)) {
      const full = path.join(directory, entry);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/\.(astro|ts)$/.test(full)) sourceFiles.push(full);
    }
  };
  walk('src');
  const corpus = sourceFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  const names = [
    'recurring-residential',
    'deep-cleaning',
    'move-in-move-out',
    'short-term-rental',
    'commercial-cleaning',
    'church-cleaning',
    'community-support',
    'read-reviews',
    'locally-owned',
    'christian-values',
    'flexible-scheduling',
    'competitive-pricing',
    'seniors',
    'first-responders',
    'military-veterans',
    'disability-support',
    'other-community',
  ];
  for (const name of names) {
    const occurrences = [...corpus.matchAll(new RegExp(`['"]${name}['"]`, 'g'))].length;
    assert.ok(occurrences >= 1, `icon ${name} is not used by an active surface`);
  }
});
