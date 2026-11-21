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

const serviceAreaHtml = `<html><head><title>Service Area | Pensacola and Cantonment</title><meta name="description" content="Pensacola coverage." /></head><body><h1 data-service-area-heading>Serving Pensacola, Cantonment, and beyond</h1><p class="lead" data-service-area-lead>Based in the Pensacola-Cantonment area.</p>
<div data-service-area-single-start hidden></div><div data-service-area-single><h2>Pensacola only</h2><div>Single map</div></div><div data-service-area-single-end hidden></div>
<div data-service-area-multi-start hidden></div><template data-service-area-multi-template><h2>Our Service Areas</h2><div>Florida overview</div><div>Tampa map</div></template><div data-service-area-multi-end hidden></div>
</body></html>`;

test('service-area page renders the single Pensacola structure while Tampa is off', () => {
  const output = applyTampaVisibility(serviceAreaHtml, false);
  assert.match(output, /Pensacola only/);
  assert.doesNotMatch(output, /Our Service Areas/);
  assert.doesNotMatch(output, /Tampa map/);
  assert.match(output, /Service Area \| Pensacola and Cantonment/);
  assert.match(output, /Serving Pensacola, Cantonment, and beyond/);
  assert.doesNotMatch(output, /Serving Northwest Florida and Tampa Bay/);
});

test('service-area page switches to both regions and multi-branch metadata when Tampa is live', () => {
  const output = applyTampaVisibility(serviceAreaHtml, true);
  assert.doesNotMatch(output, /Pensacola only/);
  assert.match(output, /Our Service Areas/);
  assert.match(output, /Florida overview/);
  assert.match(output, /Tampa map/);
  assert.doesNotMatch(output, /data-service-area-multi-template/);
  assert.match(output, /data-service-area-multi/);
  assert.match(output, /Service Areas \| Pensacola and Tampa Bay/);
  assert.match(output, /Pasco, Pinellas and Hillsborough/);
  assert.match(output, /Serving Northwest Florida and Tampa Bay/);
  assert.match(output, /approved Tampa Bay communities/);
  assert.doesNotMatch(output, /Serving Pensacola, Cantonment, and beyond/);
});
