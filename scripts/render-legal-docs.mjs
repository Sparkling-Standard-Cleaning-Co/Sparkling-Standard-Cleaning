// Render the owner-review legal templates with the approved brand identity.
// The Markdown sources are the editable originals; HTML and PDF are generated.
//
// Usage: node scripts/render-legal-docs.mjs [--out legal-out] [--only <basename>] [--no-pdf]

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inline, markdownToHtml } from './lib/markdown-doc.mjs';

const args = process.argv.slice(2);
function argValue(name, fallback = '') {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}
const outDir = path.resolve(argValue('--out', 'legal-out'));
const only = argValue('--only');
const makePdf = !args.includes('--no-pdf');
const sourceDirs = [path.resolve('docs/legal/templates'), path.resolve('docs/legal/employee')];
const logoBytes = fs.readFileSync(path.resolve('public/brand/approved-icon-master-1024.png'));
const logoData = `data:image/png;base64,${logoBytes.toString('base64')}`;

const CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: #2c2421; font-family: Georgia, 'Times New Roman', serif; font-size: 10.8pt; line-height: 1.55; }
  main { max-width: 48rem; margin: 0 auto; padding: 1.4rem 0 2rem; }
  .brand { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #c6a369; padding-bottom: 12px; margin-bottom: 22px; }
  .brand img { width: 66px; height: 66px; border-radius: 50%; }
  .brand .name { font-size: 17pt; font-weight: 700; color: #6d343c; line-height: 1.1; }
  .brand .slogan { font-size: 8.5pt; letter-spacing: .14em; text-transform: uppercase; color: #9d7736; margin-top: 3px; }
  .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 20px; border: 1px solid #e4d5c7; background: #fbf7f2; padding: 12px 14px; margin: 0 0 20px; font-size: 9pt; }
  .meta div strong { display: block; color: #8c7a70; font-size: 7.8pt; letter-spacing: .06em; text-transform: uppercase; }
  .draft { border-left: 4px solid #93475b; background: #f8ecec; padding: 10px 14px; margin: 0 0 20px; font-size: 9.4pt; }
  h1 { font-size: 21pt; line-height: 1.15; margin: 0 0 6px; color: #6d343c; }
  h2 { font-size: 13pt; margin: 1.55rem 0 .45rem; color: #6d343c; border-bottom: 1px solid #e5d8c8; padding-bottom: 3px; break-after: avoid; }
  h3 { font-size: 11pt; margin: 1.1rem 0 .3rem; break-after: avoid; }
  p, li { orphans: 3; widows: 3; }
  blockquote { margin: 1rem 0; padding: .7rem 1rem; background: #f7efec; border-left: 3px solid #9a5b61; font-size: 9.6pt; }
  blockquote p { margin: .3rem 0; }
  table { width: 100%; border-collapse: collapse; margin: .7rem 0 1.1rem; font-size: 9.4pt; }
  th, td { border: 1px solid #dccdbc; padding: .38rem .5rem; text-align: left; vertical-align: top; }
  th { background: #f3e8d8; color: #4a2e33; }
  td:empty { height: 2.1rem; }
  code { font-family: Consolas, monospace; font-size: 9pt; background: #f0e6dc; padding: 0 .2rem; }
  hr { border: 0; border-top: 1px solid #dccdbc; margin: 1.6rem 0; }
  ul, ol { padding-left: 1.35rem; }
  li { margin: .22rem 0; }
  strong { color: #4a2e33; }
  .signature { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; margin-top: 26px; page-break-inside: avoid; }
  .signature div { border-top: 1px solid #2c2421; padding-top: 5px; font-size: 8.6pt; color: #6b5d56; }
  @page { size: Letter; margin: 0.75in 0.8in 0.85in; }
  @media print { main { max-width: none; padding: 0; } a { color: inherit; text-decoration: none; } .draft { background: #f8ecec !important; } }
`;

function metadata(markdown) {
  const read = (label) => markdown.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`))?.[1]?.trim() ?? '';
  return {
    id: read('Document ID'),
    version: read('Version'),
    status: read('Status'),
    legalReview: read('Legal review'),
    effective: read('Effective date'),
  };
}

function htmlDocument(title, markdown) {
  const meta = metadata(markdown);
  const body = markdown
    .replace(/^\*\*(Document ID|Version|Status|Legal review|Effective date|Applies to|Brand|Contact|Legal entity):\*\*.*$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</title>
<style>${CSS}</style></head><body><main>
<div class="brand"><img src="${logoData}" alt="Sparkling Standard" /><div><div class="name">Sparkling Standard Cleaning Co.</div><div class="slogan">Standards That Sparkle.</div></div></div>
<div class="meta">
  <div><strong>Document ID</strong>${meta.id || 'TO BE ASSIGNED'}</div>
  <div><strong>Version</strong>${meta.version || 'DRAFT'}</div>
  <div><strong>Status</strong>${meta.status || 'Draft - owner review required'}</div>
  <div><strong>Legal review</strong>${meta.legalReview || 'Not reviewed'}</div>
  <div><strong>Effective date</strong>${meta.effective || 'Not effective'}</div>
  <div><strong>Legal entity</strong>Sparkling Standard LLC</div>
</div>
${markdownToHtml(body)}
</main></body></html>`;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const files = sourceDirs
    .filter((directory) => fs.existsSync(directory))
    .flatMap((directory) =>
      fs.readdirSync(directory)
        .filter((name) => name.endsWith('.md'))
        .filter((name) => !only || path.basename(name, '.md') === only)
        .map((name) => ({ directory, name, absolute: path.join(directory, name) })),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  if (files.length === 0) throw new Error('No legal Markdown templates were found.');

  let browser = null;
  const rendered = [];
  try {
    if (makePdf) {
      const { chromium } = await import('playwright');
      browser = await chromium.launch();
    }
    for (const file of files) {
      const markdown = fs.readFileSync(file.absolute, 'utf8');
      const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? path.basename(file.name, '.md');
      const base = path.basename(file.name, '.md');
      const htmlPath = path.join(outDir, `${base}.html`);
      fs.writeFileSync(htmlPath, htmlDocument(title, markdown), 'utf8');
      let pdfPath = '';
      if (makePdf && browser) {
        const page = await browser.newPage();
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
        pdfPath = path.join(outDir, `${base}.pdf`);
        const meta = metadata(markdown);
        await page.pdf({
          path: pdfPath,
          format: 'Letter',
          printBackground: true,
          displayHeaderFooter: true,
          headerTemplate: '<div></div>',
          footerTemplate: `<div style="width:100%;font-size:7.4px;color:#8c7a70;text-align:center;font-family:Georgia,serif;padding:0 .5in;">Sparkling Standard Cleaning Co. | ${meta.id || 'DRAFT'} | ${meta.version || 'draft'} | Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
        });
        await page.close();
      }
      rendered.push({ base, htmlPath, pdfPath });
    }
  } finally {
    await browser?.close();
  }
  process.stdout.write(`${JSON.stringify({ outDir, rendered }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`legal rendering failed: ${error.message}\n`);
  process.exitCode = 1;
});
