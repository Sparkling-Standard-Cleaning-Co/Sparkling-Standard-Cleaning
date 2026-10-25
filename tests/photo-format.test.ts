import assert from 'node:assert/strict';
import test from 'node:test';

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { sniffPhotoFormat } from '../functions/api/photo-upload.ts';
import { sanitizePhotoBytes, stripJpegMetadata, stripPngMetadata, stripWebpMetadata } from '../functions/api/photo-utils.ts';
import { normalizePhotoEntries, PHOTO_KEY_PATTERN } from '../src/lib/photos.ts';

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

test('strips EXIF/GPS metadata from a real JPEG and keeps a decodable image', async () => {
  const source = fs.readFileSync(fileURLToPath(new URL('../src/assets/images/bathroom-spacious.jpg', import.meta.url)));
  const stripped = stripJpegMetadata(new Uint8Array(source));
  assert.ok(Buffer.from(stripped).includes(Buffer.from([0xff, 0xd8])));
  assert.equal(Buffer.from(stripped).includes(Buffer.from('Exif', 'ascii')), false);
  const meta = await sharp(Buffer.from(stripped)).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.ok((meta.width ?? 0) > 0);
});

test('strips metadata from PNG and WebP output while preserving the image', async () => {
  const base = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#dda' } })
    .jpeg()
    .toBuffer();
  for (const format of ['png', 'webp'] as const) {
    const source = await sharp(base)
      .withMetadata({ exif: { IFD0: { Copyright: 'test', Software: 'test' } } })
      .toFormat(format)
      .toBuffer();
    const stripped = format === 'png'
      ? stripPngMetadata(new Uint8Array(source))
      : stripWebpMetadata(new Uint8Array(source));
    const meta = await sharp(Buffer.from(stripped)).metadata();
    assert.equal(meta.format, format);
    assert.equal(Boolean(meta.exif), false);
    assert.equal(Buffer.from(stripped).includes(Buffer.from('Copyright', 'ascii')), false);
  }
});

test('raw HEIC is rejected with an explicit conversion-required error', () => {
  assert.throws(() => sanitizePhotoBytes(box('ftyp', 'heic')), /heic_conversion_required/);
});

test('attachment entries require the same request prefix, a valid key and category', () => {
  const ref = 'a'.repeat(24);
  const key = `leads/2026/10/${ref}/bathroom-${'b'.repeat(32)}.jpg`;
  const foreign = `leads/2026/10/${'c'.repeat(24)}/bathroom-${'d'.repeat(32)}.jpg`;
  assert.match(key, PHOTO_KEY_PATTERN);
  assert.deepEqual(normalizePhotoEntries(`bathroom:${key},bathroom:${key},kitchen:${foreign}`, ref), [
    { category: 'bathroom', key },
  ]);
  assert.deepEqual(normalizePhotoEntries(`kitchen:${key}`, ref), []);
});