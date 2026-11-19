import {
  formatInvoiceDate,
  formatMoney,
  type InvoiceData,
  type InvoiceTotals,
} from './invoice.ts';

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const LEFT = 50;
const RIGHT = PAGE_WIDTH - 50;
const CONTENT_BOTTOM = 74;

const INK = '0.19 0.14 0.16';
const INK_SOFT = '0.29 0.23 0.25';
const MUTED = '0.55 0.48 0.44';
const BORDER = '0.85 0.80 0.76';
const ROSE = '0.69 0.35 0.44';

function ascii(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x20-\x7e]/g, '-');
}

function escapePdf(value: string): string {
  return ascii(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function textWidth(value: string, size: number, bold = false): number {
  return ascii(value).length * size * (bold ? 0.56 : 0.5);
}

function wrap(value: string, maxWidth: number, size: number, bold = false): string[] {
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

function text(value: string, x: number, y: number, size: number, bold = false, color = INK): string {
  return `BT ${color} rg ${bold ? '/F2' : '/F1'} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapePdf(value)}) Tj ET\n`;
}

function rightText(value: string, xRight: number, y: number, size: number, bold = false, color = INK): string {
  return text(value, xRight - textWidth(value, size, bold), y, size, bold, color);
}

function rule(y: number, color = BORDER): string {
  return `${color} RG 0.6 w ${LEFT} ${y.toFixed(2)} m ${RIGHT} ${y.toFixed(2)} l S\n`;
}

function pageFooter(contact: InvoiceData['contact'], page: number, total: number): string {
  let content = rule(58);
  content += text(`${contact.name} · ${contact.phone} · ${contact.email} · ${contact.website}`, LEFT, 44, 8, false, MUTED);
  content += rightText(`Page ${page} of ${total}`, RIGHT, 44, 8, false, MUTED);
  return content;
}

export function buildInvoicePdf(data: InvoiceData, totals: InvoiceTotals): Uint8Array {
  const pages: string[] = [];
  let content = '';
  let y = 0;

  const beginPage = (continued = false): void => {
    if (content) pages.push(content);
    content = text('Sparkling Standard Cleaning Co.', LEFT, 754, 16, true, INK);
    content += rightText('INVOICE', RIGHT, 752, 24, true, INK);
    content += text('Standards That Sparkle.', LEFT, 736, 8, false, ROSE);
    content += rule(727);
    if (continued) {
      content += text(`${data.invoiceNumber} — continued`, LEFT, 704, 9, false, MUTED);
      y = 688;
      return;
    }
    content += text('BILLED TO', LEFT, 704, 8, true, MUTED);
    const billedToLines = [
      data.billedTo.company,
      data.billedTo.contact,
      data.billedTo.email,
      data.billedTo.phone,
      ...(data.billedTo.addressLines ?? []),
    ].filter((line): line is string => Boolean(line && line.trim()));
    let leftY = 690;
    for (const [index, line] of billedToLines.entries()) {
      content += text(line, LEFT, leftY, 9, index === 0, index === 0 ? INK : INK_SOFT);
      leftY -= 12;
    }
    if (data.serviceLocation) {
      leftY -= 5;
      content += text('SERVICE LOCATION', LEFT, leftY, 8, true, MUTED);
      leftY -= 12;
      for (const line of wrap(data.serviceLocation, 250, 9)) {
        content += text(line, LEFT, leftY, 9, false, INK_SOFT);
        leftY -= 11;
      }
    }
    const metaX = 380;
    content += text('Invoice number', metaX, 704, 8, false, MUTED);
    content += rightText(data.invoiceNumber, RIGHT, 704, 9, true);
    content += text('Issue date', metaX, 690, 8, false, MUTED);
    content += rightText(formatInvoiceDate(data.issueDate), RIGHT, 690, 9);
    content += text('Due date', metaX, 676, 8, false, MUTED);
    content += rightText(data.dueDate ? formatInvoiceDate(data.dueDate) : 'On receipt', RIGHT, 676, 9);
    y = Math.min(leftY - 12, 640);
  };

  const ensure = (space: number): void => {
    if (y - space < CONTENT_BOTTOM) beginPage(true);
  };

  const tableHeader = (): void => {
    y -= 18;
    content += text('DESCRIPTION', LEFT, y, 8, true, MUTED);
    content += text('QTY', 392, y, 8, true, MUTED);
    content += text('UNIT', 452, y, 8, true, MUTED);
    content += rightText('AMOUNT', RIGHT, y, 8, true, MUTED);
    y -= 6;
    content += rule(y, INK);
    y -= 14;
  };

  beginPage(false);
  tableHeader();

  for (const item of data.lineItems) {
    const descriptionLines = wrap(item.description, 300, 9);
    const rowHeight = Math.max(20, descriptionLines.length * 11 + 8);
    if (y - (rowHeight + 8) < CONTENT_BOTTOM) {
      beginPage(true);
      tableHeader();
    }
    const top = y;
    for (const [index, line] of descriptionLines.entries()) {
      content += text(line, LEFT, top - index * 11, 9, false, INK);
    }
    content += rightText(String(item.quantity), 420, top, 9, false, INK_SOFT);
    content += rightText(formatMoney(item.unitPrice), 492, top, 9, false, INK_SOFT);
    content += rightText(formatMoney(item.quantity * item.unitPrice), RIGHT, top, 9, false, INK);
    y -= rowHeight;
    content += rule(y);
    y -= 4;
  }

  const totalRow = (label: string, value: string, bold = false): void => {
    ensure(18);
    y -= 14;
    content += rightText(label, 480, y, bold ? 11 : 9, bold, bold ? INK : INK_SOFT);
    content += rightText(value, RIGHT, y, bold ? 12 : 9, bold, INK);
  };

  totalRow('Subtotal', formatMoney(totals.subtotal));
  if (totals.discountAmount > 0) totalRow(data.discountLabel || 'Discount', `-${formatMoney(totals.discountAmount)}`);
  if (totals.taxAmount !== null) totalRow(data.taxLabel || 'Tax', formatMoney(totals.taxAmount));
  totalRow(totals.paymentsReceived > 0 ? 'Total' : 'Total due', formatMoney(totals.totalDue), true);
  if (totals.paymentsReceived > 0) {
    totalRow('Payments received', `-${formatMoney(totals.paymentsReceived)}`);
    totalRow('Balance due', formatMoney(totals.balanceDue), true);
  }

  if (data.paymentTerms) {
    ensure(80);
    y -= 22;
    content += text('PAYMENT TERMS', LEFT, y, 8, true, MUTED);
    y -= 14;
    for (const line of wrap(data.paymentTerms, 500, 9)) {
      content += text(line, LEFT, y, 9, false, INK_SOFT);
      y -= 12;
    }
  }

  if (data.paymentMethods && data.paymentMethods.length > 0) {
    ensure(16);
    for (const line of wrap(`Payment methods: ${data.paymentMethods.join(' · ')}`, 500, 9)) {
      content += text(line, LEFT, y, 9, false, INK_SOFT);
      y -= 12;
    }
  }

  if (data.paymentUrl && /^https:\/\//i.test(data.paymentUrl)) {
    ensure(30);
    content += text('PAY ONLINE', LEFT, y, 8, true, MUTED);
    y -= 14;
    for (const line of wrap(data.paymentUrl, 500, 8)) {
      content += text(line, LEFT, y, 8, false, ROSE);
      y -= 10;
    }
  }

  if (data.notes) {
    ensure(60);
    y -= 18;
    content += text('NOTES', LEFT, y, 8, true, MUTED);
    y -= 14;
    for (const line of wrap(data.notes, 500, 9)) {
      ensure(14);
      content += text(line, LEFT, y, 9, false, INK_SOFT);
      y -= 12;
    }
  }

  if (data.contact.legalName) {
    ensure(26);
    y -= 18;
    content += text(`Legal entity: ${data.contact.legalName}`, LEFT, y, 8, false, MUTED);
  }

  pages.push(content);

  const withFooters = pages.map((page, index) => page + pageFooter(data.contact, index + 1, pages.length));
  return assemblePdf(withFooters);
}

function assemblePdf(pageContents: string[]): Uint8Array {
  const objects: string[] = [];
  const pageIds = pageContents.map((_, index) => 5 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageContents.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  pageContents.forEach((stream, index) => {
    const pageId = 5 + index * 2;
    const contentId = pageId + 1;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
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
