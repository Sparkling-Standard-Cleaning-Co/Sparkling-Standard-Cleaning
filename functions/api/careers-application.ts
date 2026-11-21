import { adminDb, type AdminDbEnv } from '../../src/lib/admin/d1.ts';
import { checkPublicRateLimit, clientIp, consumePublicRateLimit, PUBLIC_RATE_LIMITS } from '../../src/lib/public-rate-limit.ts';
import { EMAIL_ROUTING } from '../../src/config/email-routing.ts';
import {
  DEPARTMENT_ADDRESSES,
  readCommunicationSettings,
  recordNotificationDelivery,
} from '../../src/lib/admin/communications.ts';
import {
  CAREER_BRANCHES,
  CAREER_EXPERIENCE_LEVELS,
  CAREER_ROLES,
  CAREER_TRANSPORT,
  CAREER_RESUME_MAX_BYTES,
  careerValue,
  resumeFormat,
  sanitizeResumeName,
} from '../../src/lib/careers.ts';

interface R2Bucket {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
}

interface Env extends AdminDbEnv {
  DOCUMENTS_BUCKET?: R2Bucket;
  PHOTOS_BUCKET?: R2Bucket;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  PUBLIC_SITE_URL?: string;
  TURNSTILE_SECRET_KEY?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

async function verifyTurnstile(request: Request, token: string, secret: string): Promise<boolean> {
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token });
  const ip = clientIp(request);
  if (ip !== 'unknown') body.set('remoteip', ip);
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    return response.ok && (await response.json() as { success?: boolean }).success === true;
  } catch { return false; }
}

function reference(): string {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `APP-${date}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

async function sendEmail(input: { to: string; subject: string; text: string; replyTo: string; env: Env; idempotencyKey: string }): Promise<boolean> {
  const key = input.env.RESEND_API_KEY?.trim();
  if (!key) return false;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': input.idempotencyKey },
      body: JSON.stringify({
        from: input.env.RESEND_FROM_EMAIL?.trim() || EMAIL_ROUTING.notificationsSender,
        to: [input.to],
        reply_to: input.replyTo,
        subject: input.subject,
        text: input.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch { return false; }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  if (!sameOrigin(context.request)) return json({ ok: false, error: 'origin_rejected' }, 403);
  const ip = clientIp(context.request);
  const ipStatus = await checkPublicRateLimit(context.env.DB, 'careers-application', ip, PUBLIC_RATE_LIMITS.careerIp);
  if (ipStatus.limited) return json({ ok: false, error: 'rate_limited', retryAfterSeconds: ipStatus.retryAfterSeconds }, 429);
  await consumePublicRateLimit(context.env.DB, 'careers-application', ip, PUBLIC_RATE_LIMITS.careerIp);

  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);

  const length = Number(context.request.headers.get('Content-Length') ?? 0);
  if (length > CAREER_RESUME_MAX_BYTES + 2 * 1024 * 1024) return json({ ok: false, error: 'request_too_large' }, 413);

  let form: FormData;
  try { form = await context.request.formData(); } catch { return json({ ok: false, error: 'invalid_request' }, 400); }

  if (context.env.TURNSTILE_SECRET_KEY && !(await verifyTurnstile(context.request, text(form.get('turnstile_token'), 2000), context.env.TURNSTILE_SECRET_KEY))) {
    return json({ ok: false, error: 'verification_failed' }, 403);
  }

  const name = text(form.get('name'), 120);
  const email = text(form.get('email'), 200).toLowerCase();
  const phone = text(form.get('phone'), 40);
  const experienceLevel = careerValue(CAREER_EXPERIENCE_LEVELS, text(form.get('experience_level'), 40));
  const desiredRole = careerValue(CAREER_ROLES, text(form.get('desired_role'), 40));
  const branchPreference = careerValue(CAREER_BRANCHES, text(form.get('branch_preference'), 40));
  const availability = text(form.get('availability'), 800);
  const transportation = careerValue(CAREER_TRANSPORT, text(form.get('transportation'), 40));
  const driverLicense = ['yes', 'no', 'prefer_not_to_say'].includes(text(form.get('driver_license'), 30)) ? text(form.get('driver_license'), 30) : 'prefer_not_to_say';
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || phone.replace(/\D/g, '').length < 7) {
    return json({ ok: false, error: 'applicant_contact_invalid' }, 400);
  }
  if (!experienceLevel || !desiredRole || !branchPreference || !availability || !transportation || form.get('consent') !== 'yes') {
    return json({ ok: false, error: 'application_fields_invalid' }, 400);
  }

  const id = `app_${crypto.randomUUID()}`;
  const appReference = reference();
  let resumeKey = '';
  let resumeName = '';
  let resumeType = '';
  let resumeBytes = 0;
  const resume = form.get('resume');
  if (resume instanceof File && resume.size > 0) {
    if (resume.size > CAREER_RESUME_MAX_BYTES) return json({ ok: false, error: 'resume_too_large' }, 413);
    const bytes = new Uint8Array(await resume.arrayBuffer());
    const format = resumeFormat(bytes, resume.name);
    if (!format) return json({ ok: false, error: 'resume_format_invalid' }, 415);
    const bucket = context.env.DOCUMENTS_BUCKET ?? context.env.PHOTOS_BUCKET;
    if (!bucket) return json({ ok: false, error: 'resume_storage_not_configured' }, 503);
    const month = new Date().toISOString().slice(0, 7).replace('-', '/');
    const suffix = crypto.randomUUID();
    resumeKey = `careers/${month}/${id}/${suffix}.${format.ext}`;
    resumeName = sanitizeResumeName(resume.name) || `resume.${format.ext}`;
    resumeType = format.mime;
    resumeBytes = bytes.byteLength;
    try {
      await bucket.put(resumeKey, bytes, { httpMetadata: { contentType: format.mime }, customMetadata: { applicationId: id } });
    } catch { return json({ ok: false, error: 'resume_storage_failed' }, 500); }
  }

  const now = new Date().toISOString();
  try {
    await db.prepare(
      `INSERT INTO career_applications
       (id, reference, name, email, phone, experience_level, desired_role, branch_preference,
        availability, transportation, driver_license, resume_key, resume_name, resume_type,
        resume_bytes, consent_at, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'careers_page', ?, ?)`,
    ).bind(id, appReference, name, email, phone, experienceLevel, desiredRole, branchPreference, availability, transportation, driverLicense, resumeKey, resumeName, resumeType, resumeBytes, now, now, now).run();
  } catch {
    return json({ ok: false, error: 'application_save_failed' }, 500);
  }

  const site = context.env.PUBLIC_SITE_URL?.trim() || new URL(context.request.url).origin;
  const communications = await readCommunicationSettings(db);
  const careersReplyTo = DEPARTMENT_ADDRESSES[communications.settings.replyTo.careers] ?? EMAIL_ROUTING.hiring;
  const hiringRecipients = [...new Set(
    communications.settings.routing.hiring_notification.map(
      (department) => communications.settings.departments[department]?.address,
    ).filter((address): address is string => Boolean(address)),
  )];
  const applicantEmail = await sendEmail({
    to: email,
    subject: `Application received - ${appReference}`,
    replyTo: careersReplyTo,
    env: context.env,
    idempotencyKey: `career-ack-${id}`,
    text: `Hello ${name},\n\nThank you for applying to Sparkling Standard. We received your application ${appReference}.\n\nWe review every application against the current hiring need. If your experience and availability are a fit, the hiring team will contact you. We do not promise a role, schedule or pay rate before that review.\n\nApplication status: ${site}/careers/#status\nReference: ${appReference}\nEmail used: ${email}\n\nPlease do not send sensitive documents such as a Social Security number or banking information by email.\n\nSparkling Standard | Hiring Team`,
  });
  let hiringEmail = false;
  for (const [index, recipient] of hiringRecipients.entries()) {
    const delivered = await sendEmail({
      to: recipient,
      subject: `New career application - ${name} - ${branchPreference}`,
      replyTo: email,
      env: context.env,
      idempotencyKey: `career-hiring-${id}-${index}`,
      text: `New application ${appReference}\n\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nExperience: ${experienceLevel}\nDesired role: ${desiredRole}\nBranch: ${branchPreference}\nAvailability: ${availability}\nTransportation: ${transportation}\nDriver license: ${driverLicense}\nResume: ${resumeName || 'not attached'}\n\nReview securely in Admin -> Careers.`,
    });
    hiringEmail = hiringEmail || delivered;
    await recordNotificationDelivery(db, {
      eventKey: 'hiring_notification',
      department: communications.settings.routing.hiring_notification[index] ?? 'hiring',
      recipient,
      status: delivered ? 'sent' : context.env.RESEND_API_KEY ? 'failed' : 'suppressed',
      errorCode: delivered ? '' : context.env.RESEND_API_KEY ? 'provider_rejected' : 'resend_not_configured',
      relatedType: 'career_application',
      relatedId: id,
    }).catch(() => undefined);
  }
  if (applicantEmail) {
    await recordNotificationDelivery(db, {
      eventKey: 'careers_application',
      department: communications.settings.replyTo.careers,
      recipient: email,
      status: 'sent',
      relatedType: 'career_application',
      relatedId: id,
    }).catch(() => undefined);
  }
  if (applicantEmail || hiringEmail) {
    await db.prepare('UPDATE career_applications SET applicant_notified_at = ?, hiring_notified_at = ?, updated_at = ? WHERE id = ?')
      .bind(applicantEmail ? now : null, hiringEmail ? now : null, now, id).run().catch(() => undefined);
  }
  return json({ ok: true, reference: appReference, status: 'received', resumeStored: Boolean(resumeKey), applicantEmailSent: applicantEmail, hiringEmailSent: hiringEmail }, 201);
}
