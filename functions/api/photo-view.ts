// GET /api/photo-view — PRIVATE owner-only retrieval of customer photos
// (Smart Estimate directive, Part 2).
//
// Objects live in a private R2 bucket and are NEVER public. Retrieval
// requires the server-side owner token (`PHOTO_OWNER_TOKEN`) — the same
// secret lead.ts embeds in the owner notification's private links. The
// token exists only in the function environment and the owner's email; it
// is never in frontend code, and photos are served with a fixed photo
// content type (no content sniffing, no executable content).
//
// GET ?key=<storage key>&t=<owner token>
// Responses: 200 (photo bytes) | 400 | 404 | 405 | 403 (bad token)

interface R2Object {
  body: ArrayBuffer | ReadableStream;
  httpMetadata?: { contentType?: string };
  size?: number;
  uploaded?: Date;
}
interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
}
interface Env {
  PHOTOS_BUCKET?: R2Bucket;
  PHOTO_OWNER_TOKEN?: string;
}

const KEY_PATTERN = /^leads\/\d{4}\/\d{2}\/[a-z0-9-]{8,40}\/[a-z]+-[0-9a-f]{32}\.(jpg|png|webp|heic)$/;

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const key = url.searchParams.get('key') ?? '';
  const token = url.searchParams.get('t') ?? '';

  if (!KEY_PATTERN.test(key)) {
    return new Response('Not found', { status: 404 });
  }
  // Timing-safe-enough comparison: constant-length compare on the encoded
  // strings. A missing or wrong token never reads the bucket.
  const expected = env.PHOTO_OWNER_TOKEN ?? '';
  if (!expected || token.length !== expected.length) {
    return new Response('Forbidden', { status: 403 });
  }
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (mismatch !== 0) return new Response('Forbidden', { status: 403 });

  const bucket = env.PHOTOS_BUCKET;
  if (!bucket) return new Response('Not found', { status: 404 });
  const object = await bucket.get(key).catch(() => null);
  if (!object) return new Response('Not found', { status: 404 });

  const ext = key.split('.').pop() ?? 'jpg';
  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': MIME_BY_EXT[ext] ?? 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function onRequestPost(): Promise<Response> {
  return new Response('Method not allowed', { status: 405 });
}
