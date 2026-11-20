import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTampaVisibility, isProductionPublicHost, isTampaPublicPath, tampaEnabledFromRow } from '../src/lib/branches/public-visibility.ts';

const html = '<h2><span data-tampa-public>Two</span><span data-tampa-off hidden>One operating region</span></h2><div class="grid"><div class="card">Pensacola</div><div class="card" data-tampa-public><p>Tampa</p></div></div>';

test('Tampa public paths are recognized with and without a trailing slash', () => {
  assert.equal(isTampaPublicPath('/locations/tampa-bay/'), true);
  assert.equal(isTampaPublicPath('/locations/tampa-bay'), true);
  assert.equal(isTampaPublicPath('/locations/pensacola/'), false);
});

test('only the canonical public hosts receive the visibility switch', () => {
  assert.equal(isProductionPublicHost('sparkling-standard.com'), true);
  assert.equal(isProductionPublicHost('www.sparkling-standard.com'), true);
  assert.equal(isProductionPublicHost('preview.pages.dev'), false);
});

test('Tampa is enabled only when the persisted branch is live and active', () => {
  assert.equal(tampaEnabledFromRow({ lifecycle_status: 'live', status: 'active' }), true);
  assert.equal(tampaEnabledFromRow({ lifecycle_status: 'setup', status: 'inactive' }), false);
  assert.equal(tampaEnabledFromRow({ lifecycle_status: 'live', status: 'inactive' }), false);
  assert.equal(tampaEnabledFromRow(null), false);
});

test('Tampa-off output removes Tampa card and reveals the single-region heading', () => {
  const output = applyTampaVisibility(html, false);
  assert.match(output, /One operating region/);
  assert.match(output, /Pensacola/);
  assert.doesNotMatch(output, /Tampa/);
  assert.doesNotMatch(output, /data-tampa-public/);
});

test('Tampa-on output retains both regions and removes the single-region heading', () => {
  const output = applyTampaVisibility(html, true);
  assert.match(output, /Two/);
  assert.match(output, /Tampa/);
  assert.doesNotMatch(output, /One operating region/);
});
