// Customer portal service: passwordless email verification, hashed sessions,
// customer-scoped data and service requests.
//
// Security rules:
// - The browser cookie contains a random token; only its SHA-256 hash is stored.
// - Magic links expire after 15 minutes and are single use.
// - Portal requests always return a generic response, so account existence is
//   never disclosed.
// - Every read is scoped by the session's customer_id. A customer can never
//   request another customer's booking, invoice or document by changing an id.
// - CSRF is required for state-changing actions.

import type { D1Database } from '../admin/d1.ts';
import { AdminAuthError } from '../admin/operations.ts';
import { readCommunicationSettings, recordNotificationDelivery } from '../admin/communications.ts';

export const PORTAL_COOKIE = '__Host-ss_portal';
export const PORTAL_TOKEN_TTL_MINUTES = 15;
export const PORTAL_SESSION_TTL_DAYS = 7;

export interface PortalEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  PUBLIC_SITE_URL?: string;
  PORTAL_BILLING_ENABLED?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_BILLING_PORTAL_CONFIGURATION_ID?: string;
}

export interface PortalSession {
  sessionId: string;
  customerId: string;
  csrf: string;
  email: string;
  name: string;
}

function now(): Date {
  return new Date();
}

function iso(date: Date): string {
  return date.toISOString();
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function randomToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  let binary = '';
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export async function hashPortalToken(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function normalizePortalEmail(value: unknown): string {
  const email = text(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

export function portalCookieHeader(token: string): string {
  const maxAge = PORTAL_SESSION_TTL_DAYS * 86_400;
  return `${PORTAL_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearPortalCookieHeader(): string {
  return `${PORTAL_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readPortalCookie(request: Request): string {
  const header = request.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === PORTAL_COOKIE) return rest.join('=');
  }
  return '';
}

export function sameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function siteUrl(env: PortalEnv): string {
  return (env.PUBLIC_SITE_URL?.trim() || 'https://sparkling-standard.com').replace(/\/+$/, '');
}

async function portalCustomer(db: D1Database, email: string): Promise<{ id: string; name: string } | null> {
  const row = await db
    .prepare(
      `SELECT c.id, c.first_name, c.last_name FROM customers c
       JOIN customer_contacts cc ON cc.customer_id = c.id AND cc.kind = 'email'
       WHERE c.status = 'active' AND c.source <> 'financial_system'
         AND (cc.normalized_value = ? OR LOWER(cc.value) = ?)
       ORDER BY cc.is_primary DESC, c.created_at ASC LIMIT 1`,
    )
    .bind(email, email)
    .first<{ id: string; first_name: string; last_name: string }>();
  if (!row) return null;
  return { id: row.id, name: [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Customer' };
}

async function sendPortalEmail(env: PortalEnv, to: string, firstName: string, link: string, replyTo: string): Promise<'sent' | 'failed' | 'suppressed'> {
  const key = env.RESEND_API_KEY?.trim();
  if (!key) return 'suppressed';
  const plain = `Hello ${firstName || 'there'},\n\nUse this secure link to sign in to your Sparkling Standard customer portal. It expires in ${PORTAL_TOKEN_TTL_MINUTES} minutes and can be used once:\n\n${link}\n\nIf you did not request this, you can ignore this message. No one can access your account without this link.\n\nSparkling Standard\n${siteUrl(env)}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f8f1ec;color:#2c2421;font-family:Georgia,serif">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px">
      <p style="font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:#9a5b61;margin:0 0 12px">Sparkling Standard</p>
      <h1 style="font-size:26px;line-height:1.2;margin:0 0 18px">Sign in to your customer portal</h1>
      <p style="font-size:16px;line-height:1.6">Hello ${escapeHtml(firstName || 'there')},</p>
      <p style="font-size:16px;line-height:1.6">Use the secure link below to view your bookings, recurring plan, invoices and signed documents. It expires in ${PORTAL_TOKEN_TTL_MINUTES} minutes and can be used once.</p>
      <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#9a5b61;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px">Open my portal</a></p>
      <p style="font-size:13px;line-height:1.6;color:#756963">If you did not request this, you can ignore this message. No one can access your account without this link.</p>
    </div></body></html>`;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `portal-access-${await hashPortalToken(`${to}:${link}`)}`.slice(0, 200),
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL?.trim() || 'Sparkling Standard <notifications@sparkling-standard.com>',
        to: [to],
        reply_to: replyTo,
        subject: 'Your Sparkling Standard customer portal link',
        text: plain,
        html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}

export async function requestPortalAccess(
  db: D1Database,
  env: PortalEnv,
  input: { email: unknown; ipHash?: string; userAgentHash?: string },
): Promise<{ ok: true }> {
  const email = normalizePortalEmail(input.email);
  if (!email) return { ok: true };
  const customer = await portalCustomer(db, email);
  if (!customer) return { ok: true };
  const token = randomToken();
  const tokenHash = await hashPortalToken(token);
  const expires = new Date(now().getTime() + PORTAL_TOKEN_TTL_MINUTES * 60_000);
  await db
    .prepare(
      `UPDATE customer_portal_tokens SET used_at = ? WHERE customer_id = ? AND used_at IS NULL`,
    )
    .bind(iso(now()), customer.id)
    .run()
    .catch(() => undefined);
  await db
    .prepare(
      `INSERT INTO customer_portal_tokens
       (id, customer_id, email, token_hash, purpose, expires_at, created_at, ip_hash, user_agent_hash)
       VALUES (?, ?, ?, ?, 'login', ?, ?, ?, ?)`,
    )
    .bind(
      `ptok_${crypto.randomUUID()}`,
      customer.id,
      email,
      tokenHash,
      iso(expires),
      iso(now()),
      text(input.ipHash, 80),
      text(input.userAgentHash, 80),
    )
    .run();
  const link = `${siteUrl(env)}/portal/?token=${encodeURIComponent(token)}`;
  const communication = await readCommunicationSettings(db).catch(() => null);
  const contactReplyTo = communication
    ? communication.settings.departments[communication.settings.replyTo.contact]?.address
    : undefined;
  const delivery = await sendPortalEmail(
    env,
    email,
    customer.name.split(' ')[0] ?? '',
    link,
    contactReplyTo || 'customer-service@sparkling-standard.com',
  );
  await recordNotificationDelivery(db, {
    eventKey: 'portal_access',
    department: 'customerService',
    recipient: email,
    status: delivery === 'sent' ? 'sent' : delivery === 'suppressed' ? 'suppressed' : 'failed',
    errorCode: delivery === 'sent' ? '' : delivery === 'suppressed' ? 'resend_not_configured' : 'provider_rejected',
    relatedType: 'customer',
    relatedId: customer.id,
  }).catch(() => undefined);
  await db
    .prepare(
      'INSERT INTO customer_portal_audit (id, customer_id, action, detail, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(
      `paud_${crypto.randomUUID()}`,
      customer.id,
      'portal.access_requested',
      delivery,
      text(input.ipHash, 80),
      iso(now()),
    )
    .run()
    .catch(() => undefined);
  return { ok: true };
}

export async function verifyPortalToken(
  db: D1Database,
  tokenInput: unknown,
  input: { ipHash?: string; userAgentHash?: string } = {},
): Promise<{ sessionToken: string; csrf: string; customerId: string; name: string } | null> {
  const token = text(tokenInput, 200);
  if (!token) return null;
  const tokenHash = await hashPortalToken(token);
  const row = await db
    .prepare(
      `SELECT t.id, t.customer_id, t.email, t.expires_at, t.used_at, c.status, c.first_name, c.last_name
       FROM customer_portal_tokens t JOIN customers c ON c.id = t.customer_id
       WHERE t.token_hash = ? LIMIT 1`,
    )
    .bind(tokenHash)
    .first<{
      id: string;
      customer_id: string;
      email: string;
      expires_at: string;
      used_at: string | null;
      status: string;
      first_name: string;
      last_name: string;
    }>();
  if (!row || row.used_at || row.status !== 'active' || new Date(row.expires_at).getTime() <= now().getTime()) {
    return null;
  }
  const usedAt = iso(now());
  await db.prepare('UPDATE customer_portal_tokens SET used_at = ? WHERE id = ?').bind(usedAt, row.id).run();
  const sessionToken = randomToken(32);
  const sessionHash = await hashPortalToken(sessionToken);
  const csrf = randomToken(24);
  const expires = new Date(now().getTime() + PORTAL_SESSION_TTL_DAYS * 86_400_000);
  await db
    .prepare(
      `INSERT INTO customer_portal_sessions
       (id, customer_id, token_hash, csrf_token, verified_email, expires_at, last_seen_at, created_at, ip_hash, user_agent_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `psess_${crypto.randomUUID()}`,
      row.customer_id,
      sessionHash,
      csrf,
      row.email,
      iso(expires),
      usedAt,
      usedAt,
      text(input.ipHash, 80),
      text(input.userAgentHash, 80),
    )
    .run();
  await db
    .prepare(
      'INSERT INTO customer_portal_audit (id, customer_id, action, detail, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(`paud_${crypto.randomUUID()}`, row.customer_id, 'portal.session_created', '', text(input.ipHash, 80), usedAt)
    .run()
    .catch(() => undefined);
  return {
    sessionToken,
    csrf,
    customerId: row.customer_id,
    name: [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Customer',
  };
}

export async function readPortalSession(
  db: D1Database,
  request: Request,
): Promise<PortalSession | null> {
  const raw = readPortalCookie(request);
  if (!raw) return null;
  const hash = await hashPortalToken(raw);
  const row = await db
    .prepare(
      `SELECT s.id, s.customer_id, s.csrf_token, s.verified_email, s.expires_at, s.revoked_at,
              c.status, c.first_name, c.last_name
       FROM customer_portal_sessions s JOIN customers c ON c.id = s.customer_id
       WHERE s.token_hash = ? LIMIT 1`,
    )
    .bind(hash)
    .first<{
      id: string;
      customer_id: string;
      csrf_token: string;
      verified_email: string;
      expires_at: string;
      revoked_at: string | null;
      status: string;
      first_name: string;
      last_name: string;
    }>();
  if (!row || row.revoked_at || row.status !== 'active' || new Date(row.expires_at).getTime() <= now().getTime()) {
    return null;
  }
  await db
    .prepare('UPDATE customer_portal_sessions SET last_seen_at = ? WHERE id = ?')
    .bind(iso(now()), row.id)
    .run()
    .catch(() => undefined);
  return {
    sessionId: row.id,
    customerId: row.customer_id,
    csrf: row.csrf_token,
    email: row.verified_email,
    name: [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Customer',
  };
}

export async function revokePortalSession(db: D1Database, request: Request): Promise<void> {
  const raw = readPortalCookie(request);
  if (!raw) return;
  const hash = await hashPortalToken(raw);
  await db
    .prepare('UPDATE customer_portal_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(iso(now()), hash)
    .run()
    .catch(() => undefined);
}

export function requirePortalCsrf(session: PortalSession, header: string | null): void {
  if (!header || header !== session.csrf) throw new AdminAuthError(403, 'csrf_invalid');
}

export async function portalSnapshot(
  db: D1Database,
  session: PortalSession,
  env: PortalEnv = {},
): Promise<Record<string, unknown>> {
  const customerId = session.customerId;
  const [customer, contacts, properties, appointments, recurring, invoices, signing, signatures, requests] = await Promise.all([
    db
      .prepare(
        `SELECT c.id, c.first_name, c.last_name, c.company_name, c.primary_branch_id, c.created_at,
                b.name AS branch_name
         FROM customers c LEFT JOIN branches b ON b.id = c.primary_branch_id
         WHERE c.id = ? AND c.status = 'active' LIMIT 1`,
      )
      .bind(customerId)
      .first<Record<string, unknown>>(),
    db
      .prepare("SELECT kind, value, is_primary FROM customer_contacts WHERE customer_id = ? ORDER BY is_primary DESC, created_at")
      .bind(customerId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT id, label, line1, line2, city, state, postal_code, property_type, is_primary
         FROM properties WHERE customer_id = ? AND status = 'active' ORDER BY is_primary DESC, created_at`,
      )
      .bind(customerId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT id, reference, status, start_at, end_at, duration_minutes
         FROM appointments WHERE customer_id = ? ORDER BY start_at DESC LIMIT 50`,
      )
      .bind(customerId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT id, frequency, status, next_visit_date, ongoing_price_cents, start_date
         FROM recurring_plans WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50`,
      )
      .bind(customerId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT id, number, status, total_cents, amount_paid_cents, balance_cents, due_date, issue_date,
                payment_url
         FROM invoices WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50`,
      )
      .bind(customerId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT id, bundle_code, packet_name, status, executed_at, executed_sha256, token_expires_at, created_at
         FROM signing_requests WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50`,
      )
      .bind(customerId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT s.id, s.status, s.signed_at, t.title, t.category, s.r2_key
         FROM document_signatures s
         JOIN signing_requests sr ON sr.id = s.signing_request_id
         JOIN document_templates t ON t.id = s.template_id
         WHERE sr.customer_id = ? AND s.status IN ('signed','verified')
         ORDER BY s.signed_at DESC LIMIT 50`,
      )
      .bind(customerId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT id, kind, status, created_at, updated_at FROM customer_portal_requests
         WHERE customer_id = ? ORDER BY created_at DESC LIMIT 25`,
      )
      .bind(customerId)
      .all<Record<string, unknown>>(),
  ]);
  const signedDocuments = (signatures.results ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    status: row.status,
    signed_at: row.signed_at,
    downloadable: Boolean(row.r2_key),
  }));
  const executed = (signing.results ?? []).filter((row) => Boolean(row.executed_at));
  return {
    customer,
    contacts: contacts.results ?? [],
    properties: properties.results ?? [],
    appointments: appointments.results ?? [],
    recurring: recurring.results ?? [],
    invoices: invoices.results ?? [],
    documents: { signingRequests: signing.results ?? [], executed, signatures: signedDocuments },
    requests: requests.results ?? [],
    billingPortalEnabled: env.PORTAL_BILLING_ENABLED === 'true',
  };
}

export async function createPortalServiceRequest(
  db: D1Database,
  env: PortalEnv,
  session: PortalSession,
  input: { kind?: unknown; message?: unknown; appointmentId?: unknown },
  ipHash?: string,
): Promise<{ id: string }> {
  const kinds = new Set(['question', 'reschedule', 'billing', 'service', 'documents']);
  const kind = text(input.kind, 20);
  if (!kinds.has(kind)) throw new AdminAuthError(400, 'request_kind_invalid');
  const message = text(input.message, 2000);
  if (message.length < 5) throw new AdminAuthError(400, 'request_message_required');
  let appointmentId: string | null = null;
  const requestedAppointment = text(input.appointmentId, 120);
  if (requestedAppointment) {
    const owned = await db
      .prepare('SELECT id FROM appointments WHERE id = ? AND customer_id = ? LIMIT 1')
      .bind(requestedAppointment, session.customerId)
      .first<{ id: string }>();
    if (!owned) throw new AdminAuthError(403, 'appointment_not_found');
    appointmentId = owned.id;
  }
  const id = `preq_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO customer_portal_requests
       (id, customer_id, appointment_id, kind, message, status, department, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'received', 'customerService', ?, ?)`,
    )
    .bind(id, session.customerId, appointmentId, kind, message, iso(now()), iso(now()))
    .run();
  await db
    .prepare(
      'INSERT INTO customer_portal_audit (id, customer_id, action, detail, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(`paud_${crypto.randomUUID()}`, session.customerId, 'portal.request_created', kind, text(ipHash, 80), iso(now()))
    .run()
    .catch(() => undefined);

  const communication = await readCommunicationSettings(db).catch(() => null);
  const recipients = [...new Set(
    (communication?.settings.routing.contact_inquiry ?? ['customerService']).map(
      (department) => communication?.settings.departments[department]?.address,
    ).filter((address): address is string => Boolean(address)),
  )];
  const key = env.RESEND_API_KEY?.trim();
  for (const recipient of recipients) {
    let status: 'sent' | 'failed' | 'suppressed' = 'suppressed';
    let errorCode = 'resend_not_configured';
    if (key) {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `portal-request-${id}-${recipient}`.slice(0, 200),
          },
          body: JSON.stringify({
            from: env.RESEND_FROM_EMAIL?.trim() || 'Sparkling Standard <notifications@sparkling-standard.com>',
            to: [recipient],
            reply_to: session.email,
            subject: `Customer portal request - ${session.name}`,
            text: `A customer submitted a portal ${kind} request.\n\nCustomer: ${session.name}\nVerified email: ${session.email}\nRequest: ${id}\n\n${message}\n\nReview in Admin -> Customers and follow up through the appropriate department.`,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        status = response.ok ? 'sent' : 'failed';
        errorCode = response.ok ? '' : `http_${response.status}`;
      } catch {
        status = 'failed';
        errorCode = 'network_error';
      }
    }
    await recordNotificationDelivery(db, {
      eventKey: 'portal_request',
      department: 'customerService',
      recipient,
      status,
      errorCode,
      relatedType: 'portal_request',
      relatedId: id,
    }).catch(() => undefined);
  }
  return { id };
}
