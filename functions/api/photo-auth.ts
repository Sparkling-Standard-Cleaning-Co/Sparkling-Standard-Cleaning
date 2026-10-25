// Server-only HMAC helpers for private customer-photo links and owner actions.
//
// New lead notifications carry time-limited signed links (no master secret in
// the URL). The master owner token remains available for the authenticated
// cleanup endpoint through an Authorization: Bearer header.

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return toHex(new Uint8Array(signature));
}

/** Signature covers the object key and expiry together. */
export async function signPhotoLink(key: string, expiresAt: number, secret: string): Promise<string> {
  return hmacHex(secret, `${key}\n${expiresAt}`);
}

export async function verifyPhotoLink(
  key: string,
  expiresAt: number,
  signature: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!secret || !Number.isSafeInteger(expiresAt) || expiresAt <= nowSeconds) return false;
  const expected = await signPhotoLink(key, expiresAt, secret);
  return constantTimeEqual(expected, signature.toLowerCase());
}

export async function buildPhotoViewUrl(
  origin: string,
  key: string,
  secret: string,
  ttlSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const expiresAt = nowSeconds + Math.max(60, Math.floor(ttlSeconds));
  const signature = await signPhotoLink(key, expiresAt, secret);
  const params = new URLSearchParams({ key, exp: String(expiresAt), sig: signature });
  return `${origin.replace(/\/$/, '')}/api/photo-view?${params.toString()}`;
}

/** Extracts the owner master token from a Bearer header only (never a query). */
export function ownerTokenFromAuthorization(request: Request): string {
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? '';
}
