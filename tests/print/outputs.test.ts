// Generated print outputs — structural checks when a build exists.
// The full geometric/QR/crop verification is `npm run print:verify`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { defaultOutputRoot, pieceById } from '../../scripts/print/manifest.mjs';

const outRoot = process.env.PRINT_OUT_DIR ?? defaultOutputRoot();
const manifestPath = path.join(outRoot, 'Specifications', 'asset-manifest.json');
const hasBuild = fs.existsSync(manifestPath);

test('generated outputs are structurally complete (skipped when not built)', { skip: !hasBuild && 'no print build found' }, () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.entries.length, 27, '27 sides expected (9 sides × 3 variants)');
  for (const entry of manifest.entries) {
    const piece = pieceById(entry.piece);
    assert.ok(piece, `known piece ${entry.piece}`);
    for (const relative of entry.files) {
      assert.ok(fs.existsSync(path.join(outRoot, relative)), relative);
    }
    if (entry.qrUrl) assert.match(entry.qrUrl, /^https:\/\/sparkling-standard\.com\//);
  }
  assert.equal(Object.keys(manifest.productionMix).length, 8);
});
