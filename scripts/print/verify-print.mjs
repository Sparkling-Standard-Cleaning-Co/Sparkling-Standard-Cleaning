// ─────────────────────────────────────────────────────────────────────────────
// Print verifier — fails closed on any regression.
//
//   node scripts/print/verify-print.mjs [--out <dir>]
//
// Checks, from the actual generated artifacts:
//   1. every manifest entry has its PDFs + PNG preview;
//   2. PNG dimensions match trim size at the declared DPI;
//   3. every QR decodes byte-for-byte to the registry URL (PNG preview);
//   4. PDF page boxes: bleed PDFs carry TrimBox offset 0.125 in + BleedBox;
//   5. crop marks sit outside the trim and no stray marks are inside it;
//   6. layout: safe margins, QR minimum size, caption minimum size,
//      door-hanger die clearance (measured in a real browser);
//   7. no address/coordinate/origin patterns in generated text artifacts.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { PIECES, PRINT_GEOMETRY, defaultOutputRoot, pieceById } from './manifest.mjs';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { out: process.env.PRINT_OUT_DIR ?? defaultOutputRoot() };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--out') options.out = args[++index];
  }
  return options;
}

const failures = [];
const notes = [];

function fail(message) {
  failures.push(message);
  console.error(`  FAIL ${message}`);
}

function pass(message) {
  console.log(`  ok   ${message}`);
}

function runPython(script, files) {
  const result = spawnSync('python', [script, ...files], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 });
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`${script} crashed: ${result.stderr || result.stdout}`);
  }
  return (result.stdout || '')
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => JSON.parse(line));
}

function checkPii(files) {
  const patterns = [
    { name: 'latitude-like', re: /\b3[01]\.\d{4,}/ },
    { name: 'longitude-like', re: /-8[0-9]\.\d{4,}/ },
    { name: 'origin variable', re: /TRAVEL_ORIGIN/ },
    { name: 'street address', re: /\b\d{2,6}\s+[A-Z][A-Za-z]+\s+(St|Ave|Dr|Ln|Way|Ct|Blvd|Loop|Trl|Trail|Cir|Rd|Pkwy|Ter)\b/ },
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      if (pattern.re.test(text)) fail(`PII pattern "${pattern.name}" found in ${path.basename(file)}`);
    }
  }
}

async function checkLayout(browser, outRoot, entries) {
  const page = await browser.newPage();
  for (const entry of entries) {
    const piece = pieceById(entry.piece);
    const side = piece.sides.find((item) => item.id === entry.side);
    const htmlPath = path.join(outRoot, 'Sources', entry.variant, `${entry.piece}-${entry.side}.html`);
    await page.goto(pathToFileURL(path.resolve(htmlPath)).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const data = await page.evaluate(() => {
      const pageEl = document.querySelector('.page');
      const pr = pageEl.getBoundingClientRect();
      const local = (rect) => ({
        left: (rect.left - pr.left) / 96,
        top: (rect.top - pr.top) / 96,
        right: (rect.right - pr.left) / 96,
        bottom: (rect.bottom - pr.top) / 96,
      });
      const texts = [];
      const walker = document.createTreeWalker(pageEl, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const value = node.textContent.replace(/\s+/g, ' ').trim();
        if (!value) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        if (!rect.width && !rect.height) continue;
        texts.push({ value: value.slice(0, 48), ...local(rect) });
      }
      const images = [...pageEl.querySelectorAll('img')].map((el) => ({
        label: 'image',
        ...local(el.getBoundingClientRect()),
      }));
      const qrs = [...pageEl.querySelectorAll('.qrsvg')].map((el) => ({
        label: 'qr',
        ...local(el.getBoundingClientRect()),
      }));
      const caps = [...pageEl.querySelectorAll('.a-qr-cap,.b-qr-cap,.c-qr-cap')].map((el) => ({
        text: el.textContent.trim(),
        size: parseFloat(getComputedStyle(el).fontSize) / 96,
      }));
      return { width: pr.width / 96, height: pr.height / 96, texts, images, qrs, caps };
    });

    const key = `${entry.variant}/${entry.piece}-${entry.side}`;
    const tolerance = 0.04;
    const safe = piece.safeMargin;
    const content = [...data.texts, ...data.images, ...data.qrs];
    const violations = content.filter(
      (item) =>
        item.left < safe - tolerance ||
        item.top < safe - tolerance ||
        item.right > data.width - safe + tolerance ||
        item.bottom > data.height - safe + tolerance,
    );
    if (violations.length > 0) {
      const detail = violations
        .slice(0, 4)
        .map(
          (item) =>
            `"${item.value ?? item.label}" [${item.left.toFixed(2)},${item.top.toFixed(2)} → ${item.right.toFixed(2)},${item.bottom.toFixed(2)}]`,
        )
        .join(' | ');
      fail(`${key}: ${violations.length} element(s) outside the ${safe} in safe margin: ${detail}`);
    } else {
      pass(`${key}: safe margins ok`);
    }

    for (const cap of data.caps) {
      if (cap.size < side.captionMin - 0.002) {
        fail(`${key}: QR caption "${cap.text}" is ${cap.size.toFixed(3)} in (min ${side.captionMin})`);
      }
    }
    for (const qr of data.qrs) {
      const size = qr.right - qr.left;
      if (size < piece.qrMin - 0.01) {
        fail(`${key}: QR is ${size.toFixed(3)} in (min ${piece.qrMin})`);
      }
    }

    if (piece.die) {
      const threshold = piece.die.centerFromTop + piece.die.holeDiameter / 2 + piece.die.minClearanceBelowHole;
      const minTop = Math.min(...content.map((item) => item.top));
      if (minTop < threshold - 0.04) {
        fail(`${key}: topmost content at ${minTop.toFixed(3)} in, needs ≥${threshold.toFixed(3)} in below the die`);
      } else {
        pass(`${key}: die clearance ok (${minTop.toFixed(3)} in)`);
      }
    }
  }
  await page.close();
}

async function main() {
  const { out } = parseArgs();
  const outRoot = path.resolve(out);
  if (path.basename(outRoot).toLowerCase() === 'door knocking') {
    throw new Error('Refusing to verify the original packet folder.');
  }
  const manifestPath = path.join(outRoot, 'Specifications', 'asset-manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing ${manifestPath}. Run the print build first.`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const pdfs = [];
  for (const entry of manifest.entries) {
    for (const relative of entry.files) {
      const full = path.join(outRoot, relative);
      if (!fs.existsSync(full)) fail(`missing file ${relative}`);
    }
    const pngRelative = `PNG-Previews/${entry.variant}/${entry.piece}-${entry.side}.png`;
    const pngPath = path.join(outRoot, pngRelative);
    if (fs.existsSync(pngPath)) {
      const png = PNG.sync.read(fs.readFileSync(pngPath));
      const piece = pieceById(entry.piece);
      const expectedWidth = Math.round(piece.width * entry.dpi);
      const expectedHeight = Math.round(piece.height * entry.dpi);
      if (png.width !== expectedWidth || png.height !== expectedHeight) {
        fail(`${pngRelative}: ${png.width}×${png.height} px, expected ${expectedWidth}×${expectedHeight}`);
      } else {
        pass(`${pngRelative}: ${entry.dpi} DPI at trim size`);
      }
      if (entry.qrUrl) {
        const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
        if (!decoded) fail(`${pngRelative}: no QR decoded`);
        else if (decoded.data !== entry.qrUrl) {
          fail(`${pngRelative}: QR mismatch\n    decoded:  ${decoded.data}\n    expected: ${entry.qrUrl}`);
        } else {
          pass(`${pngRelative}: QR decodes to the registry URL`);
        }
      }
    }
    pdfs.push(
      path.join(outRoot, 'Print-Ready-PDF', entry.variant, `${entry.piece}-${entry.side}-bleed.pdf`),
      path.join(outRoot, 'Print-Ready-PDF', entry.variant, `${entry.piece}-${entry.side}-trim.pdf`),
    );
  }

  const existingPdfs = pdfs.filter((file) => fs.existsSync(file));
  for (const result of runPython('scripts/print/pdf-boxes.py', ['check', ...existingPdfs])) {
    const name = path.basename(result.file);
    if (result.error) {
      fail(`${name}: ${result.error}`);
      continue;
    }
    const pageBox = result.pages[0];
    const isBleed = name.includes('-bleed.pdf');
    if (isBleed) {
      if (Math.abs(pageBox.trim_offset_in[0] - PRINT_GEOMETRY.bleed) > 0.002) {
        fail(`${name}: TrimBox offset ${pageBox.trim_offset_in[0]} in, expected ${PRINT_GEOMETRY.bleed}`);
      } else if (
        Math.abs(pageBox.bleed[0] - pageBox.media[0]) > 0.002 ||
        Math.abs(pageBox.bleed[1] - pageBox.media[1]) > 0.002
      ) {
        fail(`${name}: BleedBox does not match MediaBox`);
      } else {
        pass(`${name}: TrimBox/BleedBox ok`);
      }
    } else if (Math.abs(pageBox.trim_offset_in[0]) > 0.002) {
      fail(`${name}: trim PDF should have TrimBox = MediaBox`);
    } else {
      pass(`${name}: trim boxes ok`);
    }
  }

  const bleedPdfs = existingPdfs.filter((file) => file.endsWith('-bleed.pdf'));
  for (const result of runPython('scripts/print/verify-crop-marks.py', bleedPdfs)) {
    const name = path.basename(result.file);
    if (result.ok) pass(`${name}: crop marks outside trim, clean corners`);
    else fail(`${name}: crop-mark geometry failed (${JSON.stringify(result.checks)})`);
  }

  const browser = await chromium.launch();
  await checkLayout(browser, outRoot, manifest.entries);
  await browser.close();

  const textFiles = [];
  for (const dir of ['Sources', 'Specifications']) {
    const walk = (current) => {
      for (const item of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, item.name);
        if (item.isDirectory()) walk(full);
        else if (/\.(html|md|json|csv)$/.test(item.name)) textFiles.push(full);
      }
    };
    walk(path.join(outRoot, dir));
  }
  checkPii(textFiles);
  pass(`PII scan of ${textFiles.length} generated text artifacts`);

  if (notes.length) console.log(notes.join('\n'));
  console.log('');
  if (failures.length) {
    console.error(`${failures.length} verification failure(s).`);
    process.exit(1);
  }
  console.log(`All print verification checks passed (${manifest.entries.length} sides).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
