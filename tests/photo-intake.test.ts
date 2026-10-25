// Customer photo intake: server validation, private retrieval, cleanup and
// association with the lead. Providers are mocked; no network is contacted.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  onRequestGet as photoViewGet,
} from '../functions/api/photo-view.ts';
import {
  onRequestPost as photoUploadPost,
} from '../functions/api/photo-upload.ts';
import { onRequestPost as photoCleanupPost } from '../functions/api/photo-cleanup.ts';
import { buildPhotoViewUrl, signPhotoLink } from '../functions/api/photo-auth.ts';
import { onRequestPost as leadPost } from '../functions/api/lead.ts';

const JPEG = new Uint8Array(
  fs.readFileSync(fileURLToPath(new URL('../src/assets/images/bathroom-spacious.jpg', import.meta.url))),
);
const REF = 'a'.repeat(24);
const OWNER = 'test-owner-token';

function keyFor(ref = REF, category = 'bathroom', suffix = 'b'.repeat(32)) {
  return `leads/2026/10/${ref}/${category}-${suffix}.jpg`;
}

function mockBucket(options: { failAt?: number } = {}) {
  const objects = new Map<string, Uint8Array>();
  let puts = 0;
  return {
    objects,
    puts: () => puts,
    async put(key: string, value: Uint8Array | ArrayBuffer) {
      puts += 1;
      if (options.failAt && puts >= options.failAt) throw new Error('storage down');
      objects.set(key, value instanceof Uint8Array ? value : new Uint8Array(value));
    },
    async head(key: string) {
      return objects.has(key) ? {} : null;
    },
    async get(key: string) {
      const value = objects.get(key);
      return value ? { body: value, httpMetadata: { contentType: 'image/jpeg' } } : null;
    },
  };
}

async function withFetch<T>(stub: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test('uploads multiple photos, strips metadata and returns opaque keys', async () => {
  const bucket = mockBucket();
  const form = new FormData();
  form.append('request_ref', REF);
  form.append('category', 'kitchen');
  form.append('file', new File([JPEG], 'kitchen.jpg', { type: 'image/jpeg' }), 'kitchen.jpg');
  form.append('file', new File([JPEG], 'sink.jpg', { type: 'image/jpeg' }), 'sink.jpg');
  const response = await photoUploadPost({
    request: new Request('https://example.test/api/photo-upload', {
      method: 'POST',
      headers: { Origin: 'https://example.test', 'CF-Connecting-IP': '203.0.113.2' },
      body: form,
    }),
    env: { PHOTOS_BUCKET: bucket, PHOTO_OWNER_TOKEN: OWNER },
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok: boolean; photos: Array<{ key: string; name: string }> };
  assert.equal(body.ok, true);
  assert.equal(body.photos.length, 2);
  for (const photo of body.photos) {
    assert.match(photo.key, /^leads\/\d{4}\/\d{2}\/a{24}\/kitchen-[0-9a-f]{32}\.jpg$/);
    const stored = bucket.objects.get(photo.key);
    assert.ok(stored);
    assert.equal(Buffer.from(stored).includes(Buffer.from('Exif', 'ascii')), false);
    assert.ok(bucket.objects.has(`${photo.key}.meta.json`));
  }
});

test('rejects invalid files, raw HEIC and oversized input', async () => {
  const invalid = await photoUploadPost({
    request: new Request('https://example.test/api/photo-upload', {
      method: 'POST',
      headers: { Origin: 'https://example.test', 'CF-Connecting-IP': '203.0.113.3' },
      body: (() => {
        const form = new FormData();
        form.append('request_ref', REF);
        form.append('file', new File([new TextEncoder().encode('not a photo at all')], 'x.txt', { type: 'text/plain' }));
        return form;
      })(),
    }),
    env: { PHOTOS_BUCKET: mockBucket(), PHOTO_OWNER_TOKEN: OWNER },
  });
  assert.equal(invalid.status, 415);

  const heic = new Uint8Array(16);
  heic.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
  const heicResponse = await photoUploadPost({
    request: new Request('https://example.test/api/photo-upload', {
      method: 'POST',
      headers: { Origin: 'https://example.test', 'CF-Connecting-IP': '203.0.113.4' },
      body: (() => {
        const form = new FormData();
        form.append('request_ref', REF);
        form.append('file', new File([heic], 'iphone.heic', { type: 'image/heic' }));
        return form;
      })(),
    }),
    env: { PHOTOS_BUCKET: mockBucket(), PHOTO_OWNER_TOKEN: OWNER },
  });
  assert.equal(heicResponse.status, 415);
  assert.equal(((await heicResponse.json()) as { error: string }).error, 'heic_conversion_required');

  const oversized = await photoUploadPost({
    request: new Request('https://example.test/api/photo-upload', {
      method: 'POST',
      headers: { Origin: 'https://example.test', 'CF-Connecting-IP': '203.0.113.5' },
      body: (() => {
        const form = new FormData();
        form.append('request_ref', REF);
        form.append('file', new File([JPEG], 'big.jpg', { type: 'image/jpeg' }));
        return form;
      })(),
    }),
    env: { PHOTOS_BUCKET: mockBucket(), PHOTO_OWNER_TOKEN: OWNER, PHOTOS_MAX_BYTES: '1024' },
  });
  assert.equal(oversized.status, 413);
});

test('requires Turnstile when configured and reports a partial storage failure honestly', async () => {
  const noToken = await photoUploadPost({
    request: new Request('https://example.test/api/photo-upload', {
      method: 'POST',
      headers: { Origin: 'https://example.test', 'CF-Connecting-IP': '203.0.113.6' },
      body: (() => {
        const form = new FormData();
        form.append('request_ref', REF);
        form.append('file', new File([JPEG], 'room.jpg', { type: 'image/jpeg' }));
        return form;
      })(),
    }),
    env: { PHOTOS_BUCKET: mockBucket(), PHOTO_OWNER_TOKEN: OWNER, TURNSTILE_SECRET_KEY: 'turnstile-secret' },
  });
  assert.equal(noToken.status, 403);

  const verified = await withFetch(
    (async (url: string | URL) =>
      String(url).includes('challenges.cloudflare.com')
        ? new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        : new Response('unexpected', { status: 500 })) as typeof fetch,
    () => {
      const form = new FormData();
      form.append('request_ref', REF);
      form.append('turnstile_token', 'valid-token');
      form.append('file', new File([JPEG], 'room.jpg', { type: 'image/jpeg' }));
      return photoUploadPost({
        request: new Request('https://example.test/api/photo-upload', {
          method: 'POST',
          headers: { Origin: 'https://example.test', 'CF-Connecting-IP': '203.0.113.8' },
          body: form,
        }),
        env: { PHOTOS_BUCKET: mockBucket(), PHOTO_OWNER_TOKEN: OWNER, TURNSTILE_SECRET_KEY: 'turnstile-secret' },
      });
    },
  );
  assert.equal(verified.status, 200);
  const bucket = mockBucket({ failAt: 3 });
  const form = new FormData();
  form.append('request_ref', REF);
  form.append('file', new File([JPEG], 'one.jpg', { type: 'image/jpeg' }));
  form.append('file', new File([JPEG], 'two.jpg', { type: 'image/jpeg' }));
  const partial = await photoUploadPost({
    request: new Request('https://example.test/api/photo-upload', {
      method: 'POST',
      headers: { Origin: 'https://example.test', 'CF-Connecting-IP': '203.0.113.7' },
      body: form,
    }),
    env: { PHOTOS_BUCKET: bucket, PHOTO_OWNER_TOKEN: OWNER },
  });
  assert.equal(partial.status, 500);
  const body = (await partial.json()) as { ok: boolean; error: string; photos: unknown[] };
  assert.equal(body.ok, false);
  assert.equal(body.error, 'storage_failed');
  assert.equal(body.photos.length, 1, 'the genuinely stored photo is returned, not lost');
});

test('signed owner links work, expire and reject tampering', async () => {
  const key = keyFor();
  const bucket = mockBucket();
  await bucket.put(key, JPEG);
  const now = Math.floor(Date.now() / 1000);
  const valid = new URL(await buildPhotoViewUrl('https://example.test', key, OWNER, 3600, now));
  const response = await photoViewGet({
    request: new Request(valid),
    env: { PHOTOS_BUCKET: bucket, PHOTO_OWNER_TOKEN: OWNER },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');

  const tampered = new URL(valid);
  tampered.searchParams.set('sig', '0'.repeat(64));
  assert.equal((await photoViewGet({
    request: new Request(tampered),
    env: { PHOTOS_BUCKET: bucket, PHOTO_OWNER_TOKEN: OWNER },
  })).status, 403);

  const expiredExp = now - 1;
  const expiredSig = await signPhotoLink(key, expiredExp, OWNER);
  const expired = new URL('https://example.test/api/photo-view');
  expired.searchParams.set('key', key);
  expired.searchParams.set('exp', String(expiredExp));
  expired.searchParams.set('sig', expiredSig);
  assert.equal((await photoViewGet({
    request: new Request(expired),
    env: { PHOTOS_BUCKET: bucket, PHOTO_OWNER_TOKEN: OWNER },
  })).status, 403);

  const legacy = new URL('https://example.test/api/photo-view');
  legacy.searchParams.set('key', key);
  legacy.searchParams.set('t', OWNER);
  assert.equal((await photoViewGet({
    request: new Request(legacy),
    env: { PHOTOS_BUCKET: bucket, PHOTO_OWNER_TOKEN: OWNER },
  })).status, 200);
});

test('associates verified photos with the correct inquiry and uses signed links in the owner email', async () => {
  const bucket = mockBucket();
  const key = keyFor();
  const foreign = keyFor('c'.repeat(24), 'bathroom', 'd'.repeat(32));
  await bucket.put(key, JPEG);
  const captured: Array<Record<string, unknown>> = [];
  const capture = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    if (String(url).includes('api.web3forms.com')) {
      captured.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('unexpected', { status: 500 });
  };
  const request = new Request('https://example.test/api/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: 'Photo association test',
      fields: {
        request_type: 'contact',
        request_focus: 'question',
        name: 'Photo Test',
        phone: '8500000000',
        service_type: 'standard',
        photo_request_ref: REF,
        photo_keys: `bathroom:${key},bathroom:${foreign}`,
      },
    }),
  });
  const response = await withFetch(capture as typeof fetch, () =>
    leadPost({
      request,
      env: {
        WEB3FORMS_ACCESS_KEY: 'test',
        PHOTOS_BUCKET: bucket,
        PHOTO_OWNER_TOKEN: OWNER,
        PHOTO_LINK_TTL_DAYS: '30',
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as { photoCount: number }).photoCount, 1);
  const notification = captured[0] ?? {};
  assert.equal(notification['Photos - Attached'], '1 private photo (metadata stripped)');
  const links = String(notification['Photos - Private owner links'] ?? '');
  assert.match(links, /sig=/);
  assert.equal(links.includes('&t='), false);
  const note = String(notification['Photos - Note'] ?? '');
  assert.match(note, /30 days/);
});

test('cleanup requires owner authentication, supports dry runs and removes expired objects', async () => {
  const old = new Date(Date.now() - 100 * 86_400_000);
  const recent = new Date();
  const keys = [keyFor(REF, 'bathroom', '1'.repeat(32)), keyFor(REF, 'kitchen', '2'.repeat(32))];
  const deleted: string[] = [];
  const bucket = {
    async list() {
      return {
        objects: [
          { key: keys[0]!, uploaded: old },
          { key: keys[1]!, uploaded: recent },
        ],
        truncated: false,
      };
    },
    async delete(value: string | string[]) {
      deleted.push(...(Array.isArray(value) ? value : [value]));
    },
  };
  const unauthorized = await photoCleanupPost({
    request: new Request('https://example.test/api/photo-cleanup?days=90', { method: 'POST' }),
    env: { PHOTOS_BUCKET: bucket, PHOTO_OWNER_TOKEN: OWNER },
  });
  assert.equal(unauthorized.status, 401);

  const dry = await photoCleanupPost({
    request: new Request('https://example.test/api/photo-cleanup?days=90&dry=1', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OWNER}` },
    }),
    env: { PHOTOS_BUCKET: bucket, PHOTO_OWNER_TOKEN: OWNER },
  });
  assert.equal(dry.status, 200);
  assert.equal(((await dry.json()) as { eligible: number }).eligible, 1);
  assert.equal(deleted.length, 0);

  const real = await photoCleanupPost({
    request: new Request('https://example.test/api/photo-cleanup?days=90', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OWNER}` },
    }),
    env: { PHOTOS_BUCKET: bucket, PHOTO_OWNER_TOKEN: OWNER },
  });
  assert.equal(real.status, 200);
  assert.equal(((await real.json()) as { deleted: number }).deleted, 1);
  assert.deepEqual(deleted, [keys[0]]);
});
