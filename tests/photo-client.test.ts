// Browser-side photo preparation: limits, explicit invalid-file feedback and
// iPhone HEIC conversion. The converter is injected so this runs under Node
// without a browser image decoder.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isHeicFile,
  preparePhotoFiles,
  validatePhotoFile,
} from '../src/lib/photo-files.ts';

function blobFile(name: string, type: string, bytes = 2048): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

test('identifies iPhone HEIC by MIME and extension', () => {
  assert.equal(isHeicFile(blobFile('IMG_0001.HEIC', 'image/heic')), true);
  assert.equal(isHeicFile(blobFile('IMG_0001.heif', '')), true);
  assert.equal(isHeicFile(blobFile('room.jpg', 'image/jpeg')), false);
});

test('rejects unsupported and oversized photo files', () => {
  assert.match(validatePhotoFile(blobFile('notes.txt', 'text/plain'), 8 * 1024 * 1024) ?? '', /Unsupported/);
  assert.match(validatePhotoFile(blobFile('room.jpg', 'image/jpeg'), 1024) ?? '', /too large/);
  assert.equal(validatePhotoFile(blobFile('room.jpg', 'image/jpeg'), 8 * 1024 * 1024), null);
});

test('converts HEIC to JPEG and keeps the original filename stem', async () => {
  const heic = blobFile('IMG_1234.HEIC', 'image/heic');
  const converted = await preparePhotoFiles([heic], {}, async () => new Blob([new Uint8Array(4096)], { type: 'image/jpeg' }));
  assert.equal(converted.errors.length, 0);
  assert.equal(converted.accepted.length, 1);
  assert.equal(converted.accepted[0]?.name, 'IMG_1234.jpg');
  assert.equal(converted.accepted[0]?.type, 'image/jpeg');
});

test('reports a failed HEIC conversion instead of silently dropping it', async () => {
  const heic = blobFile('IMG_1234.HEIC', 'image/heic');
  const converted = await preparePhotoFiles([heic], {}, async () => {
    throw new Error('decoder unavailable');
  });
  assert.equal(converted.accepted.length, 0);
  assert.equal(converted.errors.length, 1);
  assert.match(converted.errors[0] ?? '', /Most Compatible|JPEG/);
});

test('enforces the count and total-size limits across a selection', async () => {
  const files = Array.from({ length: 8 }, (_, index) => blobFile(`room-${index}.jpg`, 'image/jpeg'));
  const countLimited = await preparePhotoFiles(files, { maxCount: 3 });
  assert.equal(countLimited.accepted.length, 3);
  assert.match(countLimited.errors.join(' '), /Up to 3 photos/);

  const totalLimited = await preparePhotoFiles(
    [blobFile('a.jpg', 'image/jpeg', 1500), blobFile('b.jpg', 'image/jpeg', 1500)],
    { maxTotalBytes: 2500 },
  );
  assert.equal(totalLimited.accepted.length, 1);
  assert.match(totalLimited.errors.join(' '), /total limit/);
});
