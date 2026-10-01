// Generates brand raster assets from the abstract floral mark:
//   public/favicon.svg, public/favicon-48.png, public/favicon-96.png
//   public/brand/apple-touch-icon.png (180)
//   public/brand/icon-512.png
//   public/brand/og-default.png (1200×630)
//
// Run after changing the mark or the business name:
//   node scripts/generate-brand-images.mjs
//
// The wordmark uses whatever PUBLIC_BUSINESS_NAME is set; it defaults to the
// owner-confirmed company name. Run after changing the mark or the name.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const name = (process.env.PUBLIC_BUSINESS_NAME || 'Sparkling Standard Cleaning Co.').trim();
const ROSE = '#c97285';
const ROSE_SOFT = '#e8b3bf';
const CHAMPAGNE = '#c6a369';
const CREAM = '#fdfbf8';
const INK = '#302429';

const petal = (rotation) =>
  `<path d="M24 3c3.5 5 7 8.6 7 13a7 7 0 0 1-14 0c0-4.4 3.5-8 7-13z"${
    rotation ? ` transform="rotate(${rotation} 24 24)"` : ''
  }/>`;

const mark = (petalColor = ROSE, centerColor = CHAMPAGNE, size = 48) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}">
  <g fill="${petalColor}">
    ${petal(0)}
    ${petal(72)}
    ${petal(144)}
    ${petal(216)}
    ${petal(288)}
  </g>
  <circle cx="24" cy="24" r="3.4" fill="${centerColor}"/>
</svg>`;

const circleMark = (size, bg, petalColor, centerColor) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}">
  <circle cx="24" cy="24" r="24" fill="${bg}"/>
  <g fill="${petalColor}">
    ${petal(0)}${petal(72)}${petal(144)}${petal(216)}${petal(288)}
  </g>
  <circle cx="24" cy="24" r="3.4" fill="${centerColor}"/>
</svg>`;

const esc = (value) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const og = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <rect width="1200" height="630" fill="${CREAM}"/>
  <circle cx="1080" cy="40" r="330" fill="#f9e6e9"/>
  <circle cx="40" cy="620" r="260" fill="#f7efdf"/>
  <g transform="translate(84 84) scale(2.4)">${mark(ROSE, CHAMPAGNE, 48).replace(/<\/?svg[^>]*>/g, '')}</g>
  <text x="84" y="320" font-family="Georgia, 'Times New Roman', serif" font-size="64" fill="${INK}">${esc(name)}</text>
  <text x="84" y="392" font-family="Arial, Helvetica, sans-serif" font-size="30" fill="#6f5f57">Residential &amp; commercial cleaning · Pensacola &amp; Cantonment, FL</text>
  <text x="84" y="452" font-family="Arial, Helvetica, sans-serif" font-size="26" fill="${ROSE}">The Details Are Our Standard.</text>
  <rect x="84" y="520" width="180" height="6" rx="3" fill="${CHAMPAGNE}"/>
</svg>`;

fs.mkdirSync(path.join('public', 'brand'), { recursive: true });

// SVG favicon (unmodified mark on a soft cream tile)
fs.writeFileSync(
  path.join('public', 'favicon.svg'),
  circleMark(48, CREAM, ROSE, CHAMPAGNE).trim() + '\n',
);

const png = (svg, size, out) =>
  sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(out)
    .then(() => console.log(`wrote ${out}`));

await png(circleMark(48, CREAM, ROSE, CHAMPAGNE), 48, path.join('public', 'favicon-48.png'));
await png(circleMark(48, CREAM, ROSE, CHAMPAGNE), 96, path.join('public', 'favicon-96.png'));
await png(circleMark(48, CREAM, ROSE, CHAMPAGNE), 180, path.join('public', 'brand', 'apple-touch-icon.png'));
await png(circleMark(48, CREAM, ROSE, CHAMPAGNE), 512, path.join('public', 'brand', 'icon-512.png'));

await sharp(Buffer.from(og))
  .png()
  .toFile(path.join('public', 'brand', 'og-default.png'))
  .then(() => console.log('wrote public/brand/og-default.png'));

// Square mark without background, for the owner to drop onto T-shirts/vehicles.
fs.writeFileSync(path.join('public', 'brand', 'logo-mark-soft.svg'), mark(ROSE_SOFT, CHAMPAGNE, 256).trim() + '\n');
console.log('wrote public/brand/logo-mark-soft.svg');
