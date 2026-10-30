// Render an owner-facing Markdown document to a printable HTML page and a PDF.
//
// Usage:
//   node scripts/render-owner-doc.mjs <input.md> --out <directory> [--title "Title"] [--no-pdf]
//
// The Markdown source stays in place; a copy is written to the output directory
// together with the HTML and PDF so every deliverable is self-contained.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { htmlDocument } from './lib/markdown-doc.mjs';

const args = process.argv.slice(2);
const input = args[0];
if (!input) {
  console.error('Usage: node scripts/render-owner-doc.mjs <input.md> --out <directory> [--title "Title"]');
  process.exit(1);
}
const outIndex = args.indexOf('--out');
if (outIndex < 0 || !args[outIndex + 1]) {
  console.error('Missing --out <directory>.');
  process.exit(1);
}
const out = path.resolve(args[outIndex + 1]);
const titleIndex = args.indexOf('--title');
const markdown = fs.readFileSync(input, 'utf8');
const firstHeading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? path.basename(input, '.md');
const title = titleIndex >= 0 && args[titleIndex + 1] ? args[titleIndex + 1] : firstHeading;
const base = path.basename(input, '.md');
const producePdf = !args.includes('--no-pdf');

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, `${base}.md`), markdown, 'utf8');
fs.writeFileSync(path.join(out, `${base}.html`), htmlDocument(title, markdown), 'utf8');
console.log(`HTML: ${path.join(out, base + '.html')}`);

if (producePdf) {
  const { chromium } = await import('playwright');
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(out, `${base}.html`)).href, { waitUntil: 'load' });
    await page.pdf({
      path: path.join(out, `${base}.pdf`),
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.75in', bottom: '0.75in', left: '0.75in', right: '0.75in' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#8a7a72;text-align:center;font-family:Georgia,serif">' +
        'Sparkling Standard · <span class="pageNumber"></span> / <span class="totalPages"></span>' +
        '</div>',
    });
    console.log(`PDF:  ${path.join(out, base + '.pdf')}`);
  } finally {
    await browser?.close();
  }
}
