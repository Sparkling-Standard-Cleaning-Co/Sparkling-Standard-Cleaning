// Customer confirmation email — branded, honest, and email-client safe.
//
// The message is delivered by the lead relay through Resend
// (`src/lib/forms/customer-email.ts`) after the owner notification is
// accepted; a manual generator (`scripts/customer-confirmation.mjs`) and the
// on-page thank-you summary share this same template. It is pure and
// unit-tested.
//
// Integrity rules (enforced by tests):
//  - "We received your request" — never "confirmed booking";
//  - "provisional estimate" — never a final price or a paid receipt;
//  - no payment has been taken by a website form, and the copy says so;
//  - nothing internal (labor hours, rates, verification codes) is exposed.
//
// The HTML is table-based with inline styles (the only reliable approach in
// email clients) and contains no external images or tracking.

import { buildRequestSummary, type RequestSummary } from './request-summary.ts';

export interface ConfirmationBusiness {
  /** Public business name, e.g. "Sparkling Standard Cleaning Co." */
  name: string;
  /** Founder first name for the signature, when approved for public use. */
  founder?: string;
  /** Public contact phone in display form. */
  phone?: string;
  /** Public contact email. */
  email?: string;
  /** Public site, display form without protocol, e.g. "sparkling-standard.com". */
  website: string;
}

export interface CustomerConfirmation {
  subject: string;
  /** Plain-text intro (also usable as a provider intro field). */
  introText: string;
  /** Full branded HTML email. */
  html: string;
  /** Plain-text fallback with the same content. */
  text: string;
}

const PALETTE = {
  cream: '#f9f3ed',
  card: '#ffffff',
  ink: '#302429',
  inkSoft: '#4a3b40',
  muted: '#8c7a70',
  rose: '#b15a6f',
  champagne: '#8a6d38',
  champagneText: '#6d5426',
  champagneBg: '#f7efdf',
  roseBg: '#f9e6e9',
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

function contactLines(business: ConfirmationBusiness): string[] {
  return [
    business.phone ? `Phone or text: ${business.phone}` : '',
    business.email ? `Email: ${business.email}` : '',
    `Website: ${business.website}`,
  ].filter(Boolean);
}

function introFor(kind: RequestSummary['kind']): string {
  switch (kind) {
    case 'reservation':
    case 'estimate':
      return 'Thank you — we received your request. The details you submitted are below, and we will review them personally before anything is scheduled.';
    case 'commercial':
      return 'Thank you — we received your walkthrough request. We will review the facility details and follow up to arrange a time that works for your team.';
    case 'str':
      return 'Thank you — we received your turnover request. We will review the property details and follow up to confirm timing, scope and pricing.';
    case 'gift':
      return 'Thank you — we received your gift certificate request. We will confirm the amount and details with you, then send a secure payment link. No payment has been taken by this request.';
    default:
      return 'Thank you — your message reached us. Every message is answered personally, and we will get back to you as soon as we can.';
  }
}

function nextStepsFor(kind: RequestSummary['kind']): string[] {
  switch (kind) {
    case 'commercial':
      return [
        'We review the facility details you shared.',
        'We follow up to arrange a walkthrough at a time that suits your team.',
        'After the walkthrough, you receive a written scope and quote to approve.',
      ];
    case 'str':
      return [
        'We review the property, timing and turnover details.',
        'We confirm scope, schedule and pricing with you personally.',
        'Only after you confirm is your first turnover placed on the calendar.',
      ];
    case 'gift':
      return [
        'We confirm the amount, recipient details and delivery with you.',
        'We send a secure payment link — payment only happens through that link.',
        'We prepare the printable certificate and deliver it as agreed.',
      ];
    case 'contact':
      return [
        'Your message goes straight to the owner.',
        'We reply personally as soon as we can.',
      ];
    default:
      return [
        'We review your scope, condition details and preferred date — usually the same day.',
        'We reply with final scope, price and the exact date and arrival details.',
        'Only after you confirm is your cleaning placed on the calendar.',
      ];
  }
}

function buildHtml(
  summary: RequestSummary,
  intro: string,
  steps: string[],
  business: ConfirmationBusiness,
): string {
  const rows = summary.rows
    .map(
      (row) => `
                <tr>
                  <td style="padding:8px 0;border-bottom:1px solid ${PALETTE.border};font-size:13px;color:${PALETTE.muted};width:38%;vertical-align:top;">${escapeHtml(row.label)}</td>
                  <td style="padding:8px 0;border-bottom:1px solid ${PALETTE.border};font-size:14px;color:${PALETTE.ink};font-weight:600;vertical-align:top;">${escapeHtml(row.value)}</td>
                </tr>`,
    )
    .join('');

  const estimateBlock = summary.estimate
    ? `
              <table role="presentation" width="536" cellpadding="0" cellspacing="0" style="margin:18px 0 0;background:${PALETTE.champagneBg};border:1px solid ${PALETTE.border};border-radius:8px;">
                <tr>
                  <td style="padding:14px 16px;">
                    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.champagneText};">${escapeHtml(summary.estimate.label)}</p>
                    <p style="margin:0;font-size:20px;font-weight:700;color:${PALETTE.ink};">${escapeHtml(summary.estimate.value)}</p>
                    <p style="margin:6px 0 0;font-size:12px;color:${PALETTE.muted};">${escapeHtml(summary.estimate.note)}</p>
                  </td>
                </tr>
              </table>`
    : '';

  const referenceBlock = summary.reference
    ? `<p style="margin:16px 0 0;font-size:12px;color:${PALETTE.muted};">Reference: <span style="color:${PALETTE.ink};font-weight:600;">${escapeHtml(summary.reference)}</span></p>`
    : '';

  const stepsBlock = steps
    .map(
      (step, index) => `
                <tr>
                  <td style="padding:6px 10px 6px 0;font-size:14px;font-weight:700;color:${PALETTE.rose};vertical-align:top;">${index + 1}.</td>
                  <td style="padding:6px 0;font-size:14px;color:${PALETTE.inkSoft};vertical-align:top;">${escapeHtml(step)}</td>
                </tr>`,
    )
    .join('');

  const contactBlock = contactLines(business)
    .map(
      (line) => `<p style="margin:2px 0;font-size:13px;color:${PALETTE.inkSoft};">${escapeHtml(line)}</p>`,
    )
    .join('');

  const signature = business.founder
    ? `<p style="margin:16px 0 0;font-size:14px;color:${PALETTE.inkSoft};">— ${escapeHtml(business.founder)}, ${escapeHtml(business.name)}</p>`
    : `<p style="margin:16px 0 0;font-size:14px;color:${PALETTE.inkSoft};">— ${escapeHtml(business.name)}</p>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(summary.title)} received — ${escapeHtml(business.name)}</title>
</head>
<body style="margin:0;padding:0;background:${PALETTE.cream};">
  <div style="background:${PALETTE.cream};padding:24px 12px;">
    <table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" style="max-width:600px;">
      <tr>
        <td style="background:${PALETTE.card};border:1px solid ${PALETTE.border};border-radius:12px;padding:32px 32px 28px;">
          <p style="margin:0 0 2px;font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:${PALETTE.ink};">Sparkling <span style="letter-spacing:.12em;">STANDARD</span></p>
          <p style="margin:0 0 18px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${PALETTE.champagneText};">The Details Are Our Standard.</p>
          <h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:22px;color:${PALETTE.ink};">We received your request</h1>
          <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:${PALETTE.inkSoft};">${escapeHtml(intro)}</p>

          <p style="margin:0 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};">Here&rsquo;s a summary of what you submitted</p>
          <table role="presentation" width="536" cellpadding="0" cellspacing="0">${rows}
          </table>
          ${estimateBlock}
          ${referenceBlock}

          <table role="presentation" width="536" cellpadding="0" cellspacing="0" style="margin:20px 0 0;background:${PALETTE.roseBg};border-radius:8px;">
            <tr>
              <td style="padding:14px 16px;">
                <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:${PALETTE.rose};">This is not a confirmed appointment.</p>
                <p style="margin:0;font-size:13px;line-height:1.5;color:${PALETTE.inkSoft};">Final scope, pricing and availability may require confirmation before anything is scheduled. Please don&rsquo;t send payment until we&rsquo;ve confirmed an amount and a payment method with you.</p>
              </td>
            </tr>
          </table>

          <p style="margin:22px 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.muted};">What happens next</p>
          <table role="presentation" cellpadding="0" cellspacing="0">${stepsBlock}
          </table>

          <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:${PALETTE.inkSoft};">If anything above is wrong, or you want to add photos or access notes, just reply to this email — it reaches us directly.</p>
          ${signature}

          <table role="presentation" width="536" cellpadding="0" cellspacing="0" style="margin:22px 0 0;border-top:1px solid ${PALETTE.border};">
            <tr>
              <td style="padding:14px 0 0;">${contactBlock}</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 8px 0;font-size:11px;line-height:1.5;color:${PALETTE.muted};">
          You received this because you submitted a request at ${escapeHtml(business.website)}. This message confirms receipt of your request only — it is not a booking, an invoice or a payment receipt.
        </td>
      </tr>
    </table>
  </div>
</body>
</html>
`;
}

function buildText(
  summary: RequestSummary,
  intro: string,
  steps: string[],
  business: ConfirmationBusiness,
): string {
  const lines: string[] = [];
  lines.push(business.name);
  lines.push('The Details Are Our Standard.');
  lines.push('');
  lines.push('WE RECEIVED YOUR REQUEST');
  lines.push('');
  lines.push(intro);
  lines.push('');
  if (summary.rows.length > 0) {
    lines.push("HERE'S A SUMMARY OF WHAT YOU SUBMITTED");
    for (const row of summary.rows) lines.push(`- ${row.label}: ${row.value}`);
    lines.push('');
  }
  if (summary.estimate) {
    lines.push(`${summary.estimate.label.toUpperCase()}: ${summary.estimate.value}`);
    lines.push(summary.estimate.note);
    lines.push('');
  }
  if (summary.reference) {
    lines.push(`Reference: ${summary.reference}`);
    lines.push('');
  }
  lines.push('THIS IS NOT A CONFIRMED APPOINTMENT.');
  lines.push(
    "Final scope, pricing and availability may require confirmation before anything is scheduled. Please don't send payment until we've confirmed an amount and a payment method with you.",
  );
  lines.push('');
  lines.push('WHAT HAPPENS NEXT');
  steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  lines.push('');
  lines.push('If anything above is wrong, or you want to add photos or access notes, just reply to this email — it reaches us directly.');
  lines.push('');
  if (business.founder) lines.push(`— ${business.founder}, ${business.name}`);
  else lines.push(`— ${business.name}`);
  lines.push('');
  for (const line of contactLines(business)) lines.push(line);
  lines.push('');
  lines.push(
    `You received this because you submitted a request at ${business.website}. This message confirms receipt of your request only — it is not a booking, an invoice or a payment receipt.`,
  );
  return lines.join('\n');
}

/**
 * Builds the branded customer confirmation for a sanitized submission field
 * map. `business` carries only owner-approved public facts.
 */
export function buildCustomerConfirmation(
  fields: Record<string, string>,
  business: ConfirmationBusiness,
): CustomerConfirmation {
  const summary = buildRequestSummary(fields);
  const intro = introFor(summary.kind);
  const steps = nextStepsFor(summary.kind);
  return {
    // Fixed subject for every request type — never "booking confirmed",
    // "your receipt" or "your invoice" (see docs/operations/FINANCIAL-WORKFLOW.md).
    subject: 'We received your Sparkling Standard request',
    introText: intro,
    html: buildHtml(summary, intro, steps, business),
    text: buildText(summary, intro, steps, business),
  };
}
