import { formatInvoiceDate, formatMoney, type InvoiceData, type InvoiceTotals } from './invoice.ts';

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';
export const DEFAULT_INVOICE_EMAIL_FROM =
  'Sparkling Standard <notifications@sparkling-standard.com>';
export const DEFAULT_INVOICE_EMAIL_REPLY_TO = 'owner@sparkling-standard.com';

export interface InvoiceEmailEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  RESEND_REPLY_TO?: string;
}

export type InvoiceEmailStatus = 'sent' | 'skipped_not_configured' | 'failed';

export interface InvoiceEmailOutcome {
  status: InvoiceEmailStatus;
  providerStatus?: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildInvoiceEmail(
  data: InvoiceData,
  totals: InvoiceTotals,
): { subject: string; html: string; text: string } {
  const due = data.dueDate ? formatInvoiceDate(data.dueDate) : 'on receipt';
  const balance = formatMoney(totals.balanceDue);
  const payLink =
    data.paymentUrl && /^https:\/\//i.test(data.paymentUrl)
      ? `<p style="margin:0 0 18px;"><a href="${escapeHtml(data.paymentUrl)}" style="display:inline-block;background:#b15a6f;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600;">Pay ${escapeHtml(balance)} online</a></p>
         <p style="margin:0 0 18px;font-size:13px;color:#6f5f57;">Or copy this secure link: <a href="${escapeHtml(data.paymentUrl)}" style="color:#93475b;">${escapeHtml(data.paymentUrl)}</a></p>`
      : '';
  const html = `<!doctype html>
<html lang="en"><body style="margin:0;padding:0;background:#f9f3ed;font-family:'Helvetica Neue',Arial,sans-serif;color:#302429;">
  <div style="padding:28px 12px;">
    <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e4d5c7;border-radius:10px;padding:30px;">
      <p style="margin:0 0 4px;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:700;">Sparkling <span style="letter-spacing:.12em;">STANDARD</span></p>
      <p style="margin:0 0 24px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6d5426;">Standards That Make Your Space Sparkle.</p>
      <p style="margin:0 0 14px;font-size:15px;">Hello ${escapeHtml(data.billedTo.contact || data.billedTo.company)},</p>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.65;">Your invoice <strong>${escapeHtml(data.invoiceNumber)}</strong> is attached as a PDF. The balance due is <strong>${escapeHtml(balance)}</strong>, due ${escapeHtml(due)}.</p>
      ${payLink}
      <p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:#4a3b40;">${escapeHtml(data.paymentTerms || 'Please reply to this email with any questions.')}</p>
      <p style="margin:0;font-size:14px;line-height:1.65;color:#4a3b40;">Thank you for your business.<br>${escapeHtml(data.contact.name)}</p>
      <p style="margin:22px 0 0;padding-top:14px;border-top:1px solid #e4d5c7;font-size:12px;line-height:1.6;color:#8c7a70;">${escapeHtml(data.contact.phone)} · ${escapeHtml(data.contact.email)} · ${escapeHtml(data.contact.website)}</p>
    </div>
  </div>
</body></html>`;
  const text = [
    `Hello ${data.billedTo.contact || data.billedTo.company},`,
    '',
    `Your invoice ${data.invoiceNumber} is attached as a PDF.`,
    `Balance due: ${balance}`,
    `Due: ${due}`,
    ...(data.paymentUrl && /^https:\/\//i.test(data.paymentUrl) ? ['', `Pay online: ${data.paymentUrl}`] : []),
    '',
    data.paymentTerms || 'Please reply to this email with any questions.',
    '',
    'Thank you for your business.',
    data.contact.name,
    `${data.contact.phone} · ${data.contact.email} · ${data.contact.website}`,
  ].join('\n');
  return {
    subject: `Invoice ${data.invoiceNumber} — ${balance} due`,
    html,
    text,
  };
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export async function sendInvoiceEmail(input: {
  to: string;
  data: InvoiceData;
  totals: InvoiceTotals;
  pdf: Uint8Array;
  env: InvoiceEmailEnv;
  idempotencyKey: string;
}): Promise<InvoiceEmailOutcome> {
  const key = input.env.RESEND_API_KEY?.trim();
  if (!key) return { status: 'skipped_not_configured' };
  const email = buildInvoiceEmail(input.data, input.totals);
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': input.idempotencyKey.slice(0, 200),
      },
      body: JSON.stringify({
        from: input.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_INVOICE_EMAIL_FROM,
        to: [input.to],
        reply_to: input.env.RESEND_REPLY_TO?.trim() || DEFAULT_INVOICE_EMAIL_REPLY_TO,
        subject: email.subject,
        html: email.html,
        text: email.text,
        attachments: [
          {
            filename: `${input.data.invoiceNumber.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`,
            content: base64(input.pdf),
          },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return { status: 'sent' };
    return { status: 'failed', providerStatus: response.status };
  } catch {
    return { status: 'failed' };
  }
}
