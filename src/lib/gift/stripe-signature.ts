// Stripe webhook signature verification (WebCrypto, dependency-free).
//
// Stripe sends `Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>…]`. The signed
// payload is `<t>.<raw body>` with HMAC-SHA256 using the webhook secret.
// Verification is constant-time and timestamp-bounded so a captured header
// cannot be replayed indefinitely.

export interface SignatureResult {
  ok: boolean;
  reason?: 'missing' | 'malformed' | 'expired' | 'mismatch';
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

export async function verifyStripeSignature(
  payload: string,
  signatureHeader: string | null,
  secret: string,
  options: { toleranceSeconds?: number; nowMs?: number } = {},
): Promise<SignatureResult> {
  const tolerance = options.toleranceSeconds ?? 300;
  const nowMs = options.nowMs ?? Date.now();
  if (!signatureHeader) return { ok: false, reason: 'missing' };

  const parts = signatureHeader.split(',');
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key === 't' && value) timestamp = Number(value);
    if (key === 'v1' && value) signatures.push(value);
  }
  if (timestamp === null || !Number.isFinite(timestamp) || signatures.length === 0) {
    return { ok: false, reason: 'malformed' };
  }
  if (Math.abs(nowMs / 1000 - timestamp) > tolerance) {
    return { ok: false, reason: 'expired' };
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`)));
  for (const candidate of signatures) {
    if (constantTimeEqual(digest, candidate.toLowerCase())) return { ok: true };
  }
  return { ok: false, reason: 'mismatch' };
}
