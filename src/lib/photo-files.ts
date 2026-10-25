// Browser-side photo file preparation, kept separate from DOM/UI code so the
// HEIC conversion and limit behavior can be tested under Node.
//
// The server remains authoritative: it re-checks magic bytes, limits and
// metadata. This module only improves the customer experience and converts
// iPhone HEIC photos to a clean JPEG before network transfer.

import {
  PHOTO_MAX_COUNT,
  PHOTO_MAX_FILE_BYTES,
  PHOTO_MAX_TOTAL_BYTES,
} from './photos.ts';

export interface PreparedPhotoFiles {
  accepted: File[];
  errors: string[];
}

export interface PhotoFileLimits {
  maxBytes?: number;
  maxCount?: number;
  maxTotalBytes?: number;
}

const ACCEPTED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']);
const ACCEPTED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);

function extensionOf(name: string): string {
  const parts = name.toLowerCase().split('.');
  return parts.length > 1 ? (parts.pop() as string) : '';
}

export function isHeicFile(file: File): boolean {
  const type = file.type.toLowerCase();
  return (
    type === 'image/heic' ||
    type === 'image/heif' ||
    type === 'image/heic-sequence' ||
    type === 'image/heif-sequence' ||
    ['heic', 'heif'].includes(extensionOf(file.name))
  );
}

/** Client-side pre-validation. Never trusts the browser MIME alone. */
export function validatePhotoFile(file: File, maxBytes = PHOTO_MAX_FILE_BYTES): string | null {
  const ext = extensionOf(file.name);
  if (!ACCEPTED_EXTENSIONS.has(ext) && !ACCEPTED_MIME.has(file.type.toLowerCase())) {
    return 'Unsupported file type — please use a JPEG, PNG, WebP or iPhone HEIC photo.';
  }
  if (file.size > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024));
    return `That photo is too large — please keep each photo under ${mb}MB.`;
  }
  if (file.size < 1024) {
    return 'That file looks empty — please choose a real photo.';
  }
  return null;
}

export type HeicConverter = (file: File) => Promise<Blob>;

/** Default iPhone conversion. Loaded lazily so ordinary uploads stay light. */
export async function defaultHeicConverter(file: File): Promise<Blob> {
  const module = await import('heic2any');
  const output = await module.default({ blob: file, toType: 'image/jpeg', quality: 0.86 });
  const blob = Array.isArray(output) ? output[0] : output;
  if (!blob) throw new Error('heic_conversion_failed');
  return blob;
}

function convertedFile(blob: Blob, original: File): File {
  const base = original.name.replace(/\.(heic|heif)$/i, '');
  return new File([blob], `${base || 'iphone-photo'}.jpg`, { type: 'image/jpeg' });
}

/**
 * Validates and converts selected files. HEIC failures are explicit and
 * actionable, never silent; ordinary JPEG/PNG/WebP files pass through.
 */
export async function preparePhotoFiles(
  files: File[],
  limits: PhotoFileLimits = {},
  convertHeic: HeicConverter = defaultHeicConverter,
): Promise<PreparedPhotoFiles> {
  const maxBytes = limits.maxBytes ?? PHOTO_MAX_FILE_BYTES;
  const maxCount = limits.maxCount ?? PHOTO_MAX_COUNT;
  const maxTotalBytes = limits.maxTotalBytes ?? PHOTO_MAX_TOTAL_BYTES;
  const accepted: File[] = [];
  const errors: string[] = [];
  let total = 0;

  for (const file of files) {
    let prepared = file;
    if (isHeicFile(file)) {
      try {
        prepared = convertedFile(await convertHeic(file), file);
      } catch {
        errors.push(
          `${file.name}: this iPhone HEIC photo could not be converted. In iPhone Settings → Camera → Formats, choose “Most Compatible”, or export the photo as JPEG and try again.`,
        );
        continue;
      }
    }
    const problem = validatePhotoFile(prepared, maxBytes);
    if (problem) {
      errors.push(`${file.name}: ${problem}`);
      continue;
    }
    if (accepted.length >= maxCount) {
      errors.push(`Up to ${maxCount} photos at a time. Remove one before adding another.`);
      break;
    }
    total += prepared.size;
    if (total > maxTotalBytes) {
      errors.push(
        `Those photos exceed the ${Math.round(maxTotalBytes / (1024 * 1024))}MB total limit. Try fewer or smaller photos.`,
      );
      break;
    }
    accepted.push(prepared);
  }
  return { accepted, errors };
}
