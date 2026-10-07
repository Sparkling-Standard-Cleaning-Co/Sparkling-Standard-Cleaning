// Shared helpers for the three print layout modules.
// Facts come from the verified print-facts module; the mark comes from the
// shared src/config/brand.ts; QR markup comes from the authoritative registry.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FACTS } from '../print-facts.mjs';
import { crestSvg } from '../../../src/config/brand.ts';
import { readQrSvg } from '../qr-map.mjs';

/** Layout-friendly fact view (same verified values, short keys). */
export const F = {
  ...FACTS,
  script: FACTS.scriptWord,
  caps: FACTS.capsWord,
  role: FACTS.founderRole,
  phone: FACTS.phoneDisplay,
  serviceArea: FACTS.serviceAreaShort,
};

/** Absolute file URL so generated HTML works from any output folder. */
export const PHOTO = pathToFileURL(path.resolve('src/assets/images/hayli-founder.webp')).href;

let crestCounter = 0;

export function crest(size = '0.36in') {
  crestCounter += 1;
  return crestSvg(`gold-print-${crestCounter}`).replace(
    '<svg ',
    `<svg class="crest" style="width:${size};height:${size}" `,
  );
}

export function readQr(qrAssetId) {
  return readQrSvg(qrAssetId);
}

export function image(src, style = '', alt = '') {
  return `<img src="${src}" alt="${alt}" style="${style}">`;
}
