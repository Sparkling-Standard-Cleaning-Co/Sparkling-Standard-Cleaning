import { EMAIL_ROUTING } from '../../config/email-routing.ts';
import { CUSTOMER_EMAIL_BUSINESS } from '../forms/customer-email.ts';

export const REVIEW_RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface ReviewEmailEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  RESEND_REPLY_TO?: string;
}

export type ReviewEmailStatus = 'sent' | 'skipped_not_configured' | 'failed';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildReviewRequestEmail(input: {
  customerName: string;
  branchName: string;
  reviewUrl: string;
}): { subject: string; html: string; text: string } {
  const name = input.customerName.trim() || 'there';
  const url = /^https:\/\//i.test(input.reviewUrl) ? input.reviewUrl : '';
  const subject = 'How did your cleaning go?';
  const html = `<!doctype html>
<html lang="en"><body style="margin:0;padding:0;background:#f9f3ed;font-family:'Helvetica Neue',Arial,sans-serif;color:#302429;">
  <div style="padding:28px 12px;">
    <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e4d5c7;border-radius:10px;padding:30px;">
      <img src="https://sparkling-standard.com/brand/icon-192.png" width="64" height="64" alt="Sparkling Standard" style="display:block;margin:0 0 12px;border:0;" />
      <p style="margin:0 0 4px;font-family:Georgia,'Times New Roman',serif;font-size:21px;font-weight:700;">Sparkling Standard Cleaning Co.</p>
      <p style="margin:0 0 24px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6d5426;">Standards That Sparkle.</p>
      <p style="margin:0 0 14px;font-size:15px;">Hello ${escapeHtml(name)},</p>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.65;">Thank you for choosing Sparkling Standard ${escapeHtml(input.branchName)}. If you would like to share your experience, a Google review helps other neighbors find us.</p>
      ${url ? `<p style="margin:0 0 18px;"><a href="${escapeHtml(url)}" style="display:inline-block;background:#b15a6f;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600;">Leave a Google review</a></p>` : ''}
      <p style="margin:0 0 18px;font-size:13px;line-height:1.65;color:#6f5f57;">There is no obligation, and your honest feedback is welcome either way. If something was not right, please reply to this email so we can make it right.</p>
      <p style="margin:0;font-size:14px;line-height:1.65;color:#4a3b40;">Thank you again for your business.</p>
      <p style="margin:22px 0 0;padding-top:14px;border-top:1px solid #e4d5c7;font-size:12px;line-height:1.6;color:#8c7a70;">${escapeHtml(CUSTOMER_EMAIL_BUSINESS.phone ?? '')} · ${escapeHtml(EMAIL_ROUTING.customerService)} · ${escapeHtml(CUSTOMER_EMAIL_BUSINESS.website)}</p>
    </div>
  </div>
</body></html>`;
  const text = [
    `Hello ${name},`,
    '',
    `Thank you for choosing Sparkling Standard ${input.branchName}. If you would like to share your experience, a Google review helps other neighbors find us.`,
    ...(url ? ['', `Leave a Google review: ${url}`] : []),
    '',
    'There is no obligation, and your honest feedback is welcome either way. If something was not right, please reply to this email so we can make it right.',
    '',
    'Thank you again for your business.',
    CUSTOMER_EMAIL_BUSINESS.name,
  ].join('\n');
  return { subject, html, text };
}

export async function sendReviewRequestEmail(input: {
  to: string;
  customerName: string;
  branchName: string;
  reviewUrl: string;
  env: ReviewEmailEnv;
  idempotencyKey: string;
}): Promise<ReviewEmailStatus> {
  const key = input.env.RESEND_API_KEY?.trim();
  if (!key) return 'skipped_not_configured';
  const email = buildReviewRequestEmail(input);
  try {
    const response = await fetch(REVIEW_RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': input.idempotencyKey.slice(0, 200),
      },
      body: JSON.stringify({
        from: input.env.RESEND_FROM_EMAIL?.trim() || EMAIL_ROUTING.notificationsSender,
        to: [input.to],
        reply_to: input.env.RESEND_REPLY_TO?.trim() || EMAIL_ROUTING.customerService,
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    return response.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}
