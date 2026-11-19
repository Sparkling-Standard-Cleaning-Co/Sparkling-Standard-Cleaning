// Branded Quick Estimate PDF and email. Both are generated from the stored
// server quote, never from browser-supplied totals.

import {
  assemblePdf,
  CONTENT_BOTTOM,
  INK,
  INK_SOFT,
  LEFT,
  MUTED,
  RIGHT,
  ROSE,
  rule,
  text,
  wrap,
} from '../pdf/pdf-core.ts';
import type { QuickEstimateInput, QuickEstimateQuote } from './quick-estimate.ts';

function money(cents: number | null | undefined): string {
  return `$${((Number(cents) || 0) / 100).toFixed(2)}`;
}

function dateLabel(value: string | undefined): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    dateStyle: 'long',
  }).format(date);
}

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function quoteLines(quote: QuickEstimateQuote): Array<[string, string]> {
  const lines: Array<[string, string]> = [];
  if (quote.cleaningSubtotalCents !== null) lines.push(['Cleaning service', money(quote.cleaningSubtotalCents)]);
  if (quote.extrasSubtotalCents && quote.extrasSubtotalCents > 0) lines.push(['Selected extras', money(quote.extrasSubtotalCents)]);
  if (quote.travelAdjustmentCents && quote.travelAdjustmentCents !== 0) {
    lines.push(['Travel adjustment', `${quote.travelAdjustmentCents > 0 ? '' : '-'}${money(Math.abs(quote.travelAdjustmentCents))}`]);
  }
  if (quote.discountAmountCents && quote.discountAmountCents > 0) {
    lines.push([quote.discountLabel || 'Promotion', `-${money(quote.discountAmountCents)}`]);
  }
  lines.push(['Estimated total', money(quote.totalCents)]);
  if (quote.ongoingPerVisitCents !== null) {
    lines.push([`Ongoing ${titleCase(quote.ongoingFrequency || 'visit')} visit`, money(quote.ongoingPerVisitCents)]);
  }
  return lines;
}

export function buildQuickEstimatePdf(
  input: QuickEstimateInput,
  quote: QuickEstimateQuote,
  addressText: string,
): Uint8Array {
  const pages: string[] = [];
  let content = '';
  let y = 0;

  const beginPage = (continued = false): void => {
    if (content) pages.push(content);
    content = text('Sparkling Standard Cleaning Co.', LEFT, 754, 16, true, INK);
    content += text('QUICK ESTIMATE', RIGHT - 120, 752, 16, true, INK);
    content += text('Standards That Sparkle.', LEFT, 736, 8, false, ROSE);
    content += rule(727);
    if (continued) {
      content += text('Quick Estimate - continued', LEFT, 704, 9, false, MUTED);
      y = 688;
    }
  };
  const ensure = (space: number): void => {
    if (y - space < CONTENT_BOTTOM) beginPage(true);
  };

  beginPage(false);
  y = 700;
  content += text('PREPARED FOR', LEFT, y, 8, true, MUTED);
  y -= 14;
  const preparedFor = input.customerName || 'Prospective customer';
  content += text(preparedFor, LEFT, y, 11, true, INK);
  y -= 12;
  if (input.customerEmail) content += text(input.customerEmail, LEFT, y, 9, false, INK_SOFT);
  if (input.customerEmail) y -= 11;
  if (input.customerPhone) content += text(input.customerPhone, LEFT, y, 9, false, INK_SOFT);
  if (input.customerPhone) y -= 11;
  content += text('SERVICE ADDRESS', LEFT, y - 6, 8, true, MUTED);
  y -= 20;
  for (const line of wrap(addressText || 'Address to be confirmed', 300, 9)) {
    content += text(line, LEFT, y, 9, false, INK_SOFT);
    y -= 11;
  }

  const metaX = 380;
  let metaY = 700;
  content += text('Estimate date', metaX, metaY, 8, false, MUTED);
  content += text(dateLabel(undefined), RIGHT - 70, metaY, 9, false, INK);
  metaY -= 14;
  content += text('Service', metaX, metaY, 8, false, MUTED);
  content += text(titleCase(input.engine) + (input.serviceType ? ` - ${titleCase(input.serviceType)}` : ''), RIGHT - 150, metaY, 9, false, INK);
  metaY -= 14;
  content += text('Frequency', metaX, metaY, 8, false, MUTED);
  content += text(titleCase(input.frequency || 'one_time'), RIGHT - 80, metaY, 9, false, INK);
  metaY -= 14;
  content += text('Pricing version', metaX, metaY, 8, false, MUTED);
  content += text(quote.pricingVersion.slice(0, 38), RIGHT - 190, metaY, 8, false, INK_SOFT);

  y -= 10;
  content += text('PROPERTY DETAILS', LEFT, y, 8, true, MUTED);
  y -= 14;
  const details = input.engine === 'commercial' || input.engine === 'church'
    ? [
        `Facility: ${titleCase(String(input.facility?.facilityType ?? input.engine))}`,
        `Cleanable square feet: ${input.facility?.cleanableSqft ?? 'not provided'}`,
        `Restroom fixtures: ${input.facility?.restroomFixtures ?? 0}`,
        `Condition: ${titleCase(String(input.facility?.condition ?? 'average'))}`,
      ]
    : [
        `Property: ${titleCase(String(input.propertyType ?? 'house'))}`,
        `Square feet: ${input.squareFeet ?? 'not provided'}`,
        `Bedrooms / bathrooms: ${input.bedrooms ?? '-'} / ${input.fullBaths ?? '-'} full, ${input.halfBaths ?? '-'} half`,
        `Condition: ${titleCase(String(input.condition ?? 'maintained'))}`,
        `Pets: ${titleCase(String(input.pets ?? 'none'))}`,
      ];
  for (const detail of details) {
    content += text(detail, LEFT, y, 9, false, INK_SOFT);
    y -= 11;
  }

  y -= 10;
  content += rule(y);
  y -= 18;
  content += text('DESCRIPTION', LEFT, y, 8, true, MUTED);
  content += text('AMOUNT', RIGHT - 48, y, 8, true, MUTED);
  y -= 8;
  content += rule(y, INK);
  y -= 16;
  for (const [label, amount] of quoteLines(quote)) {
    ensure(20);
    content += text(label, LEFT, y, label === 'Estimated total' ? 11 : 9, label === 'Estimated total', label === 'Estimated total' ? INK : INK_SOFT);
    content += text(amount, RIGHT - 48, y, label === 'Estimated total' ? 11 : 9, label === 'Estimated total', INK);
    y -= 14;
  }

  ensure(60);
  y -= 10;
  content += text('IMPORTANT', LEFT, y, 8, true, MUTED);
  y -= 14;
  const notes = [
    'This is a nonbinding estimate based on the information provided. Final scope and price are confirmed before work begins.',
    'Travel, taxes and any special condition may change the final amount. No tax is collected on this estimate.',
    'Promotions are subject to their published eligibility and expiration rules. Gift certificates are applied as payment, not as a discount.',
  ];
  for (const note of notes) {
    for (const line of wrap(note, 500, 8)) {
      ensure(12);
      content += text(line, LEFT, y, 8, false, MUTED);
      y -= 10;
    }
    y -= 2;
  }

  if (quote.status !== 'priced') {
    ensure(30);
    content += text('PERSONAL REVIEW REQUIRED', LEFT, y, 9, true, ROSE);
    y -= 12;
    for (const line of wrap(quote.message || 'This scope needs personal confirmation.', 500, 9)) {
      content += text(line, LEFT, y, 9, false, INK_SOFT);
      y -= 11;
    }
  }

  pages.push(content);
  const withFooters = pages.map((page, index) => {
    let footer = rule(58);
    footer += text('Sparkling Standard Cleaning Co. - (850) 426-8479 - owner@sparkling-standard.com - sparkling-standard.com', LEFT, 44, 7, false, MUTED);
    footer += text(`Page ${index + 1} of ${pages.length}`, RIGHT - 60, 44, 7, false, MUTED);
    return page + footer;
  });
  return assemblePdf(withFooters);
}

export function buildQuickEstimateText(
  input: QuickEstimateInput,
  quote: QuickEstimateQuote,
  addressText: string,
): { subject: string; text: string; html: string } {
  const name = input.customerName || 'there';
  const subject = `Your Sparkling Standard estimate${quote.totalCents !== null ? ` - ${money(quote.totalCents)}` : ''}`;
  const lines = [
    `Hello ${name},`,
    '',
    'Thank you for contacting Sparkling Standard Cleaning Co. Here is the estimate we discussed.',
    '',
    `Service address: ${addressText || 'to be confirmed'}`,
    `Service: ${titleCase(input.engine)}${input.serviceType ? ` - ${titleCase(input.serviceType)}` : ''}`,
    `Frequency: ${titleCase(input.frequency || 'one_time')}`,
    '',
    ...quoteLines(quote).map(([label, amount]) => `${label}: ${amount}`),
    '',
    quote.status === 'priced'
      ? 'This is a nonbinding estimate. We confirm the final scope, travel, tax and appointment before work begins.'
      : `This scope needs personal confirmation: ${quote.message || 'we will follow up with you.'}`,
    'Promotions are subject to their published eligibility rules. Gift certificates are applied as payment, not as a discount.',
    '',
    'Standards That Sparkle.',
    'Sparkling Standard Cleaning Co.',
    '(850) 426-8479',
    'https://sparkling-standard.com',
  ];
  const rows = quoteLines(quote)
    .map(
      ([label, amount]) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid #eadfd7">${escapeHtml(label)}</td><td style="padding:8px 0;border-bottom:1px solid #eadfd7;text-align:right">${escapeHtml(amount)}</td></tr>`,
    )
    .join('');
  const html = `<!doctype html><html><body style="margin:0;background:#f9f3ed;font-family:Arial,sans-serif;color:#302429">
  <div style="max-width:640px;margin:0 auto;padding:28px 18px">
    <div style="background:#fff;border:1px solid #e4d5c7;border-radius:14px;padding:32px">
      <p style="margin:0;font-family:Georgia,serif;font-size:22px;font-weight:700">Sparkling Standard Cleaning Co.</p>
      <p style="margin:4px 0 24px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6d5426">Standards That Sparkle.</p>
      <p style="margin:0 0 8px">Hello ${escapeHtml(name)},</p>
      <p style="margin:0 0 18px;line-height:1.6">Thank you for contacting Sparkling Standard Cleaning Co. Here is the estimate we discussed.</p>
      <p style="margin:0 0 4px;font-size:12px;color:#8c7a70">Service address</p>
      <p style="margin:0 0 14px">${escapeHtml(addressText || 'To be confirmed')}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>
      <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#4a3b40">${escapeHtml(
        quote.status === 'priced'
          ? 'This is a nonbinding estimate. We confirm the final scope, travel, tax and appointment before work begins.'
          : `This scope needs personal confirmation: ${quote.message || 'we will follow up with you.'}`,
      )}</p>
      <p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:#8c7a70">Promotions are subject to their published eligibility rules. Gift certificates are applied as payment, not as a discount.</p>
      <p style="margin:22px 0 0;font-size:12px;color:#4a3b40">Questions? Reply to this email or call <strong>(850) 426-8479</strong>.</p>
    </div>
  </div>
</body></html>`;
  return { subject, text: lines.join('\n'), html };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export async function sendQuickEstimateEmail(
  env: {
    RESEND_API_KEY?: string;
    RESEND_FROM_EMAIL?: string;
    RESEND_REPLY_TO?: string;
  },
  to: string,
  message: { subject: string; text: string; html: string },
  idempotencyKey: string,
): Promise<{ status: 'sent' | 'failed' | 'skipped' }> {
  if (!env.RESEND_API_KEY?.trim() || !to) return { status: 'skipped' };
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY.trim()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey.slice(0, 200),
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL?.trim() || 'Sparkling Standard <notifications@sparkling-standard.com>',
        ...(env.RESEND_REPLY_TO?.trim() ? { reply_to: env.RESEND_REPLY_TO.trim() } : {}),
        to: [to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return { status: response.ok ? 'sent' : 'failed' };
  } catch {
    return { status: 'failed' };
  }
}
