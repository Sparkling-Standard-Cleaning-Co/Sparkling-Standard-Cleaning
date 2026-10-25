// POST /api/photo-upload — secure customer-photo intake for cleaning requests.
//
// Architecture:
//  - Customer photos upload directly to this function (multipart/form-data).
//  - Storage is a PRIVATE Cloudflare R2 bucket bound as `PHOTOS_BUCKET`.
//    Objects are never public; retrieval happens only through
//    /api/photo-view with a time-limited signed owner link.
//  - Object keys are SERVER-GENERATED (random under the request reference), so
//    a guessed object name can never retrieve a file.
//  - Data flows through `photo-utils.ts`: magic-byte identification, metadata
//    stripping (EXIF/GPS/XMP/text) and a hard cap before R2 `put`.
//  - iPhone HEIC/HEIF is converted to JPEG in the browser; raw HEIC is rejected
//    here with an explicit conversion-required response, never silently stored.
//  - Turnstile is verified when configured. The browser resets its widget after
//    each upload so the later lead submission still receives a fresh token.
//
// Env:
//  PHOTOS_BUCKET           — private R2 bucket binding
//  PHOTO_OWNER_TOKEN       — secret for signed links and owner cleanup
//  TURNSTILE_SECRET_KEY    — optional Turnstile secret for uploads
//  PHOTOS_MAX_BYTES        — optional per-file cap (default 8 MiB, hard 12 MiB)
//
// Responses: 200 | 400 | 403 | 405 | 413 | 415 | 429 | 500 | 503

import {
  PHOTO_ABSOLUTE_MAX_FILE_BYTES,
  PHOTO_MAX_COUNT,
  PHOTO_MAX_FILE_BYTES,
  PHOTO_MAX_TOTAL_BYTES,
  sanitizePhotoRequestRef,
  isPhotoCategory,
  type PhotoCategory,
} from '../../src/lib/photos.ts';
import { sanitizePhotoBytes, sniffPhotoFormat } from './photo-utils.ts';

export { sniffPhotoFormat } from './photo-utils.ts';

interface R2Bucket {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | ReadableStream,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ): Promise<unknown>;
}

interface Env {
  PHOTOS_BUCKET?: R2Bucket;
  PHOTO_OWNER_TOKEN?: string;
  TURNSTILE_SECRET_KEY?: string;
  PHOTOS_MAX_BYTES?: string;
}

const WINDOW_MS = 60_000;
const PER_IP_PER_MINUTE = 10;
const MAX_REQUEST_BYTES = PHOTO_MAX_TOTAL_BYTES + 2 * 1024 * 1024;

const hits = new Map<string, { count: number; reset: number }>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? request.headers.get('x-forwarded-for') ?? 'unknown';
}

function throttled(request: Request): boolean {
  const now = Date.now();
  const ip = clientIp(request);
  const entry = hits.get(ip);
  if (!entry || entry.reset < now) {
    hits.set(ip, { count: 1, reset: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > PER_IP_PER_MINUTE;
}

function maxBytesFor(env: Env): number {
  return Math.min(
    Number(env.PHOTOS_MAX_BYTES ?? '') || PHOTO_MAX_FILE_BYTES,
    PHOTO_ABSOLUTE_MAX_FILE_BYTES,
  );
}

async function verifyTurnstile(
  request: Request,
  token: string,
  secret: string,
): Promise<boolean> {
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token });
  const ip = clientIp(request);
  if (ip !== 'unknown') body.set('remoteip', ip);
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch {
    return false;
  }
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function onRequestGet(context: { env: Env }): Promise<Response> {
  const enabled = Boolean(context.env.PHOTOS_BUCKET && context.env.PHOTO_OWNER_TOKEN);
  return json(
    {
      ok: true,
      enabled,
      maxBytes: maxBytesFor(context.env),
      maxCount: PHOTO_MAX_COUNT,
      maxTotalBytes: PHOTO_MAX_TOTAL_BYTES,
      turnstileRequired: Boolean(context.env.TURNSTILE_SECRET_KEY),
      heic: 'client_jpeg_conversion',
    },
    200,
  );
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (!sameOrigin(request)) return json({ ok: false, error: 'origin_rejected' }, 403);
  if (throttled(request)) return json({ ok: false, error: 'rate_limited' }, 429);

  const bucket = env.PHOTOS_BUCKET;
  if (!bucket || !env.PHOTO_OWNER_TOKEN) {
    return json({ ok: false, error: 'photo_storage_not_configured' }, 503);
  }

  const declaredLength = Number(request.headers.get('Content-Length') ?? 0);
  if (declaredLength > MAX_REQUEST_BYTES) {
    return json({ ok: false, error: 'request_too_large' }, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }

  const requestRef = sanitizePhotoRequestRef(String(form.get('request_ref') ?? ''));
  if (!requestRef) return json({ ok: false, error: 'invalid_request' }, 400);

  if (env.TURNSTILE_SECRET_KEY) {
    const token = String(form.get('turnstile_token') ?? '').trim();
    if (!(await verifyTurnstile(request, token, env.TURNSTILE_SECRET_KEY))) {
      return json({ ok: false, error: 'verification_failed' }, 403);
    }
  }

  const category = String(form.get('category') ?? 'additional');
  if (!isPhotoCategory(category)) return json({ ok: false, error: 'invalid_category' }, 400);

  const files = form.getAll('file').filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) return json({ ok: false, error: 'no_file' }, 400);
  if (files.length > PHOTO_MAX_COUNT) return json({ ok: false, error: 'too_many_files' }, 400);

  const maxBytes = maxBytesFor(env);
  const prepared: Array<{ name: string; bytes: Uint8Array; mime: string; ext: string }> = [];
  let totalBytes = 0;

  // Validate and sanitise every file BEFORE writing anything. A bad file in a
  // batch never leaves a half-uploaded set that the customer cannot see.
  for (const file of files) {
    if (file.size > maxBytes) return json({ ok: false, error: 'file_too_large' }, 413);
    const buffer = new Uint8Array(await file.arrayBuffer());
    if (buffer.byteLength > maxBytes) return json({ ok: false, error: 'file_too_large' }, 413);
    if (buffer.byteLength < 16) return json({ ok: false, error: 'unsupported_format' }, 415);
    totalBytes += buffer.byteLength;
    if (totalBytes > PHOTO_MAX_TOTAL_BYTES) return json({ ok: false, error: 'request_too_large' }, 413);

    const format = sniffPhotoFormat(buffer.slice(0, 16));
    if (!format) return json({ ok: false, error: 'unsupported_format' }, 415);
    if (format.ext === 'heic') {
      return json({ ok: false, error: 'heic_conversion_required' }, 415);
    }
    let sanitized: Uint8Array;
    try {
      sanitized = sanitizePhotoBytes(buffer);
    } catch {
      return json({ ok: false, error: 'unsupported_format' }, 415);
    }
    const safeName =
      file.name
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/[\\/]/g, '')
        .slice(0, 120) || `photo.${format.ext}`;
    prepared.push({ name: safeName, bytes: sanitized, mime: format.mime, ext: format.ext });
  }

  const month = new Date().toISOString().slice(0, 7).replace('-', '/');
  const uploaded: Array<{ key: string; category: PhotoCategory; bytes: number; name: string }> = [];

  for (const file of prepared) {
    const random = crypto.getRandomValues(new Uint8Array(16));
    const suffix = Array.from(random, (byte) => byte.toString(16).padStart(2, '0')).join('');
    const key = `leads/${month}/${requestRef}/${category}-${suffix}.${file.ext}`;
    try {
      await bucket.put(key, file.bytes, {
        httpMetadata: { contentType: file.mime },
        customMetadata: { requestRef, category },
      });
      uploaded.push({ key, category, bytes: file.bytes.byteLength, name: file.name });
      const meta = new TextEncoder().encode(
        JSON.stringify({
          originalName: file.name,
          bytes: file.bytes.byteLength,
          mime: file.mime,
          category,
          requestRef,
          uploadedAt: new Date().toISOString(),
          metadataStripped: true,
        }),
      );
      await bucket.put(`${key}.meta.json`, meta, {
        httpMetadata: { contentType: 'application/json' },
      });
    } catch {
      // Return the files that genuinely reached private storage so the UI can
      // keep them attached and honestly report the partial result.
      return json(
        {
          ok: false,
          error: 'storage_failed',
          photos: uploaded,
          message: 'Some photos were stored, but not all. Please retry the remaining photos.',
        },
        500,
      );
    }
  }

  return json({ ok: true, photos: uploaded });
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, { status: 204, headers: { Allow: 'GET, POST, OPTIONS' } });
}
