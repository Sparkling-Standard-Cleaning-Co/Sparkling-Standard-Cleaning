/**
 * Minimal, dependency-free PDF primitives shared by the branded invoice and
 * estimate documents. Helvetica is a built-in PDF font, so no external font,
 * browser process or paid service is required at runtime.
 */

export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;
export const LEFT = 50;
export const RIGHT = PAGE_WIDTH - 50;
export const CONTENT_BOTTOM = 74;

export const INK = '0.19 0.14 0.16';
export const INK_SOFT = '0.29 0.23 0.25';
export const MUTED = '0.55 0.48 0.44';
export const BORDER = '0.85 0.80 0.76';
export const ROSE = '0.69 0.35 0.44';

export function ascii(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x20-\x7e]/g, '-');
}

export function escapePdf(value: string): string {
  return ascii(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function textWidth(value: string, size: number, bold = false): number {
  return ascii(value).length * size * (bold ? 0.56 : 0.5);
}

export function wrap(value: string, maxWidth: number, size: number, bold = false): string[] {
  const words = ascii(value).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, size, bold) <= maxWidth || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export type PdfFont =
  | 'sans'
  | 'sans-bold'
  | 'serif'
  | 'serif-bold'
  | 'sans-italic'
  | 'serif-italic';

const PDF_FONT_NAMES: Record<PdfFont, string> = {
  sans: '/F1',
  'sans-bold': '/F2',
  serif: '/F3',
  'serif-bold': '/F4',
  'sans-italic': '/F5',
  'serif-italic': '/F6',
};

export function textFont(
  value: string,
  x: number,
  y: number,
  size: number,
  font: PdfFont,
  color = INK,
): string {
  return `BT ${color} rg ${PDF_FONT_NAMES[font]} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapePdf(value)}) Tj ET\n`;
}

export function text(value: string, x: number, y: number, size: number, bold = false, color = INK): string {
  return `BT ${color} rg ${bold ? '/F2' : '/F1'} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapePdf(value)}) Tj ET\n`;
}

export function rightText(value: string, xRight: number, y: number, size: number, bold = false, color = INK): string {
  return text(value, xRight - textWidth(value, size, bold), y, size, bold, color);
}

export function rule(y: number, color = BORDER): string {
  return `${color} RG 0.6 w ${LEFT} ${y.toFixed(2)} m ${RIGHT} ${y.toFixed(2)} l S\n`;
}

export function assemblePdf(pageContents: string[]): Uint8Array {
  const objects: string[] = [];
  const pageIds = pageContents.map((_, index) => 9 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageContents.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>';
  objects[6] = '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>';
  objects[7] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>';
  objects[8] = '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic /Encoding /WinAnsiEncoding >>';
  pageContents.forEach((stream, index) => {
    const pageId = 9 + index * 2;
    const contentId = pageId + 1;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R /F5 7 0 R /F6 8 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
  });

  let body = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = body.length;
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    body += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}
