// Owner notification email with customer photos as real MIME attachments.
//
// Why Resend: the existing Web3Forms owner notification is on its free plan,
// and Web3Forms file attachments are a paid Pro feature (single file limited to
// 5 MB). Resend is already configured for this domain, supports real
// attachments on its free tier (100/day, 3,000/month in 2026), and permits up
// to 40 MB per email after Base64. We keep Web3Forms as the fallback lead
// channel when Resend is unavailable or rejects every attachment email.
//
// Limits are deliberately below both the provider's 40 MB ceiling and a common
// 25 MB inbox ceiling: a part gets at most 21.5 MB of Base64 attachment data,
// so two 8 MB photos (≈21.33 MB encoded) fit in one part. Every part has the
// same request ID, a numbered subject, the full lead summary and every private
// link, so a missing part is never a dead end.

import {
  DEFAULT_CUSTOMER_EMAIL_FROM,
  RESEND_ENDPOINT,
} from './customer-email.ts';

export const DEFAULT_OWNER_NOTIFICATION_EMAIL = 'owner@sparkling-standard.com';
/** Conservative per-email attachment budget after Base64 encoding. */
export const OWNER_ATTACHMENT_BASE64_BUDGET = 21.5 * 1024 * 1024;

export interface OwnerEmailAttachment {
  filename: string;
  contentType: string;
  contentBase64: string;
  rawBytes: number;
}

export interface OwnerEmailMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  attachments: OwnerEmailAttachment[];
  idempotencyKey: string;
}

export interface OwnerEmailEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  OWNER_NOTIFICATION_EMAIL?: string;
}

export type OwnerEmailPartStatus = 'accepted' | 'failed';

export interface OwnerEmailPartOutcome {
  index: number;
  status: OwnerEmailPartStatus;
  providerStatus?: number;
  providerId?: string;
  attempts: number;
}

export type OwnerEmailStatus = 'accepted' | 'partial' | 'failed' | 'not_configured' | 'no_attachments';

export interface OwnerEmailOutcome {
  status: OwnerEmailStatus;
  parts: OwnerEmailPartOutcome[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function safeRequestId(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned || 'request';
}

/** Base64 without Node Buffer (Cloudflare Workers only guarantee btoa). */
export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function ownerAttachmentFilename(
  requestId: string,
  index: number,
  category: string,
  key: string,
): string {
  const suffix = key.split('.').pop()?.toLowerCase() || 'jpg';
  const safeCategory = category.replace(/[^a-z0-9_]+/gi, '-').slice(0, 32) || 'photo';
  const safeId = safeRequestId(requestId);
  return `${safeId}_${String(index + 1).padStart(2, '0')}_${safeCategory}.${suffix}`;
}

/** Splits attachments by the encoded (Base64) size budget, preserving order. */
export function splitOwnerAttachments(
  attachments: OwnerEmailAttachment[],
  budget = OWNER_ATTACHMENT_BASE64_BUDGET,
): OwnerEmailAttachment[][] {
  const parts: OwnerEmailAttachment[][] = [];
  let current: OwnerEmailAttachment[] = [];
  let currentBytes = 0;
  for (const attachment of attachments) {
    const encoded = attachment.contentBase64.length;
    if (current.length > 0 && currentBytes + encoded > budget) {
      parts.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(attachment);
    currentBytes += encoded;
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

function buildPart(
  notification: Record<string, string>,
  subject: string,
  requestId: string,
  part: OwnerEmailAttachment[],
  partIndex: number,
  partCount: number,
  from: string,
  to: string,
  replyTo?: string,
): OwnerEmailMessage {
  const rows = Object.entries(notification).filter(([, value]) => typeof value === 'string' && value.trim() !== '');
  const partLabel = partCount > 1 ? `Attachment set ${partIndex + 1} of ${partCount}` : 'Photo attachments';
  const attachmentNames = part.map((attachment) => attachment.filename).join(', ');
  const baseSubject = subject.trim().slice(0, 150) || 'Sparkling Standard request';
  const emailSubject = `${partCount > 1 ? `[Photos ${partIndex + 1}/${partCount}] ` : '[Photos] '}${baseSubject} - ${requestId}`;

  const htmlRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 10px 6px 0;vertical-align:top;color:#8c7a70;font-size:12px;white-space:nowrap;">${escapeHtml(label)}</td><td style="padding:6px 0;vertical-align:top;color:#302429;font-size:13px;white-space:pre-wrap;">${escapeHtml(value)}</td></tr>`,
    )
    .join('');
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f9f3ed;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9f3ed;padding:20px 10px;">
<tr><td align="center">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border:1px solid #e4d5c7;border-radius:8px;">
<tr><td style="padding:20px 24px;">
<p style="margin:0 0 4px;color:#b15a6f;font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;">Sparkling Standard</p>
<h1 style="margin:0 0 6px;color:#302429;font-family:Georgia,'Times New Roman',serif;font-size:21px;">New request — ${escapeHtml(requestId)}</h1>
<p style="margin:0 0 14px;color:#4a3b40;font-size:13px;">${escapeHtml(partLabel)}${part.length > 0 ? `: ${escapeHtml(attachmentNames)}` : ''}</p>
<p style="margin:0 0 14px;color:#4a3b40;font-size:13px;">This is the owner notification. The customer photos are attached as real files. Private time-limited links are also included below as a backup. If this is one of several attachment sets, all sets share request ID <strong>${escapeHtml(requestId)}</strong>.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${htmlRows}</table>
<p style="margin:16px 0 0;color:#8c7a70;font-size:11px;">Attachment acceptance by the email provider is not proof of inbox delivery. Do not forward customer photos outside Sparkling Standard.</p>
</td></tr></table></td></tr></table>
</body></html>`;

  const text = [
    'SPARKLING STANDARD — NEW REQUEST',
    `Request ID: ${requestId}`,
    partLabel,
    ...(attachmentNames ? [`Files: ${attachmentNames}`] : []),
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    'The customer photos are attached as real files. Private time-limited links are included above as a backup.',
    'Attachment acceptance by the email provider is not proof of inbox delivery. Do not forward customer photos outside Sparkling Standard.',
  ].join('\n');

  const message: OwnerEmailMessage = {
    from,
    to,
    subject: emailSubject,
    html,
    text,
    attachments: part,
    idempotencyKey: `owner-notification/${safeRequestId(requestId)}/part-${partIndex + 1}/v1`,
  };
  if (replyTo) message.replyTo = replyTo;
  return message;
}

export function buildOwnerEmailMessages(options: {
  notification: Record<string, string>;
  subject: string;
  requestId: string;
  attachments: OwnerEmailAttachment[];
  from?: string;
  to?: string;
  replyTo?: string;
  budget?: number;
}): OwnerEmailMessage[] {
  const from = options.from || DEFAULT_CUSTOMER_EMAIL_FROM;
  const to = options.to || DEFAULT_OWNER_NOTIFICATION_EMAIL;
  const requestId = safeRequestId(options.requestId);
  const parts = splitOwnerAttachments(options.attachments, options.budget);
  if (parts.length === 0) {
    return [buildPart(options.notification, options.subject, requestId, [], 0, 1, from, to, options.replyTo)];
  }
  return parts.map((part, index) =>
    buildPart(
      options.notification,
      options.subject,
      requestId,
      part,
      index,
      parts.length,
      from,
      to,
      options.replyTo,
    ),
  );
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendPart(
  message: OwnerEmailMessage,
  apiKey: string,
  fetchImpl: typeof fetch,
  retryDelayMs: number,
): Promise<OwnerEmailPartOutcome> {
  let lastStatus: number | undefined;
  let attempts = 0;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    attempts = attempt;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetchImpl(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Idempotency-Key': message.idempotencyKey,
        },
        body: JSON.stringify({
          from: message.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
          attachments: message.attachments.map((attachment) => ({
            filename: attachment.filename,
            content: attachment.contentBase64,
            content_type: attachment.contentType,
          })),
        }),
        signal: controller.signal,
      });
      lastStatus = response.status;
      if (response.ok) {
        const data = (await response.json().catch(() => ({}))) as { id?: unknown };
        return {
          index: 0,
          status: 'accepted',
          providerStatus: response.status,
          ...(typeof data.id === 'string' ? { providerId: data.id } : {}),
          attempts: attempt,
        };
      }
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 2) break;
    } catch {
      lastStatus = undefined;
      if (attempt === 2) break;
    } finally {
      clearTimeout(timer);
    }
    if (retryDelayMs > 0) await delay(retryDelayMs * attempt);
  }
  return {
    index: 0,
    status: 'failed',
    ...(lastStatus !== undefined ? { providerStatus: lastStatus } : {}),
    attempts,
  };
}

/**
 * Sends each message with a bounded retry. Provider acceptance is reported as
 * `accepted`, never as inbox delivery. At most two attempts per part.
 */
export async function sendOwnerEmailMessages(
  messages: OwnerEmailMessage[],
  env: OwnerEmailEnv,
  options: { fetchImpl?: typeof fetch; retryDelayMs?: number } = {},
): Promise<OwnerEmailOutcome> {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) return { status: 'not_configured', parts: [] };
  if (messages.length === 0) return { status: 'no_attachments', parts: [] };
  const fetchImpl = options.fetchImpl ?? fetch;
  const retryDelayMs = options.retryDelayMs ?? 500;
  const parts: OwnerEmailPartOutcome[] = [];
  for (const [index, message] of messages.entries()) {
    const outcome = await sendPart(message, apiKey, fetchImpl, retryDelayMs);
    parts.push({ ...outcome, index: index + 1 });
  }
  if (parts.every((part) => part.status === 'accepted')) return { status: 'accepted', parts };
  if (parts.some((part) => part.status === 'accepted')) return { status: 'partial', parts };
  return { status: 'failed', parts };
}

/** Safe operational log line — no customer data, attachment names or secrets. */
export function describeOwnerEmailOutcome(outcome: OwnerEmailOutcome): string {
  const accepted = outcome.parts.filter((part) => part.status === 'accepted').length;
  const failed = outcome.parts.filter((part) => part.status === 'failed').length;
  const codes = outcome.parts
    .map((part) => part.providerStatus)
    .filter((code): code is number => typeof code === 'number')
    .join(',');
  return `owner-notification: ${outcome.status}; parts accepted=${accepted} failed=${failed}${codes ? `; provider codes=${codes}` : ''}`;
}
