// ─────────────────────────────────────────────────────────────────────────────
// Physical acquisition print system — builds every piece in all three approved
// suite variants from the repository's single sources of truth:
//
//   src/config/business.ts        facts          (verified by print-facts.mjs)
//   src/config/brand.ts           crest/wordmark (shared with the site)
//   src/config/marketing-links.ts QR registry    (verified by qr-map.mjs)
//   scripts/print/manifest.mjs    pieces, variants, production mix
//
//   node scripts/print/print-system.mjs [--variant <id>] [--piece <id>] [--out <dir>]
//
// Outputs (default: ~/Downloads/Door Knocking - Stage 2 Review):
//   Print-Ready-PDF/<variant>/<piece>-<side>-bleed.pdf  (crop marks + TrimBox)
//   Print-Ready-PDF/<variant>/<piece>-<side>-trim.pdf   (exact trim size)
//   PNG-Previews/<variant>/<piece>-<side>.png           (300 DPI; board 150 DPI)
//   Suite-Boards/<variant>-board.pdf|png
//   Sources/<variant>/<piece>-<side>.html               (generated layout source)
//   Specifications/                                     (specs, manifest, die guide)
//
// The original ~/Downloads/Door Knocking packet is never touched.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { FACTS, verifyFacts } from './print-facts.mjs';
import {
  VARIANTS,
  PIECES,
  PRODUCTION_MIX,
  PRINT_GEOMETRY,
  defaultOutputRoot,
} from './manifest.mjs';
import { resolveQrAsset } from './qr-map.mjs';
import { baseCss } from './layouts/styles.mjs';
import * as editorial from './layouts/dir-editorial.mjs';
import * as neighbor from './layouts/dir-neighbor.mjs';
import * as utility from './layouts/dir-utility.mjs';

const LAYOUTS = { editorial, neighbor, utility };
const TMP = path.join('canvass-out', 'print-tmp');
const BLEED = PRINT_GEOMETRY.bleed;

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { variant: null, piece: null, out: process.env.PRINT_OUT_DIR ?? defaultOutputRoot(), boards: true };
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === '--variant') options.variant = args[++index];
    else if (key === '--piece') options.piece = args[++index];
    else if (key === '--out') options.out = args[++index];
    else if (key === '--no-boards') options.boards = false;
  }
  return options;
}

function assertSafeOutput(outDir) {
  const resolved = path.resolve(outDir);
  if (path.basename(resolved).toLowerCase() === 'door knocking') {
    throw new Error(
      `Refusing to write into the original packet folder (${resolved}). ` +
        'Choose a different --out directory.',
    );
  }
  return resolved;
}

function cropMarks(width, height, bleed) {
  const g = PRINT_GEOMETRY;
  const xL = bleed;
  const xR = bleed + width;
  const yT = bleed;
  const yB = bleed + height;
  const marks = [];
  for (const x of [xL, xR]) {
    for (const y of [yT, yB]) {
      const left = x === xL ? x - g.cropMarkGap - g.cropMarkLength : x + g.cropMarkGap;
      marks.push(
        `<div class="crop crop--h" style="left:${left}in;top:${y - g.cropMarkThickness / 2}in"></div>`,
      );
      const top = y === yT ? y - g.cropMarkGap - g.cropMarkLength : y + g.cropMarkGap;
      marks.push(
        `<div class="crop crop--v" style="left:${x - g.cropMarkThickness / 2}in;top:${top}in"></div>`,
      );
    }
  }
  return marks.join('');
}

function pageHtml({ name, width, height, bleed, variantId, body }) {
  const pageWidth = width + bleed * 2;
  const pageHeight = height + bleed * 2;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title>
<style>
  @page { size: ${pageWidth}in ${pageHeight}in; margin: 0; }
  ${baseCss()}
  body { width: ${pageWidth}in; height: ${pageHeight}in; position: relative; }
  .page { position: absolute; left: ${bleed}in; top: ${bleed}in; width: ${width}in; height: ${height}in; }
</style></head><body>${bleed > 0 ? cropMarks(width, height, bleed) : ''}<div class="page dir-${variantId}">${body}</div></body></html>`;
}

function setPdfBoxes(file, bleedInches) {
  const result = spawnSync(
    'python',
    ['scripts/print/pdf-boxes.py', 'set', '--bleed', String(bleedInches * 72), file],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`pdf-boxes.py failed for ${file}: ${result.stderr || result.stdout}`);
  }
}

function ensureDirs(outRoot) {
  for (const dir of ['Print-Ready-PDF', 'PNG-Previews', 'Suite-Boards', 'Sources', 'Specifications']) {
    const full = path.join(outRoot, dir);
    if (dir === 'Specifications') fs.mkdirSync(full, { recursive: true });
    else fs.rmSync(full, { recursive: true, force: true });
  }
  for (const variant of VARIANTS) {
    for (const dir of ['Print-Ready-PDF', 'PNG-Previews', 'Sources']) {
      fs.mkdirSync(path.join(outRoot, dir, variant.id), { recursive: true });
    }
  }
}

function layoutPiece(variantId, slug) {
  const layout = LAYOUTS[variantId];
  if (!layout) throw new Error(`Unknown variant "${variantId}".`);
  const builder = layout.pieces.find((entry) => entry.slug === slug);
  if (!builder) throw new Error(`Layout "${variantId}" is missing piece "${slug}".`);
  return builder;
}

const BOARD_TEXT = {
  neighbor: {
    summary:
      'Audience: neighborhood homeowners who want a person, not a call center — door hangers, community boards, leave-behinds. Emotional promise: warmth and recognition; a local owner who answers personally. Verbal concept: “From a Neighbor” — first-person greetings, checklists, invitations.',
    rules:
      'Visual rules: rounded panels, rose bands, script greetings (never below ~0.2 in), the genuine founder portrait, soft champagne notes; rounded QR card with a friendly caption. Recommended for: business card, quarter sheet, door hanger, community leave-behind.',
  },
  utility: {
    summary:
      'Audience: detail-conscious, time-poor homeowners — utility cards, canvassing, professional desks. Emotional promise: order and competence; every step is clear and honest. Verbal concept: “The Detail Standard” — what’s included, how it works, three steps.',
    rules:
      'Visual rules: visible grid, micro-labels, checkboxes, numbered steps, ticked QR frame, ink bands; QR treated as a control-panel element. Recommended for: QR estimate card, realtor referral card.',
  },
  editorial: {
    summary:
      'Audience: homeowners who value restraint, craft and a premium standard — event tables, community boards, large-format presence. Emotional promise: quiet confidence; a considered company, not a coupon. Verbal concept: “The Standard” — short declarative lines; the tagline carries the brand.',
    rules:
      'Visual rules: asymmetric editorial grid, Fraunces display with tight leading, hairline champagne rules, framed QR, one action per side. Recommended for: event poster, foam board.',
  },
};

function boardHtml(variant, previewUrls) {
  const columns = [
    ['business-card-front', 'business-card-back', 'realtor-card-front', 'qr-estimate-card-front'],
    ['door-hanger-front', 'quarter-sheet-front', 'community-leave-behind-front'],
    ['event-poster-front', 'foam-board-front'],
  ];
  const heights = {
    'business-card-front': 2.2,
    'business-card-back': 2.2,
    'realtor-card-front': 2.2,
    'qr-estimate-card-front': 5.6,
    'door-hanger-front': 9.6,
    'quarter-sheet-front': 6.3,
    'community-leave-behind-front': 6.3,
    'event-poster-front': 11.4,
    'foam-board-front': 8.0,
  };
  const sizes = {
    'business-card-front': '3.5 × 2 in · business-card',
    'business-card-back': '3.5 × 2 in · business-card',
    'realtor-card-front': '3.5 × 2 in · realtor-packet',
    'qr-estimate-card-front': '4 × 6 in · qr-estimate-card',
    'door-hanger-front': '3.5 × 8.5 in · door-hanger',
    'quarter-sheet-front': '4.25 × 5.5 in · quarter-sheet',
    'community-leave-behind-front': '5 × 7 in · community-leave-behind',
    'event-poster-front': '11 × 17 in · event-poster',
    'foam-board-front': '24 × 36 in · foam-board',
  };
  const text = BOARD_TEXT[variant.id];
  const cols = columns
    .map(
      (column) => `<div style="display:flex;flex-direction:column;gap:.3in;width:5.2in">
      ${column
        .map(
          (slug) => `<div class="board-cell" style="height:${heights[slug]}in">
        <div class="imgwrap"><img src="${previewUrls[slug]}" alt=""></div>
        <div class="board-cap"><span>${sizes[slug]}</span><span>${slug}.pdf</span></div>
      </div>`,
        )
        .join('')}
    </div>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: 18in 24in; margin:0; }
  ${baseCss()}
  body { width:18in; height:24in; }
  .board { width:18in; height:24in; padding:.7in; }
</style></head><body><div class="board">
  <div style="display:flex;justify-content:space-between;gap:.6in">
    <div style="flex:1.25">
      <div class="board-label" style="font-size:.15in">Stage 2 suite variant</div>
      <h1 style="font-size:.72in;margin-top:.1in">${variant.label}</h1>
      <div class="board-sub" style="font-size:.155in;margin-top:.16in">${text.summary}</div>
      <div class="board-sub" style="font-size:.155in;margin-top:.12in">${text.rules}</div>
    </div>
    <div style="flex:.75">
      <div class="board-label" style="font-size:.12in">Type &amp; palette</div>
      <div style="font-family:var(--font-display);font-size:.4in;color:var(--ink-900);margin-top:.08in">Fraunces — display</div>
      <div style="font-size:.24in;margin-top:.06in">Nunito Sans — body &amp; labels</div>
      <div style="font-family:'Great Vibes',cursive;font-size:.4in;color:var(--rose-600);margin-top:.06in">Great Vibes — greetings</div>
      <div style="display:flex;gap:.08in;margin-top:.18in">
        <span class="swatch" style="background:var(--cream-50)"></span>
        <span class="swatch" style="background:var(--cream-100)"></span>
        <span class="swatch" style="background:var(--rose-700)"></span>
        <span class="swatch" style="background:var(--rose-300)"></span>
        <span class="swatch" style="background:var(--champagne-500)"></span>
        <span class="swatch" style="background:var(--ink-900)"></span>
      </div>
      <div class="board-sub" style="font-size:.12in;margin-top:.14in">Actual-size PDFs and 300 DPI PNG previews for every piece are in the Print-Ready-PDF and PNG-Previews folders. Foam board preview is 150 DPI.</div>
    </div>
  </div>
  <div style="display:flex;gap:.3in;margin-top:.5in">${cols}</div>
</div></body></html>`;
}

function dieGuideHtml(piece) {
  const die = piece.die;
  const center = die.centerFromTop;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: ${piece.width}in ${piece.height}in; margin:0; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { width:${piece.width}in; height:${piece.height}in; font-family:system-ui, sans-serif; color:#8f2f2f; }
  .circle { position:absolute; left:50%; transform:translateX(-50%); top:${center - die.holeDiameter / 2}in; width:${die.holeDiameter}in; height:${die.holeDiameter}in; border:0.012in dashed #8f2f2f; border-radius:50%; }
  .label { position:absolute; left:0; right:0; top:0.2in; text-align:center; font-size:9pt; font-weight:700; letter-spacing:.08em; }
  .note { position:absolute; left:0; right:0; bottom:0.2in; text-align:center; font-size:8pt; }
</style></head><body>
  <div class="label">DIE PLACEMENT GUIDE — NOT FOR PRINT</div>
  <div class="circle"></div>
  <div class="note">Hole: ${die.holeDiameter} in diameter, centered ${die.centerFromTop} in from the top.<br>Printable artwork keeps content ≥${die.minClearanceBelowHole} in below the hole. Print from the artwork PDFs only.</div>
</body></html>`;
}

function specsMarkdown(manifest) {
  const lines = [
    '# Print specifications — Stage 2 production suite',
    '',
    'Generated by `scripts/print/print-system.mjs` from `scripts/print/manifest.mjs`.',
    'Facts verified against `src/config/business.ts` / `src/config/brand.ts`; QR destinations',
    'resolved from `src/config/marketing-links.ts`.',
    '',
    '## Global rules',
    '',
    `- Bleed: ${PRINT_GEOMETRY.bleed} in on all sides; \`*-bleed.pdf\` carries corner crop marks and a real TrimBox.`,
    '- `*-trim.pdf` is the exact finished size with TrimBox = MediaBox (use with online printers).',
    '- PNG previews are 300 DPI at trim size (foam board preview 150 DPI).',
    '- Fonts are embedded in the PDFs; the HTML sources reference the repository WOFF2 files.',
    '- Champagne/gold is an accent only; no small light-on-cream gold text.',
    '- QR codes decode to the exact tracked registry URLs (see `QR-ASSIGNMENTS.md`).',
    '',
    '## Pieces',
    '',
    '| Piece | Trim | Stock | Print | First run | QR asset |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const piece of PIECES) {
    const qr = piece.sides.map((side) => side.qr).filter(Boolean).join(', ') || '—';
    lines.push(
      `| ${piece.name} | ${piece.width} × ${piece.height} in | ${piece.stock} | ${piece.print} | ${piece.firstRun} | ${qr} |`,
    );
  }
  lines.push('', '## Recommended production mix', '');
  lines.push('| Piece | Variant | Rationale |', '| --- | --- | --- |');
  for (const piece of PIECES) {
    const variant = VARIANTS.find((entry) => entry.id === PRODUCTION_MIX[piece.id]);
    lines.push(`| ${piece.name} | ${variant.label} (${variant.id}) | ${variant.role} |`);
  }
  lines.push(
    '',
    'All three variants are generated for every piece; the mix above is the recommended',
    'first print run. See `PRODUCTION-MIX.md` for the full rationale.',
    '',
  );
  return lines.join('\n');
}

function productionMixMarkdown() {
  const lines = [
    '# Recommended production mix (owner delegated direction choice)',
    '',
    'One brand, three medium-led treatments. The mix below was selected from the Stage 1',
    'evidence: warmth for contact-heavy pieces, structure for QR/utility pieces, editorial',
    'restraint for large-format presence. Every piece also exists in all three variants.',
    '',
    '| Piece | Recommended | Why |',
    '| --- | --- | --- |',
    '| Business card | From a Neighbor | The card is the most personal hand-off; the portrait and first-person note do the work. |',
    '| Quarter sheet | From a Neighbor | Neighborhood handout; a letter-like note converts better than a spec sheet. |',
    '| Door hanger | From a Neighbor | A porch greeting from a real local owner; warmth beats formality at the door. |',
    '| QR estimate card | The Detail Standard | The card exists to be scanned; the three-step hierarchy is the clearest path. |',
    '| Event poster | The Standard | Large-format presence benefits from editorial type and restraint. |',
    '| Foam board | The Standard | A booth board must read at distance; the editorial composition is built for it. |',
    '| Community leave-behind | From a Neighbor | A keep-on-desk note for community spaces; hospitality fits the context. |',
    '| Realtor referral card | The Detail Standard | Professional desk card; the move-out checklist and clarity win. |',
    '',
    'Selected print-service-area wording:',
    '',
    `- Large format (poster, foam board, leave-behind): “${FACTS.serviceAreaFull}”`,
    `- Small pieces (cards, sheets, hanger, QR card): “${FACTS.serviceAreaShort}”`,
    '',
    'Both forms are derived verbatim from the approved `business.ts` sentence; the short form is',
    'the same sentence with the “within about an hour of Cantonment” qualifier removed. Nothing is',
    'added, widened or invented.',
    '',
  ];
  return lines.join('\n');
}

function printNotesMarkdown() {
  return `# Printer notes — Stage 2 production suite

- Use the \`*-bleed.pdf\` files for a local print shop: ${PRINT_GEOMETRY.bleed} in bleed on all
  sides, corner crop marks outside the trim, and a real TrimBox on every page.
- Use the \`*-trim.pdf\` files for online printers that supply their own bleed template.
- Colors are supplied as RGB; ask the shop to convert to CMYK and match the website. Gold/champagne
  is an accent only.
- Fonts are embedded in the PDFs (Fraunces, Nunito Sans, Great Vibes — self-hosted, open licences).
- The door hanger needs a 1.25 in hole die-cut centered 0.925 in from the top. The dashed circle in
  \`door-hanger-die-guide.pdf\` is a placement guide and is NOT part of the artwork; never print it.
- QR codes: dark on white with a 4-module quiet zone. Do not scale, recolor or crop a QR.
- Request one physical proof per piece before the full run and compare it with the PNG previews.
`;
}

function buildSpecs(outRoot, manifest) {
  const specs = path.join(outRoot, 'Specifications');
  fs.writeFileSync(path.join(specs, 'PRINT-SPECIFICATIONS.md'), specsMarkdown(manifest), 'utf8');
  fs.writeFileSync(path.join(specs, 'PRODUCTION-MIX.md'), productionMixMarkdown(), 'utf8');
  fs.writeFileSync(path.join(specs, 'PRINT-NOTES.md'), printNotesMarkdown(), 'utf8');
  fs.writeFileSync(path.join(specs, 'asset-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const rows = [
    ['variant', 'piece', 'side', 'trim', 'qr_asset', 'qr_link_id', 'files'],
    ...manifest.entries.map((entry) => [
      entry.variant,
      entry.piece,
      entry.side,
      entry.trim,
      entry.qrAsset ?? '',
      entry.qrLinkId ?? '',
      entry.files.join(' '),
    ]),
  ];
  fs.writeFileSync(
    path.join(specs, 'ASSET-REGISTER.csv'),
    rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n') + '\n',
    'utf8',
  );
}

async function main() {
  verifyFacts();
  const options = parseArgs();
  const outRoot = assertSafeOutput(options.out);
  const variants = options.variant
    ? VARIANTS.filter((variant) => variant.id === options.variant)
    : VARIANTS;
  const pieces = options.piece ? PIECES.filter((piece) => piece.id === options.piece) : PIECES;
  if (variants.length === 0) throw new Error(`Unknown variant "${options.variant}".`);
  if (pieces.length === 0) throw new Error(`Unknown piece "${options.piece}".`);

  ensureDirs(outRoot);
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  const browser = await chromium.launch();
  const manifest = {
    generator: 'scripts/print/print-system.mjs',
    generatedAt: new Date().toISOString(),
    variants: VARIANTS.map(({ id, letter, label }) => ({ id, letter, label })),
    productionMix: PRODUCTION_MIX,
    entries: [],
  };

  for (const variant of variants) {
    for (const piece of pieces) {
      for (const side of piece.sides) {
        const slug = `${piece.id}-${side.id}`;
        const builder = layoutPiece(variant.id, slug);
        if (builder.width !== piece.width || builder.height !== piece.height) {
          throw new Error(
            `Layout "${variant.id}/${slug}" size ${builder.width}×${builder.height} does not match the manifest (${piece.width}×${piece.height}).`,
          );
        }
        const body = builder.html();
        const fileBase = `${piece.id}-${side.id}`;
        const sourceHtml = pageHtml({ name: fileBase, width: piece.width, height: piece.height, bleed: 0, variantId: variant.id, body });
        fs.writeFileSync(path.join(outRoot, 'Sources', variant.id, `${fileBase}.html`), sourceHtml, 'utf8');

        for (const bleed of [BLEED, 0]) {
          const variantName = bleed > 0 ? 'bleed' : 'trim';
          const htmlPath = path.join(TMP, `${variant.id}-${fileBase}-${variantName}.html`);
          fs.writeFileSync(
            htmlPath,
            pageHtml({ name: fileBase, width: piece.width, height: piece.height, bleed, variantId: variant.id, body }),
            'utf8',
          );
          const pdfPath = path.join(outRoot, 'Print-Ready-PDF', variant.id, `${fileBase}-${variantName}.pdf`);
          const page = await browser.newPage();
          await page.goto(pathToFileURL(path.resolve(htmlPath)).href, { waitUntil: 'load' });
          await page.evaluate(() => document.fonts.ready);
          await page.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
          await page.close();
          setPdfBoxes(pdfPath, bleed);
        }

        const dpi = piece.width >= 20 ? 150 : 300;
        const pngHtml = path.join(TMP, `${variant.id}-${fileBase}-trim.html`);
        const context = await browser.newContext({
          viewport: { width: Math.round(piece.width * 96), height: Math.round(piece.height * 96) },
          deviceScaleFactor: dpi / 96,
        });
        const shot = await context.newPage();
        await shot.goto(pathToFileURL(path.resolve(pngHtml)).href, { waitUntil: 'load' });
        await shot.evaluate(() => document.fonts.ready);
        await shot.screenshot({
          path: path.join(outRoot, 'PNG-Previews', variant.id, `${fileBase}.png`),
          clip: { x: 0, y: 0, width: Math.round(piece.width * 96), height: Math.round(piece.height * 96) },
        });
        await context.close();

        const qr = side.qr ? resolveQrAsset(side.qr) : null;
        manifest.entries.push({
          variant: variant.id,
          piece: piece.id,
          side: side.id,
          trim: `${piece.width} x ${piece.height} in`,
          qrAsset: qr?.qrAssetId ?? null,
          qrLinkId: qr?.linkId ?? null,
          qrUrl: qr?.url ?? null,
          dpi,
          files: [
            `Print-Ready-PDF/${variant.id}/${fileBase}-bleed.pdf`,
            `Print-Ready-PDF/${variant.id}/${fileBase}-trim.pdf`,
            `PNG-Previews/${variant.id}/${fileBase}.png`,
          ],
        });
        console.log(`  ${variant.id}/${fileBase} (${piece.width}×${piece.height} in, ${dpi} DPI)`);
      }
    }

    if (options.boards) {
      const previewUrls = {};
      for (const piece of pieces) {
        for (const side of piece.sides) {
          const slug = `${piece.id}-${side.id}`;
          previewUrls[slug] = pathToFileURL(
            path.join(outRoot, 'PNG-Previews', variant.id, `${slug}.png`),
          ).href;
        }
      }
      const htmlPath = path.join(TMP, `board-${variant.id}.html`);
      fs.writeFileSync(htmlPath, boardHtml(variant, previewUrls), 'utf8');
      const page = await browser.newPage();
      await page.goto(pathToFileURL(path.resolve(htmlPath)).href, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.pdf({
        path: path.join(outRoot, 'Suite-Boards', `${variant.id}-board.pdf`),
        preferCSSPageSize: true,
        printBackground: true,
      });
      await page.close();
      const context = await browser.newContext({
        viewport: { width: Math.round(18 * 96), height: Math.round(24 * 96) },
        deviceScaleFactor: 120 / 96,
      });
      const shot = await context.newPage();
      await shot.goto(pathToFileURL(path.resolve(htmlPath)).href, { waitUntil: 'load' });
      await shot.evaluate(() => document.fonts.ready);
      await shot.screenshot({
        path: path.join(outRoot, 'Suite-Boards', `${variant.id}-board.png`),
        clip: { x: 0, y: 0, width: Math.round(18 * 96), height: Math.round(24 * 96) },
      });
      await context.close();
      console.log(`  board ${variant.id}`);
    }
  }

  // Door-hanger die placement guide (separate from printable artwork).
  const hanger = PIECES.find((piece) => piece.id === 'door-hanger');
  if (hanger && pieces.some((piece) => piece.id === 'door-hanger')) {
    const htmlPath = path.join(TMP, 'door-hanger-die-guide.html');
    fs.writeFileSync(htmlPath, dieGuideHtml(hanger), 'utf8');
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.resolve(htmlPath)).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: path.join(outRoot, 'Specifications', 'door-hanger-die-guide.pdf'),
      preferCSSPageSize: true,
      printBackground: true,
    });
    await page.close();
  }

  await browser.close();
  buildSpecs(outRoot, manifest);
  console.log(`\nbuilt ${manifest.entries.length} print sides into ${outRoot}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
