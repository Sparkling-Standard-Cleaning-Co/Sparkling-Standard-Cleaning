/**
 * Branded, itemized customer receipt for a verified cleaning payment.
 *
 * The receipt is built from the server-owned checkout record created when the
 * Stripe session was opened. It never trusts a browser-supplied amount and
 * never contains card data, secrets or internal cost/margin values.
 */

export type ReceiptLineKind = 'charge' | 'discount' | 'travel' | 'tax';

export interface ReceiptLine {
  label: string;
  amountCents: number;
  kind: ReceiptLineKind;
}

export interface ReceiptData {
  receiptNumber: string;
  reference: string;
  paidAt: string;
  service: string;
  serviceLocation?: string;
  customerName?: string;
  customerEmail?: string;
  lines: ReceiptLine[];
  subtotalCents: number;
  taxCents: number;
  taxRatePercent?: number | null;
  taxJurisdiction?: string | null;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  paymentStatus: 'paid' | 'partially_paid' | 'refunded' | 'unknown';
  stripeSessionId?: string;
  notes?: string;
}

export interface BuiltReceipt {
  subject: string;
  html: string;
  text: string;
}

const PALETTE = {
  cream: '#f9f3ed',
  card: '#ffffff',
  ink: '#302429',
  inkSoft: '#4a3b40',
  muted: '#8c7a70',
  rose: '#93475b',
  champagne: '#6d5426',
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

function money(cents: number): string {
  return `$${(Math.round(cents) / 100).toFixed(2)}`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
}

function lineAmount(line: ReceiptLine): string {
  const amount = money(Math.abs(line.amountCents));
  return line.kind === 'discount' ? `−${amount}` : amount;
}

export function buildReceipt(data: ReceiptData): BuiltReceipt {
  const rows = data.lines
    .map(
      (line) => `
        <tr>
          <td style="padding:9px 12px;border-bottom:1px solid ${PALETTE.border};font-size:14px;color:${PALETTE.ink};">${escapeHtml(line.label)}</td>
          <td style="padding:9px 12px;border-bottom:1px solid ${PALETTE.border};font-size:14px;color:${line.kind === 'discount' ? PALETTE.rose : PALETTE.inkSoft};text-align:right;white-space:nowrap;">${lineAmount(line)}</td>
        </tr>`,
    )
    .join('');

  const taxLabel =
    data.taxCents > 0 && data.taxRatePercent
      ? `Sales tax (${data.taxRatePercent}%${data.taxJurisdiction ? ` — ${escapeHtml(data.taxJurisdiction)}` : ''})`
      : 'Sales tax';
  const taxRow =
    data.taxCents > 0
      ? `<tr>
          <td style="padding:8px 12px;font-size:14px;color:${PALETTE.inkSoft};text-align:right;">${taxLabel}</td>
          <td style="padding:8px 12px;font-size:14px;color:${PALETTE.ink};text-align:right;white-space:nowrap;">${money(data.taxCents)}</td>
        </tr>`
      : '';

  const balanceRow =
    data.balanceCents > 0
      ? `<tr>
          <td style="padding:8px 12px;font-size:14px;color:${PALETTE.rose};text-align:right;">Outstanding balance</td>
          <td style="padding:8px 12px;font-size:14px;font-weight:700;color:${PALETTE.rose};text-align:right;white-space:nowrap;">${money(data.balanceCents)}</td>
        </tr>`
      : '';

  const locationBlock = data.serviceLocation
    ? `<p style="margin:14px 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};">Service location</p>
       <p style="margin:0;font-size:14px;line-height:1.6;color:${PALETTE.inkSoft};">${escapeHtml(data.serviceLocation)}</p>`
    : '';

  const customer = data.customerName || data.customerEmail
    ? `<p style="margin:14px 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};">Customer</p>
       ${data.customerName ? `<p style="margin:0;font-size:14px;color:${PALETTE.ink};">${escapeHtml(data.customerName)}</p>` : ''}
       ${data.customerEmail ? `<p style="margin:0;font-size:13px;color:${PALETTE.inkSoft};">${escapeHtml(data.customerEmail)}</p>` : ''}`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your Sparkling Standard receipt</title></head>
<body style="margin:0;padding:0;background:${PALETTE.cream};font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="background:${PALETTE.cream};padding:28px 12px;">
    <table role="presentation" width="680" align="center" cellpadding="0" cellspacing="0" style="max-width:680px;background:${PALETTE.card};border:1px solid ${PALETTE.border};border-radius:14px;padding:34px 38px;">
      <tr><td>
        <p style="margin:0 0 2px;font-family:Georgia,'Times New Roman',serif;font-size:23px;font-weight:700;color:${PALETTE.ink};">Sparkling <span style="letter-spacing:.12em;">STANDARD</span></p>
        <p style="margin:0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${PALETTE.champagne};">Standards That Make Your Space Sparkle.</p>
        <p style="margin:22px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:20px;color:${PALETTE.ink};">Payment receipt</p>
        <p style="margin:4px 0 0;font-size:13px;color:${PALETTE.muted};">${escapeHtml(formatDate(data.paidAt))}</p>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;">
          <tr>
            <td style="vertical-align:top;width:55%;">
              <p style="margin:0 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};">Receipt</p>
              <p style="margin:0;font-size:14px;font-weight:700;color:${PALETTE.ink};">${escapeHtml(data.receiptNumber)}</p>
              <p style="margin:8px 0 0;font-size:13px;color:${PALETTE.inkSoft};">${escapeHtml(data.service)}</p>
              ${locationBlock}
              ${customer}
            </td>
            <td style="vertical-align:top;width:45%;">
              <p style="margin:0 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};">Status</p>
              <p style="margin:0;font-size:14px;font-weight:700;color:${data.paymentStatus === 'paid' ? '#2f6b45' : PALETTE.rose};">${escapeHtml(data.paymentStatus.replace('_', ' ').toUpperCase())}</p>
              <p style="margin:8px 0 0;font-size:12px;color:${PALETTE.muted};">Reference</p>
              <p style="margin:0;font-size:13px;color:${PALETTE.inkSoft};">${escapeHtml(data.reference)}</p>
            </td>
          </tr>
        </table>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;border-collapse:collapse;">
          <tr>
            <th style="padding:8px 12px;border-bottom:2px solid ${PALETTE.ink};font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};text-align:left;">Item</th>
            <th style="padding:8px 12px;border-bottom:2px solid ${PALETTE.ink};font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};text-align:right;">Amount</th>
          </tr>
          ${rows}
          <tr>
            <td style="padding:10px 12px 2px;font-size:14px;color:${PALETTE.inkSoft};text-align:right;">Subtotal</td>
            <td style="padding:10px 12px 2px;font-size:14px;color:${PALETTE.ink};text-align:right;white-space:nowrap;">${money(data.subtotalCents)}</td>
          </tr>
          ${taxRow}
          <tr>
            <td style="padding:12px 12px 4px;font-size:15px;font-weight:700;color:${PALETTE.ink};text-align:right;">Total</td>
            <td style="padding:12px 12px 4px;font-size:17px;font-weight:700;color:${PALETTE.ink};text-align:right;white-space:nowrap;">${money(data.totalCents)}</td>
          </tr>
          <tr>
            <td style="padding:6px 12px;font-size:14px;color:${PALETTE.inkSoft};text-align:right;">Paid</td>
            <td style="padding:6px 12px;font-size:14px;color:${PALETTE.ink};text-align:right;white-space:nowrap;">−${money(data.paidCents)}</td>
          </tr>
          ${balanceRow}
        </table>

        <p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:${PALETTE.muted};">${escapeHtml(data.notes ?? 'Complete paid bookings confirm automatically when the address, photos, requested time and resource availability verify. If a requirement is outstanding, the booking remains pending and we follow up.')}</p>
        <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:${PALETTE.inkSoft};">Questions? Reply to this email or call <strong>(850) 426-8479</strong>. Sparkling Standard LLC · sparkling-standard.com</p>
      </td></tr>
    </table>
  </div>
</body>
</html>`;

  const textLines = [
    'SPARKLING STANDARD — PAYMENT RECEIPT',
    `Receipt: ${data.receiptNumber}`,
    `Paid: ${formatDate(data.paidAt)}`,
    `Service: ${data.service}`,
    data.serviceLocation ? `Service location: ${data.serviceLocation}` : '',
    data.customerName ? `Customer: ${data.customerName}` : '',
    data.customerEmail ? `Email: ${data.customerEmail}` : '',
    `Reference: ${data.reference}`,
    `Status: ${data.paymentStatus.replace('_', ' ').toUpperCase()}`,
    '',
    'ITEMS',
    ...data.lines.map((line) => `${line.label}: ${lineAmount(line)}`),
    `Subtotal: ${money(data.subtotalCents)}`,
    ...(data.taxCents > 0 ? [`Sales tax: ${money(data.taxCents)}`] : []),
    `Total: ${money(data.totalCents)}`,
    `Paid: ${money(data.paidCents)}`,
    ...(data.balanceCents > 0 ? [`Outstanding balance: ${money(data.balanceCents)}`] : []),
    '',
    data.notes ?? 'Payment received. Appointment confirmation is shown separately on the payment status page.',
    'Questions? Reply to this email or call (850) 426-8479.',
  ];

  return {
    subject: `Your Sparkling Standard receipt — ${data.reference}`,
    html,
    text: textLines.join('\n'),
  };
}
