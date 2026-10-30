import { hashToken, randomToken } from './auth.ts';
import { decryptMfaSecret, encryptMfaSecret } from './secrets.ts';
import type { D1Database } from './d1.ts';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const MFA_PERIOD_SECONDS = 30;
const MFA_DIGITS = 6;
const MFA_CHALLENGE_SECONDS = 5 * 60;
const MFA_MAX_ATTEMPTS = 5;

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string): Uint8Array {
  const normalized = input.replace(/[^A-Z2-7]/gi, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(output);
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

export function totpUri(secret: string, email: string): string {
  const label = encodeURIComponent(`Sparkling Standard:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent('Sparkling Standard')}&algorithm=SHA1&digits=${MFA_DIGITS}&period=${MFA_PERIOD_SECONDS}`;
}

function decimalCode(bytes: Uint8Array): string {
  const offset = (bytes[bytes.length - 1] ?? 0) & 15;
  const value =
    (((bytes[offset] ?? 0) & 0x7f) << 24) |
    (((bytes[offset + 1] ?? 0) & 0xff) << 16) |
    (((bytes[offset + 2] ?? 0) & 0xff) << 8) |
    ((bytes[offset + 3] ?? 0) & 0xff);
  return String(value % 10 ** MFA_DIGITS).padStart(MFA_DIGITS, '0');
}

async function hotp(secret: string, counter: number): Promise<string> {
  const keyBytes = base32Decode(secret);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const message = new Uint8Array(8);
  let value = counter;
  for (let index = 7; index >= 0; index -= 1) {
    message[index] = value & 255;
    value = Math.floor(value / 256);
  }
  return decimalCode(new Uint8Array(await crypto.subtle.sign('HMAC', key, message)));
}

export async function verifyTotp(secret: string, codeInput: string, now = Date.now()): Promise<boolean> {
  const code = codeInput.replace(/\D/g, '');
  if (code.length !== MFA_DIGITS) return false;
  const counter = Math.floor(now / 1000 / MFA_PERIOD_SECONDS);
  for (const drift of [-1, 0, 1]) {
    if (await hotp(secret, counter + drift) === code) return true;
  }
  return false;
}

export function recoveryCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const raw = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

function normalizeRecoveryCode(code: string): string {
  return code.replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

export async function createRecoveryCodes(db: D1Database, userId: string): Promise<string[]> {
  const codes = Array.from({ length: 8 }, () => recoveryCode());
  await db.prepare('DELETE FROM admin_recovery_codes WHERE user_id = ?').bind(userId).run();
  for (const code of codes) {
    await db
      .prepare('INSERT INTO admin_recovery_codes (id, user_id, code_hash) VALUES (?, ?, ?)')
      .bind(`recovery_${crypto.randomUUID()}`, userId, await hashToken(normalizeRecoveryCode(code)))
      .run();
  }
  await db
    .prepare("UPDATE admin_users SET mfa_enabled = 1, updated_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), userId)
    .run();
  return codes;
}

async function consumeRecoveryCode(db: D1Database, userId: string, code: string): Promise<boolean> {
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length < 8) return false;
  const hash = await hashToken(normalized);
  const row = await db
    .prepare(
      "SELECT id FROM admin_recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL LIMIT 1",
    )
    .bind(userId, hash)
    .first<{ id: string }>();
  if (!row) return false;
  await db
    .prepare('UPDATE admin_recovery_codes SET used_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), row.id)
    .run();
  return true;
}

export async function createMfaChallenge(
  db: D1Database,
  userId: string,
): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + MFA_CHALLENGE_SECONDS * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO admin_mfa_challenges (id, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(`mfa_${crypto.randomUUID()}`, userId, await hashToken(token), expiresAt)
    .run();
  return { token, expiresAt };
}

export async function verifyMfaChallenge(
  db: D1Database,
  token: string,
  input: { code?: string; recoveryCode?: string; encryptionKey?: string },
): Promise<{ userId: string } | null> {
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const row = await db
    .prepare(
      `SELECT c.id, c.user_id, c.expires_at, c.attempts, u.mfa_secret, u.status
       FROM admin_mfa_challenges c JOIN admin_users u ON u.id = c.user_id
       WHERE c.token_hash = ? LIMIT 1`,
    )
    .bind(tokenHash)
    .first<{
      id: string;
      user_id: string;
      expires_at: string;
      attempts: number;
      mfa_secret: string | null;
      status: string;
    }>();
  if (!row || row.status !== 'active') return null;
  if (Date.parse(row.expires_at) <= Date.now() || Number(row.attempts) >= MFA_MAX_ATTEMPTS) {
    await db.prepare('DELETE FROM admin_mfa_challenges WHERE id = ?').bind(row.id).run();
    return null;
  }
  const code = input.code ?? '';
  const recovery = input.recoveryCode ?? '';
  const secret = row.mfa_secret ? await decryptMfaSecret(row.mfa_secret, input.encryptionKey) : null;
  const valid =
    (code && secret && (await verifyTotp(secret, code))) ||
    (recovery && (await consumeRecoveryCode(db, row.user_id, recovery)));
  if (!valid) {
    await db
      .prepare('UPDATE admin_mfa_challenges SET attempts = attempts + 1 WHERE id = ?')
      .bind(row.id)
      .run();
    return null;
  }
  await db.prepare('DELETE FROM admin_mfa_challenges WHERE id = ?').bind(row.id).run();
  return { userId: row.user_id };
}

export async function startMfaEnrollment(
  db: D1Database,
  userId: string,
  email: string,
  encryptionKey: string,
): Promise<{ secret: string; uri: string }> {
  const secret = generateTotpSecret();
  await db
    .prepare("UPDATE admin_users SET mfa_secret = ?, mfa_enabled = 0, updated_at = ? WHERE id = ?")
    .bind(await encryptMfaSecret(secret, encryptionKey), new Date().toISOString(), userId)
    .run();
  return { secret, uri: totpUri(secret, email) };
}

export async function enableMfa(
  db: D1Database,
  userId: string,
  code: string,
  encryptionKey?: string,
): Promise<string[] | null> {
  const row = await db
    .prepare('SELECT mfa_secret FROM admin_users WHERE id = ? LIMIT 1')
    .bind(userId)
    .first<{ mfa_secret: string | null }>();
  const secret = row?.mfa_secret ? await decryptMfaSecret(row.mfa_secret, encryptionKey) : null;
  if (!secret || !(await verifyTotp(secret, code))) return null;
  return createRecoveryCodes(db, userId);
}

export async function disableMfa(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare("UPDATE admin_users SET mfa_secret = NULL, mfa_enabled = 0, updated_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), userId)
    .run();
  await db.prepare('DELETE FROM admin_recovery_codes WHERE user_id = ?').bind(userId).run();
}