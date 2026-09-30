// POST /api/lead — serverless lead relay (Cloudflare Pages Functions).
//
// Responsibilities:
//  - Server-side validation and sanitization (never trust the client).
//  - Optional Cloudflare Turnstile verification when configured.
//  - Forward the lead to the configured form provider using the SERVER-side
//    access key. Secrets never appear in client bundles.
//
// The static site falls back to a direct provider submission when this
// function is not deployed (local preview) — see src/lib/forms/submit.ts.
//
// Returns:
//   200 { ok: true }
//   400 { ok: false, error: 'invalid_request' | 'verification_failed' }
//   502 { ok: false, error: 'provider_failed' }
//   503 { ok: false, error: 'not_configured' }   → client uses the fallback

interface Env {
  WEB3FORMS_ACCESS_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  WEB3FORMS_ENDPOINT?: string;
}

const MAX_FIELDS = 45;
const MAX_VALUE_LENGTH = 2000;
const MAX_SUBJECT_LENGTH = 200;
const SAFE_KEY = /^[a-z0-9_]{1,40}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function verifyTurnstile(secret: string, token: string, remoteIp: string | null): Promise<boolean> {
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (remoteIp) form.append('remoteip', remoteIp);
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    });
    if (!response.ok) return false;
    const data = (await response.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

export async function onRequestPost(context: {
  request: Request;
  env: Env;
}): Promise<Response> {
  const { request, env } = context;

  let payload: { subject?: unknown; fields?: unknown; turnstileToken?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }

  const subject =
    typeof payload.subject === 'string' ? payload.subject.trim().slice(0, MAX_SUBJECT_LENGTH) : '';
  if (!subject || typeof payload.fields !== 'object' || payload.fields === null) {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }

  // Sanitize: flat string values, safe keys, bounded counts and lengths.
  const clean: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of Object.entries(payload.fields as Record<string, unknown>)) {
    if (count >= MAX_FIELDS) break;
    if (!SAFE_KEY.test(key)) continue;
    if (typeof value !== 'string') continue;
    const trimmed = value.trim().slice(0, MAX_VALUE_LENGTH);
    if (!trimmed) continue;
    clean[key] = trimmed;
    count += 1;
  }

  // Honeypot must remain empty (defense in depth — the client strips it too).
  if (clean.company_website) return json({ ok: false, error: 'invalid_request' }, 400);

  // Require at least one contact channel.
  if (!clean.phone && !clean.email) {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }

  // Turnstile verification when the secret is configured.
  if (env.TURNSTILE_SECRET_KEY) {
    const token = typeof payload.turnstileToken === 'string' ? payload.turnstileToken : '';
    if (!token) return json({ ok: false, error: 'verification_failed' }, 400);
    const remoteIp = request.headers.get('CF-Connecting-IP');
    const verified = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, token, remoteIp);
    if (!verified) return json({ ok: false, error: 'verification_failed' }, 400);
  }

  if (!env.WEB3FORMS_ACCESS_KEY) {
    // Tell the client to use its static fallback (public key) instead.
    return json({ ok: false, error: 'not_configured' }, 503);
  }

  const endpoint = env.WEB3FORMS_ENDPOINT ?? 'https://api.web3forms.com/submit';
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        access_key: env.WEB3FORMS_ACCESS_KEY,
        subject,
        botcheck: '',
        ...clean,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as { success?: boolean };
    if (response.ok && data.success === true) {
      return json({ ok: true });
    }
    return json({ ok: false, error: 'provider_failed' }, 502);
  } catch {
    return json({ ok: false, error: 'provider_failed' }, 502);
  }
}

export async function onRequestGet(): Promise<Response> {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
