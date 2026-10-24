// POST /api/photo-upload — secure customer-photo intake for cleaning
// requests (Smart Estimate directive, Part 2).
//
// Architecture:
//  - Customer photos upload DIRECTLY to this function from the estimator
//    (multipart/form-data) — provider credentials never touch the browser.
//  - Storage is a PRIVATE Cloudflare R2 bucket bound as `PHOTOS_BUCKET`.
//    Objects are never public; retrieval happens only through
//    /api/photo-view with the server-side owner token.
//  - Object keys are SERVER-GENERATED (crypto random under a per-request
//    prefix) — a guessed object name can never retrieve a file.
//  - Validation: magic-byte content sniffing (JPEG/PNG/WebP/HEIC), a hard
//    per-file size cap, and per-IP throttling. Uploaded files are never
//    executable content and are always served with a photo content type.
//  - The upload endpoint reports its own availability via GET so the client
//    can hide the photo section when R2 is not provisioned (production stays
//    disabled until uploads genuinely work end to end — owner directive).
//
// Env:
//  PHOTOS_BUCKET    — R2 bucket binding (missing ⇒ uploads disabled)
//  PHOTO_OWNER_TOKEN — secret for /api/photo-view (never in frontend code)
//  PHOTOS_MAX_BYTES — optional per-file cap override (default 8 MiB)
//
// Responses: 200 | 400 | 404 | 405 | 413 | 415 | 429 | 500 | 503

interface R2Bucket {
  put(key: string, value: ArrayBuffer | ReadableStream, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  head(key: string): Promise<unknown | null>;
}
interface Env {
  PHOTOS_BUCKET?: R2Bucket;
  PHOTO_OWNER_TOKEN?: string;
  PHOTOS_MAX_BYTES?: string;
}

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
/** Hard cap regardless of the env override — one photo never exceeds this. */
const ABSOLUTE_MAX_BYTES = 12 * 1024 * 1024;
const MAX_PER_REQUEST = 12;
const WINDOW_MS = 60_000;
const PER_IP_PER_MINUTE = 10;

const hits = new Map<string, { count: number; reset: number }>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
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

/** Accepted photo formats with their magic-byte signatures and MIME types. */
const PHOTO_FORMATS = [
  { mime: 'image/jpeg', ext: 'jpg', magic: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/webp', ext: 'webp', magic: [0x52, 0x49, 0x46, 0x46] },
  { mime: 'image/heic', ext: 'heic', magic: [0x00, 0x00, 0x00, 0x18] },
  { mime: 'image/heic', ext: 'heic', magic: [0x00, 0x00, 0x00, 0x24] },
] as const;

function sniffFormat(head: Uint8Array): { mime: string; ext: string } | null {
  for (const format of PHOTO_FORMATS) {
    if (format.magic.every((byte, index) => head[index] === byte)) {
      // RIFF is also AVI/WAV; WebP requires the "WEBP" tag at offset 8.
      if (format.mime === 'image/webp') {
        const tag = String.fromCharCode(...head.slice(8, 12));
        if (tag !== 'WEBP') continue;
      }
      return { mime: format.mime, ext: format.ext };
    }
  }
  return null;
}

function randomKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function sanitizeRef(value: string): string {
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
  return cleaned.length >= 8 ? cleaned : '';
}

const ALLOWED_CATEGORIES = new Set([
  'bathroom',
  'kitchen',
  'living_area',
  'additional',
  'bedroom',
  'laundry',
]);

function sanitizeCategory(value: string): string {
  const cleaned = value.trim().toLowerCase().slice(0, 20);
  return ALLOWED_CATEGORIES.has(cleaned as never) ? cleaned : 'additional';
}

export async function onRequestGet(context: { env: Env }): Promise<Response> {
  // Availability probe: the estimator hides the photo section when the R2
  // binding (or the owner token) is missing — production stays disabled
  // until uploads genuinely work end to end (owner directive). Nothing
  // sensitive is exposed.
  const enabled = Boolean(context.env.PHOTOS_BUCKET && context.env.PHOTO_OWNER_TOKEN);
  const maxBytes = Math.min(Number(context.env.PHOTOS_MAX_BYTES ?? '') || DEFAULT_MAX_BYTES, ABSOLUTE_MAX_BYTES);
  return json({ ok: true, enabled, maxBytes, maxCount: 6 }, 200);
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (throttled(request)) return json({ ok: false, error: 'rate_limited' }, 429);

  const bucket = env.PHOTOS_BUCKET;
  if (!bucket || !env.PHOTO_OWNER_TOKEN) {
    return json({ ok: false, error: 'photo_storage_not_configured' }, 503);
  }

  const maxBytes = Math.min(
    Number(env.PHOTOS_MAX_BYTES ?? '') || DEFAULT_MAX_BYTES,
    ABSOLUTE_MAX_BYTES,
  );

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }

  const requestRef = sanitizeRef(String(form.get('request_ref') ?? ''));
  if (!requestRef) return json({ ok: false, error: 'invalid_request' }, 400);
  const category = sanitizeCategory(String(form.get('category') ?? 'additional'));
  const files = form.getAll('file').filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) return json({ ok: false, error: 'no_file' }, 400);
  if (files.length > MAX_PER_REQUEST) return json({ ok: false, error: 'too_many_files' }, 400);

  const month = new Date().toISOString().slice(0, 7).replace('-', '/');
  const results: Array<{ key: string; category: string; bytes: number }> = [];

  for (const file of files) {
    if (file.size > maxBytes) return json({ ok: false, error: 'file_too_large' }, 413);
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength > maxBytes) return json({ ok: false, error: 'file_too_large' }, 413);
    if (buffer.byteLength < 16) return json({ ok: false, error: 'unsupported_format' }, 415);

    const head = new Uint8Array(buffer.slice(0, 16));
    const format = sniffFormat(head);
    if (!format) return json({ ok: false, error: 'unsupported_format' }, 415);

    const key = `leads/${month}/${requestRef}/${category}-${randomKey()}.${format.ext}`;
    try {
      await bucket.put(key, buffer, {
        httpMetadata: { contentType: format.mime },
      });
    } catch {
      return json({ ok: false, error: 'storage_failed' }, 500);
    }
    results.push({ key, category, bytes: buffer.byteLength });
  }

  return json({ ok: true, photos: results });
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' },
  });
}
