// Server-only administrator authentication for the gift financial register.
// Passwords, session tokens and recovery tokens are never stored in plaintext
// and never returned to an unauthenticated visitor.

import {
  createLedgerJson,
  deleteLedgerKey,
  paymentHash,
  readLedgerJson,
  writeLedgerJson,
  type LedgerBucket,
} from '../payments/ledger.ts';

export const ADMIN_COOKIE = '__Host-ss_admin';
export const SESSION_TTL_SECONDS = 2 * 60 * 60;
export const RECOVERY_TTL_SECONDS = 30 * 60;
export const PASSWORD_ITERATIONS = 210_000;
export const ADMIN_KEY = 'auth/admin.json';
const SESSION_PREFIX = 'auth/sessions/';
const CHALLENGE_PREFIX = 'auth/challenges/';

export interface AdminRecord {
  version: 1;
  passwordHash: string;
  recoveryEmail?: string;
  recoveryEmailVerified: boolean;
  recoveryPhone?: string;
  recoveryPhoneVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSession {
  version: 1;
  tokenHash: string;
  csrf: string;
  createdAt: string;
  expiresAt: string;
  ipHash?: string;
  userAgentHash?: string;
}

export interface AuthChallenge {
  version: 1;
  kind: 'verify_email' | 'reset_password' | 'verify_phone';
  tokenHash: string;
  email?: string;
  phone?: string;
  createdAt: string;
  expiresAt: string;
  attempts: number;
}

export interface AdminStorageEnv {
  PAYMENT_LEDGER?: LedgerBucket;
  PHOTOS_BUCKET?: LedgerBucket;
}

export function adminBucket(env: AdminStorageEnv): LedgerBucket | null {
  return env.PAYMENT_LEDGER ?? env.PHOTOS_BUCKET ?? null;
}

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function hashToken(token: string): Promise<string> {
  return paymentHash(token);
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export function passwordProblem(password: string): string | null {
  if (password.length < 12) return 'Use at least 12 characters.';
  if (password.length > 200) return 'Use no more than 200 characters.';
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  if (classes < 3) return 'Include at least three of: lowercase, uppercase, number and symbol.';
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PASSWORD_ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  );
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = Number(parts[1]);
  if (!Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) return false;
  try {
    const salt = Uint8Array.from(fromBase64Url(parts[2]!));
    const expected = parts[3]!;
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      key,
      256,
    );
    return constantTimeEqual(toBase64Url(new Uint8Array(bits)), expected);
  } catch {
    return false;
  }
}

export async function readAdmin(bucket: LedgerBucket): Promise<AdminRecord | null> {
  return (await readLedgerJson<AdminRecord>(bucket, ADMIN_KEY))?.value ?? null;
}

export async function createAdmin(bucket: LedgerBucket, record: AdminRecord): Promise<boolean> {
  return createLedgerJson(bucket, ADMIN_KEY, record);
}

export async function writeAdmin(bucket: LedgerBucket, record: AdminRecord): Promise<void> {
  await writeLedgerJson(bucket, ADMIN_KEY, { ...record, updatedAt: new Date().toISOString() });
}

export function sessionKey(tokenHash: string): string {
  return `${SESSION_PREFIX}${tokenHash}.json`;
}

export async function createSession(
  bucket: LedgerBucket,
  meta: { ip?: string; userAgent?: string },
): Promise<{ token: string; session: AdminSession }> {
  const token = randomToken();
  const csrf = randomToken(24);
  const now = new Date();
  const session: AdminSession = {
    version: 1,
    tokenHash: await hashToken(token),
    csrf,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString(),
    ...(meta.ip ? { ipHash: await paymentHash(meta.ip) } : {}),
    ...(meta.userAgent ? { userAgentHash: await paymentHash(meta.userAgent) } : {}),
  };
  await writeLedgerJson(bucket, sessionKey(session.tokenHash), session);
  return { token, session };
}

export function sessionTokenFromRequest(request: Request): string {
  const cookie = request.headers.get('Cookie') ?? '';
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === ADMIN_COOKIE) return rest.join('=');
  }
  return '';
}

export async function readSession(bucket: LedgerBucket, token: string): Promise<AdminSession | null> {
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const stored = await readLedgerJson<AdminSession>(bucket, sessionKey(tokenHash)).catch(() => null);
  if (!stored) return null;
  if (Date.parse(stored.value.expiresAt) <= Date.now()) {
    await deleteLedgerKey(bucket, sessionKey(tokenHash));
    return null;
  }
  return stored.value;
}

export async function deleteSession(bucket: LedgerBucket, token: string): Promise<void> {
  if (!token) return;
  await deleteLedgerKey(bucket, sessionKey(await hashToken(token)));
}

export async function invalidateAllSessions(bucket: LedgerBucket): Promise<void> {
  if (!bucket.list) return;
  const listed = await bucket.list({ prefix: SESSION_PREFIX });
  await Promise.all(listed.objects.map((item) => deleteLedgerKey(bucket, item.key)));
}

export function sessionCookie(token: string): string {
  return `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function expiredSessionCookie(): string {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function challengeKey(tokenHash: string): string {
  return `${CHALLENGE_PREFIX}${tokenHash}.json`;
}

export async function createChallenge(
  bucket: LedgerBucket,
  kind: AuthChallenge['kind'],
  data: { email?: string; phone?: string } = {},
): Promise<{ token: string; challenge: AuthChallenge }> {
  const token = randomToken();
  const now = new Date();
  const challenge: AuthChallenge = {
    version: 1,
    kind,
    tokenHash: await hashToken(token),
    ...(data.email ? { email: data.email } : {}),
    ...(data.phone ? { phone: data.phone } : {}),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + RECOVERY_TTL_SECONDS * 1000).toISOString(),
    attempts: 0,
  };
  await writeLedgerJson(bucket, challengeKey(challenge.tokenHash), challenge);
  return { token, challenge };
}

export async function consumeChallenge(
  bucket: LedgerBucket,
  token: string,
  kind: AuthChallenge['kind'],
): Promise<AuthChallenge | null> {
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const key = challengeKey(tokenHash);
  const stored = await readLedgerJson<AuthChallenge>(bucket, key).catch(() => null);
  if (!stored || stored.value.kind !== kind) return null;
  if (Date.parse(stored.value.expiresAt) <= Date.now()) {
    await deleteLedgerKey(bucket, key);
    return null;
  }
  await deleteLedgerKey(bucket, key);
  return stored.value;
}

export async function audit(
  bucket: LedgerBucket,
  action: string,
  input: { success: boolean; ip?: string; detail?: string; actor?: string },
): Promise<void> {
  const at = new Date().toISOString();
  const key = `auth/audit/${at.replace(/[:.]/g, '-')}-${randomToken(6)}.json`;
  const record = {
    at,
    action: action.slice(0, 80),
    success: input.success,
    ...(input.actor ? { actor: input.actor.slice(0, 80) } : {}),
    ...(input.ip ? { ipHash: await paymentHash(input.ip) } : {}),
    ...(input.detail ? { detail: input.detail.slice(0, 300) } : {}),
  };
  await writeLedgerJson(bucket, key, record).catch(() => undefined);
}

export function requestIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? request.headers.get('x-forwarded-for') ?? 'unknown';
}

export function requestUserAgent(request: Request): string {
  return (request.headers.get('User-Agent') ?? '').slice(0, 300);
}
