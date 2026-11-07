import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('the production CSP allows the first-party integrations without wildcard scripts', () => {
  const headers = fs.readFileSync('public/_headers', 'utf8');
  const line = headers.split(/\r?\n/).find((entry) => entry.includes('Content-Security-Policy:'));
  assert.ok(line, 'CSP is present');
  const script = /script-src ([^;]+)/.exec(line ?? '')?.[1] ?? '';
  assert.match(script, /'self'/);
  assert.match(script, /https:\/\/maps\.googleapis\.com/);
  assert.match(script, /https:\/\/maps\.gstatic\.com/);
  assert.match(script, /https:\/\/www\.googletagmanager\.com/);
  assert.match(script, /https:\/\/challenges\.cloudflare\.com/);
  assert.doesNotMatch(script, /(^|\s)https:(\s|$)/, 'no wildcard https script source');
  assert.match(line ?? '', /style-src [^;]*https:\/\/fonts\.googleapis\.com/);
  assert.match(line ?? '', /font-src [^;]*https:\/\/fonts\.gstatic\.com/);
  assert.match(line ?? '', /frame-ancestors 'none'/);
  assert.match(line ?? '', /object-src 'none'/);
});
