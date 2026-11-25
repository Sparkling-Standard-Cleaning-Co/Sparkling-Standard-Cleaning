import { tipsConfig } from '../../config/tips.ts';

export type TipLinkMode = 'invoice' | 'tip';

export interface TipLinkEnv {
  TIPS_LINK_SECRET?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  PUBLIC_SITE_URL?: string;
}

interface TipTokenPayload {
  v: 1;
  invoiceId: string;
  mode: TipLinkMode;
  exp: number;
  nonce: string;
}

function secretFor(env: TipLinkEnv): string {
  return env.TIPS_LINK_SECRET?.trim() || env.STRIPE_WEBHOOK_SECRET?.trim() || '';
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export function tipLinkSecretConfigured(env: TipLinkEnv): boolean {
  return Boolean(secretFor(env));
}

export async function createInvoicePayToken(
  env: TipLinkEnv,
  invoiceId: string,
  mode: TipLinkMode,
  options: { ttlDays?: number; now?: Date } = {},
): Promise<string> {
  const secret = secretFor(env);
  if (!secret) throw new Error('tip_link_secret_not_configured');
  if (!/^[A-Za-z0-9_-]{3,120}$/.test(invoiceId)) throw new Error('invoice_id_invalid');
  const now = options.now ?? new Date();
  const ttlDays = Math.max(1, Math.min(90, options.ttlDays ?? tipsConfig.linkTtlDays));
  const payload: TipTokenPayload = {
    v: 1,
    invoiceId,
    mode: mode === 'tip' ? 'tip' : 'invoice',
    exp: Math.floor(now.getTime() / 1000) + ttlDays * 86_400,
    nonce: crypto.randomUUID(),
  };
  const encodedPayload = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    new TextEncoder().encode(encodedPayload),
  );
  return `${encodedPayload}.${base64Url(new Uint8Array(signature))}`;
}

export async function verifyInvoicePayToken(
  env: TipLinkEnv,
  token: string,
  options: { now?: Date } = {},
): Promise<{ invoiceId: string; mode: TipLinkMode; expiresAt: string } | null> {
  const secret = secretFor(env);
  if (!secret || !token || token.length > 2000) return null;
  const [encodedPayload, encodedSignature] = token.split('.');
  if (!encodedPayload || !encodedSignature) return null;
  const signature = fromBase64Url(encodedSignature);
  if (!signature) return null;
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      signature as BufferSource,
      new TextEncoder().encode(encodedPayload),
    );
  } catch {
    return null;
  }
  if (!valid) return null;
  const raw = fromBase64Url(encodedPayload);
  if (!raw) return null;
  let payload: TipTokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw)) as TipTokenPayload;
  } catch {
    return null;
  }
  if (
    payload.v !== 1 ||
    typeof payload.invoiceId !== 'string' ||
    !/^[A-Za-z0-9_-]{3,120}$/.test(payload.invoiceId) ||
    (payload.mode !== 'invoice' && payload.mode !== 'tip') ||
    !Number.isFinite(payload.exp)
  ) {
    return null;
  }
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (payload.exp <= nowSeconds) return null;
  return {
    invoiceId: payload.invoiceId,
    mode: payload.mode,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

export function invoicePayUrl(env: TipLinkEnv, token: string): string {
  const origin = (env.PUBLIC_SITE_URL?.trim() || 'https://sparkling-standard.com').replace(/\/+$/, '');
  return `${origin}/invoice-pay/?token=${encodeURIComponent(token)}`;
}

export async function createInvoicePayUrl(
  env: TipLinkEnv,
  invoiceId: string,
  mode: TipLinkMode,
): Promise<string> {
  return invoicePayUrl(env, await createInvoicePayToken(env, invoiceId, mode));
}
