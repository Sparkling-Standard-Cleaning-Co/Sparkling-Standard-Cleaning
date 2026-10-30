// Customer booking correspondence for owner/manager actions.
//
// Sending never decides whether a booking is confirmed. Calendar confirmation
// and the D1 appointment must succeed first; this module only reports whether
// the customer was told. It never logs the recipient address or the API key.

import {
  DEFAULT_CUSTOMER_EMAIL_FROM,
  DEFAULT_CUSTOMER_EMAIL_REPLY_TO,
  RESEND_ENDPOINT,
  type CustomerEmailEnv,
} from './customer-email.ts';

export type BookingEmailKind = 'confirmation' | 'decline' | 'proposal' | 'reschedule' | 'cancellation';

export interface BookingEmailData {
  kind: BookingEmailKind;
  reference: string;
  customerName?: string;
  dateLabel: string;
  timeLabel: string;
  address: string;
  service?: string;
  notes?: string;
  reason?: string;
}

export interface BookingEmailEnv extends CustomerEmailEnv {
  PUBLIC_SITE_URL?: string;
}

export interface BookingEmail {
  subject: string;
  html: string;
  text: string;
}

export type BookingEmailStatus = 'sent' | 'skipped_no_email' | 'skipped_invalid_email' | 'skipped_not_configured' | 'failed';

export interface BookingEmailOutcome {
  status: BookingEmailStatus;
  providerStatus?: number;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function siteUrl(env: BookingEmailEnv): string {
  return (env.PUBLIC_SITE_URL?.trim() || 'https://sparkling-standard.com').replace(/\/+$/, '');
}

function shell(title: string, body: string, footer: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f8f1ec;color:#2c2421;font-family:Georgia,serif">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px">
    <p style="font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:#9a5b61;margin:0 0 12px">Sparkling Standard</p>
    <h1 style="font-size:26px;line-height:1.2;margin:0 0 18px">${title}</h1>
    ${body}
    <p style="font-size:12px;color:#756963;margin-top:28px">${footer}</p>
  </div></body></html>`;
}

export function buildBookingEmail(env: BookingEmailEnv, data: BookingEmailData): BookingEmail {
  const greeting = data.customerName ? `Hi ${data.customerName},` : 'Hello,';
  const details = `<table style="width:100%;font-size:15px;line-height:1.6;border-collapse:collapse">
    <tr><td style="padding:4px 0;color:#756963">Reference</td><td style="padding:4px 0">${escapeHtml(data.reference)}</td></tr>
    <tr><td style="padding:4px 0;color:#756963">Date</td><td style="padding:4px 0">${escapeHtml(data.dateLabel)}</td></tr>
    <tr><td style="padding:4px 0;color:#756963">Time</td><td style="padding:4px 0">${escapeHtml(data.timeLabel)}</td></tr>
    <tr><td style="padding:4px 0;color:#756963">Property</td><td style="padding:4px 0">${escapeHtml(data.address)}</td></tr>
    ${data.service ? `<tr><td style="padding:4px 0;color:#756963">Service</td><td style="padding:4px 0">${escapeHtml(data.service)}</td></tr>` : ''}
  </table>`;
  const note = data.notes ? `<p style="font-size:15px;line-height:1.6">${escapeHtml(data.notes)}</p>` : '';
  const reason = data.reason ? `<p style="font-size:15px;line-height:1.6">${escapeHtml(data.reason)}</p>` : '';
  const url = siteUrl(env);

  switch (data.kind) {
    case 'confirmation':
      return {
        subject: `Your cleaning is confirmed — ${data.reference}`,
        html: shell(
          'Your cleaning is confirmed',
          `<p style="font-size:16px;line-height:1.6">${escapeHtml(greeting)}</p>
           <p style="font-size:16px;line-height:1.6">Your appointment is confirmed. We look forward to caring for your home.</p>
           ${details}${note}
           <p style="font-size:14px;line-height:1.6">If anything changes, reply to this email or call us. Please review the <a href="${url}/terms/" style="color:#9a5b61">Terms of Service</a>.</p>`,
          'Sparkling Standard · Standards That Make Your Space Sparkle.',
        ),
        text: `Your cleaning is confirmed\n\n${greeting}\n\nReference: ${data.reference}\nDate: ${data.dateLabel}\nTime: ${data.timeLabel}\nProperty: ${data.address}${data.service ? `\nService: ${data.service}` : ''}\n${data.notes ? `\n${data.notes}\n` : ''}\nIf anything changes, reply or call us.\n${url}/terms/`,
      };
    case 'decline':
      return {
        subject: `About your cleaning request — ${data.reference}`,
        html: shell(
          'We could not confirm this request',
          `<p style="font-size:16px;line-height:1.6">${escapeHtml(greeting)}</p>
           <p style="font-size:16px;line-height:1.6">We are sorry, but we cannot confirm this particular request as submitted.</p>
           ${details}${reason}
           <p style="font-size:15px;line-height:1.6">You are welcome to send another request for a different time, or reply and we will help find an option.</p>`,
          'Sparkling Standard · If you have questions, reply to this email.',
        ),
        text: `We could not confirm this request\n\n${greeting}\n\nReference: ${data.reference}\nDate: ${data.dateLabel}\nTime: ${data.timeLabel}\nProperty: ${data.address}\n${data.reason ? `\n${data.reason}\n` : ''}\nYou are welcome to send another request or reply for help.`,
      };
    case 'proposal':
      return {
        subject: `A new time for your cleaning request — ${data.reference}`,
        html: shell(
          'We would like to propose a new time',
          `<p style="font-size:16px;line-height:1.6">${escapeHtml(greeting)}</p>
           <p style="font-size:16px;line-height:1.6">The time you requested is not available. We can offer the time below. This is a proposal, not a confirmed appointment.</p>
           ${details}${note}
           <p style="font-size:15px;line-height:1.6">Reply to this email to accept the proposed time. We will confirm it in writing once you agree.</p>`,
          'Sparkling Standard · This proposed time is not confirmed until you reply.',
        ),
        text: `We would like to propose a new time\n\n${greeting}\n\nReference: ${data.reference}\nProposed date: ${data.dateLabel}\nProposed time: ${data.timeLabel}\nProperty: ${data.address}\n${note ? `\n${data.notes}\n` : ''}\nThis is a proposal, not a confirmed appointment. Reply to accept.`,
      };
    case 'reschedule':
      return {
        subject: `Your cleaning time has changed — ${data.reference}`,
        html: shell(
          'Your cleaning time has changed',
          `<p style="font-size:16px;line-height:1.6">${escapeHtml(greeting)}</p>
           <p style="font-size:16px;line-height:1.6">Your confirmed appointment has been moved to the time below. The calendar has been updated.</p>
           ${details}${note}
           <p style="font-size:14px;line-height:1.6">If this does not work for you, reply to this email and we will help.</p>`,
          'Sparkling Standard · Thank you for your flexibility.',
        ),
        text: `Your cleaning time has changed\n\n${greeting}\n\nReference: ${data.reference}\nNew date: ${data.dateLabel}\nNew time: ${data.timeLabel}\nProperty: ${data.address}\n${data.notes ? `\n${data.notes}\n` : ''}\nIf this does not work, reply to this email.`,
      };
    case 'cancellation':
      return {
        subject: `Your cleaning appointment was cancelled — ${data.reference}`,
        html: shell(
          'Your appointment was cancelled',
          `<p style="font-size:16px;line-height:1.6">${escapeHtml(greeting)}</p>
           <p style="font-size:16px;line-height:1.6">Your appointment below has been cancelled and the calendar has been released.</p>
           ${details}${reason}
           <p style="font-size:15px;line-height:1.6">If this was not expected, reply to this email or call us so we can help.</p>`,
          'Sparkling Standard · We are happy to help you rebook.',
        ),
        text: `Your appointment was cancelled\n\n${greeting}\n\nReference: ${data.reference}\nDate: ${data.dateLabel}\nTime: ${data.timeLabel}\nProperty: ${data.address}\n${data.reason ? `\n${data.reason}\n` : ''}\nIf this was not expected, reply or call us.`,
      };
  }
}

/** Never throws. Returns a status safe to store and display. */
export async function sendBookingEmail(
  env: BookingEmailEnv,
  to: string,
  data: BookingEmailData,
): Promise<BookingEmailOutcome> {
  const recipient = (to ?? '').trim();
  if (!recipient) return { status: 'skipped_no_email' };
  if (!EMAIL_PATTERN.test(recipient)) return { status: 'skipped_invalid_email' };
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) return { status: 'skipped_not_configured' };
  const email = buildBookingEmail(env, data);
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL?.trim() || DEFAULT_CUSTOMER_EMAIL_FROM,
        reply_to: env.RESEND_REPLY_TO?.trim() || DEFAULT_CUSTOMER_EMAIL_REPLY_TO,
        to: [recipient],
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? { status: 'sent', providerStatus: response.status } : { status: 'failed', providerStatus: response.status };
  } catch {
    return { status: 'failed' };
  }
}
