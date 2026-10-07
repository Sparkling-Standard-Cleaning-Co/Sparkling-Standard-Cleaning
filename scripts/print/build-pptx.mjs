// ─────────────────────────────────────────────────────────────────────────────
// Editable PowerPoint masters — one per piece, in the recommended production
// variant. Pure Node OOXML writer (no new dependencies): ordinary text stays
// live text, panels/rules are editable rectangles, the crest lockup / portrait
// / QR are linked images.
//
//   node scripts/print/build-pptx.mjs [--out <dir>]
//
// Final print PDFs are produced by scripts/print/print-system.mjs; a PPTX is
// an editing master, not a press-ready file.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { FACTS } from './print-facts.mjs';
import { crestSvg } from '../../src/config/brand.ts';
import { PIECES, PRODUCTION_MIX, defaultOutputRoot } from './manifest.mjs';
import { resolveQrAsset } from './qr-map.mjs';

const EMU = 914400;
const TMP = path.join('canvass-out', 'print-tmp');

/* ── ZIP writer (deflate) ─────────────────────────────────────────────────── */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipWrite(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const now = { time: 0, date: 0x21 }; // fixed timestamp for determinism (1980-01-01)
  for (const [name, content] of entries) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const compressed = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(now.time, 10);
    local.writeUInt16LE(now.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuffer, compressed);
    central.push({ nameBuffer, crc, compressedLength: compressed.length, size: data.length, offset });
    offset += local.length + nameBuffer.length + compressed.length;
  }
  const centralChunks = [];
  for (const entry of central) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt16LE(now.time, 12);
    header.writeUInt16LE(now.date, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.compressedLength, 20);
    header.writeUInt32LE(entry.size, 24);
    header.writeUInt16LE(entry.nameBuffer.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(entry.offset, 42);
    centralChunks.push(header, entry.nameBuffer);
  }
  const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, ...centralChunks, end]);
}

/* ── OOXML helpers ────────────────────────────────────────────────────────── */
const esc = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const emu = (inches) => Math.round(inches * EMU);
const hex = (color) => color.replace('#', '').toUpperCase();

function textBody(element) {
  const paragraphs = element.paragraphs
    .map((paragraph) => {
      const runs = (paragraph.runs ?? [{ text: paragraph.text ?? '' }])
        .map((run) => {
          const size = Math.round((run.size ?? 10) * 100);
          const attrs = [
            `lang="en-US"`,
            `sz="${size}"`,
            run.bold ? 'b="1"' : '',
            run.italic ? 'i="1"' : '',
            run.spacing ? `spc="${Math.round(run.spacing * 100)}"` : '',
            'dirty="0"',
          ]
            .filter(Boolean)
            .join(' ');
          return `<a:r><a:rPr ${attrs}><a:solidFill><a:srgbClr val="${hex(run.color ?? '#3d3036')}"/></a:solidFill><a:latin typeface="${esc(run.font ?? 'Nunito Sans')}"/></a:rPr><a:t>${esc(run.text)}</a:t></a:r>`;
        })
        .join('');
      const align = paragraph.align ? ` algn="${paragraph.align}"` : '';
      const line = paragraph.lineSpacing ? `<a:lnSpc><a:spcPct val="${Math.round(paragraph.lineSpacing * 100000)}"/></a:lnSpc>` : '';
      const spaceAfter = paragraph.spaceAfter ? `<a:spcAft><a:spcPts val="${Math.round(paragraph.spaceAfter * 100)}"/></a:spcAft>` : '';
      return `<a:p><a:pPr${align}>${line}${spaceAfter}</a:pPr>${runs}</a:p>`;
    })
    .join('');
  return `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"/><a:lstStyle/>${paragraphs}</p:txBody>`;
}

function shapeXml(element, id) {
  const position = `<a:xfrm><a:off x="${emu(element.x)}" y="${emu(element.y)}"/><a:ext cx="${emu(element.w)}" cy="${emu(element.h)}"/></a:xfrm>`;
  if (element.type === 'rect') {
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(element.name ?? 'Rectangle')}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${position}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${hex(element.fill)}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;
  }
  if (element.type === 'text') {
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(element.name ?? 'Text')}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${position}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>${textBody(element)}</p:sp>`;
  }
  throw new Error(`Unsupported element type ${element.type}`);
}

function pictureXml(element, id, relId) {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${esc(element.name ?? 'Picture')}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${emu(element.x)}" y="${emu(element.y)}"/><a:ext cx="${emu(element.w)}" cy="${emu(element.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

const GROUP_SHAPE = `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;

function slideXml(slide, rels) {
  let id = 2;
  const relIdBySrc = new Map(rels.map((entry) => [entry.src, entry.rId]));
  const elements = [];
  for (const element of slide.elements) {
    if (element.type === 'image') {
      elements.push(pictureXml(element, id++, relIdBySrc.get(element.src)));
    } else {
      elements.push(shapeXml(element, id++));
    }
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${hex(slide.background ?? '#fdfbf8')}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${GROUP_SHAPE}${elements.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Sparkling Standard"><a:themeElements><a:clrScheme name="Sparkling"><a:dk1><a:srgbClr val="302429"/></a:dk1><a:lt1><a:srgbClr val="FDFBF8"/></a:lt1><a:dk2><a:srgbClr val="3D3036"/></a:dk2><a:lt2><a:srgbClr val="F9F3ED"/></a:lt2><a:accent1><a:srgbClr val="93475B"/></a:accent1><a:accent2><a:srgbClr val="C6A369"/></a:accent2><a:accent3><a:srgbClr val="8BA888"/></a:accent3><a:accent4><a:srgbClr val="6F5F57"/></a:accent4><a:accent5><a:srgbClr val="E8B3BF"/></a:accent5><a:accent6><a:srgbClr val="4A3B40"/></a:accent6><a:hlink><a:srgbClr val="93475B"/></a:hlink><a:folHlink><a:srgbClr val="7A3A4B"/></a:folHlink></a:clrScheme><a:fontScheme name="Sparkling"><a:majorFont><a:latin typeface="Fraunces"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Nunito Sans"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Sparkling"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;

function masterXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>${GROUP_SHAPE}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;
}

function layoutXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${GROUP_SHAPE}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

function buildPptx({ widthIn, heightIn, slides, outPath }) {
  const media = new Map();
  const slideEntries = [];
  for (const slide of slides) {
    const rels = [];
    let relIndex = 2;
    for (const element of slide.elements) {
      if (element.type !== 'image') continue;
      if (!media.has(element.src)) {
        const ext = path.extname(element.src).toLowerCase();
        media.set(element.src, `image${media.size + 1}${ext === '.jpeg' ? '.jpg' : ext}`);
      }
      if (!rels.some((entry) => entry.src === element.src)) {
        rels.push({ rId: `rId${relIndex++}`, src: element.src, name: media.get(element.src) });
      }
    }
    slideEntries.push({ slide, rels });
  }

  const entries = [];
  const contentTypes = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Default Extension="png" ContentType="image/png"/>',
    '<Default Extension="jpg" ContentType="image/jpeg"/>',
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>',
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
  ];
  slideEntries.forEach((_, index) => {
    contentTypes.push(
      `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    );
  });
  contentTypes.push('</Types>');
  entries.push(['[Content_Types].xml', contentTypes.join('')]);

  entries.push([
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
  ]);

  const slideIds = slideEntries
    .map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`)
    .join('');
  entries.push([
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="${emu(widthIn)}" cy="${emu(heightIn)}" type="custom"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  ]);
  const presentationRels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>',
  ];
  slideEntries.forEach((_, index) => {
    presentationRels.push(
      `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`,
    );
  });
  presentationRels.push('</Relationships>');
  entries.push(['ppt/_rels/presentation.xml.rels', presentationRels.join('')]);

  entries.push(['ppt/slideMasters/slideMaster1.xml', masterXml()]);
  entries.push([
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>',
  ]);
  entries.push(['ppt/slideLayouts/slideLayout1.xml', layoutXml()]);
  entries.push([
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>',
  ]);
  entries.push(['ppt/theme/theme1.xml', THEME]);

  slideEntries.forEach(({ slide, rels }, index) => {
    entries.push([`ppt/slides/slide${index + 1}.xml`, slideXml(slide, rels)]);
    const relEntries = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>',
    ];
    for (const entry of rels) {
      relEntries.push(
        `<Relationship Id="${entry.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${entry.name}"/>`,
      );
    }
    relEntries.push('</Relationships>');
    entries.push([`ppt/slides/_rels/slide${index + 1}.xml.rels`, relEntries.join('')]);
  });

  for (const [src, name] of media) {
    entries.push([`ppt/media/${name}`, fs.readFileSync(src)]);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, zipWrite(entries));
}

/* ── Master specifications (production variant) ───────────────────────────── */
function generateAssets() {
  fs.mkdirSync(TMP, { recursive: true });
  return (async () => {
    const browser = await chromium.launch();
    const crest = crestSvg('gold-pptx').replace('<svg ', '<svg class="crest" ');
    const lockupHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family:'Fraunces'; src:url('${pathToFileURL(path.resolve('public/fonts/fraunces-normal-latin.woff2')).href}') format('woff2'); font-weight:300 700; }
@font-face { font-family:'Great Vibes'; src:url('${pathToFileURL(path.resolve('public/fonts/great-vibes-normal-latin.woff2')).href}') format('woff2'); }
:root { --color-rose-300:#e8b3bf; --color-rose-500:#c97285; --color-champagne-500:#c6a369; }
* { margin:0; padding:0; box-sizing:border-box; } body { background:transparent; }
.lockup { display:flex; align-items:center; gap:.08in; }
.crest { width:.42in; height:.42in; flex:0 0 auto; }
.script { font-family:'Great Vibes',cursive; color:#b15a6f; font-size:.42in; line-height:.95; }
.caps { font-family:'Fraunces',Georgia,serif; font-weight:600; color:#302429; font-size:.2in; letter-spacing:.15em; }
.desc { font-family:'Fraunces',Georgia,serif; color:#6f5f57; font-size:.105in; letter-spacing:.22em; text-transform:uppercase; margin-top:.02in; }
</style></head><body><div class="lockup" id="l">${crest}<div><div style="display:flex;align-items:baseline;gap:.05in"><span class="script">${FACTS.scriptWord}</span><span class="caps">${FACTS.capsWord}</span></div><div class="desc">${FACTS.descriptor}</div></div></div></body></html>`;
    const lockupPath = path.join(TMP, 'pptx-lockup.html');
    fs.writeFileSync(lockupPath, lockupHtml, 'utf8');
    const page = await browser.newPage({ viewport: { width: 700, height: 200 }, deviceScaleFactor: 4 });
    await page.goto(pathToFileURL(path.resolve(lockupPath)).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const box = await page.evaluate(() => {
      const rect = document.getElementById('l').getBoundingClientRect();
      return { width: Math.ceil(rect.width) + 2, height: Math.ceil(rect.height) + 2 };
    });
    await page.setViewportSize(box);
    await page.evaluate(() => document.fonts.ready);
    const lockupPng = path.join(TMP, 'pptx-lockup.png');
    await page.screenshot({ path: lockupPng, omitBackground: true });
    await page.close();
    const lockupAspect = box.height / box.width;

    const portraitHtml = `<!doctype html><html><head><style>*{margin:0;padding:0}body{background:transparent}img{display:block;width:100%}</style></head><body><img src="${pathToFileURL(path.resolve('src/assets/images/hayli-founder.webp')).href}"></body></html>`;
    const portraitPath = path.join(TMP, 'pptx-portrait.html');
    fs.writeFileSync(portraitPath, portraitHtml, 'utf8');
    const portraitPage = await browser.newPage({ viewport: { width: 600, height: 900 }, deviceScaleFactor: 2 });
    await portraitPage.goto(pathToFileURL(path.resolve(portraitPath)).href, { waitUntil: 'load' });
    const portraitBox = await portraitPage.evaluate(() => {
      const img = document.querySelector('img');
      return { width: Math.round(img.naturalWidth), height: Math.round(img.naturalHeight) };
    });
    const aspect = portraitBox.height / portraitBox.width;
    await portraitPage.setViewportSize({ width: 600, height: Math.round(600 * aspect) });
    const portraitPng = path.join(TMP, 'pptx-portrait.png');
    await portraitPage.screenshot({ path: portraitPng });
    await portraitPage.close();
    await browser.close();
    return { lockupPng, portraitPng, lockupAspect, portraitAspect: aspect };
  })();
}

const P = {
  cream: '#fdfbf8',
  cream100: '#f9f3ed',
  ink: '#302429',
  ink700: '#4a3b40',
  ink800: '#3d3036',
  taupe: '#6f5f57',
  rose: '#93475b',
  rose600: '#b15a6f',
  rose100: '#f9e6e9',
  rose300: '#e8b3bf',
  sand: '#e4d5c7',
  champagne: '#c6a369',
  champagne100: '#f7efdf',
  champagne700: '#8a6d38',
};

const t = (x, y, w, h, text, { font = 'Nunito Sans', size = 9, bold = false, italic = false, color = P.ink700, align = 'l', lineSpacing, spacing, name } = {}) => ({
  type: 'text',
  x,
  y,
  w,
  h,
  name,
  paragraphs: [{ runs: [{ text, font, size, bold, italic, color, spacing }], align, lineSpacing }],
});
const multi = (x, y, w, h, paragraphs, name) => ({ type: 'text', x, y, w, h, name, paragraphs });
const r = (x, y, w, h, fill, name) => ({ type: 'rect', x, y, w, h, fill, name });
const img = (x, y, w, h, src, name) => ({ type: 'image', x, y, w, h, src, name });

function specs(assets) {
  const { lockupPng, portraitPng, lockupAspect, portraitAspect } = assets;
  const qr = (id) => path.resolve(resolveQrAsset(id).pngPath);
  const lockup = (x, y, w) => img(x, y, w, w * lockupAspect, lockupPng, 'Logo lockup');
  const portrait = (x, y, w) => img(x, y, w, w * portraitAspect, portraitPng, 'Founder portrait');
  const phone = FACTS.phoneDisplay;
  const domain = FACTS.domain;
  const email = FACTS.email;

  return {
    'business-card': {
      width: 3.5,
      height: 2,
      slides: [
        {
          elements: [
            lockup(0.18, 0.13, 1.55),
            portrait(2.6, 0.4, 0.7),
            t(0.18, 0.6, 2.2, 0.4, FACTS.founder, { font: 'Fraunces', size: 24, bold: true, color: P.ink }),
            t(0.18, 1.0, 2.2, 0.16, FACTS.founderRole.toUpperCase(), { size: 6.5, bold: true, color: P.rose, spacing: 1.5 }),
            t(0.18, 1.38, 2.2, 0.2, phone, { size: 11, bold: true, color: P.ink }),
            t(0.18, 1.63, 3.1, 0.16, `${email} · ${domain}`, { size: 7, color: P.ink700 }),
          ],
        },
        {
          elements: [
            t(0.18, 0.14, 3.1, 0.3, `A note from ${FACTS.founder}`, { font: 'Great Vibes', size: 18, color: P.rose600 }),
            t(0.18, 0.4, 3.0, 0.3, 'When your home needs a hand, I answer personally — and the details stay done.', { size: 8, color: P.ink700 }),
            t(0.18, 1.0, 1.9, 0.5, 'Weekly, biweekly or monthly\nThe same careful standard\nHayli confirms every request', { size: 7.5, color: P.ink700, lineSpacing: 1.35 }),
            img(2.2, 0.95, 0.85, 0.85, qr('business-card'), 'QR — business card'),
            t(2.1, 1.82, 1.05, 0.12, 'Scan me', { size: 6, color: P.taupe, align: 'ctr' }),
          ],
        },
      ],
    },
    'quarter-sheet': {
      width: 4.25,
      height: 5.5,
      slides: [
        {
          elements: [
            lockup(0.3, 0.28, 2.1),
            t(0.3, 0.92, 3.7, 0.4, `A note from ${FACTS.founder}`, { font: 'Great Vibes', size: 22, color: P.rose600 }),
            t(0.3, 1.32, 3.7, 0.7, 'A cleaner home. Less stress. More time.', { font: 'Fraunces', size: 20, bold: true, color: P.ink, lineSpacing: 1.02 }),
            t(0.3, 2.05, 3.65, 0.5, 'Recurring house cleaning planned around your home — not a route clock. Every request is confirmed personally before anything is scheduled.', { size: 9, color: P.ink700, lineSpacing: 1.3 }),
            t(0.3, 2.7, 3.65, 0.9, '✓  Estimates built from real labor hours\n✓  Weekly, biweekly or monthly — the details stay done\n✓  Hayli personally confirms every request', { size: 9, color: P.ink700, lineSpacing: 1.6 }),
            img(0.3, 3.85, 1.05, 1.05, qr('quarter-sheet'), 'QR — quarter sheet'),
            t(0.3, 4.95, 1.05, 0.12, 'Scan me', { size: 6, color: P.taupe, align: 'ctr' }),
            t(2.2, 4.35, 1.75, 0.7, `${phone}\n${email}\n${domain}\n${FACTS.hours}`, { size: 8.5, color: P.ink700, align: 'r', lineSpacing: 1.3 }),
          ],
        },
      ],
    },
    'door-hanger': {
      width: 3.5,
      height: 8.5,
      slides: [
        {
          elements: [
            r(0, 0, 3.5, 2.9, P.rose100, 'Greeting band'),
            t(0.25, 1.9, 1.9, 0.9, 'Hello,\nneighbor!', { font: 'Great Vibes', size: 24, color: P.rose, lineSpacing: 0.9 }),
            portrait(2.5, 1.85, 0.78),
            t(0.25, 3.1, 3.0, 0.5, 'Let me take care of your home.', { font: 'Fraunces', size: 20, bold: true, color: P.ink }),
            t(0.25, 3.7, 3.0, 0.4, 'Recurring house cleaning in this neighborhood — with the details most cleaners skip.', { size: 9, color: P.ink700, lineSpacing: 1.3 }),
            t(0.25, 4.2, 3.0, 0.8, '✓  Weekly, biweekly or monthly plans\n✓  Honest estimates built from real labor hours\n✓  Every request confirmed by Hayli', { size: 8.5, color: P.ink700, lineSpacing: 1.6 }),
            img(0.25, 5.8, 1.35, 1.35, qr('door-hanger'), 'QR — door hanger'),
            t(0.25, 7.2, 1.35, 0.12, 'Scan me', { size: 6, color: P.taupe, align: 'ctr' }),
            t(1.95, 6.2, 1.3, 0.8, `Call or text\n${phone}\n${domain}`, { size: 9, color: P.ink, align: 'r', lineSpacing: 1.4, bold: true }),
          ],
        },
      ],
    },
    'qr-estimate-card': {
      width: 4,
      height: 6,
      slides: [
        {
          elements: [
            lockup(0.3, 0.28, 1.9),
            t(0.3, 1.15, 3.4, 0.5, "Let's get your price.", { font: 'Great Vibes', size: 26, color: P.rose600, align: 'ctr' }),
            img(1.0, 1.9, 2.0, 2.0, qr('qr-estimate-card'), 'QR — estimate card'),
            t(1.0, 3.95, 2.0, 0.14, 'Scan me', { size: 7, color: P.taupe, align: 'ctr' }),
            t(0.3, 4.25, 3.4, 0.4, 'Answer a few questions about your home and see your proposed price instantly.', { size: 9, color: P.ink700, align: 'ctr', lineSpacing: 1.3 }),
            r(0.3, 4.75, 3.4, 0.5, P.champagne100, 'Trust panel'),
            t(0.42, 4.86, 3.16, 0.3, 'No obligation. Hayli confirms every request personally before anything is scheduled.', { size: 7.5, color: P.ink700, align: 'ctr', lineSpacing: 1.3 }),
            t(0.3, 5.4, 3.4, 0.3, phone, { size: 13, bold: true, color: P.ink, align: 'ctr' }),
          ],
        },
      ],
    },
    'event-poster': {
      width: 11,
      height: 17,
      slides: [
        {
          elements: [
            lockup(0.7, 0.6, 3.6),
            t(7.5, 0.75, 2.8, 0.3, 'PENSACOLA · CANTONMENT\nOWNER-OPERATED', { size: 8, bold: true, color: P.taupe, align: 'r', spacing: 1.2, lineSpacing: 1.3 }),
            r(0.7, 1.55, 9.6, 0.008, P.champagne, 'Rule'),
            t(0.7, 2.1, 6.4, 1.6, FACTS.tagline, { font: 'Fraunces', size: 44, bold: true, color: P.ink, lineSpacing: 1.0 }),
            t(0.7, 3.9, 6.2, 0.8, 'Recurring house cleaning in Pensacola and Cantonment — weekly, biweekly or monthly.', { size: 15, color: P.ink700, lineSpacing: 1.3 }),
            t(0.7, 4.9, 6.2, 1.2, '01  Estimates built from real labor hours\n02  The details most cleaners skip, every visit\n03  Hayli confirms every request personally', { size: 13, color: P.ink700, lineSpacing: 1.8 }),
            t(0.7, 6.3, 6.2, 0.3, 'NOW SCHEDULING IN YOUR NEIGHBORHOOD', { size: 9, bold: true, color: P.taupe, spacing: 1.5 }),
            t(0.7, 6.7, 6.2, 0.6, FACTS.serviceAreaFull, { size: 8, color: P.taupe, lineSpacing: 1.3 }),
            portrait(7.5, 2.1, 2.9),
            t(7.5, 6.2, 2.9, 0.5, `${FACTS.founder}\n${FACTS.founderRole}`, { font: 'Fraunces', size: 18, bold: true, color: P.ink, lineSpacing: 1.1 }),
            r(0.7, 11.8, 9.6, 0.008, P.champagne, 'Rule'),
            img(0.7, 12.2, 2.5, 2.5, qr('event-poster'), 'QR — event poster'),
            t(0.7, 14.75, 2.5, 0.14, 'SCAN FOR A FREE INSTANT ESTIMATE', { size: 8, color: P.taupe, align: 'ctr', spacing: 1.2 }),
            t(6.9, 12.3, 3.4, 1.2, `${phone}\n${email}\n${domain}\n${FACTS.hours}`, { size: 13, color: P.ink700, align: 'r', lineSpacing: 1.5 }),
          ],
        },
      ],
    },
    'foam-board': {
      width: 24,
      height: 36,
      slides: [
        {
          elements: [
            lockup(1.3, 1.2, 7.5),
            t(17.5, 1.5, 5.2, 0.7, 'PENSACOLA · CANTONMENT\nOWNER-OPERATED', { size: 15, bold: true, color: P.taupe, align: 'r', spacing: 1.5, lineSpacing: 1.3 }),
            r(1.3, 3.2, 21.4, 0.02, P.champagne, 'Rule'),
            t(1.3, 4.4, 13.5, 4.0, FACTS.tagline, { font: 'Fraunces', size: 88, bold: true, color: P.ink, lineSpacing: 1.0 }),
            t(1.3, 8.8, 12.5, 1.4, 'Recurring house cleaning in Pensacola and Cantonment — weekly, biweekly or monthly.', { size: 26, color: P.ink700, lineSpacing: 1.3 }),
            t(1.3, 10.8, 13.5, 2.4, '01  Estimates built from real labor hours\n02  The details most cleaners skip, every visit\n03  Hayli confirms every request personally', { size: 22, color: P.ink700, lineSpacing: 1.8 }),
            t(1.3, 13.6, 13.5, 0.6, 'NOW SCHEDULING IN YOUR NEIGHBORHOOD', { size: 15, bold: true, color: P.taupe, spacing: 1.5 }),
            t(1.3, 14.4, 13.5, 1.0, FACTS.serviceAreaFull, { size: 14, color: P.taupe, lineSpacing: 1.3 }),
            portrait(16.2, 4.6, 6.4),
            t(16.2, 15.0, 6.5, 1.2, `${FACTS.founder}\n${FACTS.founderRole}`, { font: 'Fraunces', size: 34, bold: true, color: P.ink, lineSpacing: 1.1 }),
            r(1.3, 30.2, 21.4, 0.02, P.champagne, 'Rule'),
            img(1.3, 31.0, 5.0, 5.0, qr('foam-board'), 'QR — foam board'),
            t(1.3, 36.15 - 1.0, 5.0, 0.3, 'SCAN FOR A FREE INSTANT ESTIMATE', { size: 15, color: P.taupe, align: 'ctr', spacing: 1.2 }),
            t(14.5, 31.3, 8.2, 2.6, `${phone}\n${email}\n${domain}\n${FACTS.hours}`, { size: 28, color: P.ink700, align: 'r', lineSpacing: 1.5 }),
          ],
        },
      ],
    },
    'community-leave-behind': {
      width: 5,
      height: 7,
      slides: [
        {
          elements: [
            lockup(0.4, 0.35, 2.3),
            t(0.4, 1.15, 4.2, 0.4, 'Keep this note.', { font: 'Great Vibes', size: 24, color: P.rose600 }),
            t(0.4, 1.6, 4.2, 0.7, 'Ways I can help your home.', { font: 'Fraunces', size: 20, bold: true, color: P.ink, lineSpacing: 1.05 }),
            t(0.4, 2.4, 4.2, 1.1, '✓  Recurring house cleaning\n✓  Deep cleaning\n✓  Move-in / move-out\n✓  Short-term rentals\n✓  Commercial spaces · Churches', { size: 10, color: P.ink700, lineSpacing: 1.5 }),
            r(0.4, 3.7, 4.2, 0.95, P.champagne100, 'Owner panel'),
            t(0.55, 3.85, 3.9, 0.7, `Owner-operated by ${FACTS.founder}\nEvery request is confirmed personally, and the details stay done visit after visit.`, { size: 9, color: P.ink700, lineSpacing: 1.4 }),
            img(0.4, 5.1, 1.25, 1.25, qr('community-leave-behind'), 'QR — leave-behind'),
            t(0.4, 6.4, 1.25, 0.14, 'Scan me', { size: 6.5, color: P.taupe, align: 'ctr' }),
            t(2.5, 5.35, 2.1, 1.0, `${phone}\n${email}\n${domain}`, { size: 9.5, color: P.ink700, align: 'r', lineSpacing: 1.5 }),
          ],
        },
      ],
    },
    'realtor-card': {
      width: 3.5,
      height: 2,
      slides: [
        {
          elements: [
            lockup(0.17, 0.13, 1.5),
            r(2.6, 0.14, 0.75, 0.24, P.champagne100, 'Tag'),
            t(2.62, 0.19, 0.71, 0.14, 'FOR REALTORS', { size: 5.5, bold: true, color: P.champagne700, align: 'ctr', spacing: 1.0 }),
            t(0.18, 0.55, 1.9, 0.6, 'Move-out cleaning, scheduled around closings.', { font: 'Fraunces', size: 13, bold: true, color: P.ink, lineSpacing: 1.05 }),
            t(0.18, 1.05, 1.9, 0.35, '☐  Move-in / move-out cleaning\n☐  Confirmed personally by Hayli', { size: 7, color: P.ink700, lineSpacing: 1.5 }),
            t(0.18, 1.55, 1.9, 0.3, `${phone}\n${email} · ${domain}`, { size: 7.5, color: P.ink700, lineSpacing: 1.4 }),
            img(2.45, 0.6, 0.85, 0.85, qr('realtor-packet'), 'QR — realtor card'),
            t(2.45, 1.48, 0.85, 0.14, 'MOVE-OUT PAGE', { size: 5.5, color: P.taupe, align: 'ctr', spacing: 1.0 }),
          ],
        },
      ],
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  let outRoot = process.env.PRINT_OUT_DIR ?? defaultOutputRoot();
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--out') outRoot = args[++index];
  }
  if (path.basename(path.resolve(outRoot)).toLowerCase() === 'door knocking') {
    throw new Error('Refusing to write into the original packet folder.');
  }
  const assets = await generateAssets();
  const all = specs(assets);
  const masterDir = path.join(path.resolve(outRoot), 'Editable-Masters');
  fs.mkdirSync(masterDir, { recursive: true });
  for (const piece of PIECES) {
    const spec = all[piece.id];
    if (!spec) throw new Error(`Missing PPTX spec for ${piece.id}`);
    const variant = PRODUCTION_MIX[piece.id];
    const outPath = path.join(masterDir, `${piece.id}-${variant}.pptx`);
    buildPptx({ widthIn: spec.width, heightIn: spec.height, slides: spec.slides, outPath });
    console.log(`  ${piece.id}-${variant}.pptx (${spec.width}×${spec.height} in, ${spec.slides.length} slide(s))`);
  }
  console.log(`\nwrote ${PIECES.length} editable masters into ${masterDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
