// Commercial invoice — pure builder for a professional, owner-completed
// invoice. The website never issues invoices; this module exists so the owner
// can produce one from verified business facts and explicitly marked
// owner-completion fields.
//
// Integrity rules (enforced by tests):
//  - no bank details, tax IDs, registration numbers or legal terms are ever
//    invented — unset fields render as explicit owner-completion placeholders;
//  - tax appears only when the owner supplies a label AND a rate;
//  - totals are arithmetic on the supplied line items, rounded to cents;
//  - all values are HTML-escaped.

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface InvoiceParty {
  company: string;
  contact?: string;
  email?: string;
  phone?: string;
  addressLines?: string[];
}

export interface InvoiceContact {
  /** Public business name. */
  name: string;
  phone: string;
  email: string;
  /** Display form, no protocol. */
  website: string;
  /** Registered legal entity — render as a completion placeholder when absent. */
  legalName?: string;
}

export interface InvoiceData {
  invoiceNumber: string;
  /** ISO date (YYYY-MM-DD). */
  issueDate: string;
  /** ISO date; unset renders an owner-completion placeholder. */
  dueDate?: string;
  billedTo: InvoiceParty;
  serviceLocation?: string;
  poReference?: string;
  lineItems: InvoiceLineItem[];
  /** Tax row appears only when both a label and a rate are supplied. */
  taxLabel?: string;
  taxRatePercent?: number;
  notes?: string;
  /** Commercial payment terms — unset renders an owner-completion placeholder. */
  paymentTerms?: string;
  /** Owner-approved payment methods (verified facts only). */
  paymentMethods?: string[];
  contact: InvoiceContact;
}

export interface InvoiceTotals {
  subtotal: number;
  taxAmount: number | null;
  totalDue: number;
}

export interface BuiltInvoice {
  html: string;
  text: string;
  totals: InvoiceTotals;
}

const PALETTE = {
  cream: '#f9f3ed',
  card: '#ffffff',
  ink: '#302429',
  inkSoft: '#4a3b40',
  muted: '#8c7a70',
  rose: '#b15a6f',
  champagneText: '#6d5426',
  border: '#e4d5c7',
} as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatMoney(value: number): string {
  return `$${round2(value).toFixed(2)}`;
}

/** ISO date → "October 8, 2026"; anything else unchanged. */
export function formatInvoiceDate(raw: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  try {
    const date = new Date(`${raw}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return raw;
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(date);
  } catch {
    return raw;
  }
}

function placeholder(label: string): string {
  return `[${label} — owner to complete]`;
}

/** Computes the invoice totals. Tax is applied only when label AND rate exist. */
export function computeInvoiceTotals(data: InvoiceData): InvoiceTotals {
  const subtotal = round2(
    data.lineItems.reduce((sum, item) => sum + round2(item.quantity * item.unitPrice), 0),
  );
  const rate = data.taxRatePercent;
  const taxApplicable =
    Boolean(data.taxLabel && data.taxLabel.trim() !== '') &&
    typeof rate === 'number' &&
    Number.isFinite(rate) &&
    rate >= 0;
  const taxAmount = taxApplicable ? round2((subtotal * (rate as number)) / 100) : null;
  return {
    subtotal,
    taxAmount,
    totalDue: round2(subtotal + (taxAmount ?? 0)),
  };
}

function contactLines(contact: InvoiceContact): string[] {
  return [
    contact.phone ? `Phone or text: ${contact.phone}` : '',
    contact.email ? `Email: ${contact.email}` : '',
    contact.website ? `Website: ${contact.website}` : '',
  ].filter(Boolean);
}

function buildHtml(data: InvoiceData, totals: InvoiceTotals): string {
  const billedToLines = [
    data.billedTo.company,
    data.billedTo.contact,
    data.billedTo.email,
    data.billedTo.phone,
    ...(data.billedTo.addressLines ?? []),
  ].filter((line): line is string => Boolean(line && line.trim() !== ''));

  const lineRows = data.lineItems
    .map((item) => {
      const amount = round2(item.quantity * item.unitPrice);
      return `
              <tr>
                <td style="padding:10px 12px;border-bottom:1px solid ${PALETTE.border};font-size:14px;color:${PALETTE.ink};">${escapeHtml(item.description)}</td>
                <td style="padding:10px 12px;border-bottom:1px solid ${PALETTE.border};font-size:14px;color:${PALETTE.inkSoft};text-align:right;white-space:nowrap;">${escapeHtml(String(item.quantity))}</td>
                <td style="padding:10px 12px;border-bottom:1px solid ${PALETTE.border};font-size:14px;color:${PALETTE.inkSoft};text-align:right;white-space:nowrap;">${formatMoney(item.unitPrice)}</td>
                <td style="padding:10px 12px;border-bottom:1px solid ${PALETTE.border};font-size:14px;color:${PALETTE.ink};text-align:right;white-space:nowrap;">${formatMoney(amount)}</td>
              </tr>`;
    })
    .join('');

  const taxRow =
    totals.taxAmount !== null
      ? `
              <tr>
                <td colspan="3" style="padding:8px 12px;font-size:14px;color:${PALETTE.inkSoft};text-align:right;">${escapeHtml(data.taxLabel ?? 'Tax')}</td>
                <td style="padding:8px 12px;font-size:14px;color:${PALETTE.ink};text-align:right;white-space:nowrap;">${formatMoney(totals.taxAmount)}</td>
              </tr>`
      : '';

  const paymentMethods =
    data.paymentMethods && data.paymentMethods.length > 0
      ? `<p style="margin:6px 0 0;font-size:13px;line-height:1.6;color:${PALETTE.inkSoft};"><strong style="color:${PALETTE.ink};">Payment methods:</strong> ${escapeHtml(data.paymentMethods.join(' · '))}</p>`
      : '';

  const notes = data.notes
    ? `<p style="margin:8px 0 0;font-size:13px;line-height:1.6;color:${PALETTE.inkSoft};white-space:pre-line;">${escapeHtml(data.notes)}</p>`
    : '';

  const legalLine = data.contact.legalName
    ? `<p style="margin:2px 0;font-size:11px;color:${PALETTE.muted};">Legal entity: ${escapeHtml(data.contact.legalName)}</p>`
    : `<p style="margin:2px 0;font-size:11px;color:${PALETTE.muted};">${escapeHtml(placeholder('Legal entity'))}</p>`;

  const footerContact = contactLines(data.contact)
    .map((line) => `<p style="margin:2px 0;font-size:12px;color:${PALETTE.inkSoft};">${escapeHtml(line)}</p>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Invoice ${escapeHtml(data.invoiceNumber)} — ${escapeHtml(data.contact.name)}</title>
  <style>
    @page { size: Letter; margin: 0.65in; }
    @media print {
      body { background: #ffffff; }
      .invoice-card { border: 0 !important; box-shadow: none !important; }
    }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  </style>
</head>
<body style="margin:0;padding:0;background:${PALETTE.cream};font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="background:${PALETTE.cream};padding:28px 12px;">
    <table role="presentation" width="720" align="center" cellpadding="0" cellspacing="0" class="invoice-card" style="max-width:720px;background:${PALETTE.card};border:1px solid ${PALETTE.border};border-radius:12px;padding:36px 40px;">
      <tr>
        <td>
          <table role="presentation" width="640" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:top;">
                    <p style="margin:0 0 2px;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:700;color:${PALETTE.ink};">Sparkling <span style="letter-spacing:.12em;">STANDARD</span></p>
                    <p style="margin:0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${PALETTE.champagneText};">The Details Are Our Standard.</p>
                  </td>
                  <td style="vertical-align:top;text-align:right;">
                    <p style="margin:0;font-size:26px;font-weight:700;letter-spacing:.04em;color:${PALETTE.ink};">INVOICE</p>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="margin:22px 0 0;">
                <tr>
                  <td style="width:50%;vertical-align:top;padding-right:16px;">
                    <p style="margin:0 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};">Billed to</p>
                    ${billedToLines
                      .map(
                        (line, index) =>
                          `<p style="margin:0 0 2px;font-size:14px;${index === 0 ? `font-weight:700;color:${PALETTE.ink};` : `color:${PALETTE.inkSoft};`}">${escapeHtml(line)}</p>`,
                      )
                      .join('')}
                    ${
                      data.serviceLocation
                        ? `<p style="margin:10px 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};">Service location</p>
                    <p style="margin:0;font-size:14px;color:${PALETTE.inkSoft};white-space:pre-line;">${escapeHtml(data.serviceLocation)}</p>`
                        : ''
                    }
                  </td>
                  <td style="width:50%;vertical-align:top;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:2px 0;font-size:13px;color:${PALETTE.muted};">Invoice number</td>
                        <td style="padding:2px 0;font-size:13px;color:${PALETTE.ink};font-weight:600;text-align:right;">${escapeHtml(data.invoiceNumber)}</td>
                      </tr>
                      <tr>
                        <td style="padding:2px 0;font-size:13px;color:${PALETTE.muted};">Issue date</td>
                        <td style="padding:2px 0;font-size:13px;color:${PALETTE.ink};text-align:right;">${escapeHtml(formatInvoiceDate(data.issueDate))}</td>
                      </tr>
                      <tr>
                        <td style="padding:2px 0;font-size:13px;color:${PALETTE.muted};">Due date</td>
                        <td style="padding:2px 0;font-size:13px;color:${PALETTE.ink};text-align:right;">${
                          data.dueDate ? escapeHtml(formatInvoiceDate(data.dueDate)) : escapeHtml(placeholder('Due date'))
                        }</td>
                      </tr>
                      <tr>
                        <td style="padding:2px 0;font-size:13px;color:${PALETTE.muted};">PO / reference</td>
                        <td style="padding:2px 0;font-size:13px;color:${PALETTE.ink};text-align:right;">${escapeHtml(data.poReference || '—')}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="margin:24px 0 0;border-collapse:collapse;">
                <tr>
                  <th style="padding:8px 12px;border-bottom:2px solid ${PALETTE.ink};font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};text-align:left;">Description</th>
                  <th style="padding:8px 12px;border-bottom:2px solid ${PALETTE.ink};font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};text-align:right;">Qty</th>
                  <th style="padding:8px 12px;border-bottom:2px solid ${PALETTE.ink};font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};text-align:right;">Unit price</th>
                  <th style="padding:8px 12px;border-bottom:2px solid ${PALETTE.ink};font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};text-align:right;">Amount</th>
                </tr>${lineRows}
                <tr>
                  <td colspan="3" style="padding:10px 12px 4px;font-size:14px;color:${PALETTE.inkSoft};text-align:right;">Subtotal</td>
                  <td style="padding:10px 12px 4px;font-size:14px;color:${PALETTE.ink};text-align:right;white-space:nowrap;">${formatMoney(totals.subtotal)}</td>
                </tr>${taxRow}
                <tr>
                  <td colspan="3" style="padding:10px 12px 6px;font-size:15px;font-weight:700;color:${PALETTE.ink};text-align:right;">Total due</td>
                  <td style="padding:10px 12px 6px;font-size:16px;font-weight:700;color:${PALETTE.ink};text-align:right;white-space:nowrap;">${formatMoney(totals.totalDue)}</td>
                </tr>
              </table>

              <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="margin:24px 0 0;border-top:1px solid ${PALETTE.border};">
                <tr>
                  <td style="padding:14px 0 0;">
                    <p style="margin:0 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};">Payment terms</p>
                    <p style="margin:0;font-size:13px;line-height:1.6;color:${PALETTE.inkSoft};">${
                      data.paymentTerms ? escapeHtml(data.paymentTerms) : escapeHtml(placeholder('Payment terms'))
                    }</p>
                    ${paymentMethods}
                  </td>
                </tr>
                ${
                  notes
                    ? `<tr>
                  <td style="padding:16px 0 0;">
                    <p style="margin:0 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};">Notes / scope</p>
                    ${notes}
                  </td>
                </tr>`
                    : ''
                }
              </table>

              <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="margin:24px 0 0;border-top:1px solid ${PALETTE.border};">
                <tr>
                  <td style="padding:14px 0 0;">
                    <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:${PALETTE.ink};">${escapeHtml(data.contact.name)}</p>
                    ${footerContact}
                    ${legalLine}
                  </td>
                </tr>
              </table>
        </td>
      </tr>
    </table>
    <p style="max-width:720px;margin:12px auto 0;font-size:11px;line-height:1.5;color:${PALETTE.muted};text-align:center;">
      Thank you for your business. Questions about this invoice? Reply to ${escapeHtml(data.contact.email)} and it reaches us directly.
    </p>
  </div>
</body>
</html>
`;
}

function buildText(data: InvoiceData, totals: InvoiceTotals): string {
  const lines: string[] = [];
  lines.push(`${data.contact.name} — INVOICE ${data.invoiceNumber}`);
  lines.push(`Issue date: ${formatInvoiceDate(data.issueDate)}`);
  lines.push(`Due date: ${data.dueDate ? formatInvoiceDate(data.dueDate) : placeholder('Due date')}`);
  lines.push(`PO / reference: ${data.poReference || '—'}`);
  lines.push('');
  lines.push('BILLED TO');
  lines.push(data.billedTo.company);
  if (data.billedTo.contact) lines.push(data.billedTo.contact);
  if (data.billedTo.email) lines.push(data.billedTo.email);
  if (data.billedTo.phone) lines.push(data.billedTo.phone);
  for (const line of data.billedTo.addressLines ?? []) lines.push(line);
  if (data.serviceLocation) {
    lines.push('');
    lines.push('SERVICE LOCATION');
    lines.push(data.serviceLocation);
  }
  lines.push('');
  lines.push('LINE ITEMS');
  for (const item of data.lineItems) {
    lines.push(
      `${item.description} — ${item.quantity} × ${formatMoney(item.unitPrice)} = ${formatMoney(round2(item.quantity * item.unitPrice))}`,
    );
  }
  lines.push('');
  lines.push(`Subtotal: ${formatMoney(totals.subtotal)}`);
  if (totals.taxAmount !== null) lines.push(`${data.taxLabel ?? 'Tax'}: ${formatMoney(totals.taxAmount)}`);
  lines.push(`TOTAL DUE: ${formatMoney(totals.totalDue)}`);
  lines.push('');
  lines.push('PAYMENT TERMS');
  lines.push(data.paymentTerms || placeholder('Payment terms'));
  if (data.paymentMethods && data.paymentMethods.length > 0) {
    lines.push(`Payment methods: ${data.paymentMethods.join(' · ')}`);
  }
  if (data.notes) {
    lines.push('');
    lines.push('NOTES / SCOPE');
    lines.push(data.notes);
  }
  lines.push('');
  for (const line of contactLines(data.contact)) lines.push(line);
  if (data.contact.legalName) lines.push(`Legal entity: ${data.contact.legalName}`);
  else lines.push(placeholder('Legal entity'));
  return lines.join('\n');
}

/**
 * Builds the invoice HTML and plain-text versions plus the computed totals.
 * Callers are responsible for having completed every owner-completion
 * placeholder before sending the document to a customer.
 */
export function buildInvoice(data: InvoiceData): BuiltInvoice {
  const totals = computeInvoiceTotals(data);
  return {
    html: buildHtml(data, totals),
    text: buildText(data, totals),
    totals,
  };
}

/** True when the invoice still contains owner-completion placeholders. */
export function hasOwnerPlaceholders(invoice: BuiltInvoice): boolean {
  return invoice.html.includes('— owner to complete]');
}
