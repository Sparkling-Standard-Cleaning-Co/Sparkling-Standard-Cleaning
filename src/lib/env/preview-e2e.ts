// Isolated Preview end-to-end authorization.
//
// Ordinary preview deployments stay read-only. One exact host may be opened for
// an owner-authorized acceptance run when BOTH E2E_ALLOWED_HOSTS names that host
// and E2E_AUTH_TOKEN is configured. The token is exchanged for a short-lived,
// host-bound, HMAC-signed HttpOnly cookie so the browser journey can use the
// normal application APIs without exposing the token to page assets or third
// parties. Production hosts and every other preview host are always rejected.

const PRODUCTION_HOSTS = new Set(['sparkling-standard.com', 'www.sparkling-standard.com']);

export const E2E_SESSION_COOKIE = 'ss_e2e_session';
export const E2E_TOKEN_HEADER = 'x-e2e-token';
export const E2E_SESSION_ENDPOINT = '/api/e2e/session';
export const E2E_SESSION_TTL_SECONDS = 4 * 60 * 60;

// Stripe delivers webhooks server-to-server. Only the exact authorized host may
// reach the webhook without the E2E cookie, and the endpoint still verifies the
// Stripe signature exactly as it does in production.
const E2E_UNAUTHENTICATED_PATHS = new Set(['/api/stripe-webhook']);

export interface E2EEnv {
  E2E_ALLOWED_HOSTS?: string;
  E2E_AUTH_TOKEN?: string;
}

export type E2EAuthMethod = 'header' | 'cookie' | 'webhook';

function normalizedHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, '');
}

function isExactPagesHost(host: string): boolean {
  if (!host || PRODUCTION_HOSTS.has(host) || host.includes('*')) return false;
  if (!host.endsWith('.pages.dev')) return false;
  const labels = host.split('.');
  if (labels.length < 3) return false;
  return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

export function e2eAllowedHosts(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => normalizedHost(entry))
    .filter(isExactPagesHost);
}

export function isE2EHost(hostname: string, allowlist: string | undefined): boolean {
  const host = normalizedHost(hostname);
  if (!host || PRODUCTION_HOSTS.has(host)) return false;
  return e2eAllowedHosts(allowlist).includes(host);
}

export function e2eToken(env: E2EEnv): string {
  return (env.E2E_AUTH_TOKEN ?? '').trim();
}

export function e2eConfigured(env: E2EEnv, hostname: string): boolean {
  return Boolean(e2eToken(env)) && isE2EHost(hostname, env.E2E_ALLOWED_HOSTS);
}

export function e2eWebhookExempt(pathname: string): boolean {
  return E2E_UNAUTHENTICATED_PATHS.has(pathname);
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

export async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(left), sha256(right)]);
  let difference = a.length ^ b.length;
  for (let index = 0; index < a.length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return new Uint8Array(signature);
}

function sessionMessage(host: string, expiresSeconds: number): string {
  return `e2e-session.v1|${host}|${expiresSeconds}`;
}

export interface E2ESession {
  value: string;
  expiresAt: string;
  maxAgeSeconds: number;
}

export async function createE2ESession(
  secret: string,
  hostname: string,
  now: number = Date.now(),
  ttlSeconds: number = E2E_SESSION_TTL_SECONDS,
): Promise<E2ESession> {
  const host = normalizedHost(hostname);
  const expiresSeconds = Math.floor(now / 1000) + Math.max(60, Math.floor(ttlSeconds));
  const signature = await hmac(secret, sessionMessage(host, expiresSeconds));
  return {
    value: `${expiresSeconds}.${toHex(signature)}`,
    expiresAt: new Date(expiresSeconds * 1000).toISOString(),
    maxAgeSeconds: Math.max(60, Math.floor(ttlSeconds)),
  };
}

export async function verifyE2ESession(
  secret: string,
  hostname: string,
  value: string,
  now: number = Date.now(),
): Promise<boolean> {
  if (!secret || !value) return false;
  const [expiresRaw = '', signature = ''] = value.split('.');
  if (!/^[0-9]{1,12}$/.test(expiresRaw) || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expiresSeconds = Number(expiresRaw);
  if (!Number.isFinite(expiresSeconds) || expiresSeconds * 1000 <= now) return false;
  const expected = await hmac(secret, sessionMessage(normalizedHost(hostname), expiresSeconds));
  return constantTimeEqual(signature.toLowerCase(), toHex(expected));
}

export function readCookie(header: string | null | undefined, name: string): string {
  if (!header) return '';
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return '';
}

export function e2eSessionCookie(session: E2ESession, secure = true): string {
  return [
    `${E2E_SESSION_COOKIE}=${session.value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${session.maxAgeSeconds}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export interface E2ERequestInput {
  hostname: string;
  pathname: string;
  method?: string;
  env: E2EEnv;
  tokenHeader?: string | null;
  cookieHeader?: string | null;
  origin?: string | null;
  now?: number;
}

export async function authorizeE2ERequest(
  input: E2ERequestInput,
): Promise<E2EAuthMethod | null> {
  const host = normalizedHost(input.hostname);
  const secret = e2eToken(input.env);
  if (!secret || !isE2EHost(host, input.env.E2E_ALLOWED_HOSTS)) return null;
  if (e2eWebhookExempt(input.pathname)) return 'webhook';

  const headerToken = (input.tokenHeader ?? '').trim();
  if (headerToken && (await constantTimeEqual(headerToken, secret))) return 'header';

  const cookieValue = readCookie(input.cookieHeader, E2E_SESSION_COOKIE);
  if (
    cookieValue &&
    (await verifyE2ESession(secret, host, cookieValue, input.now ?? Date.now()))
  ) {
    const method = (input.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      const origin = (input.origin ?? '').trim().toLowerCase();
      if (origin && origin !== `https://${host}`) return null;
    }
    return 'cookie';
  }
  return null;
}
