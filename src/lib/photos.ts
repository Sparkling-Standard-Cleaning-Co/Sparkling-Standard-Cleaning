// Shared customer-photo vocabulary and reference validation.
//
// Client and Cloudflare Functions both import this module so the upload
// categories, storage-key format and attachment-association rules cannot drift.
// It contains no secrets and performs no I/O.

export type PhotoEngine = 'residential' | 'str' | 'commercial' | 'church';

export type PhotoCategory =
  | 'bathroom'
  | 'kitchen'
  | 'living_area'
  | 'bedroom'
  | 'laundry'
  | 'facility'
  | 'floor'
  | 'restroom'
  | 'special_workload'
  | 'sanctuary'
  | 'fellowship_hall'
  | 'classroom'
  | 'nursery'
  | 'church_kitchen'
  | 'office'
  | 'additional';

export interface PhotoCategoryOption {
  value: PhotoCategory;
  label: string;
}

export const PHOTO_CATEGORY_OPTIONS: Record<PhotoEngine, readonly PhotoCategoryOption[]> = {
  residential: [
    { value: 'bathroom', label: 'Bathroom' },
    { value: 'kitchen', label: 'Kitchen' },
    { value: 'living_area', label: 'Main living or work area' },
    { value: 'additional', label: 'Additional photos' },
  ],
  str: [
    { value: 'bedroom', label: 'Bedrooms' },
    { value: 'bathroom', label: 'Bathrooms' },
    { value: 'kitchen', label: 'Kitchen' },
    { value: 'laundry', label: 'Laundry / linens' },
    { value: 'additional', label: 'Additional photos' },
  ],
  commercial: [
    { value: 'facility', label: 'Facility / entry' },
    { value: 'floor', label: 'Floors' },
    { value: 'restroom', label: 'Restrooms' },
    { value: 'special_workload', label: 'Special workload' },
    { value: 'additional', label: 'Additional photos' },
  ],
  church: [
    { value: 'sanctuary', label: 'Sanctuary' },
    { value: 'fellowship_hall', label: 'Fellowship hall' },
    { value: 'classroom', label: 'Classrooms' },
    { value: 'nursery', label: 'Nursery' },
    { value: 'church_kitchen', label: 'Kitchen' },
    { value: 'office', label: 'Church offices' },
    { value: 'additional', label: 'Additional photos' },
  ],
};

export const PHOTO_CATEGORY_SET: ReadonlySet<string> = new Set(
  Object.values(PHOTO_CATEGORY_OPTIONS).flatMap((options) => options.map((option) => option.value)),
);

export const PHOTO_ENGINE_COPY: Record<
  PhotoEngine,
  { title: string; hint: string; privacy: string }
> = {
  residential: {
    title: 'Photos of Your Space',
    hint: 'Include your bathroom, kitchen and main living area. Photos of appliances or areas needing extra attention are especially useful.',
    privacy: 'Photos are private, used only to prepare your cleaning estimate, and never posted publicly. Please only share photos of the space — no ID documents or personal paperwork.',
  },
  str: {
    title: 'Help Us Understand Your Turnover',
    hint: 'Bedrooms, bathrooms, kitchen, laundry and any linen storage are helpful. Include the areas that take the most turnover work.',
    privacy: 'Photos are private, used only to prepare your turnover estimate, and never posted publicly. Please only share photos of the property — no guest information or personal paperwork.',
  },
  commercial: {
    title: 'Help Us Understand Your Facility',
    hint: 'Facility entry, floors, restrooms and any special workload areas are helpful. Photos reduce scope questions before we confirm your estimate.',
    privacy: 'Photos are private, used only to prepare your facility estimate, and never posted publicly. Please only share photos of the space — no employee information, credentials, screens or personal paperwork.',
  },
  church: {
    title: 'Help Us Understand Your Church',
    hint: 'Sanctuary, fellowship hall, classrooms, nursery, kitchen and offices are helpful. Include any space with a special event or access consideration.',
    privacy: 'Photos are private, used only to prepare your church estimate, and never posted publicly. Please only share photos of the facilities — no member information or personal paperwork.',
  },
};

export const PHOTO_MAX_COUNT = 6;
export const PHOTO_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const PHOTO_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
export const PHOTO_ABSOLUTE_MAX_FILE_BYTES = 12 * 1024 * 1024;

export const PHOTO_REQUEST_REF_PATTERN = /^[a-z0-9-]{8,40}$/;
export const PHOTO_KEY_PATTERN =
  /^leads\/\d{4}\/\d{2}\/[a-z0-9-]{8,40}\/[a-z_]+-[0-9a-f]{32}\.(jpg|png|webp|heic)$/;

export function isPhotoCategory(value: string): value is PhotoCategory {
  return PHOTO_CATEGORY_SET.has(value);
}

export function sanitizePhotoRequestRef(value: string): string {
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
  return PHOTO_REQUEST_REF_PATTERN.test(cleaned) ? cleaned : '';
}

export function isPhotoKey(value: string): boolean {
  return PHOTO_KEY_PATTERN.test(value);
}

export function isPhotoSidecarKey(value: string): boolean {
  return /^leads\/\d{4}\/\d{2}\/[a-z0-9-]{8,40}\/[a-z_]+-[0-9a-f]{32}\.(jpg|png|webp|heic)\.meta\.json$/.test(value);
}

/** True only when the key is inside this request's server-generated prefix. */
export function photoKeyBelongsToRequest(key: string, requestRef: string): boolean {
  const ref = sanitizePhotoRequestRef(requestRef);
  if (!ref || !isPhotoKey(key)) return false;
  return key.includes(`/${ref}/`);
}

export interface ParsedPhotoEntry {
  category: PhotoCategory;
  key: string;
}

/**
 * Parses "category:key" attachments. The key is authoritative; a client cannot
 * claim a different category than the one recorded in its server-generated key.
 * Invalid, duplicate, foreign-request and excess entries are dropped.
 */
export function normalizePhotoEntries(
  raw: string | null | undefined,
  requestRef: string,
  maxCount = PHOTO_MAX_COUNT,
): ParsedPhotoEntry[] {
  const ref = sanitizePhotoRequestRef(requestRef);
  if (!ref || !raw) return [];
  const seen = new Set<string>();
  const entries: ParsedPhotoEntry[] = [];
  for (const item of raw.split(',')) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(':');
    const key = separator >= 0 ? trimmed.slice(separator + 1) : trimmed;
    if (!photoKeyBelongsToRequest(key, ref) || seen.has(key)) continue;
    const filename = key.split('/').pop() ?? '';
    const categoryFromKey = filename.split('-')[0] ?? '';
    if (!isPhotoCategory(categoryFromKey)) continue;
    const claimed = separator >= 0 ? trimmed.slice(0, separator) : '';
    if (claimed && claimed !== categoryFromKey) continue;
    seen.add(key);
    entries.push({ category: categoryFromKey, key });
    if (entries.length >= maxCount) break;
  }
  return entries;
}

/** `photo_keys` submission payload: "category:key" pairs. */
export function photoKeysField(photos: Array<{ category: PhotoCategory; key: string }>): string {
  return photos.map((photo) => `${photo.category}:${photo.key}`).join(',');
}
