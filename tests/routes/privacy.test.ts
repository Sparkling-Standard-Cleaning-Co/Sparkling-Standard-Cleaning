// Route privacy test — no real residential data may enter the repository.
//
// The estimator legitimately contains public city-centre coordinates; the
// invariants enforced here are the ones that protect residential canvassing
// data: operational outputs stay untracked, no origin value is committed,
// no canvass-data file shape appears in tracked files, and fixtures are
// unmistakably synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Tracked + untracked-but-not-ignored files (the set that could be committed).
const tracked = execSync('git ls-files --cached --others --exclude-standard', { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);
const textExtensions = /\.(md|json|js|mjs|ts|py|csv|html|txt|yml|yaml|astro)$/i;

test('canvass-out is git-ignored and contains no tracked files', () => {
  const ignore = execSync('git check-ignore canvass-out', { encoding: 'utf8' }).trim();
  assert.equal(ignore, 'canvass-out');
  assert.equal(tracked.some((file) => file.startsWith('canvass-out/')), false);
});

test('no canvass operational output is tracked', () => {
  const forbidden = ['master_addresses.csv', 'routes.geojson', 'route_object.json', 'performance_tracking.csv', 'routes.csv'];
  for (const file of tracked) {
    for (const name of forbidden) {
      assert.equal(file.endsWith(name), false, `tracked operational output: ${file}`);
    }
  }
});

test('no private origin value is committed', () => {
  const originValue = /TRAVEL_ORIGIN\s*=\s*[-0-9]/;
  for (const file of tracked) {
    if (!textExtensions.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(originValue.test(text), false, `origin value in ${file}`);
  }
});

test('no tracked file carries a canvass-style address+coordinate record', () => {
  const addressField = /"?Full_Address"?/;
  const latitudeField = /"?Latitude"?\s*[:=]\s*-?\d/;
  for (const file of tracked) {
    if (!textExtensions.test(file)) continue;
    if (file.startsWith('tests/routes/')) continue; // synthetic fixtures only
    const text = fs.readFileSync(file, 'utf8');
    if (addressField.test(text) && latitudeField.test(text)) {
      assert.fail(`canvass-style address+coordinate record in ${file}`);
    }
  }
});

test('route fixtures are unmistakably synthetic', () => {
  const fixtureFile = tracked.find((file) => file === 'tests/routes/fixtures.py');
  assert.ok(fixtureFile, 'fixtures.py is tracked');
  const text = fs.readFileSync(path.resolve(fixtureFile), 'utf8');
  assert.match(text, /SYNTHETIC/);
  assert.match(text, /SYN-/);
});
