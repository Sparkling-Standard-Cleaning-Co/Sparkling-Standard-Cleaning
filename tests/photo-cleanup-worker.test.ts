// Photo-retention Worker safety: only server-generated customer photos and
// sidecars under leads/ may ever be deleted.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../workers/photo-cleanup/src/index.ts';

class FakeR2 {
  readonly objects: Array<{ key: string; uploaded: Date }>;
  readonly deleted: string[] = [];
  constructor(objects: Array<{ key: string; uploaded: Date }>) {
    this.objects = objects;
  }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const prefix = options.prefix ?? '';
    const rows = this.objects.filter((object) => object.key.startsWith(prefix));
    return { objects: rows, truncated: false };
  }
  async delete(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    this.deleted.push(...list);
    for (const key of list) {
      const index = this.objects.findIndex((object) => object.key === key);
      if (index >= 0) this.objects.splice(index, 1);
    }
  }
}

const old = new Date(Date.now() - 40 * 86_400_000);
const fresh = new Date(Date.now() - 2 * 86_400_000);

function bucket() {
  return new FakeR2([
    {
      key: 'leads/2026/09/abcdefgh/bathroom-0123456789abcdef0123456789abcdef.jpg',
      uploaded: old,
    },
    {
      key: 'leads/2026/09/abcdefgh/bathroom-0123456789abcdef0123456789abcdef.jpg.meta.json',
      uploaded: old,
    },
    {
      key: 'leads/2026/11/abcdefgh/kitchen-0123456789abcdef0123456789abcdef.jpg',
      uploaded: fresh,
    },
    { key: 'payments/checkouts/abc.json', uploaded: old },
    { key: 'legal/acceptances/2026-09-01/abc.json', uploaded: old },
    { key: 'agreements/signed/abc.pdf', uploaded: old },
  ]);
}

function request(token = 'test-token', query = '?days=30&dry=1') {
  return new Request(`https://cleanup.example.test/${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

test('dry run reports eligible photos without deleting anything', async () => {
  const r2 = bucket();
  const response = await worker.fetch(request(), {
    PHOTOS_BUCKET: r2,
    CLEANUP_TOKEN: 'test-token',
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    dryRun: boolean;
    eligible: number;
    deleted: number;
  };
  assert.equal(body.dryRun, true);
  assert.equal(body.eligible, 2);
  assert.equal(body.deleted, 0);
  assert.equal(r2.deleted.length, 0);
});

test('real cleanup deletes only old photo objects and sidecars', async () => {
  const r2 = bucket();
  const response = await worker.fetch(request('test-token', '?days=30'), {
    PHOTOS_BUCKET: r2,
    CLEANUP_TOKEN: 'test-token',
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { deleted: number };
  assert.equal(body.deleted, 2);
  assert.deepEqual(
    r2.deleted.sort(),
    [
      'leads/2026/09/abcdefgh/bathroom-0123456789abcdef0123456789abcdef.jpg',
      'leads/2026/09/abcdefgh/bathroom-0123456789abcdef0123456789abcdef.jpg.meta.json',
    ].sort(),
  );
  assert.ok(r2.objects.some((object) => object.key.startsWith('payments/')));
  assert.ok(r2.objects.some((object) => object.key.startsWith('legal/')));
  assert.ok(r2.objects.some((object) => object.key.startsWith('agreements/')));
  assert.ok(r2.objects.some((object) => object.key.includes('kitchen-')));
});

test('the cleanup endpoint rejects missing or wrong tokens', async () => {
  const r2 = bucket();
  assert.equal(
    (await worker.fetch(request('wrong'), { PHOTOS_BUCKET: r2, CLEANUP_TOKEN: 'test-token' })).status,
    401,
  );
  assert.equal(
    (await worker.fetch(new Request('https://cleanup.example.test/'), {
      PHOTOS_BUCKET: r2,
      CLEANUP_TOKEN: 'test-token',
    })).status,
    401,
  );
});

test('the scheduled handler uses the same narrow deletion rules', async () => {
  const r2 = bucket();
  await worker.scheduled({}, { PHOTOS_BUCKET: r2, CLEANUP_TOKEN: 'test-token' }, { waitUntil() {} });
  assert.equal(r2.deleted.length, 2);
});
