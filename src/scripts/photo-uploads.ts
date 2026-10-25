// Shared customer photo controller for all four estimate engines.
//
// The section is rendered by `PhotoUploadSection.astro` and initialized here.
// It stays hidden until GET /api/photo-upload confirms private R2 storage is
// genuinely available. Browser validation is a convenience; the function
// re-checks magic bytes, limits, metadata and Turnstile server-side.
//
// HEIC/HEIF: iPhone photos are converted to JPEG in the browser (heic2any)
// before upload. If conversion is unavailable or fails, the customer receives
// an explicit instruction instead of a silent failure. Raw HEIC never reaches
// R2, so the server never stores a HEIF metadata container it cannot sanitise.
//
// Attachments are held in controller state (not the DOM), so Back/Continue
// never loses them. Removing a photo forgets its reference; retention cleanup
// is documented in docs/operations/PHOTO-UPLOADS.md.

import {
  PHOTO_ENGINE_COPY,
  PHOTO_MAX_COUNT,
  PHOTO_MAX_FILE_BYTES,
  PHOTO_MAX_TOTAL_BYTES,
  PHOTO_CATEGORY_OPTIONS,
  photoKeysField,
  type PhotoCategory,
  type PhotoEngine,
} from '../lib/photos';
import { resetTurnstile, waitForTurnstileToken } from '../lib/forms/submit';
import {
  defaultHeicConverter,
  isHeicFile,
  preparePhotoFiles,
  validatePhotoFile,
  type HeicConverter,
  type PreparedPhotoFiles,
} from '../lib/photo-files';

export {
  defaultHeicConverter,
  isHeicFile,
  preparePhotoFiles,
  validatePhotoFile,
  type HeicConverter,
  type PreparedPhotoFiles,
};

export type { PhotoCategory, PhotoEngine };

export interface UploadedPhoto {
  key: string;
  category: PhotoCategory;
  previewUrl: string;
  label: string;
  bytes: number;
}

export interface PhotoUploadConfig {
  enabled: boolean;
  maxBytes: number;
  maxCount: number;
  maxTotalBytes: number;
  turnstileRequired: boolean;
}

export interface PhotoUploadResult {
  ok: boolean;
  photos?: UploadedPhoto[];
  error?:
    | 'rate_limited'
    | 'file_too_large'
    | 'unsupported_format'
    | 'heic_conversion_required'
    | 'verification_failed'
    | 'invalid_category'
    | 'origin_rejected'
    | 'request_too_large'
    | 'too_many_files'
    | 'storage_failed'
    | 'no_file'
    | 'network';
  message?: string;
}

export const DEFAULT_PHOTO_CONFIG: PhotoUploadConfig = {
  enabled: false,
  maxBytes: PHOTO_MAX_FILE_BYTES,
  maxCount: PHOTO_MAX_COUNT,
  maxTotalBytes: PHOTO_MAX_TOTAL_BYTES,
  turnstileRequired: false,
};

/** Fetch the server's availability + limits. Never throws. */
export async function fetchPhotoUploadConfig(): Promise<PhotoUploadConfig> {
  try {
    const response = await fetch('/api/photo-upload', { method: 'GET' });
    if (!response.ok) return { ...DEFAULT_PHOTO_CONFIG };
    const data = (await response.json()) as {
      enabled?: boolean;
      maxBytes?: number;
      maxCount?: number;
      maxTotalBytes?: number;
      turnstileRequired?: boolean;
    };
    return {
      enabled: data.enabled === true,
      maxBytes: Number(data.maxBytes) > 0 ? Number(data.maxBytes) : DEFAULT_PHOTO_CONFIG.maxBytes,
      maxCount: Number(data.maxCount) > 0 ? Number(data.maxCount) : DEFAULT_PHOTO_CONFIG.maxCount,
      maxTotalBytes:
        Number(data.maxTotalBytes) > 0 ? Number(data.maxTotalBytes) : DEFAULT_PHOTO_CONFIG.maxTotalBytes,
      turnstileRequired: data.turnstileRequired === true,
    };
  } catch {
    return { ...DEFAULT_PHOTO_CONFIG };
  }
}

export function uploadPhotos(
  files: File[],
  category: PhotoCategory,
  requestRef: string,
  onProgress: (percent: number) => void,
  turnstileToken?: string,
): Promise<PhotoUploadResult> {
  return new Promise((resolve) => {
    const form = new FormData();
    form.append('request_ref', requestRef);
    form.append('category', category);
    if (turnstileToken) form.append('turnstile_token', turnstileToken);
    for (const file of files) form.append('file', file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/photo-upload');
    xhr.responseType = 'json';
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    xhr.addEventListener('load', () => {
      const body = (xhr.response ?? {}) as {
        ok?: boolean;
        photos?: Array<{ key: string; category: string; bytes: number; name?: string }>;
        error?: string;
        message?: string;
      };
      const photos = Array.isArray(body.photos)
        ? body.photos.map((photo) => ({
            key: photo.key,
            category: photo.category as PhotoCategory,
            previewUrl: '',
            label: photo.name ?? '',
            bytes: photo.bytes,
          }))
        : [];
      if (xhr.status === 200 && body.ok && photos.length > 0) {
        resolve({ ok: true, photos });
        return;
      }
      const allowed = new Set<PhotoUploadResult['error']>([
        'rate_limited',
        'file_too_large',
        'unsupported_format',
        'heic_conversion_required',
        'verification_failed',
        'invalid_category',
        'origin_rejected',
        'request_too_large',
        'too_many_files',
        'storage_failed',
        'no_file',
        'network',
      ]);
      const error = (body.error ?? 'network') as PhotoUploadResult['error'];
      const failure: PhotoUploadResult = {
        ok: false,
        error: (allowed.has(error) ? error : 'storage_failed') as NonNullable<PhotoUploadResult['error']>,
      };
      if (photos.length > 0) failure.photos = photos;
      if (body.message) failure.message = body.message;
      resolve(failure);
    });
    xhr.addEventListener('error', () => resolve({ ok: false, error: 'network' }));
    xhr.addEventListener('abort', () => resolve({ ok: false, error: 'network' }));
    xhr.send(form);
  });
}

export function newRequestRef(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface PhotoController {
  getPhotos(): UploadedPhoto[];
  photoCount(): number;
  keys(): string;
  isUploading(): boolean;
  requestRef: string;
  refreshEngine(): void;
}

function errorCopy(result: PhotoUploadResult): string {
  switch (result.error) {
    case 'file_too_large':
      return 'A photo was too large for upload.';
    case 'unsupported_format':
    case 'heic_conversion_required':
      return 'One of those files is not a supported photo format.';
    case 'rate_limited':
      return 'Too many uploads in a short time — try again in a minute.';
    case 'verification_failed':
      return 'Please complete the human verification check, then try the photos again.';
    case 'request_too_large':
    case 'too_many_files':
      return 'Those photos exceed the upload limit. Try fewer or smaller photos.';
    case 'origin_rejected':
      return 'For security, photos can only be uploaded from this website.';
    default:
      return result.message ?? 'Upload did not complete — check your connection and try again.';
  }
}

/**
 * Binds the shared photo section to a form. Returns a controller the form uses
 * at submission time; no photo state lives in hidden inputs.
 */
export function initPhotoUploads(
  form: HTMLFormElement,
  options: { engine: PhotoEngine | (() => PhotoEngine) },
): PhotoController {
  const photoSection = form.querySelector<HTMLElement>('[data-photo-section]');
  const photoGrid = form.querySelector<HTMLElement>('[data-photo-grid]');
  const photoInput = form.querySelector<HTMLInputElement>('[data-photo-input]');
  const photoCategory = form.querySelector<HTMLSelectElement>('[data-photo-category]');
  const photoStatus = form.querySelector<HTMLElement>('[data-photo-status]');
  const photoPickLabel = form.querySelector<HTMLElement>('[data-photo-pick-label]');
  const photoTitle = form.querySelector<HTMLElement>('[data-photo-title]');
  const photoHint = form.querySelector<HTMLElement>('[data-photo-hint]');
  const photoPrivacy = form.querySelector<HTMLElement>('[data-photo-privacy]');
  let config: PhotoUploadConfig = { ...DEFAULT_PHOTO_CONFIG };
  let photos: UploadedPhoto[] = [];
  let uploading = false;
  let replaceIndex: number | null = null;
  const requestRef = newRequestRef();

  const engine = (): PhotoEngine =>
    typeof options.engine === 'function' ? options.engine() : options.engine;

  function categoryLabel(category: string): string {
    const option = photoCategory?.querySelector<HTMLOptionElement>(`option[value="${category}"]`);
    if (option?.textContent?.trim()) return option.textContent.trim();
    for (const options of Object.values(PHOTO_CATEGORY_OPTIONS)) {
      const match = options.find((entry) => entry.value === category);
      if (match) return match.label;
    }
    return category;
  }

  function setStatus(message: string, kind: '' | 'error' | 'success' = ''): void {
    if (!photoStatus) return;
    photoStatus.textContent = message;
    photoStatus.dataset.kind = kind;
  }

  function privacyText(): string {
    const base = PHOTO_ENGINE_COPY[engine()].privacy;
    if (!config.enabled) return base;
    const maxMb = Math.round(config.maxBytes / (1024 * 1024));
    const totalMb = Math.round(config.maxTotalBytes / (1024 * 1024));
    return `${base} Up to ${config.maxCount} photos, ${maxMb}MB each, ${totalMb}MB total.`;
  }

  function syncEngine(): void {
    if (!photoCategory) return;
    const current = photoCategory.value;
    const copy = PHOTO_ENGINE_COPY[engine()];
    if (photoTitle) photoTitle.textContent = copy.title;
    if (photoHint) photoHint.textContent = copy.hint;
    if (photoPrivacy) photoPrivacy.textContent = privacyText();
    const options = PHOTO_CATEGORY_OPTIONS[engine()];
    photoCategory.innerHTML = '';
    for (const option of options) {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      photoCategory.appendChild(element);
    }
    if (options.some((option) => option.value === current)) photoCategory.value = current;
    if (photoPickLabel) {
      const remaining = config.maxCount - photos.length;
      photoPickLabel.textContent = remaining <= 0 ? 'Photo limit reached' : `Add photos (${remaining} left)`;
    }
  }

  function render(): void {
    if (!photoGrid) return;
    photoGrid.innerHTML = '';
    for (const [index, photo] of photos.entries()) {
      const thumb = document.createElement('div');
      thumb.className = 'photo-upload__thumb';
      const image = document.createElement('img');
      image.src = photo.previewUrl;
      image.alt = `${categoryLabel(photo.category)} photo`;
      const meta = document.createElement('span');
      meta.className = 'photo-upload__thumb-meta';
      const label = document.createElement('span');
      label.className = 'photo-upload__thumb-label';
      label.textContent = photo.label || categoryLabel(photo.category);
      label.title = label.textContent;
      const actions = document.createElement('span');
      actions.className = 'photo-upload__thumb-actions';
      const replace = document.createElement('button');
      replace.type = 'button';
      replace.className = 'photo-upload__thumb-action';
      replace.textContent = 'Replace';
      replace.setAttribute('aria-label', `Replace ${label.textContent}`);
      replace.addEventListener('click', () => {
        if (uploading || !photoInput || !photoCategory) return;
        replaceIndex = index;
        photoCategory.value = photo.category;
        photoInput.click();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'photo-upload__thumb-action';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${label.textContent}`);
      remove.addEventListener('click', () => {
        URL.revokeObjectURL(photo.previewUrl);
        photos.splice(index, 1);
        render();
        setStatus(`${photos.length} photo${photos.length === 1 ? '' : 's'} attached.`, '');
      });
      actions.append(replace, remove);
      meta.append(label, actions);
      thumb.append(image, meta);
      photoGrid.appendChild(thumb);
    }
    if (photoPickLabel) {
      const remaining = config.maxCount - photos.length;
      photoPickLabel.textContent = remaining <= 0 ? 'Photo limit reached' : `Add photos (${remaining} left)`;
    }
  }

  async function handleSelection(): Promise<void> {
    if (!photoInput || !photoCategory || uploading) return;
    const files = [...(photoInput.files ?? [])];
    photoInput.value = '';
    if (files.length === 0) {
      replaceIndex = null;
      return;
    }

    const replacing = replaceIndex;
    const room = config.maxCount - photos.length + (replacing !== null ? 1 : 0);
    if (room <= 0) {
      setStatus(`Up to ${config.maxCount} photos, please. Remove one to add another.`, 'error');
      return;
    }

    uploading = true;
    setStatus(files.some(isHeicFile) ? 'Preparing iPhone photo…' : 'Checking photos…', '');
    let prepared: PreparedPhotoFiles;
    try {
      prepared = await preparePhotoFiles(replacing !== null ? files.slice(0, 1) : files.slice(0, room), config);
    } catch {
      uploading = false;
      setStatus('Those photos could not be prepared. Please try again.', 'error');
      return;
    }
    if (prepared.errors.length > 0) setStatus(prepared.errors.join(' '), 'error');
    if (prepared.accepted.length === 0) {
      uploading = false;
      replaceIndex = null;
      return;
    }

    let token: string | undefined;
    if (config.turnstileRequired) {
      token = await waitForTurnstileToken();
      if (!token) {
        uploading = false;
        replaceIndex = null;
        setStatus(
          'Please complete the human verification check, then add the photos again. Your other answers are saved.',
          'error',
        );
        return;
      }
    }

    const category = photoCategory.value as PhotoCategory;
    setStatus(`Uploading ${prepared.accepted.length} photo${prepared.accepted.length === 1 ? '' : 's'}…`, '');
    const result = await uploadPhotos(prepared.accepted, category, requestRef, (percent) => {
      setStatus(`Uploading photos… ${percent}%`, '');
    }, token);
    resetTurnstile();
    uploading = false;

    if (result.photos && result.photos.length > 0) {
      const added = result.photos.map((photo, index) => ({
        ...photo,
        previewUrl: URL.createObjectURL(prepared.accepted[index] as File),
        label: prepared.accepted[index]?.name ?? photo.label,
      }));
      if (replacing !== null) {
        const old = photos[replacing];
        if (old) URL.revokeObjectURL(old.previewUrl);
        photos.splice(replacing, 1, ...added);
      } else {
        photos.push(...added);
      }
      replaceIndex = null;
      render();
    } else {
      replaceIndex = null;
    }

    if (!result.ok) {
      const partial = result.photos?.length
        ? ` ${result.photos.length} photo${result.photos.length === 1 ? '' : 's'} attached; the rest did not upload.`
        : '';
      setStatus(`${errorCopy(result)}${partial} You can continue without the remaining photos.`, 'error');
      return;
    }
    setStatus(
      `${photos.length} photo${photos.length === 1 ? '' : 's'} attached — uploaded privately for Hayli’s review.`,
      'success',
    );
  }

  if (photoSection && photoInput && photoCategory) {
    syncEngine();
    const serviceInput = form.querySelector<HTMLInputElement>('input[name="serviceType"]');
    serviceInput?.addEventListener('change', syncEngine);
    photoInput.addEventListener('change', () => void handleSelection());
    photoInput.addEventListener('cancel', () => {
      replaceIndex = null;
    });
    photoSection.addEventListener('dragover', (event) => event.preventDefault());
    photoSection.addEventListener('drop', (event) => {
      event.preventDefault();
      if (uploading) return;
      if (event.dataTransfer?.files.length) {
        photoInput.files = event.dataTransfer.files;
        void handleSelection();
      }
    });
    void (async () => {
      config = await fetchPhotoUploadConfig();
      if (!config.enabled) return;
      photoSection.hidden = false;
      syncEngine();
    })();
  }

  return {
    getPhotos: () => [...photos],
    photoCount: () => photos.length,
    keys: () => photoKeysField(photos),
    isUploading: () => uploading,
    requestRef,
    refreshEngine: syncEngine,
  };
}
