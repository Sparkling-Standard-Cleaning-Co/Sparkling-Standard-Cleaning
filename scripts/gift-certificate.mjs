// Owner tool — generates a printable gift certificate (HTML + standalone QR).
//
// Usage (run locally, never in the repository's build):
//   node scripts/gift-certificate.mjs --recipient "Jane" --value 100 --from "Alex" \
//     --message "Happy birthday!" --delivery 2026-12-20 --seed <stripe-session-id>
//   node scripts/gift-certificate.mjs --sample
//
// Output goes to gift-out/ (git-ignored — never commit customer certificates).
// The QR decodes to the public redemption page for the certificate code.

import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { certificateCode, certificateHtml, formatGiftValue, redeemUrl } from '../src/lib/gift/certificate.ts';

const OUT_DIR = 'gift-out';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function fontFace(family, file, style = 'normal', weight = '400') {
  const data = fs.readFileSync(path.join('public', 'fonts', file)).toString('base64');
  return `@font-face { font-family: '${family}'; font-style: ${style}; font-weight: ${weight}; src: url(data:font/woff2;base64,${data}) format('woff2'); }`;
}

const args = parseArgs(process.argv.slice(2));
const sample = Boolean(args.sample);
const siteUrl = (args.site ?? 'https://sparkling-standard.com').replace(/\/+$/, '');

const recipientName = sample ? 'Someone Special' : String(args.recipient ?? '').trim();
const valueUsd = sample ? 100 : Number(args.value);
const purchaserName = sample ? 'A Friend' : String(args.from ?? '').trim();
const message = sample ? 'Enjoy a beautifully kept home.' : (args.message ? String(args.message) : undefined);
const deliveryDate = sample ? undefined : (args.delivery ? String(args.delivery) : undefined);

if (!recipientName || !Number.isFinite(valueUsd) || valueUsd <= 0) {
  console.error('Missing recipient or value. Example: --recipient "Jane" --value 100 --from "Alex" [--seed <id>]');
  process.exit(1);
}

const seed = sample ? 'sample-certificate' : String(args.code ?? args.seed ?? `${recipientName}|${valueUsd}|${Date.now()}`);
const code = sample ? 'SSGC-SAMP-LE42' : String(args.code ?? certificateCode(seed));
const url = redeemUrl(code, siteUrl);

fs.mkdirSync(OUT_DIR, { recursive: true });

const qrPng = await QRCode.toDataURL(url, {
  errorCorrectionLevel: 'H',
  margin: 4,
  width: 360,
  color: { dark: '#302429', light: '#FFFFFF' },
});
const qrSvg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'H', margin: 4, color: { dark: '#302429', light: '#FFFFFF' } });

// Self-check: the generated QR must decode to the exact redeem URL.
const raster = await sharp(Buffer.from(qrPng.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const decoded = jsQR(new Uint8ClampedArray(raster.data), raster.info.width, raster.info.height);
if (!decoded || decoded.data !== url) {
  console.error('QR self-check failed — certificate not written. Contact engineering.');
  process.exit(1);
}

const fontFaces = [
  fontFace('Great Vibes', 'great-vibes-normal-latin.woff2'),
  fontFace('Fraunces', 'fraunces-normal-latin.woff2', 'normal', '300 700'),
  fontFace('Nunito Sans', 'nunito-sans-normal-latin.woff2', 'normal', '200 1000'),
].join('\n');

const html = certificateHtml({
  code,
  value: formatGiftValue(valueUsd),
  recipientName,
  ...(purchaserName ? { purchaserName } : {}),
  ...(message ? { message } : {}),
  issuedOn: new Date().toISOString().slice(0, 10),
  redeemUrl: url,
  qrDataUri: qrPng,
  fontFaces,
  contact: { phone: '(850) 426-8479', email: 'owner@sparkling-standard.com', website: 'sparkling-standard.com' },
  redemptionSteps: [
    'Contact Sparkling Standard with this certificate code and the service address.',
    'We confirm the service, scope and date, and apply the certificate value to the agreed price.',
    'Any remaining balance is handled directly with the recipient after the cleaning.',
  ],
  terms:
    'This certificate represents a prepaid value toward Sparkling Standard cleaning services and is not redeemable for cash. Final redemption terms are provided with purchase. Gift certificates issued in Florida; the holder’s statutory rights are not limited by this certificate.',
});

const htmlPath = path.join(OUT_DIR, `certificate-${code}.html`);
const qrPath = path.join(OUT_DIR, `certificate-${code}-qr.svg`);
fs.writeFileSync(htmlPath, html);
fs.writeFileSync(qrPath, qrSvg);

console.log(`Certificate written: ${htmlPath}`);
console.log(`QR written:          ${qrPath}`);
console.log(`Code:                ${code}`);
console.log(`Redeem URL:          ${url}`);
console.log(`QR self-check:       decodes to the redeem URL ✓`);
if (deliveryDate) console.log(`Delivery date:       ${deliveryDate}`);
console.log('Open the HTML file in a browser and print (Letter, background graphics on).');
console.log('gift-out/ is git-ignored — never commit customer certificates.');
