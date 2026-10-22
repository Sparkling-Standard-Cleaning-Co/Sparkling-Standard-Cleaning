// Generates the official circular Sparkling Standard logo assets:
//   public/favicon.svg             (embedded 512px render)
//   public/favicon.ico             (16/32/48 multi-size)
//   public/favicon-16/32/48/64/96/128/256.png
//   public/brand/apple-touch-icon.png
//   public/brand/icon-192.png, icon-512.png, icon-maskable-512.png
//   public/brand/og-default.png    (1200x630 social preview)
//   public/brand/logo-mark.svg, logo-mark-soft.svg
//   public/brand/logo-primary.svg  (static-color vector source)
//
// Uses the site's own display fonts and the shared logoSvg() mark so the
// assets cannot drift from the header/footer logo. Run after changing the
// mark:
//   node scripts/generate-logo-assets.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { logoSvg } from '../src/config/brand.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const FONTS = path.join(PUBLIC, 'fonts');

const PALETTE = {
  cream: '#fdfbf8',
  rose: '#b15a6f',
  roseSoft: '#e8b3bf',
  ink: '#302429',
  taupe: '#6f5f57',
  champagne: '#c6a369',
};

const fontData = (file) =>
  `data:font/woff2;base64,${fs.readFileSync(path.join(FONTS, file)).toString('base64')}`;

const fontCss = `
  @font-face {
    font-family: 'Great Vibes';
    src: url('${fontData('great-vibes-normal-latin.woff2')}') format('woff2');
    font-weight: 400;
    font-style: normal;
  }
  @font-face {
    font-family: 'Fraunces';
    src: url('${fontData('fraunces-normal-latin.woff2')}') format('woff2');
    font-weight: 300 700;
    font-style: normal;
  }
  @font-face {
    font-family: 'Nunito Sans';
    src: url('${fontData('nunito-sans-normal-latin.woff2')}') format('woff2');
    font-weight: 200 1000;
    font-style: normal;
  }
`;

const fullLogo = (primary = PALETTE.rose, secondary = PALETTE.ink) =>
  logoSvg('brand-gold-static', { primary, secondary, title: 'Sparkling Standard' });

const softLogo = () =>
  logoSvg('brand-gold-soft', {
    primary: PALETTE.roseSoft,
    secondary: PALETTE.roseSoft,
    title: 'Sparkling Standard',
  });

const logoPage = (markup, size = 1024) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
${fontCss}
html, body { margin: 0; width: ${size}px; height: ${size}px; background: transparent; }
#logo { width: ${size}px; height: ${size}px; }
#logo svg { width: 100%; height: 100%; display: block; }
</style></head><body><div id="logo">${markup}</div></body></html>`;

const ogPage = `<!doctype html>
<html><head><meta charset="utf-8"><style>
${fontCss}
* { box-sizing: border-box; }
html, body { margin: 0; width: 1200px; height: 630px; }
body {
  background: ${PALETTE.cream};
  font-family: 'Nunito Sans', Arial, sans-serif;
  color: ${PALETTE.ink};
  position: relative;
  overflow: hidden;
}
.orb { position: absolute; border-radius: 50%; }
.orb--rose { width: 500px; height: 500px; background: #f9e6e9; top: -180px; right: -90px; }
.orb--gold { width: 340px; height: 340px; background: #f7efdf; bottom: -190px; left: -100px; }
.frame { position: absolute; inset: 64px; display: grid; grid-template-columns: 340px 1fr; gap: 54px; align-items: center; }
.logo { width: 320px; height: 320px; }
.logo svg { width: 100%; height: 100%; display: block; }
.copy { position: relative; }
.eyebrow { margin: 0 0 14px; font-size: 18px; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; color: ${PALETTE.rose}; }
h1 { margin: 0; font-family: 'Fraunces', Georgia, serif; font-size: 58px; line-height: 1.05; font-weight: 600; }
.lead { margin: 20px 0 0; max-width: 560px; font-size: 24px; line-height: 1.45; color: ${PALETTE.taupe}; }
.meta { margin-top: 34px; display: flex; flex-wrap: wrap; gap: 12px 24px; font-size: 19px; font-weight: 700; color: ${PALETTE.ink}; }
.meta span { display: inline-flex; align-items: center; }
.meta span::before { content: ''; width: 8px; height: 8px; margin-right: 10px; border-radius: 50%; background: ${PALETTE.champagne}; }
</style></head><body>
  <div class="orb orb--rose"></div>
  <div class="orb orb--gold"></div>
  <div class="frame">
    <div class="logo">${fullLogo()}</div>
    <div class="copy">
      <p class="eyebrow">Pensacola &amp; Cantonment</p>
      <h1>Leaving Your Space Sparkling.</h1>
      <p class="lead">Professional, owner-operated cleaning for Pensacola, Cantonment, and surrounding communities.</p>
      <div class="meta"><span>(850) 426-8479</span><span>sparkling-standard.com</span></div>
    </div>
  </div>
</body></html>`;

function icoFromPngs(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const directory = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const images = [];
  entries.forEach(({ size, buffer }, index) => {
    const entryOffset = index * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, entryOffset);
    directory.writeUInt8(size >= 256 ? 0 : size, entryOffset + 1);
    directory.writeUInt8(0, entryOffset + 2);
    directory.writeUInt8(0, entryOffset + 3);
    directory.writeUInt16LE(1, entryOffset + 4);
    directory.writeUInt16LE(32, entryOffset + 6);
    directory.writeUInt32LE(buffer.length, entryOffset + 8);
    directory.writeUInt32LE(offset, entryOffset + 12);
    offset += buffer.length;
    images.push(buffer);
  });
  return Buffer.concat([header, directory, ...images]);
}

async function main() {
  fs.mkdirSync(path.join(PUBLIC, 'brand'), { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  await page.setContent(logoPage(fullLogo()), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const transparentLogo = await page.locator('#logo').screenshot({ omitBackground: true });

  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(ogPage, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(PUBLIC, 'brand', 'og-default.png'), type: 'png' });
  console.log('wrote public/brand/og-default.png');

  await browser.close();

  const transparent = sharp(transparentLogo);
  const sizes = [16, 32, 48, 64, 96, 128, 256];
  for (const size of sizes) {
    await sharp(transparentLogo)
      .resize(size, size, { fit: 'contain' })
      .png()
      .toFile(path.join(PUBLIC, `favicon-${size}.png`));
  }
  console.log(`wrote ${sizes.map((size) => `public/favicon-${size}.png`).join(', ')}`);

  const icoEntries = [];
  for (const size of [16, 32, 48]) {
    icoEntries.push({
      size,
      buffer: await sharp(transparentLogo).resize(size, size, { fit: 'contain' }).png().toBuffer(),
    });
  }
  fs.writeFileSync(path.join(PUBLIC, 'favicon.ico'), icoFromPngs(icoEntries));
  console.log('wrote public/favicon.ico');

  const favicon512 = await sharp(transparentLogo).resize(512, 512, { fit: 'contain' }).png().toBuffer();
  fs.writeFileSync(
    path.join(PUBLIC, 'favicon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="Sparkling Standard">\n  <image width="512" height="512" href="data:image/png;base64,${favicon512.toString('base64')}"/>\n</svg>\n`,
  );
  console.log('wrote public/favicon.svg');

  const padded = async (file, size, inner) => {
    const logo = await sharp(transparentLogo).resize(inner, inner, { fit: 'contain' }).png().toBuffer();
    await sharp({ create: { width: size, height: size, channels: 4, background: PALETTE.cream } })
      .composite([{ input: logo, gravity: 'center' }])
      .png()
      .toFile(path.join(PUBLIC, 'brand', file));
  };

  await padded('apple-touch-icon.png', 180, 146);
  await padded('icon-192.png', 192, 156);
  await padded('icon-512.png', 512, 416);
  await padded('icon-maskable-512.png', 512, 358);
  console.log('wrote public/brand/apple-touch-icon.png, icon-192.png, icon-512.png, icon-maskable-512.png');

  const staticSvg = fullLogo().replace(' role="img"', ' role="img"');
  fs.writeFileSync(path.join(PUBLIC, 'brand', 'logo-primary.svg'), `${staticSvg}\n`);
  fs.writeFileSync(path.join(PUBLIC, 'brand', 'logo-mark.svg'), `${staticSvg}\n`);
  fs.writeFileSync(path.join(PUBLIC, 'brand', 'logo-mark-soft.svg'), `${softLogo()}\n`);
  console.log('wrote public/brand/logo-primary.svg, logo-mark.svg, logo-mark-soft.svg');
}

await main();
