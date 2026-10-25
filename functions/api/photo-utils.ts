// Server-only photo parsing and metadata sanitisation.
//
// The browser is untrusted. The upload endpoint identifies formats by magic
// bytes, strips common metadata containers (including GPS/EXIF/XMP) before the
// bytes ever reach R2, and rejects raw HEIC/HEIF because the customer UI
// converts iPhone photos to a clean JPEG first.

export interface PhotoFormat {
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';
  ext: 'jpg' | 'png' | 'webp' | 'heic';
}

/** Accepted formats, identified by magic bytes (never by filename/MIME alone). */
export function sniffPhotoFormat(head: Uint8Array): PhotoFormat | null {
  if (head.length < 12) return null;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return { mime: 'image/png', ext: 'png' };
  }
  const riff = String.fromCharCode(head[0] as number, head[1] as number, head[2] as number, head[3] as number);
  const webp = String.fromCharCode(head[8] as number, head[9] as number, head[10] as number, head[11] as number);
  if (riff === 'RIFF' && webp === 'WEBP') return { mime: 'image/webp', ext: 'webp' };

  const ftyp = String.fromCharCode(head[4] as number, head[5] as number, head[6] as number, head[7] as number);
  if (ftyp === 'ftyp') {
    const brand = String.fromCharCode(head[8] as number, head[9] as number, head[10] as number, head[11] as number);
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) {
      return { mime: 'image/heic', ext: 'heic' };
    }
  }
  return null;
}

function malformed(): never {
  throw new Error('malformed_photo');
}

/**
 * Removes APP1 (EXIF/XMP), APP13 (IPTC) and COM metadata from a JPEG while
 * preserving the image stream. Entropy data after SOS is copied verbatim, so
 * progressive and baseline JPEGs both survive.
 */
function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Removes APP1 (EXIF/XMP), APP13 (IPTC) and COM metadata from a JPEG while
 * preserving the image stream. Entropy data after SOS is copied verbatim, so
 * progressive and baseline JPEGs both survive.
 */
export function stripJpegMetadata(input: Uint8Array): Uint8Array {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) malformed();
  const chunks: Uint8Array[] = [Uint8Array.of(0xff, 0xd8)];
  let offset = 2;
  while (offset < input.length) {
    if (input[offset] !== 0xff) malformed();
    while (offset < input.length && input[offset] === 0xff) offset += 1;
    if (offset >= input.length) malformed();
    const marker = input[offset] as number;
    offset += 1;

    if (marker === 0xd9) {
      chunks.push(Uint8Array.of(0xff, 0xd9));
      return concatChunks(chunks);
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      chunks.push(Uint8Array.of(0xff, marker));
      continue;
    }
    if (offset + 2 > input.length) malformed();
    const length = ((input[offset] as number) << 8) | (input[offset + 1] as number);
    if (length < 2 || offset + length > input.length) malformed();
    const end = offset + length;

    if (marker === 0xda) {
      chunks.push(Uint8Array.of(0xff, 0xda), input.subarray(offset, end), input.subarray(end));
      return concatChunks(chunks);
    }

    // APP1 (EXIF/XMP), APP13 (IPTC) and comments can carry location/author
    // metadata. Everything else (including ICC APP2 and JFIF APP0) is kept.
    const strip = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!strip) chunks.push(Uint8Array.of(0xff, marker), input.subarray(offset, end));
    offset = end;
  }
  malformed();
}
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] as number) << 24) |
    ((bytes[offset + 1] as number) << 16) |
    ((bytes[offset + 2] as number) << 8) |
    (bytes[offset + 3] as number)
  ) >>> 0;
}

/** Removes PNG text, time and EXIF chunks; colour chunks and pixels remain. */
export function stripPngMetadata(input: Uint8Array): Uint8Array {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (input.length < 8 || signature.some((byte, index) => input[index] !== byte)) malformed();
  const chunks: Uint8Array[] = [Uint8Array.from(signature)];
  let offset = 8;
  let sawEnd = false;
  const remove = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
  while (offset + 12 <= input.length) {
    const length = u32be(input, offset);
    if (length > input.length - offset - 12) malformed();
    const type = String.fromCharCode(
      input[offset + 4] as number,
      input[offset + 5] as number,
      input[offset + 6] as number,
      input[offset + 7] as number,
    );
    const end = offset + 12 + length;
    if (!remove.has(type)) chunks.push(input.subarray(offset, end));
    if (type === 'IEND') {
      sawEnd = true;
      break;
    }
    offset = end;
  }
  if (!sawEnd) malformed();
  return concatChunks(chunks);
}

function u32le(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] as number) |
    ((bytes[offset + 1] as number) << 8) |
    ((bytes[offset + 2] as number) << 16) |
    ((bytes[offset + 3] as number) << 24)
  ) >>> 0;
}

function writeU32le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

/** Removes WebP EXIF/XMP chunks and clears the matching VP8X feature flags. */
export function stripWebpMetadata(input: Uint8Array): Uint8Array {
  if (input.length < 16) malformed();
  const riff = String.fromCharCode(input[0] as number, input[1] as number, input[2] as number, input[3] as number);
  const webp = String.fromCharCode(input[8] as number, input[9] as number, input[10] as number, input[11] as number);
  if (riff !== 'RIFF' || webp !== 'WEBP') malformed();

  const chunks: Uint8Array[] = [];
  let offset = 12;
  while (offset + 8 <= input.length) {
    const type = String.fromCharCode(
      input[offset] as number,
      input[offset + 1] as number,
      input[offset + 2] as number,
      input[offset + 3] as number,
    );
    const size = u32le(input, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    if (size > input.length - dataStart) malformed();
    const paddedEnd = dataEnd + (size % 2);
    if (paddedEnd > input.length) malformed();
    if (type !== 'EXIF' && type !== 'XMP ') {
      const chunk = input.slice(offset, paddedEnd);
      if (type === 'VP8X' && size >= 1) chunk[8] = ((chunk[8] as number) & ~0x0c) & 0xff;
      chunks.push(chunk);
    }
    offset = paddedEnd;
  }
  if (offset !== input.length) malformed();

  const body = concatChunks(chunks);
  const riffSize = 4 + body.length;
  return concatChunks([
    new TextEncoder().encode('RIFF'),
    Uint8Array.from(writeU32le(riffSize)),
    new TextEncoder().encode('WEBP'),
    body,
  ]);
}

/**
 * Validates supported photo bytes and returns a metadata-stripped copy. Raw
 * HEIC/HEIF is rejected: the browser converts it to JPEG first so the server
 * never has to trust a HEIF metadata container it cannot sanitise.
 */
export function sanitizePhotoBytes(input: Uint8Array): Uint8Array {
  const format = sniffPhotoFormat(input.slice(0, 16));
  if (!format) throw new Error('unsupported_format');
  if (format.ext === 'heic') throw new Error('heic_conversion_required');
  if (format.ext === 'jpg') return stripJpegMetadata(input);
  if (format.ext === 'png') return stripPngMetadata(input);
  return stripWebpMetadata(input);
}

// Re-export the CRC helper for focused tests/documentation.
export { crc32 };
