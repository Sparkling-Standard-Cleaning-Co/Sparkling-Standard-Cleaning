// Print manifest integrity tests — run by `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PIECES, VARIANTS, PRODUCTION_MIX, PRINT_GEOMETRY } from '../../scripts/print/manifest.mjs';
import { resolveQrAsset } from '../../scripts/print/qr-map.mjs';

test('variants are unique and complete', () => {
  assert.equal(VARIANTS.length, 3);
  assert.equal(new Set(VARIANTS.map((variant) => variant.id)).size, 3);
});

test('pieces are unique with positive trim dimensions', () => {
  assert.equal(new Set(PIECES.map((piece) => piece.id)).size, PIECES.length);
  for (const piece of PIECES) {
    assert.ok(piece.width > 0 && piece.height > 0, `${piece.id} dimensions`);
    assert.ok(piece.safeMargin > 0 && piece.safeMargin < Math.min(piece.width, piece.height) / 2, `${piece.id} safe margin`);
    assert.ok(piece.sides.length >= 1, `${piece.id} sides`);
  }
});

test('business card is double-sided and every QR asset resolves', () => {
  const card = PIECES.find((piece) => piece.id === 'business-card');
  assert.deepEqual(card.sides.map((side) => side.id), ['front', 'back']);
  for (const piece of PIECES) {
    for (const side of piece.sides) {
      if (!side.qr) continue;
      const resolved = resolveQrAsset(side.qr);
      assert.match(resolved.url, /^https:\/\/sparkling-standard\.com\//);
      assert.ok(fs.existsSync(path.resolve(resolved.svgPath)), `${side.qr} svg exists`);
      assert.ok(fs.existsSync(path.resolve(resolved.pngPath)), `${side.qr} png exists`);
      assert.ok(side.captionMin > 0, `${piece.id}/${side.id} captionMin`);
    }
  }
});

test('door hanger carries the die specification and clearance', () => {
  const hanger = PIECES.find((piece) => piece.id === 'door-hanger');
  assert.ok(hanger.die, 'die spec present');
  assert.equal(hanger.die.holeDiameter, 1.25);
  assert.equal(hanger.die.centerFromTop, 0.925);
  assert.ok(hanger.die.minClearanceBelowHole >= 0.25);
});

test('production mix covers every piece with a valid variant', () => {
  for (const piece of PIECES) {
    const variant = PRODUCTION_MIX[piece.id];
    assert.ok(VARIANTS.some((entry) => entry.id === variant), `${piece.id} -> ${variant}`);
  }
});

test('bleed geometry is the documented 0.125 in', () => {
  assert.equal(PRINT_GEOMETRY.bleed, 0.125);
  assert.ok(PRINT_GEOMETRY.cropMarkGap + PRINT_GEOMETRY.cropMarkLength < PRINT_GEOMETRY.bleed);
});
