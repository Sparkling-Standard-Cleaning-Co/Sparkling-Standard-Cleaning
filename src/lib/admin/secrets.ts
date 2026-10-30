const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function keyFor(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export function mfaKeyConfigured(value: string | undefined): value is string {
  return Boolean(value && value.trim().length >= 32);
}

export async function encryptMfaSecret(secret: string, encryptionKey: string): Promise<string> {
  const key = await keyFor(encryptionKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(secret),
  );
  return `v1.${b64url(iv)}.${b64url(new Uint8Array(encrypted))}`;
}

export async function decryptMfaSecret(stored: string, encryptionKey?: string): Promise<string | null> {
  if (!stored.startsWith('v1.')) return stored;
  if (!encryptionKey) return null;
  const [, ivValue, cipherValue] = stored.split('.');
  if (!ivValue || !cipherValue) return null;
  try {
    const key = await keyFor(encryptionKey);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64url(ivValue) as unknown as BufferSource },
      key,
      fromB64url(cipherValue) as unknown as BufferSource,
    );
    return decoder.decode(decrypted);
  } catch {
    return null;
  }
}
