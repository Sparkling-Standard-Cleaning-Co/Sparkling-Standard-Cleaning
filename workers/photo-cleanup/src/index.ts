/**
 * Daily customer-photo retention cleanup.
 *
 * The production Pages cleanup endpoint requires a GitHub secret that is not
 * configured, so this Worker performs the same narrow deletion directly from
 * the private R2 binding. It only removes server-generated customer-photo
 * objects and their metadata sidecars under leads/, never payments, booking,
 * gift, legal, agreement or document records.
 */

import { isPhotoKey, isPhotoSidecarKey } from '../../../src/lib/photos.ts';

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
  PHOTO_RETENTION_DAYS?: string;
  CLEANUP_TOKEN?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

function days(value: string | undefined): number {
  const parsed = Number(value ?? '30');
  return Number.isFinite(parsed) ? Math.min(365, Math.max(1, Math.floor(parsed))) : 30;
}

async function cleanup(
  bucket: R2Bucket,
  retentionDays: number,
  dryRun: boolean,
): Promise<{
  retentionDays: number;
  dryRun: boolean;
  cutoff: string;
  scanned: number;
  eligible: number;
  deleted: number;
  truncated: boolean;
}> {
  const cutoff = Date.now() - retentionDays * 86_400_000;
  let cursor: string | undefined;
  let scanned = 0;
  let eligible = 0;
  let deleted = 0;
  let pages = 0;
  const pending: string[] = [];

  do {
    const page = await bucket.list({
      prefix: 'leads/',
      limit: 500,
      ...(cursor ? { cursor } : {}),
    });
    for (const object of page.objects) {
      scanned += 1;
      if (!object.key.startsWith('leads/')) continue;
      if (!isPhotoKey(object.key) && !isPhotoSidecarKey(object.key)) continue;
      const uploaded = object.uploaded instanceof Date ? object.uploaded.getTime() : Number.NaN;
      if (!Number.isFinite(uploaded) || uploaded >= cutoff) continue;
      eligible += 1;
      pending.push(object.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
    pages += 1;
    if (!dryRun) {
      while (pending.length >= 200) {
        await bucket.delete(pending.splice(0, 200));
        deleted += 200;
      }
    }
    if (pages >= 20) break;
  } while (cursor);

  if (!dryRun && pending.length > 0) {
    const remaining = pending.splice(0);
    await bucket.delete(remaining);
    deleted += remaining.length;
  }
  return {
    retentionDays,
    dryRun,
    cutoff: new Date(cutoff).toISOString(),
    scanned,
    eligible,
    deleted: dryRun ? 0 : deleted,
    truncated: Boolean(cursor),
  };
}

async function authorized(request: Request, env: Env): Promise<boolean> {
  const token = env.CLEANUP_TOKEN?.trim();
  if (!token) return false;
  const provided = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (provided.length !== token.length) return false;
  let mismatch = 0;
  for (let index = 0; index < token.length; index += 1) {
    mismatch |= provided.charCodeAt(index) ^ token.charCodeAt(index);
  }
  return mismatch === 0;
}

export default {
  async scheduled(_controller: unknown, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (!env.PHOTOS_BUCKET) {
      console.error('[photo-cleanup] bucket_not_configured');
      return;
    }
    const result = await cleanup(env.PHOTOS_BUCKET, days(env.PHOTO_RETENTION_DAYS), false);
    console.log('[photo-cleanup] complete', result);
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    if (!(await authorized(request, env))) {
      return new Response(JSON.stringify({ ok: false, error: 'forbidden' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }
    if (!env.PHOTOS_BUCKET) {
      return new Response(JSON.stringify({ ok: false, error: 'bucket_not_configured' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }
    const url = new URL(request.url);
    const result = await cleanup(
      env.PHOTOS_BUCKET,
      days(url.searchParams.get('days') ?? env.PHOTO_RETENTION_DAYS),
      url.searchParams.get('dry') === '1',
    );
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  },
};
