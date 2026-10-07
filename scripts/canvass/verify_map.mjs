// Verifies the generated canvassing map actually renders the canonical route
// geometry (catches the "tiles never load" failure mode), with escaped popups
// and the tile-failure notice present in the document.
//
//   node scripts/canvass/verify_map.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const mapPath = path.resolve('canvass-out', 'map.html');
if (!fs.existsSync(mapPath)) {
  console.error('map.html not found — run python scripts/canvass/build_outputs.py first.');
  process.exit(1);
}
const html = fs.readFileSync(mapPath, 'utf8');
const geojson = JSON.parse(fs.readFileSync(path.resolve('canvass-out', 'routes.geojson'), 'utf8'));
const expectedPoints = geojson.features.filter((feature) => feature.geometry.type === 'Point').length;

const failures = [];
if (!html.includes('setText(')) failures.push('map popups must use setText (no HTML injection)');
if (!html.includes('tileNotice')) failures.push('map must include the tile-failure notice');
if (!html.includes('route-numbers')) failures.push('map must render numbered stops');

const bounds = geojson.features.reduce(
  (box, feature) => {
    const coordinates = feature.geometry.type === 'Point' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const [lon, lat] of coordinates) {
      box[0] = Math.min(box[0], lon);
      box[1] = Math.min(box[1], lat);
      box[2] = Math.max(box[2], lon);
      box[3] = Math.max(box[3], lat);
    }
    return box;
  },
  [Infinity, Infinity, -Infinity, -Infinity],
);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await page.goto(pathToFileURL(mapPath).href, { waitUntil: 'load' });
await page.waitForTimeout(3000);
await page.evaluate((box) => {
  map.fitBounds(
    [
      [box[0], box[1]],
      [box[2], box[3]],
    ],
    { padding: 20, duration: 0 },
  );
}, bounds);
await page.waitForTimeout(9000);
const result = await page.evaluate(() => ({
  sourceFeatures: map.querySourceFeatures('routes').length,
  renderedPoints: map.queryRenderedFeatures({ layers: ['route-points'] }).length,
  renderedLines: map.queryRenderedFeatures({ layers: ['route-lines'] }).length,
  numbers: map.queryRenderedFeatures({ layers: ['route-numbers'] }).length,
}));
await browser.close();

if (result.renderedPoints < expectedPoints * 0.95) {
  failures.push(`rendered ${result.renderedPoints} of ${expectedPoints} route points`);
}
if (result.renderedLines < 1) failures.push('no route lines rendered');
if (result.sourceFeatures < expectedPoints) failures.push(`source has ${result.sourceFeatures} features, expected ≥${expectedPoints}`);

console.log(JSON.stringify({ ...result, expectedPoints, failures, ok: failures.length === 0 }, null, 1));
process.exit(failures.length ? 1 : 0);
