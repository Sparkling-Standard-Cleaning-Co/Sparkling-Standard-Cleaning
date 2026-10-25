// POST /api/photo-cleanup — owner-authenticated retention cleanup.
//
// The owner token is supplied in an Authorization: Bearer header, never a URL.
// The endpoint deletes customer-photo objects (and their private metadata
// sidecars) older than the requested retention window. This is the documented
// retention mechanism; run it manually after review or on a schedule if the
// owner later adds a scheduler.
//
// POST /api/photo-cleanup?days=90[&dry=1]
// Environment: PHOTOS_BUCKET + PHOTO_OWNER_TOKEN
// Responses: 200 | 401 | 405 | 503

interface R2Object {
  key: string;
  uploaded?: Date;
}
interface R2Bucket {
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ objects: R2Object[]; truncated: boolean; cursor?: string }>;
  delete(keys: string | string[]): Promise<void>;
}
interface Env {
  PHOTOS_BUCKET?: R2Bucket;
  PHOTO_OWNER_TOKEN?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

import { constantTimeEqual, ownerTokenFromAuthorization } from './photo-auth.ts';

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  const expected = env.PHOTO_OWNER_TOKEN ?? '';
  if (!expected || !constantTimeEqual(ownerTokenFromAuthorization(request), expected)) {
    return json({ ok: false, error: 'forbidden' }, 401);
  }
  const bucket = env.PHOTOS_BUCKET;
  if (!bucket) return json({ ok: false, error: 'photo_storage_not_configured' }, 503);

  const url = new URL(request.url);
  const parsedDays = Number(url.searchParams.get('days') ?? '90');
  const days = Number.isFinite(parsedDays) ? Math.min(365, Math.max(7, Math.floor(parsedDays))) : 90;
  const dryRun = url.searchParams.get('dry') === '1';
  const cutoff = Date.now() - days * 86_400_000;

  let cursor: string | undefined;
  let scanned = 0;
  let deleted = 0;
  let pages = 0;
  const toDelete: string[] = [];

  do {
    const page = await bucket.list({ prefix: 'leads/', limit: 500, ...(cursor ? { cursor } : {}) });
    for (const object of page.objects) {
      scanned += 1;
      if (!object.key.startsWith('leads/')) continue;
      const uploaded = object.uploaded instanceof Date ? object.uploaded.getTime() : Number.NaN;
      if (!Number.isFinite(uploaded) || uploaded >= cutoff) continue;
      toDelete.push(object.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
    pages += 1;
    if (!dryRun) {
      while (toDelete.length >= 200) {
        await bucket.delete(toDelete.splice(0, 200));
        deleted += 200;
      }
    }
    if (pages >= 20) break;
  } while (cursor);

  if (!dryRun && toDelete.length > 0) {
    const remaining = toDelete.splice(0);
    await bucket.delete(remaining);
    deleted += remaining.length;
  }

  return json({
    ok: true,
    retentionDays: days,
    dryRun,
    cutoff: new Date(cutoff).toISOString(),
    scanned,
    deleted: dryRun ? 0 : deleted,
    eligible: dryRun ? toDelete.length : deleted,
    truncated: Boolean(cursor),
  });
}

export async function onRequestGet(): Promise<Response> {
  return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
}
