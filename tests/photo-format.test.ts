import assert from 'node:assert/strict';
import test from 'node:test';

import { sniffPhotoFormat } from '../functions/api/photo-upload.ts';

function bytes(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function box(contentTypeTag: string, brand: string): Uint8Array {
  const head = [
    0x00, 0x00, 0x00, 0x18, // box size prefix (also the old, too-loose match)
    ...contentTypeTag.split('').map((char) => char.charCodeAt(0)),
    ...brand.split('').map((char) => char.charCodeAt(0)),
    0x00, 0x00, 0x00, 0x00,
  ];
  return bytes(head);
}

test('accepts JPEG magic bytes', () => {
  assert.deepEqual(sniffPhotoFormat(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), {
    mime: 'image/jpeg',
    ext: 'jpg',
  });
});

test('accepts PNG magic bytes', () => {
  assert.deepEqual(sniffPhotoFormat(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])), {
    mime: 'image/png',
    ext: 'png',
  });
});

test('accepts WebP only when the RIFF tag is WEBP', () => {
  const riff = (tag: string) => {
    const chars = (value: string) => value.split('').map((char) => char.charCodeAt(0));
    return bytes([...chars('RIFF'), 0x20, 0x00, 0x00, 0x00, ...chars(tag)]);
  };
  assert.deepEqual(sniffPhotoFormat(riff('WEBP')), { mime: 'image/webp', ext: 'webp' });
  assert.equal(sniffPhotoFormat(riff('AVI ')), null);
});

test('accepts HEIC-family ISO media boxes', () => {
  assert.deepEqual(sniffPhotoFormat(box('ftyp', 'heic')), { mime: 'image/heic', ext: 'heic' });
  assert.deepEqual(sniffPhotoFormat(box('ftyp', 'mif1')), { mime: 'image/heic', ext: 'heic' });
});

test('rejects MP4-family files that share the old 4-byte prefix', () => {
  // Regression: the Rev1 HEIC check matched 00 00 00 18 alone and therefore
  // accepted MP4 video. The brand must be a HEIF-family brand.
  assert.equal(sniffPhotoFormat(box('ftyp', 'isom')), null);
  assert.equal(sniffPhotoFormat(box('ftyp', 'mp42')), null);
  assert.equal(sniffPhotoFormat(box('moov', 'heic')), null);
});

test('rejects buffers too short to verify', () => {
  assert.equal(sniffPhotoFormat(bytes([0xff, 0xd8, 0xff])), null);
});
