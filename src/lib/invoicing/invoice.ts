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
  /** Exact tax amount (dollars) for stored invoices. Overrides rate calculation. */
  taxAmount?: number;
  discountLabel?: string;
  /** Discount in dollars, applied before tax. */
  discountAmount?: number;
  /** Payments already received in dollars. */
  amountPaid?: number;
  /** Exact outstanding balance in dollars when the stored invoice is authoritative. */
  balanceDue?: number;
  notes?: string;
  /** Commercial payment terms — unset renders an owner-completion placeholder. */
  paymentTerms?: string;
  /** Owner-approved payment methods (verified facts only). */
  paymentMethods?: string[];
  /** Server-issued Stripe payment link, when one exists. */
  paymentUrl?: string;
  /** Optional review invitation, only after a verified completed service. */
  review?: {
    url: string;
    eligible: boolean;
    branchName?: string;
  };
  contact: InvoiceContact;
}

export interface InvoiceTotals {
  subtotal: number;
  discountAmount: number;
  taxAmount: number | null;
  totalDue: number;
  paymentsReceived: number;
  balanceDue: number;
}

export interface BuiltInvoice {
  html: string;
  text: string;
  totals: InvoiceTotals;
  data: InvoiceData;
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
  const discountAmount = round2(
    Math.max(0, Math.min(subtotal, Number.isFinite(data.discountAmount) ? (data.discountAmount as number) : 0)),
  );
  const rate = data.taxRatePercent;
  const taxApplicable =
    Boolean(data.taxLabel && data.taxLabel.trim() !== '') &&
    typeof rate === 'number' &&
    Number.isFinite(rate) &&
    rate >= 0;
  const fixedTax =
    typeof data.taxAmount === 'number' && Number.isFinite(data.taxAmount) && data.taxAmount >= 0;
  const taxAmount = fixedTax
    ? round2(data.taxAmount as number)
    : taxApplicable
      ? round2(((subtotal - discountAmount) * (rate as number)) / 100)
      : null;
  const totalDue = round2(subtotal - discountAmount + (taxAmount ?? 0));
  const paymentsReceived = round2(
    Math.max(0, Number.isFinite(data.amountPaid) ? (data.amountPaid as number) : 0),
  );
  const balanceDue =
    typeof data.balanceDue === 'number' && Number.isFinite(data.balanceDue)
      ? round2(Math.max(0, data.balanceDue))
      : round2(Math.max(0, totalDue - paymentsReceived));
  return {
    subtotal,
    discountAmount,
    taxAmount,
    totalDue,
    paymentsReceived,
    balanceDue,
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

  const discountRow =
    totals.discountAmount > 0
      ? `
              <tr>
                <td colspan="3" style="padding:8px 12px;font-size:14px;color:${PALETTE.inkSoft};text-align:right;">${escapeHtml(data.discountLabel || 'Discount')}</td>
                <td style="padding:8px 12px;font-size:14px;color:${PALETTE.ink};text-align:right;white-space:nowrap;">-${formatMoney(totals.discountAmount)}</td>
              </tr>`
      : '';

  const taxRow =
    totals.taxAmount !== null
      ? `
              <tr>
                <td colspan="3" style="padding:8px 12px;font-size:14px;color:${PALETTE.inkSoft};text-align:right;">${escapeHtml(data.taxLabel ?? 'Tax')}</td>
                <td style="padding:8px 12px;font-size:14px;color:${PALETTE.ink};text-align:right;white-space:nowrap;">${formatMoney(totals.taxAmount)}</td>
              </tr>`
      : '';

  const totalRow = `
              <tr>
                <td colspan="3" style="padding:10px 12px 6px;font-size:15px;font-weight:700;color:${PALETTE.ink};text-align:right;">${totals.paymentsReceived > 0 ? 'Total' : 'Total due'}</td>
                <td style="padding:10px 12px 6px;font-size:16px;font-weight:700;color:${PALETTE.ink};text-align:right;white-space:nowrap;">${formatMoney(totals.totalDue)}</td>
              </tr>`;

  const paymentRows =
    totals.paymentsReceived > 0
      ? `
              <tr>
                <td colspan="3" style="padding:4px 12px;font-size:14px;color:${PALETTE.inkSoft};text-align:right;">Payments received</td>
                <td style="padding:4px 12px;font-size:14px;color:${PALETTE.ink};text-align:right;white-space:nowrap;">-${formatMoney(totals.paymentsReceived)}</td>
              </tr>
              <tr>
                <td colspan="3" style="padding:8px 12px 6px;font-size:15px;font-weight:700;color:${PALETTE.ink};text-align:right;">Balance due</td>
                <td style="padding:8px 12px 6px;font-size:16px;font-weight:700;color:${PALETTE.ink};text-align:right;white-space:nowrap;">${formatMoney(totals.balanceDue)}</td>
              </tr>`
      : '';

  const paymentMethods =
    data.paymentMethods && data.paymentMethods.length > 0
      ? `<p style="margin:6px 0 0;font-size:13px;line-height:1.6;color:${PALETTE.inkSoft};"><strong style="color:${PALETTE.ink};">Payment methods:</strong> ${escapeHtml(data.paymentMethods.join(' · '))}</p>`
      : '';

  const paymentLink =
    data.paymentUrl && /^https:\/\//i.test(data.paymentUrl)
      ? `<p style="margin:8px 0 0;font-size:13px;line-height:1.6;color:${PALETTE.inkSoft};"><strong style="color:${PALETTE.ink};">Pay online:</strong> <a href="${escapeHtml(data.paymentUrl)}" style="color:${PALETTE.rose};">${escapeHtml(data.paymentUrl)}</a></p>`
      : '';

  const notes = data.notes
    ? `<p style="margin:8px 0 0;font-size:13px;line-height:1.6;color:${PALETTE.inkSoft};white-space:pre-line;">${escapeHtml(data.notes)}</p>`
    : '';

  const review =
    data.review?.eligible && data.review.url && /^https:\/\//i.test(data.review.url)
      ? `<tr>
                  <td style="padding:16px 0 0;">
                    <p style="margin:0 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};">Share your experience</p>
                    <p style="margin:0;font-size:13px;line-height:1.6;color:${PALETTE.inkSoft};">Thank you for choosing Sparkling Standard${data.review.branchName ? ` ${escapeHtml(data.review.branchName)}` : ''}. If you would like to share your experience, a Google review helps other neighbors find us. There is no obligation.</p>
                    <p style="margin:6px 0 0;font-size:13px;"><a href="${escapeHtml(data.review.url)}" style="color:${PALETTE.rose};">Leave a Google review</a></p>
                  </td>
                </tr>`
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
                    <p style="margin:0 0 2px;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:700;color:${PALETTE.ink};">Sparkling Standard Cleaning Co.</p>
                    <p style="margin:0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${PALETTE.champagneText};">Standards That Sparkle.</p>
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
                </tr>${discountRow}${taxRow}${totalRow}${paymentRows}
              </table>

              <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="margin:24px 0 0;border-top:1px solid ${PALETTE.border};">
                <tr>
                  <td style="padding:14px 0 0;">
                    <p style="margin:0 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};">Payment terms</p>
                    <p style="margin:0;font-size:13px;line-height:1.6;color:${PALETTE.inkSoft};">${
                      data.paymentTerms ? escapeHtml(data.paymentTerms) : escapeHtml(placeholder('Payment terms'))
                    }</p>
                    ${paymentMethods}
                    ${paymentLink}
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
                ${review}
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
  if (totals.discountAmount > 0) {
    lines.push(`${data.discountLabel || 'Discount'}: -${formatMoney(totals.discountAmount)}`);
  }
  if (totals.taxAmount !== null) lines.push(`${data.taxLabel ?? 'Tax'}: ${formatMoney(totals.taxAmount)}`);
  if (totals.paymentsReceived > 0) {
    lines.push(`TOTAL: ${formatMoney(totals.totalDue)}`);
    lines.push(`PAYMENTS RECEIVED: -${formatMoney(totals.paymentsReceived)}`);
    lines.push(`BALANCE DUE: ${formatMoney(totals.balanceDue)}`);
  } else {
    lines.push(`TOTAL DUE: ${formatMoney(totals.totalDue)}`);
  }
  lines.push('');
  lines.push('PAYMENT TERMS');
  lines.push(data.paymentTerms || placeholder('Payment terms'));
  if (data.paymentMethods && data.paymentMethods.length > 0) {
    lines.push(`Payment methods: ${data.paymentMethods.join(' · ')}`);
  }
  if (data.paymentUrl && /^https:\/\//i.test(data.paymentUrl)) {
    lines.push(`Pay online: ${data.paymentUrl}`);
  }
  if (data.notes) {
    lines.push('');
    lines.push('NOTES / SCOPE');
    lines.push(data.notes);
  }
  if (data.review?.eligible && data.review.url && /^https:\/\//i.test(data.review.url)) {
    lines.push('');
    lines.push('SHARE YOUR EXPERIENCE');
    lines.push(
      `Thank you for choosing Sparkling Standard${data.review.branchName ? ` ${data.review.branchName}` : ''}. If you would like to share your experience, a Google review helps other neighbors find us. There is no obligation.`,
    );
    lines.push(data.review.url);
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
    data,
  };
}

/** True when the invoice still contains owner-completion placeholders. */
export function hasOwnerPlaceholders(invoice: BuiltInvoice): boolean {
  return invoice.html.includes('— owner to complete]');
}
