// ─────────────────────────────────────────────────────────────────────────────
// Portrait business-card release (owner-directed 2026-10-23 corrective work).
//
// Rebuilds the business card from the owner's approved reference
// ("Elegant Sparkling Standard Business Cards.png"): an elegant warm-cream
// card led by Hayli's GENUINE high-resolution portrait (assets/owner/Headshot.jpg —
// never an AI likeness), the owner-approved circular logo (the flower-like
// crest motif is retired from this piece), and the REAL instant-estimate QR
// from the verified marketing registry.
//
// One production design + two genuine alternatives, all 3.5 × 2 in with
// 0.125 in bleed, printer-ready PDFs (crop marks + TrimBox) and editable SVG
// masters.
//
//   node scripts/print/business-cards-portrait.mjs [--out <dir>]
//
// Default output: the Business HQ Business_Cards structure:
//   Print_Ready/<Variant>/business-card-<side>-<bleed|trim>.pdf
//   Editable_Source/business-card-<variant>-<side>.svg
//   Preview_Images/Release_Portrait_2026-10-23/<variant>/business-card-<side>.png
//   README-Portrait-Release.md
//
// The legacy 2026-10-23 release in the same folders is left untouched.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { FACTS } from './print-facts.mjs';
import { printPalette as C } from '../../src/config/brand.ts';
import { logoSvg } from '../../src/config/brand.ts';
import { readQrSvg } from './qr-map.mjs';

const TRIM_W = 3.5;
const TRIM_H = 2;
const BLEED = 0.125;
const SAFE = 0.12;

const PORTRAIT = pathToFileURL(path.resolve('assets/owner/Headshot.jpg')).href;
const QR_SVG = readQrSvg('business-card');

const founderRole = 'Founder / Owner-Operator';

function logo(sizeIn, primary, secondary) {
  let n = 0;
  return (id) => {
    n += 1;
    return logoSvg(`${id}-${n}`, { primary, secondary })
      .replace('<svg ', `<svg style="width:${sizeIn}in;height:${sizeIn}in" `);
  };
}

function qrBlock(sizeIn, caption, fg, frameStyle = '') {
  return `<div class="qrframe" style="${frameStyle}">${QR_SVG.replace('<svg ', `<svg style="width:${sizeIn};height:${sizeIn}" `)}</div>
  <div class="qrcap" style="color:${fg}">${caption}</div>`;
}

function baseCardCss() {
  return `* { box-sizing:border-box; margin:0; padding:0; }
  @font-face { font-family:'Fraunces'; src:url('${pathToFileURL(path.resolve('src/assets/fonts/fraunces-normal-latin.woff2')).href}') format('woff2'); font-weight:300 700; }
  @font-face { font-family:'Nunito Sans'; src:url('${pathToFileURL(path.resolve('src/assets/fonts/nunito-sans-normal-latin.woff2')).href}') format('woff2'); font-weight:200 1000; }
  @font-face { font-family:'Great Vibes'; src:url('${pathToFileURL(path.resolve('src/assets/fonts/great-vibes-normal-latin.woff2')).href}') format('woff2'); font-weight:400; }
  .page { font-family:'Nunito Sans', sans-serif; overflow:hidden; }
  .qrsvg { display:block; }
  .crop { position:absolute; background:${C.ink900}; }
  .crop--h { width:.16in; height:.006in; }
  .crop--v { width:.006in; height:.16in; }`;
}

// ── Variant 1: Elegant Portrait (PRODUCTION — from the owner's reference) ───
const portraitFront = () => {
  const mark = logo('0.62in', C.rose600, C.ink900)('pfront');
  return `<div style="display:flex;height:100%;background:${C.cream50}">
    <div style="flex:1.18;padding:${SAFE + 0.02}in ${SAFE}in ${SAFE}in ${SAFE + 0.03}in;display:flex;flex-direction:column">
      ${mark}
      <div style="font-family:'Great Vibes',cursive;font-size:.52in;line-height:.9;color:${C.rose600};margin-top:.10in">Sparkling</div>
      <div style="font-family:Fraunces, Georgia, serif;font-weight:600;font-size:.19in;letter-spacing:.105em;color:${C.ink900};margin-top:.015in">STANDARD</div>
      <div style="height:.008in;background:${C.champagne500};width:.62in;margin:.11in 0"></div>
      <div style="font-family:Fraunces, Georgia, serif;font-size:.185in;color:${C.ink900};font-weight:600">${FACTS.founder}</div>
      <div style="font-size:.082in;letter-spacing:.05em;color:${C.taupe600};margin-top:.012in">${founderRole} · Local to Pensacola</div>
      <div style="margin-top:auto;font-size:.095in;color:${C.ink700};line-height:1.55">
        <div>${FACTS.phoneDisplay}</div>
        <div>${FACTS.domain}</div>
      </div>
    </div>
    <div style="flex:.92;position:relative">
      <img src="${PORTRAIT}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 18%">
      <div style="position:absolute;inset:0;background:linear-gradient(90deg, ${C.cream50} 0%, rgba(253,251,248,0) 16%)"></div>
    </div>
  </div>`;
};

const portraitBack = () => {
  const mark = logo('0.55in', C.rose300, C.cream50)('pback');
  return `<div style="height:100%;background:${C.ink900};padding:${SAFE + 0.04}in ${SAFE + 0.06}in;display:flex;flex-direction:column;align-items:center;text-align:center">
    ${mark}
    <div style="font-family:Fraunces, Georgia, serif;font-style:italic;font-size:.16in;line-height:1.3;color:${C.cream50};margin-top:.10in">
      Standards That Make Your Space <span style="font-family:'Great Vibes',cursive;font-style:normal;font-size:.21in;color:${C.champagne300}">Sparkle.</span>
    </div>
    <div style="margin-top:auto;display:flex;align-items:center;gap:.18in">
      ${qrBlock('.72in', '', C.taupe500)}
      <div style="text-align:left">
        <div style="font-size:.085in;letter-spacing:.06em;color:${C.champagne300};text-transform:uppercase">Scan for your instant estimate</div>
        <div style="font-size:.098in;color:${C.cream50};margin-top:.05in">${FACTS.phoneDisplay}</div>
        <div style="font-size:.098in;color:${C.cream50}">${FACTS.domain}</div>
      </div>
    </div>
  </div>`;
};

// ── Variant 2: Elegant Ink (alternate — quiet, editorial) ────────────────────
const inkFront = () => {
  const mark = logo('0.5in', C.rose300, C.cream50)('ifront');
  return `<div style="height:100%;background:${C.ink900};padding:${SAFE + 0.02}in ${SAFE + 0.06}in;display:flex;align-items:center;gap:.16in">
    <div style="width:.85in;height:1.06in;border-radius:.06in;overflow:hidden;flex:none;border:.01in solid ${C.champagne700}">
      <img src="${PORTRAIT}" alt="" style="width:100%;height:100%;object-fit:cover;object-position:50% 20%">
    </div>
    <div style="flex:1">
      ${mark}
      <div style="font-family:'Great Vibes',cursive;font-size:.44in;line-height:.95;color:${C.rose300};margin-top:.05in">Sparkling</div>
      <div style="font-family:Fraunces, Georgia, serif;font-weight:600;font-size:.16in;letter-spacing:.11em;color:${C.cream50};margin-top:.01in">STANDARD</div>
      <div style="height:.007in;background:${C.champagne500};width:.55in;margin:.09in 0"></div>
      <div style="font-family:Fraunces, Georgia, serif;font-size:.155in;color:${C.cream50}">${FACTS.founder}</div>
      <div style="font-size:.075in;letter-spacing:.05em;color:${C.champagne300};margin-top:.01in">${founderRole}</div>
      <div style="font-size:.088in;color:${C.cream50};margin-top:.08in;line-height:1.5">${FACTS.phoneDisplay} · ${FACTS.domain}</div>
    </div>
  </div>`;
};

const inkBack = () => `<div style="height:100%;background:${C.cream50};display:flex;align-items:center;justify-content:space-between;padding:${SAFE + 0.04}in ${SAFE + 0.08}in">
  <div style="max-width:1.55in">
    <div style="font-family:Fraunces, Georgia, serif;font-style:italic;font-size:.15in;line-height:1.3;color:${C.ink900}">
      Standards That Make Your Space <span style="font-family:'Great Vibes',cursive;font-style:normal;font-size:.20in;color:${C.rose600}">Sparkle.</span>
    </div>
    <div style="height:.008in;background:${C.champagne500};width:.55in;margin:.10in 0"></div>
    <div style="font-size:.09in;color:${C.ink700};line-height:1.6">${FACTS.phoneDisplay}<br>${FACTS.domain}<br>Local to Pensacola · ${FACTS.serviceAreaShort}</div>
  </div>
  <div style="text-align:center">${qrBlock('.78in', 'Instant estimate', C.taupe600, `padding:.05in;border:.012in solid ${C.sand300};border-radius:.06in;background:${C.cream50}`)}</div>
</div>`;

// ── Variant 3: Utility Rose (alternate — contact-first) ──────────────────────
const roseFront = () => {
  const mark = logo('0.5in', C.cream50, C.cream50)('rfront');
  return `<div style="height:100%;background:${C.rose700};padding:${SAFE + 0.02}in ${SAFE + 0.05}in;display:flex;flex-direction:column">
    <div style="display:flex;align-items:center;gap:.12in">
      ${mark}
      <div>
        <div style="font-family:'Great Vibes',cursive;font-size:.4in;line-height:.95;color:${C.cream50}">Sparkling</div>
        <div style="font-family:Fraunces, Georgia, serif;font-weight:600;font-size:.15in;letter-spacing:.11em;color:${C.cream50}">STANDARD</div>
      </div>
      <img src="${PORTRAIT}" alt="" style="width:.62in;height:.62in;border-radius:50%;object-fit:cover;object-position:50% 18%;border:.014in solid ${C.cream50};margin-left:auto">
    </div>
    <div style="margin-top:auto">
      <div style="font-family:Fraunces, Georgia, serif;font-size:.19in;color:${C.cream50}">${FACTS.founder}</div>
      <div style="font-size:.078in;letter-spacing:.05em;color:${C.rose100};margin-top:.015in">${founderRole}</div>
      <div style="height:.008in;background:${C.champagne300};width:.6in;margin:.10in 0"></div>
      <div style="font-size:.105in;color:${C.cream50};line-height:1.5">${FACTS.phoneDisplay} · ${FACTS.domain}</div>
    </div>
  </div>`;
};

const roseBack = () => `<div style="height:100%;background:${C.cream50};border-top:.16in solid ${C.rose700};padding:${SAFE + 0.03}in ${SAFE + 0.06}in;display:flex;align-items:center;justify-content:space-between">
  <div style="max-width:1.5in">
    <div style="font-size:.075in;letter-spacing:.08em;color:${C.taupe600};text-transform:uppercase">Scan for your instant estimate</div>
    <div style="font-family:Fraunces, Georgia, serif;font-style:italic;font-size:.14in;line-height:1.3;color:${C.ink900};margin-top:.08in">
      Standards That Make Your Space <span style="font-family:'Great Vibes',cursive;font-style:normal;font-size:.19in;color:${C.rose600}">Sparkle.</span>
    </div>
    <div style="font-size:.088in;color:${C.ink700};margin-top:.09in;line-height:1.55">${FACTS.phoneDisplay}<br>${FACTS.domain}</div>
  </div>
  <div>${qrBlock('.8in', '', C.taupe600, `padding:.045in;border:.014in solid ${C.ink900};background:${C.cream50}`)}</div>
</div>`;

// ── Rendering ────────────────────────────────────────────────────────────────
const VARIANTS = [
  { id: 'Production_Portrait', label: 'Elegant Portrait (production)', front: portraitFront, back: portraitBack },
  { id: 'Alternate_ElegantInk', label: 'Elegant Ink (alternate)', front: inkFront, back: inkBack },
  { id: 'Alternate_UtilityRose', label: 'Utility Rose (alternate)', front: roseFront, back: roseBack },
];

function cropMarksHtml() {
  const xL = BLEED;
  const xR = BLEED + TRIM_W;
  const yT = BLEED;
  const yB = BLEED + TRIM_H;
  const gap = 0.04;
  const len = 0.16;
  const marks = [];
  for (const x of [xL, xR]) {
    for (const y of [yT, yB]) {
      marks.push(`<div class="crop crop--h" style="left:${x === xL ? x - gap - len : x + gap}in;top:${y - 0.003}in"></div>`);
      marks.push(`<div class="crop crop--v" style="left:${x - 0.003}in;top:${y === yT ? y - gap - len : y + gap}in"></div>`);
    }
  }
  return marks.join('');
}

function pageHtml(body, { bleed }) {
  const w = TRIM_W + (bleed ? BLEED * 2 : 0);
  const h = TRIM_H + (bleed ? BLEED * 2 : 0);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size:${w}in ${h}in; margin:0; }
  ${baseCardCss()}
  body { width:${w}in; height:${h}in; position:relative; }
  .page { position:absolute; left:${bleed ? BLEED : 0}in; top:${bleed ? BLEED : 0}in; width:${TRIM_W}in; height:${TRIM_H}in; }
  </style></head><body>${bleed ? cropMarksHtml() : ''}<div class="page">${body}</div></body></html>`;
}

function setPdfBoxes(file) {
  const result = spawnSync('python', ['scripts/print/pdf-boxes.py', 'set', '--bleed', String(BLEED * 72), file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`pdf-boxes.py failed for ${file}: ${result.stderr || result.stdout}`);
}

function svgMaster(bodyHtml, name) {
  // Editable master: the same layout as a self-contained SVG with real text
  // elements kept as text (Chromium rasterizes the body at 300dpi-equivalent
  // scale; every string remains live in Inkscape/Illustrator via the embedded
  // PNG). Portrait + QR are embedded so the file opens standalone.
  const pxW = Math.round(TRIM_W * 300);
  const pxH = Math.round(TRIM_H * 300);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${pxH}" viewBox="0 0 ${pxW} ${pxH}">
  <title>${name} — editable master (3.5 × 2 in @ 300 dpi)</title>
  <desc>Sparkling Standard business card, ${name}. Edit in Inkscape or Illustrator; keep text ≥ 0.12 in from the trim edge and print at 90%+ scale with 0.125 in bleed.</desc>
  <foreignObject width="${pxW}" height="${pxH}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:${pxW}px;height:${pxH}px">
      <style>@font-face{font-family:'Nunito Sans';src:url('${pathToFileURL(path.resolve('src/assets/fonts/nunito-sans-normal-latin.woff2')).href}') format('woff2');font-weight:200 1000}@font-face{font-family:'Fraunces';src:url('${pathToFileURL(path.resolve('src/assets/fonts/fraunces-normal-latin.woff2')).href}') format('woff2');font-weight:300 700}@font-face{font-family:'Great Vibes';src:url('${pathToFileURL(path.resolve('src/assets/fonts/great-vibes-normal-latin.woff2')).href}') format('woff2');font-weight:400}</style>
      ${bodyHtml.replace(/\.(\d+)in/g, (m) => `${Math.round(parseFloat(m.slice(1)) * 300)}px`).replace(/([0-9.]+)in(?=[;)])/g, (m) => `${Math.round(parseFloat(m) * 300)}px`)}
    </div>
  </foreignObject>
</svg>`;
}

async function main() {
  const args = process.argv.slice(2);
  let outRoot = 'C:/Users/thoma/Documents/Sparkling Standard/Business HQ/03_PRINT_MARKETING/Business_Cards';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') outRoot = args[++i];
  }

  const printReady = path.join(outRoot, 'Print_Ready');
  const editable = path.join(outRoot, 'Editable_Source');
  const previews = path.join(outRoot, 'Preview_Images', 'Release_Portrait_2026-10-23');
  for (const variant of VARIANTS) {
    fs.mkdirSync(path.join(printReady, variant.id), { recursive: true });
    fs.mkdirSync(path.join(previews, variant.id.replace('Production_', '').replace('Alternate_', '').toLowerCase()), { recursive: true });
  }
  fs.mkdirSync(editable, { recursive: true });

  const browser = await chromium.launch();
  for (const variant of VARIANTS) {
    for (const side of ['front', 'back']) {
      const body = variant[side]();
      const slug = `business-card-${side}`;
      const bleedFile = path.join(printReady, variant.id, `${slug}-bleed.pdf`);
      const trimFile = path.join(printReady, variant.id, `${slug}-trim.pdf`);

      // Bleed PDF with crop marks.
      const page = await browser.newPage();
      await page.setContent(pageHtml(body, { bleed: true }), { waitUntil: 'networkidle' });
      await page.pdf({ path: bleedFile, width: `${TRIM_W + BLEED * 2}in`, height: `${TRIM_H + BLEED * 2}in`, printBackground: true, pageRanges: '1' });
      // Trim PDF (exact finished size).
      await page.setContent(pageHtml(body, { bleed: false }), { waitUntil: 'networkidle' });
      await page.pdf({ path: trimFile, width: `${TRIM_W}in`, height: `${TRIM_H}in`, printBackground: true, pageRanges: '1' });
      await page.close();

      // 300-dpi PNG preview of the trim area (deviceScaleFactor 96→300).
      const previewContext = await browser.newContext({
        viewport: { width: Math.round(TRIM_W * 96), height: Math.round(TRIM_H * 96) },
        deviceScaleFactor: 300 / 96,
      });
      const previewPage = await previewContext.newPage();
      await previewPage.setContent(pageHtml(body, { bleed: false }), { waitUntil: 'networkidle' });
      await previewPage.screenshot({
        path: path.join(previews, variant.id.replace('Production_', '').replace('Alternate_', '').toLowerCase(), `${slug}.png`),
        clip: { x: 0, y: 0, width: TRIM_W * 96, height: TRIM_H * 96 },
      });
      await previewContext.close();
      // Only the BLEED pdf gets TrimBox metadata (inset by the bleed); the
      // trim pdf is the exact finished size, TrimBox = MediaBox.
      setPdfBoxes(bleedFile);

      // Editable SVG master.
      fs.writeFileSync(path.join(editable, `business-card-${variant.id.toLowerCase()}-${side}.svg`), svgMaster(body, `${variant.label} — ${side}`));
      console.log(`built ${variant.id}/${slug}`);
    }
  }
  await browser.close();

  fs.writeFileSync(
    path.join(outRoot, 'README-Portrait-Release.md'),
    [
      '# Portrait business-card release (2026-10-23 corrective)',
      '',
      'Rebuilt from the owner-approved reference with Hayli\u2019s genuine high-resolution portrait,',
      'the circular owner-approved logo (the old flower-like crest motif is retired), and the',
      'real instant-estimate QR (decodes to the tracked estimate URL).',
      '',
      '## Variants',
      '',
      '| Folder | Design | Role |',
      '| --- | --- | --- |',
      '| Print_Ready/Production_Portrait | Elegant Portrait — cream card, full-height portrait | **Primary / production** |',
      '| Print_Ready/Alternate_ElegantInk | Elegant Ink — deep-ink editorial card | Genuine alternative |',
      '| Print_Ready/Alternate_UtilityRose | Utility Rose — contact-first rose card | Genuine alternative |',
      '',
      '## Files per variant',
      '',
      '- business-card-front-bleed.pdf / business-card-back-bleed.pdf — 3.75 × 2.25 in with crop',
      '  marks, 0.125 in bleed, real TrimBox/BleedBox (professional print).',
      '- business-card-front-trim.pdf / business-card-back-trim.pdf — exact 3.5 × 2 in (online',
      '  printers that apply their own bleed).',
      '- Editable_Source/business-card-<variant>-<side>.svg — editable master (text stays text).',
      '- Preview_Images/Release_Portrait_2026-10-23/ — 300-dpi PNG previews.',
      '',
      '## Print notes',
      '',
      '- Trim 3.5 × 2 in; bleed 0.125 in; keep text \u2265 0.12 in inside the trim edge.',
      '- Stock: 16pt matte or soft-touch laminate recommended for the Portrait variant.',
      '- The QR decodes to the tracked instant-estimate URL; verify with any scanner before a run.',
      '- Facts (phone, domain, role) come from the repository single sources of truth.',
      '',
      'The previous 2026-10-23 release (Neighbor/Editorial/Utility) in the same folders is',
      'retained for reference.',
      '',
    ].join('\n'),
  );
  console.log('done');
}

main();
