// Customer photo uploads for cleaning requests (Smart Estimate directive,
// Part 2). The estimator exposes this ONLY when the server reports that the
// private R2 storage backend is provisioned (GET /api/photo-upload →
// enabled). Until then the section stays hidden and nothing pretends to work.
//
// Security/UX rules:
//  - Files upload directly to /api/photo-upload (server-generated private
//    keys; no public URLs, no credentials in the browser).
//  - Client-side pre-validation mirrors the server: photo formats only
//    (JPEG/PNG/WebP/HEIC), a per-file size cap, a per-request photo cap.
//  - HEIC from iPhones uploads as-is: the server accepts and stores it for
//    the owner's review (modern Windows/macOS browsers display HEIC; a
//    conversion path can be added later without changing the interface).
//  - Uploads happen once per file and are preserved across wizard steps;
//    removing a photo only forgets its reference (storage cleanup is the
//    documented retention process — see docs/operations/PHOTO-UPLOADS.md).
//  - A failed upload is never reported as a success.

export type PhotoCategory = 'bathroom' | 'kitchen' | 'living_area' | 'additional' | 'bedroom' | 'laundry';

export interface UploadedPhoto {
  /** Server-generated private storage key. */
  key: string;
  category: PhotoCategory;
  /** Local object-URL preview (never uploaded anywhere). */
  previewUrl: string;
  label: string;
  bytes: number;
}

export interface PhotoUploadConfig {
  enabled: boolean;
  maxBytes: number;
  maxCount: number;
}

export const DEFAULT_PHOTO_CONFIG: PhotoUploadConfig = {
  enabled: false,
  maxBytes: 8 * 1024 * 1024,
  maxCount: 6,
};

const ACCEPTED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']);

function extensionOf(name: string): string {
  const parts = name.toLowerCase().split('.');
  return parts.length > 1 ? (parts.pop() as string) : '';
}

/** Fetch the server's upload availability + limits. Never throws. */
export async function fetchPhotoUploadConfig(): Promise<PhotoUploadConfig> {
  try {
    const response = await fetch('/api/photo-upload', { method: 'GET' });
    if (!response.ok) return { ...DEFAULT_PHOTO_CONFIG };
    const data = (await response.json()) as { enabled?: boolean; maxBytes?: number; maxCount?: number };
    return {
      enabled: data.enabled === true,
      maxBytes: Number(data.maxBytes) > 0 ? Number(data.maxBytes) : DEFAULT_PHOTO_CONFIG.maxBytes,
      maxCount: Number(data.maxCount) > 0 ? Number(data.maxCount) : DEFAULT_PHOTO_CONFIG.maxCount,
    };
  } catch {
    return { ...DEFAULT_PHOTO_CONFIG };
  }
}

/** Client-side pre-validation (the server re-validates everything). */
export function validatePhotoFile(file: File, maxBytes: number): string | null {
  const ext = extensionOf(file.name);
  if (!ACCEPTED_EXTENSIONS.has(ext) && !file.type.startsWith('image/')) {
    return 'Unsupported file type — please use a JPEG, PNG, WebP or HEIC photo.';
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

export interface PhotoUploadResult {
  ok: boolean;
  photos?: UploadedPhoto[];
  error?: 'rate_limited' | 'file_too_large' | 'unsupported_format' | 'storage_failed' | 'no_file' | 'network';
}

/**
 * Uploads files for one category to the private store. Uses XMLHttpRequest
 * for real progress reporting (fetch cannot report upload progress).
 */
export function uploadPhotos(
  files: File[],
  category: PhotoCategory,
  requestRef: string,
  onProgress: (percent: number) => void,
): Promise<PhotoUploadResult> {
  return new Promise((resolve) => {
    const form = new FormData();
    form.append('request_ref', requestRef);
    form.append('category', category);
    for (const file of files) form.append('file', file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/photo-upload');
    xhr.responseType = 'json';
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    xhr.addEventListener('load', () => {
      const body = (xhr.response ?? {}) as { ok?: boolean; photos?: Array<{ key: string; category: string; bytes: number }>; error?: string };
      if (xhr.status === 200 && body.ok && Array.isArray(body.photos)) {
        resolve({
          ok: true,
          photos: body.photos.map((photo) => ({
            key: photo.key,
            category: photo.category as PhotoCategory,
            previewUrl: '',
            label: '',
            bytes: photo.bytes,
          })),
        });
        return;
      }
      const error = (body.error ?? 'network') as PhotoUploadResult['error'];
      resolve({ ok: false, error: error === 'rate_limited' || error === 'file_too_large' || error === 'unsupported_format' || error === 'storage_failed' || error === 'no_file' ? error : 'storage_failed' });
    });
    xhr.addEventListener('error', () => resolve({ ok: false, error: 'network' }));
    xhr.send(form);
  });
}

/** The lead's random reference — generated once per page load. */
export function newRequestRef(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** `photo_keys` submission payload: "category:key" pairs. */
export function photoKeysField(photos: UploadedPhoto[]): string {
  return photos.map((photo) => `${photo.category}:${photo.key}`).join(',');
}
