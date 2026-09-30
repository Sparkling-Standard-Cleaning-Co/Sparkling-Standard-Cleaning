// Photo guardrails: check dimensions, file size and format before committing
// images; optionally downscale in place.
//
// Usage:
//   node scripts/photo.mjs <file-or-dir> [more...]
//   node scripts/photo.mjs <file-or-dir> --resize 2000 --write
//
// Targets: <= 2000px long edge, JPEG/WebP/PNG, under ~500 KB where practical.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const args = process.argv.slice(2);
const RESIZE_INDEX = args.indexOf('--resize');
const RESIZE = RESIZE_INDEX >= 0 ? Number(args[RESIZE_INDEX + 1]) : null;
const WRITE = args.includes('--write');
const targets = args.filter((arg, index) => !arg.startsWith('--') && index !== RESIZE_INDEX + 1);

if (targets.length === 0) {
  console.error('Usage: node scripts/photo.mjs <file-or-dir> [--resize 2000 --write]');
  process.exit(1);
}

const IMAGE_EXT = /\.(jpe?g|png|webp|avif|tiff?)$/i;

function walk(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return IMAGE_EXT.test(target) ? [target] : [];
  const out = [];
  for (const item of fs.readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, item.name);
    if (item.isDirectory()) out.push(...walk(full));
    else if (IMAGE_EXT.test(full)) out.push(full);
  }
  return out;
}

const files = targets.flatMap(walk);
if (files.length === 0) {
  console.error('No image files found in the given targets.');
  process.exit(1);
}

let warnings = 0;
for (const file of files) {
  const buffer = fs.readFileSync(file);
  const metadata = await sharp(buffer).metadata();
  const sizeKb = Math.round(buffer.length / 1024);
  const longEdge = Math.max(metadata.width ?? 0, metadata.height ?? 0);
  const issues = [];

  if (longEdge > 4000) issues.push(`${longEdge}px long edge (>4000)`);
  else if (longEdge > 2000) issues.push(`${longEdge}px long edge (>2000 target)`);
  if (sizeKb > 1024) issues.push(`${sizeKb} KB (>1 MB)`);
  else if (sizeKb > 500) issues.push(`${sizeKb} KB (>500 KB target)`);

  if (RESIZE && WRITE && longEdge > RESIZE) {
    const pipeline = sharp(buffer).rotate();
    const resized = await pipeline
      .resize({ width: RESIZE, height: RESIZE, fit: 'inside', withoutEnlargement: true })
      .toBuffer();
    fs.writeFileSync(file, resized);
    console.log(`✓ resized ${file} → ${RESIZE}px long edge`);
    continue;
  }

  if (issues.length > 0) {
    warnings += 1;
    console.log(`! ${file}: ${issues.join(', ')} (${metadata.format}, ${metadata.width}×${metadata.height})`);
  } else {
    console.log(`✓ ${file}: ${metadata.width}×${metadata.height}, ${sizeKb} KB, ${metadata.format}`);
  }
}

if (warnings > 0 && !RESIZE) {
  console.log('\nTip: node scripts/photo.mjs <path> --resize 2000 --write  (downscale in place)');
}
