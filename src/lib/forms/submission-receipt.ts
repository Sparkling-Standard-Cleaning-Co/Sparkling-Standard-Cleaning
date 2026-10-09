// Single-use request summary (session storage).
//
// After a successful submission the customer's browser keeps a small,
// sanitized copy of the request so the thank-you page can show
// "here's what you submitted" without any server-side storage. It is:
//  - session-scoped (cleared when the tab closes),
//  - single-use (removed as soon as the thank-you page reads it),
//  - limited to the fields below (never the honeypot, never verification
//    codes, never anything the customer did not type themselves).
//
// Storage failures are ignored — the confirmation is a convenience, never a
// dependency of the submission itself.

export const SUMMARY_STORAGE_KEY = 'pcc-request-summary';

/** The only submission keys that may be kept client-side for the summary. */
const SUMMARY_KEYS = [
  'request_type',
  'service_type',
  'frequency',
  'turnover_frequency',
  'property_type',
  'square_feet',
  'bedrooms',
  'full_baths',
  'service_address',
  'property_location',
  'address_city',
  'address_state',
  'zip',
  'preferred_date',
  'walkthrough_date',
  'arrival_preference',
  'quoted_price',
  'proposed_total',
  'quoted_range',
  'verified_range',
  'estimate_low',
  'estimate_high',
  'quote_reference',
  'recipient_name',
  'gift_value',
  'facility_type',
  'organization',
] as const;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | undefined {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : undefined;
  } catch {
    return undefined;
  }
}

/** Stores the sanitized summary of a submitted request. Best-effort only. */
export function saveSubmissionSummary(
  fields: Record<string, string>,
  storage: StorageLike | undefined = defaultStorage(),
): void {
  if (!storage) return;
  const summary: Record<string, string> = {};
  for (const key of SUMMARY_KEYS) {
    const value = fields[key];
    if (typeof value === 'string' && value.trim() !== '') {
      summary[key] = value.trim().slice(0, 300);
    }
  }
  try {
    storage.setItem(SUMMARY_STORAGE_KEY, JSON.stringify(summary));
  } catch {
    // Storage full/blocked — the submission itself is unaffected.
  }
}

/** Reads and removes the stored summary (single use). Returns null when absent. */
export function takeSubmissionSummary(
  storage: StorageLike | undefined = defaultStorage(),
): Record<string, string> | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(SUMMARY_STORAGE_KEY);
    storage.removeItem(SUMMARY_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const summary: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!(SUMMARY_KEYS as readonly string[]).includes(key)) continue;
      if (typeof value === 'string' && value.trim() !== '') summary[key] = value.trim();
    }
    return Object.keys(summary).length > 0 ? summary : null;
  } catch {
    return null;
  }
}
