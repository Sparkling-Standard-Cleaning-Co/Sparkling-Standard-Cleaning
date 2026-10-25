// GET /api/photo-view — PRIVATE owner-only retrieval of customer photos.
//
// Objects live in a private R2 bucket and are NEVER public. New links carry a
// time-limited HMAC signature (`exp` + `sig`) generated when the lead
// notification is built. The legacy master-token query (`t=`) remains accepted
// only for already-delivered owner emails; new links never contain it.
//
// GET ?key=<storage key>&exp=<unix seconds>&sig=<hmac>
// GET ?key=<storage key>&t=<owner token>   (legacy owner emails only)
// Responses: 200 (photo bytes) | 400 | 403 | 404 | 405

import { isPhotoKey } from '../../src/lib/photos.ts';
import {
  constantTimeEqual,
  verifyPhotoLink,
} from './photo-auth.ts';

interface R2Object {
  body: ArrayBuffer | ReadableStream;
  httpMetadata?: { contentType?: string };
}
interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
}
interface Env {
  PHOTOS_BUCKET?: R2Bucket;
  PHOTO_OWNER_TOKEN?: string;
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};

function deny(status: number, body = 'Not found'): Response {
  return new Response(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const key = url.searchParams.get('key') ?? '';
  if (!isPhotoKey(key)) return deny(404);

  const secret = env.PHOTO_OWNER_TOKEN ?? '';
  if (!secret) return deny(403, 'Forbidden');

  const signature = url.searchParams.get('sig') ?? '';
  const expiresAt = Number(url.searchParams.get('exp') ?? '');
  const legacyToken = url.searchParams.get('t') ?? '';
  let authorized = false;
  if (signature) {
    authorized = await verifyPhotoLink(key, expiresAt, signature, secret);
  } else if (legacyToken) {
    authorized = constantTimeEqual(legacyToken, secret);
  }
  if (!authorized) return deny(403, 'Forbidden');

  const bucket = env.PHOTOS_BUCKET;
  if (!bucket) return deny(404);
  const object = await bucket.get(key).catch(() => null);
  if (!object) return deny(404);

  const ext = key.split('.').pop() ?? 'jpg';
  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': MIME_BY_EXT[ext] ?? 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': 'inline',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function onRequestPost(): Promise<Response> {
  return new Response('Method not allowed', {
    status: 405,
    headers: { Allow: 'GET', 'Cache-Control': 'no-store' },
  });
}
