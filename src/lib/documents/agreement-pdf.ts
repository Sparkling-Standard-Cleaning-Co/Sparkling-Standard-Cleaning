/**
 * Production-compatible executed agreement PDF.
 *
 * Uses the dependency-free PDF primitives already used by invoices so the
 * Cloudflare Function runtime does not need Chromium, LibreOffice or an external
 * rendering service. The PDF is an evidence artifact built from the immutable
 * signing-request snapshot; it is not a replacement for the exact approved
 * template hash stored with each signature.
 */
import {
  CONTENT_BOTTOM,
  INK,
  LEFT,
  MUTED,
  PAGE_HEIGHT,
  RIGHT,
  ROSE,
  assemblePdf,
  image,
  rightText,
  rule,
  text,
  textFont,
  textWidth,
  wrap,
  type PdfFont,
} from '../pdf/pdf-core.ts';
import { BRAND_LOGO } from './brand-logo.ts';
import { DOCUMENT_BRAND } from './branding.ts';
import {
  isRichDocumentHtml,
  parseDocumentBlocks,
  plainDocumentText,
  sanitizeDocumentHtml,
  stripInternalDraftNotices,
} from './rich-text.ts';
import {
  formatPricingMoney,
  pricingSnapshotText,
  type PricingSnapshot,
} from './pricing-snapshot.ts';

export interface AgreementPdfSignature {
  title: string;
  version: string;
  templateId: string;
  contentText: string;
  contentSha256: string;
  signerName: string;
  signerEmail: string;
  signedAt: string;
  typedSignature: string;
  status: string;
  consentVersion: string;
  sourceKind?: 'text' | 'pdf';
}

export interface AgreementPdfInput {
  requestId: string;
  bundleName: string;
  bundleCode: string;
  bundleVersion: number;
  bookingReference: string;
  serviceCode: string;
  customerName: string;
  propertyAddress: string;
  executedAt: string;
  countersignatureName?: string;
  customerFields?: Array<{ label: string; value: string }>;
  pricing?: PricingSnapshot;
  signatures: AgreementPdfSignature[];
}

const BODY_SIZE = 9.2;
const LEADING = 12.4;
const HEAD_SIZE = 11.2;
const GOLD = '0.62 0.47 0.21';
const GOLD_RULE = '0.78 0.64 0.41';

function line(value: string, x: number, y: number, size: number, bold = false, color = INK): string {
  return text(value, x, y, size, bold, color);
}

function paragraphLines(value: string, maxWidth: number, size: number): string[] {
  const result: string[] = [];
  for (const raw of value.replace(/\r/g, '').split(/\n+/)) {
    const trimmed = raw.trim();
    if (!trimmed) {
      result.push('');
      continue;
    }
    result.push(...wrap(trimmed, maxWidth, size));
  }
  return result;
}

function humanDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Chicago',
    timeZoneName: 'short',
  }).format(date);
}

function humanService(value: string): string {
  const cleaned = String(value ?? '').replace(/[-_]+/g, ' ').trim();
  if (!cleaned) return 'Cleaning service';
  return cleaned.replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizedTitle(value: string): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function technicalMetadata(value: string): boolean {
  const text = value.trim().replace(/^\*{0,2}/, '').trim();
  return (
    /^version\b/i.test(text) ||
    /^document\b.*\bversion\b/i.test(text) ||
    /^template\b/i.test(text) ||
    /\bsha-?256\b/i.test(text) ||
    /^consent version\b/i.test(text) ||
    /^status\s*:/i.test(text) ||
    /^\*{0,2}(document id|legal review|effective date|applies to|brand|contact|legal entity)\*{0,2}\s*:/i.test(text)
  );
}

interface RichRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  sizePt: number | null;
  serif: boolean;
}

interface RichBlock {
  kind: 'heading' | 'paragraph' | 'bullet' | 'table' | 'pagebreak';
  level: number;
  align: 'left' | 'center' | 'right';
  runs: RichRun[];
  rows?: RichRun[][][];
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function pdfColor(value: string): string {
  const color = value.trim().toLowerCase();
  if (!color) return INK;
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex?.[1]) {
    const number = Number.parseInt(hex[1], 16);
    return `${(((number >> 16) & 255) / 255).toFixed(3)} ${(((number >> 8) & 255) / 255).toFixed(3)} ${((number & 255) / 255).toFixed(3)}`;
  }
  const short = color.match(/^#([0-9a-f]{3})$/i);
  if (short?.[1]) {
    const channels = short[1]
      .split('')
      .map((character) => Number.parseInt(`${character}${character}`, 16));
    const [r = 0, g = 0, b = 0] = channels;
    return `${(r / 255).toFixed(3)} ${(g / 255).toFixed(3)} ${(b / 255).toFixed(3)}`;
  }
  if (color === 'black') return INK;
  if (color === 'gray' || color === 'grey') return MUTED;
  if (color === 'red') return '0.75 0.12 0.16';
  if (color === 'green') return '0.15 0.45 0.25';
  if (color === 'blue') return '0.12 0.3 0.7';
  return INK;
}

function styleDeclarations(style: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of style.split(';')) {
    const [property, ...rest] = part.split(':');
    if (!property || !rest.length) continue;
    result[property.trim().toLowerCase()] = rest.join(':').trim().toLowerCase();
  }
  return result;
}

function sizeFromStyle(style: Record<string, string>): number | null {
  const raw = style['font-size'] ?? '';
  const match = raw.match(/^(\d{1,2}(?:\.\d{1,2})?)(pt|px|em|rem)?$/);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2] ?? 'pt';
  if (unit === 'px') return value * 0.75;
  if (unit === 'em' || unit === 'rem') return value * 9.2;
  return value;
}

function inlineRuns(html: string, base: { bold?: boolean; italic?: boolean; underline?: boolean; color?: string; sizePt?: number | null; serif?: boolean } = {}): RichRun[] {
  const runs: RichRun[] = [];
  const stack: Array<{ bold: boolean; italic: boolean; underline: boolean; color: string; sizePt: number | null; serif: boolean }> = [
    {
      bold: base.bold ?? false,
      italic: base.italic ?? false,
      underline: base.underline ?? false,
      color: base.color ?? INK,
      sizePt: base.sizePt ?? null,
      serif: base.serif ?? false,
    },
  ];
  const pushText = (value: string): void => {
    if (!value) return;
    const current = stack[stack.length - 1]!;
    runs.push({
      text: decodeEntities(value),
      bold: current.bold,
      italic: current.italic,
      underline: current.underline,
      color: current.color,
      sizePt: current.sizePt,
      serif: current.serif,
    });
  };
  for (const token of html.matchAll(/<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>|[^<]+|<br\s*\/?>/gi)) {
    const value = token[0];
    if (value.startsWith('<!--')) continue;
    if (/^<br/i.test(value)) {
      pushText('\n');
      continue;
    }
    if (!value.startsWith('<')) {
      pushText(value);
      continue;
    }
    const closing = /^<\s*\//.test(value);
    const tagMatch = value.match(/^<\s*\/?\s*([a-zA-Z0-9]+)([^>]*)>$/);
    if (!tagMatch) continue;
    const tag = String(tagMatch[1] ?? '').toLowerCase();
    const attrs = String(tagMatch[2] ?? '');
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (tag === 'br') {
      pushText('\n');
      continue;
    }
    const styleAttr = attrs.match(/style\s*=\s*"([^"]*)"/i)?.[1] ?? '';
    const style = styleDeclarations(styleAttr);
    const current = stack[stack.length - 1]!;
    const family = style['font-family'] ?? '';
    stack.push({
      bold: current.bold || tag === 'strong' || tag === 'b' || style['font-weight'] === 'bold',
      italic: current.italic || tag === 'em' || tag === 'i' || style['font-style'] === 'italic',
      underline: current.underline || tag === 'u' || style['text-decoration'] === 'underline',
      color: style.color ? pdfColor(style.color) : current.color,
      sizePt: sizeFromStyle(style) ?? current.sizePt,
      serif: current.serif || /times|georgia|serif/i.test(family),
    });
  }
  return runs;
}

function blockAlign(attrs: string): 'left' | 'center' | 'right' {
  const style = styleDeclarations(attrs.match(/style\s*=\s*"([^"]*)"/i)?.[1] ?? '');
  if (style['text-align'] === 'center') return 'center';
  if (style['text-align'] === 'right') return 'right';
  return 'left';
}

function richBlocksFromHtml(content: string): { blocks: RichBlock[]; header: RichRun[]; footer: RichRun[] } {
  let body = sanitizeDocumentHtml(content);
  const outer = body.match(/^<div[^>]*>/i);
  if (outer && body.trimEnd().endsWith('</div>')) {
    body = body.slice(outer[0].length, body.trimEnd().length - '</div>'.length);
  }
  let header: RichRun[] = [];
  let footer: RichRun[] = [];
  const headerMatch = body.match(/<header[^>]*>([\s\S]*?)<\/header>/i) ?? body.match(/<div[^>]*data-doc-header[^>]*>([\s\S]*?)<\/div>/i);
  if (headerMatch?.[1]) {
    header = inlineRuns(headerMatch[1]);
    body = body.replace(headerMatch[0], '');
  }
  const footerMatch = body.match(/<footer[^>]*>([\s\S]*?)<\/footer>/i) ?? body.match(/<div[^>]*data-doc-footer[^>]*>([\s\S]*?)<\/div>/i);
  if (footerMatch?.[1]) {
    footer = inlineRuns(footerMatch[1]);
    body = body.replace(footerMatch[0], '');
  }
  const blocks: RichBlock[] = [];
  const push = (kind: RichBlock['kind'], content: string, attrs = '', level = 0): void => {
    const style = styleDeclarations(attrs.match(/style\s*=\s*"([^"]*)"/i)?.[1] ?? '');
    const runs = inlineRuns(content, {
      ...(style.color ? { color: pdfColor(style.color) } : {}),
      ...(style['font-weight'] === 'bold' ? { bold: true } : {}),
      ...(style['font-style'] === 'italic' ? { italic: true } : {}),
      ...(style['text-decoration'] === 'underline' ? { underline: true } : {}),
      ...(/times|georgia|serif/i.test(style['font-family'] ?? '') ? { serif: true } : {}),
      ...(sizeFromStyle(style) ? { sizePt: sizeFromStyle(style) } : {}),
    });
    if (!runs.some((run) => run.text.trim())) return;
    blocks.push({ kind, level, align: blockAlign(attrs), runs });
  };
  const tables: string[] = [];
  body = body.replace(/<table[\s\S]*?<\/table>/gi, (table) => {
    const token = `\n[[TABLE:${tables.length}]]\n`;
    tables.push(table);
    return token;
  });
  body = body.replace(/<div[^>]*data-doc-page-break[^>]*>\s*<\/div>|<hr[^>]*>/gi, '\n[[PAGEBREAK]]\n');
  body = body.replace(/(<h1[^>]*>[\s\S]*?<\/h1>|<h2[^>]*>[\s\S]*?<\/h2>|<h3[^>]*>[\s\S]*?<\/h3>|<h4[^>]*>[\s\S]*?<\/h4>)/gi, (heading) => {
    const level = Number(heading.match(/^<h([1-4])/i)?.[1] ?? 2);
    const attrs = heading.match(/^<h[1-4]([^>]*)>/i)?.[1] ?? '';
    push('heading', heading.replace(/^<h[1-4][^>]*>/i, '').replace(/<\/h[1-4]>$/i, ''), attrs, level);
    return '\n';
  });
  body = body.replace(/(<ul[^>]*>[\s\S]*?<\/ul>|<ol[^>]*>[\s\S]*?<\/ol>)/gi, (list) => {
    const items = list.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi);
    for (const item of items) {
      if (item[1]) push('bullet', item[1]);
    }
    return '\n';
  });
  body = body.replace(/<(p|div)([^>]*)>([\s\S]*?)<\/\1>/gi, (_all, _tag, attrs: string, inner: string) => {
    push('paragraph', String(inner), String(attrs));
    return '\n';
  });
  for (const token of body.split(/\n+/)) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const tableMatch = trimmed.match(/^\[\[TABLE:(\d+)\]\]$/);
    if (tableMatch?.[1]) {
      const table = tables[Number(tableMatch[1])] ?? '';
      const rows: RichRun[][][] = [];
      for (const rowMatch of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const cells: RichRun[][] = [];
        for (const cellMatch of String(rowMatch[1] ?? '').matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)) {
          cells.push(inlineRuns(String(cellMatch[1] ?? '')));
        }
        if (cells.length) rows.push(cells);
      }
      if (rows.length) blocks.push({ kind: 'table', level: 0, align: 'left', runs: [], rows });
      continue;
    }
    if (trimmed === '[[PAGEBREAK]]') {
      blocks.push({ kind: 'pagebreak', level: 0, align: 'left', runs: [] });
      continue;
    }
    push('paragraph', trimmed);
  }
  return { blocks, header, footer };
}

function runFont(run: RichRun): PdfFont {
  if (run.serif && run.bold) return 'serif-bold';
  if (run.serif && run.italic) return 'serif-italic';
  if (run.serif) return 'serif';
  if (run.bold) return 'sans-bold';
  if (run.italic) return 'sans-italic';
  return 'sans';
}

function writeRichLine(
  runs: RichRun[],
  x: number,
  y: number,
  defaultSize: number,
  align: 'left' | 'center' | 'right',
  width: number,
): string {
  const segments = runs.map((run) => ({
    text: run.text,
    font: runFont(run),
    size: run.sizePt ?? defaultSize,
    color: run.color,
    underline: run.underline,
    width: textWidth(run.text, run.sizePt ?? defaultSize, runFont(run).includes('bold')),
  }));
  const total = segments.reduce((sum, segment) => sum + segment.width, 0);
  let cursor = x;
  if (align === 'center') cursor = x + Math.max(0, (width - total) / 2);
  if (align === 'right') cursor = x + Math.max(0, width - total);
  let output = '';
  for (const segment of segments) {
    if (segment.text) {
      output += textFont(segment.text, cursor, y, segment.size, segment.font, segment.color);
      if (segment.underline) {
        output += `${segment.color} RG 0.5 w ${cursor.toFixed(2)} ${(y - 1.5).toFixed(2)} m ${(cursor + segment.width).toFixed(2)} ${(y - 1.5).toFixed(2)} l S\n`;
      }
    }
    cursor += segment.width;
  }
  return output;
}

function wrapRichRuns(runs: RichRun[], width: number, defaultSize: number): RichRun[][] {
  const lines: RichRun[][] = [];
  let line: RichRun[] = [];
  let lineWidth = 0;
  const flush = (): void => {
    if (line.length) lines.push(line);
    line = [];
    lineWidth = 0;
  };
  for (const run of runs) {
    const pieces = run.text.split(/(\s+|\n)/).filter((piece) => piece !== '');
    for (const piece of pieces) {
      if (piece === '\n') {
        flush();
        continue;
      }
      const segment: RichRun = { ...run, text: piece };
      const segmentWidth = textWidth(piece, run.sizePt ?? defaultSize, run.bold);
      if (lineWidth + segmentWidth > width && line.length && piece.trim()) flush();
      line.push(segment);
      lineWidth += segmentWidth;
    }
  }
  flush();
  return lines;
}

export function buildExecutedAgreementPdf(input: AgreementPdfInput): Uint8Array {
  const pages: string[] = [];
  let commands = '';
  let y = PAGE_HEIGHT - 58;

  const brandFooter = (): string =>
    image('BrandLogo', LEFT, 26, 16, 16) +
    text(`${DOCUMENT_BRAND.name} | ${DOCUMENT_BRAND.slogan}`, LEFT + 22, 34, 7.2, false, MUTED) +
    text('Confidential customer copy', LEFT + 22, 24, 6.8, false, MUTED) +
    rightText('Page __PAGENO__', RIGHT, 30, 7.2, false, MUTED);

  const brandHeader = (first: boolean): void => {
    const top = PAGE_HEIGHT - 40;
    const logoSize = first ? 44 : 22;
    commands += image('BrandLogo', LEFT, top - logoSize, logoSize, logoSize);
    const textX = LEFT + logoSize + 12;
    commands += line(DOCUMENT_BRAND.name, textX, top - 8, first ? 14 : 9, true, ROSE);
    commands += line(DOCUMENT_BRAND.slogan, textX, top - 20, first ? 7.5 : 6.5, false, GOLD);
    commands += rightText(DOCUMENT_BRAND.phone, RIGHT, top - 8, 7.2, false, MUTED);
    commands += rightText(DOCUMENT_BRAND.email, RIGHT, top - 18, 6.4, false, MUTED);
    commands += rightText('sparkling-standard.com', RIGHT, top - 27, 6.4, false, MUTED);
    if (first) {
      commands += line('Executed Agreement and Signature Record', LEFT, top - 54, 17, true, INK);
      commands += rule(top - 64, GOLD_RULE);
      y = top - 82;
    } else {
      commands += rule(top - 30, GOLD_RULE);
      y = top - 44;
    }
  };

  const newPage = () => {
    pages.push(commands + brandFooter());
    commands = '';
    brandHeader(false);
  };

  const ensure = (height: number) => {
    if (y - height < CONTENT_BOTTOM) newPage();
  };

  const write = (value: string, x = LEFT, size = BODY_SIZE, bold = false, color = INK, gap = LEADING, width = RIGHT - LEFT) => {
    for (const part of paragraphLines(value, width, size)) {
      ensure(gap);
      commands += line(part, x, y, size, bold, color);
      y -= gap;
    }
  };

  const writeRichRuns = (
    runs: RichRun[],
    options: {
      size?: number;
      gap?: number;
      indent?: number;
      align?: 'left' | 'center' | 'right';
      width?: number;
      color?: string;
      bold?: boolean;
    } = {},
  ): void => {
    const size = options.size ?? BODY_SIZE;
    const gap = options.gap ?? LEADING;
    const indent = options.indent ?? 0;
    const width = options.width ?? RIGHT - LEFT - indent;
    const align = options.align ?? 'left';
    const prepared = options.color || options.bold
      ? runs.map((run) => ({
          ...run,
          ...(options.color ? { color: options.color } : {}),
          ...(options.bold ? { bold: true } : {}),
        }))
      : runs;
    for (const line of wrapRichRuns(prepared, width, size)) {
      ensure(gap);
      commands += writeRichLine(line, LEFT + indent, y, size, align, width);
      y -= gap;
    }
  };

  const writeDocumentContent = (value: string, documentTitle: string): void => {
    if (isRichDocumentHtml(value)) {
      const parsed = richBlocksFromHtml(value);
      if (parsed.header.length) {
        writeRichRuns(parsed.header, { size: 8.4, gap: 11.5, color: MUTED });
        y -= 4;
      }
      const titleKey = normalizedTitle(documentTitle);
      for (const block of parsed.blocks) {
        if (block.kind === 'pagebreak') {
          newPage();
          continue;
        }
        if (block.kind === 'table' && block.rows?.length) {
          const columnCount = Math.max(...block.rows.map((row) => row.length));
          const cellWidth = (RIGHT - LEFT) / Math.max(1, columnCount);
          for (const row of block.rows) {
            const cellLines = row.map((cell) => wrapRichRuns(cell, cellWidth - 8, 8.6));
            const rowHeight = Math.max(1, ...cellLines.map((lines) => lines.length)) * 11.5 + 4;
            ensure(rowHeight + 6);
            const rowTop = y;
            for (let column = 0; column < columnCount; column += 1) {
              const lines = cellLines[column] ?? [];
              let cellY = rowTop;
              for (const line of lines) {
                commands += writeRichLine(line, LEFT + column * cellWidth + 4, cellY, 8.6, 'left', cellWidth - 8);
                cellY -= 11.5;
              }
              commands += `${MUTED} RG 0.5 w ${(LEFT + (column + 1) * cellWidth).toFixed(2)} ${(rowTop + 4).toFixed(2)} m ${(LEFT + (column + 1) * cellWidth).toFixed(2)} ${(rowTop - rowHeight + 4).toFixed(2)} l S\n`;
            }
            commands += `${MUTED} RG 0.5 w ${LEFT.toFixed(2)} ${(rowTop - rowHeight + 4).toFixed(2)} m ${RIGHT.toFixed(2)} ${(rowTop - rowHeight + 4).toFixed(2)} l S\n`;
            y -= rowHeight;
          }
          y -= 4;
          continue;
        }
        const textValue = block.runs.map((run) => run.text).join('').trim();
        if (!textValue) continue;
        if (block.kind === 'heading') {
          const headingKey = normalizedTitle(textValue);
          if (headingKey === titleKey || headingKey === 'sparkling standard cleaning co') continue;
          ensure(24);
          y -= 4;
          const size = block.level === 1 ? 14 : block.level === 2 ? HEAD_SIZE : 10.2;
          writeRichRuns(block.runs, {
            size,
            gap: size + 4,
            bold: true,
            color: ROSE,
            align: block.align,
          });
          continue;
        }
        if (block.kind === 'bullet') {
          const first = block.runs[0];
          writeRichRuns(
            first ? [{ ...first, text: `- ${first.text}` }, ...block.runs.slice(1)] : block.runs,
            { indent: 8, align: block.align },
          );
          continue;
        }
        writeRichRuns(block.runs, { align: block.align });
        y -= 2;
      }
      if (parsed.footer.length) {
        y -= 4;
        commands += rule(y);
        y -= 14;
        writeRichRuns(parsed.footer, { size: 8.4, gap: 11.5, color: MUTED });
      }
      return;
    }
    const blocks = parseDocumentBlocks(stripInternalDraftNotices(value).content);
    if (blocks.length === 0) {
      write(value || 'Document content is retained in the signing record.');
      return;
    }
    const titleKey = normalizedTitle(documentTitle);
    for (const block of blocks) {
      if (block.type === 'table' && block.rows?.length) {
        const columnCount = Math.max(...block.rows.map((row) => row.length));
        const cellWidth = (RIGHT - LEFT) / Math.max(1, columnCount);
        for (const row of block.rows) {
          const cellLines = row.map((cell) => wrapRichRuns(inlineRuns(cell), cellWidth - 8, 8.6));
          const rowHeight = Math.max(1, ...cellLines.map((lines) => lines.length)) * 11.5 + 4;
          ensure(rowHeight + 6);
          const rowTop = y;
          for (let column = 0; column < columnCount; column += 1) {
            const lines = cellLines[column] ?? [];
            let cellY = rowTop;
            for (const line of lines) {
              commands += writeRichLine(line, LEFT + column * cellWidth + 4, cellY, 8.6, 'left', cellWidth - 8);
              cellY -= 11.5;
            }
            commands += `${MUTED} RG 0.5 w ${(LEFT + (column + 1) * cellWidth).toFixed(2)} ${(rowTop + 4).toFixed(2)} m ${(LEFT + (column + 1) * cellWidth).toFixed(2)} ${(rowTop - rowHeight + 4).toFixed(2)} l S\n`;
          }
          commands += `${MUTED} RG 0.5 w ${LEFT.toFixed(2)} ${(rowTop - rowHeight + 4).toFixed(2)} m ${RIGHT.toFixed(2)} ${(rowTop - rowHeight + 4).toFixed(2)} l S\n`;
          y -= rowHeight;
        }
        y -= 4;
        continue;
      }
      const content = plainDocumentText(block.text);
      if (!content) continue;
      if (block.type === 'metadata' && technicalMetadata(content)) continue;
      if (block.type === 'title') continue;
      if (block.type === 'heading') {
        const key = normalizedTitle(content);
        if (key === titleKey || key === 'sparkling standard cleaning co') {
          continue;
        }
      }
      if (block.type === 'heading') {
        ensure(24);
        y -= 4;
        write(content, LEFT, HEAD_SIZE, true, ROSE, 15);
      } else if (block.type === 'metadata') {
        write(content, LEFT, 8.4, false, MUTED, 11.5);
      } else if (block.type === 'bullet') {
        write(`- ${content}`, LEFT + 8, BODY_SIZE, false, INK, LEADING, RIGHT - LEFT - 8);
      } else {
        write(content, LEFT, BODY_SIZE, false, INK);
        y -= 2;
      }
    }
  };

  brandHeader(true);

  const meta: Array<[string, string]> = [
    ['Agreement', input.bundleName || 'Cleaning agreement'],
    ['Booking reference', input.bookingReference || 'Not applicable'],
    ['Service', humanService(input.serviceCode)],
    ['Customer', input.customerName || 'Customer identified in the signed schedule'],
    ['Property', input.propertyAddress || 'Property identified in the signed schedule'],
    ['Executed', humanDateTime(input.executedAt)],
  ];
  for (const [label, value] of meta) {
    ensure(LEADING);
    commands += line(`${label}:`, LEFT, y, BODY_SIZE, true, INK);
    commands += line(value, LEFT + 95, y, BODY_SIZE, false, INK);
    y -= LEADING;
  }
  y -= 6;

  if (input.customerFields?.length) {
    ensure(24);
    commands += line('Customer Instructions and Access Schedule', LEFT, y, HEAD_SIZE, true, ROSE);
    y -= 15;
    write(
      'The customer provided the following access and service instructions. These instructions are part of the signed record and do not change the approved agreement wording.',
      LEFT,
      8.4,
      false,
      MUTED,
    );
    for (const row of input.customerFields) {
      ensure(LEADING);
      commands += line(`${row.label}:`, LEFT, y, BODY_SIZE, true, INK);
      y -= LEADING;
      write(row.value, LEFT + 8, BODY_SIZE, false, INK, LEADING, RIGHT - LEFT - 8);
    }
    y -= 6;
    commands += rule(y);
    y -= 16;
  }

  if (input.pricing) {
    ensure(24);
    commands += line('Pricing and Payment', LEFT, y, HEAD_SIZE, true, ROSE);
    y -= 15;
    for (const row of pricingSnapshotText(input.pricing)) {
      if (!row) continue;
      if (row.startsWith('Total:') || row.startsWith('Amount due now:')) {
        ensure(LEADING);
        commands += line(row, LEFT, y, BODY_SIZE, true, INK);
        y -= LEADING;
        continue;
      }
      write(row, LEFT, BODY_SIZE, false, INK);
    }
    if (input.pricing.totalCents !== null) {
      ensure(LEADING);
      commands += line(
        `Total confirmed: ${formatPricingMoney(input.pricing.totalCents)}`,
        LEFT,
        y,
        BODY_SIZE,
        true,
        ROSE,
      );
      y -= LEADING;
    }
    y -= 6;
    commands += rule(y);
    y -= 16;
  }

  let firstDocument = true;
  for (const signature of input.signatures) {
    if (!firstDocument) newPage();
    firstDocument = false;
    commands += line(signature.title, LEFT, y, HEAD_SIZE, true, ROSE);
    y -= 18;
    if (signature.sourceKind === 'pdf' && !signature.contentText.trim()) {
      write('This document was signed as a separate PDF. The original PDF is retained privately and forms part of this record.');
    } else {
      writeDocumentContent(signature.contentText || 'Document content is retained in the signing record.', signature.title);
    }
    ensure(70);
    y -= 6;
    commands += rule(y);
    y -= 14;
    commands += line('Electronic signature', LEFT, y, BODY_SIZE, true, INK);
    y -= LEADING;
    commands += line(`Signed by: ${signature.signerName}`, LEFT + 8, y, BODY_SIZE, false, INK);
    y -= LEADING;
    commands += line(`Signature: ${signature.typedSignature || signature.signerName}`, LEFT + 8, y, BODY_SIZE, false, INK);
    y -= LEADING;
    commands += line(`Signed on: ${humanDateTime(signature.signedAt)}`, LEFT + 8, y, BODY_SIZE, false, MUTED);
    y -= 18;
    commands += rule(y);
    y -= 16;
  }

  ensure(90);
  commands += line('Execution Record', LEFT, y, HEAD_SIZE, true, ROSE);
  y -= 15;
  const audit = [
    `Executed: ${humanDateTime(input.executedAt)}`,
    `Customer: ${input.customerName || 'as recorded'}`,
    `Property: ${input.propertyAddress || 'as recorded'}`,
    `Booking reference: ${input.bookingReference || 'not applicable'}`,
    `Countersigned by: ${input.countersignatureName || 'not required'}`,
    'This copy records the agreement text and electronic signatures shown above. Signature verification and audit evidence are retained privately by Sparkling Standard.',
  ];
  for (const entry of audit) {
    ensure(LEADING);
    write(entry, LEFT + 6, BODY_SIZE, false, MUTED, LEADING, RIGHT - LEFT - 6);
  }

  pages.push(commands + `0.55 0.48 0.44 rg BT /F1 8 Tf ${LEFT} 38 Td (Sparkling Standard LLC - confidential) Tj ET\n` +
    `0.55 0.48 0.44 rg BT /F1 8 Tf ${RIGHT - 70} 38 Td (Page __PAGENO__) Tj ET\n`);

  const numbered = pages.map((page, index) => page.replaceAll('__PAGENO__', `${index + 1} of ${pages.length}`));
  return assemblePdf(numbered, [{ name: 'BrandLogo', width: BRAND_LOGO.width, height: BRAND_LOGO.height, hexData: BRAND_LOGO.hexData }]);
}
