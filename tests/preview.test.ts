import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPreviewHost, previewApiBlocked } from '../src/lib/env/preview.ts';

test('preview hosts are isolated from production hosts', () => {
  assert.equal(isPreviewHost('sparkling-standard.com'), false);
  assert.equal(isPreviewHost('www.sparkling-standard.com'), false);
  assert.equal(isPreviewHost('abc123.sparkling-standard-cleaning.pages.dev'), true);
  assert.equal(isPreviewHost('sparkling-standard-recurring.owner-e75.workers.dev'), true);
  assert.equal(isPreviewHost('localhost'), false);
});

test('preview API routes are blocked while static pages remain available', () => {
  assert.equal(previewApiBlocked('/api/lead'), true);
  assert.equal(previewApiBlocked('/api/admin/customers'), true);
  assert.equal(previewApiBlocked('/api/estimate-checkout'), true);
  assert.equal(previewApiBlocked('/'), false);
  assert.equal(previewApiBlocked('/estimate/residential/'), false);
  assert.equal(previewApiBlocked('/_astro/app.js'), false);
});
