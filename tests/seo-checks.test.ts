import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isEffectivelyIndexable,
  isEffectivelyNoindex,
  normalizeOrigin,
  originOf,
  parseRobotsContent,
} from '../scripts/lib/seo-checks.ts';

test('robots: plain noindex is detected (regression for substring bug)', () => {
  assert.equal(isEffectivelyNoindex('noindex'), true);
  assert.equal(isEffectivelyIndexable('noindex'), false);
});

test('robots: "index, follow" is indexable', () => {
  assert.equal(isEffectivelyNoindex('index, follow'), false);
  assert.equal(isEffectivelyIndexable('index, follow'), true);
});

test('robots: conflicting index/noindex resolves to the most restrictive', () => {
  assert.equal(isEffectivelyNoindex('index, noindex'), true);
  assert.equal(isEffectivelyNoindex('noindex, index'), true);
});

test('robots: "none" means noindex,nofollow', () => {
  const parsed = parseRobotsContent('none');
  assert.equal(parsed.noindex, true);
  assert.equal(parsed.nofollow, true);
});

test('robots: case, commas, semicolons and extra whitespace are tolerated', () => {
  assert.equal(isEffectivelyNoindex(' NOINDEX ; follow '), true);
  assert.equal(isEffectivelyNoindex('index;follow'), false);
  assert.equal(isEffectivelyNoindex('max-snippet:-1, index, follow'), false);
  assert.equal(isEffectivelyNoindex('max-image-preview:large,noindex'), true);
});

test('robots: indexifembedded does not by itself imply noindex', () => {
  assert.equal(isEffectivelyNoindex('indexifembedded'), false);
});

test('origin normalization tolerates trailing slashes and defaults', () => {
  assert.equal(normalizeOrigin('https://sparkling-standard.com/'), 'https://sparkling-standard.com');
  assert.equal(normalizeOrigin('  '), 'https://sparkling-standard.com');
  assert.equal(normalizeOrigin('https://example.com'), 'https://example.com');
});

test('canonical origin extraction rejects relative or malformed URLs', () => {
  assert.equal(originOf('https://sparkling-standard.com/about/'), 'https://sparkling-standard.com');
  assert.equal(originOf('/about/'), null);
  assert.equal(originOf('not a url'), null);
});
