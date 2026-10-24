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
/** Whole-request ceiling across all files (Sparkling Standard 4.0 §2 hardening). */
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
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

/** Accepted photo formats, identified by magic bytes (never by extension or
 *  client-provided MIME type alone). */
export function sniffPhotoFormat(head: Uint8Array): { mime: string; ext: string } | null {
  if (head.length < 12) return null;
  // JPEG
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  // PNG
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return { mime: 'image/png', ext: 'png' };
  }
  // RIFF....WEBP
  const riff = String.fromCharCode(head[0] as number, head[1] as number, head[2] as number, head[3] as number);
  const webp = String.fromCharCode(head[8] as number, head[9] as number, head[10] as number, head[11] as number);
  if (riff === 'RIFF' && webp === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  // ISO Base Media (HEIC/HEIF): bytes 4–7 must be "ftyp" and the brand at
  // bytes 8–11 must be a HEIF-family brand. This rejects MP4-family files
  // that merely share a 4-byte box-size prefix (the Rev1 check was too loose).
  const ftyp = String.fromCharCode(head[4] as number, head[5] as number, head[6] as number, head[7] as number);
  if (ftyp === 'ftyp') {
    const brand = String.fromCharCode(head[8] as number, head[9] as number, head[10] as number, head[11] as number);
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) {
      return { mime: 'image/heic', ext: 'heic' };
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
  let totalBytes = 0;

  for (const file of files) {
    if (file.size > maxBytes) return json({ ok: false, error: 'file_too_large' }, 413);
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength > maxBytes) return json({ ok: false, error: 'file_too_large' }, 413);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) return json({ ok: false, error: 'request_too_large' }, 413);
    if (buffer.byteLength < 16) return json({ ok: false, error: 'unsupported_format' }, 415);

    const head = new Uint8Array(buffer.slice(0, 16));
    const format = sniffPhotoFormat(head);
    if (!format) return json({ ok: false, error: 'unsupported_format' }, 415);

    const key = `leads/${month}/${requestRef}/${category}-${randomKey()}.${format.ext}`;
    try {
      await bucket.put(key, buffer, {
        httpMetadata: { contentType: format.mime },
      });
      // Private metadata sidecar: preserves the ORIGINAL filename and upload
      // facts without altering the original photo bytes (owner decision:
      // metadata preservation). The sidecar is never served as an image.
      const safeName = file.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200);
      const meta = new TextEncoder().encode(
        JSON.stringify({
          originalName: safeName,
          bytes: buffer.byteLength,
          mime: format.mime,
          category,
          requestRef,
          uploadedAt: new Date().toISOString(),
        }),
      );
      await bucket.put(`${key}.meta.json`, meta.buffer as ArrayBuffer, {
        httpMetadata: { contentType: 'application/json' },
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
