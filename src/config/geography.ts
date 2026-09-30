// ─────────────────────────────────────────────────────────────────────────────
// Service geography configuration — SINGLE SOURCE OF TRUTH for travel zones.
//
// IMPORTANT: the exact operating origin and service radius are PENDING owner
// decisions (directive §9, §31). Nothing in this file is a public claim about
// where the company will or will not go; it is an internal estimator policy.
//
// The public site may only use the approved language in
// business.serviceArea.summary until the owner approves more specific coverage.
//
// Zone assignments and coordinates below are PROVISIONAL operational reference
// data: approximate ZIP centroids used for PRELIMINARY route estimates (the
// directive explicitly allows ZIP-centroid distance for early quote steps).
// When the site runs with its Cloudflare functions and a configured
// TRAVEL_ORIGIN + routing provider, a real route replaces the straight-line
// fallback. See docs/operations/ESTIMATOR-CALIBRATION.md.
// ─────────────────────────────────────────────────────────────────────────────

export type ServiceZone = 'core' | 'surrounding' | 'extended' | 'outside' | 'unknown';

export interface ZipReference {
  city: string;
  state: 'FL' | 'AL';
  zone: ServiceZone;
  /** Approximate ZIP centroid for preliminary route estimates (±1–2 miles). */
  lat: number;
  lng: number;
}

/**
 * Provisional ZIP → zone/centroid reference around Pensacola. Unknown ZIPs are
 * treated as 'outside' and never receive an instant estimate.
 */
export const zipReference: Record<string, ZipReference> = {
  // ── Core: Pensacola + Cantonment (owner-confirmed markets) ────────────────
  '32501': { city: 'Pensacola', state: 'FL', zone: 'core', lat: 30.42, lng: -87.22 },
  '32502': { city: 'Pensacola', state: 'FL', zone: 'core', lat: 30.41, lng: -87.23 },
  '32503': { city: 'Pensacola', state: 'FL', zone: 'core', lat: 30.45, lng: -87.21 },
  '32504': { city: 'Pensacola', state: 'FL', zone: 'core', lat: 30.48, lng: -87.19 },
  '32505': { city: 'Pensacola', state: 'FL', zone: 'core', lat: 30.44, lng: -87.26 },
  '32506': { city: 'Pensacola', state: 'FL', zone: 'core', lat: 30.4, lng: -87.31 },
  '32507': { city: 'Pensacola', state: 'FL', zone: 'core', lat: 30.36, lng: -87.35 },
  '32508': { city: 'Pensacola', state: 'FL', zone: 'core', lat: 30.35, lng: -87.28 },
  '32511': { city: 'Pensacola', state: 'FL', zone: 'core', lat: 30.42, lng: -87.22 },
  '32514': { city: 'Pensacola', state: 'FL', zone: 'core', lat: 30.53, lng: -87.22 },
  '32526': { city: 'Pensacola', state: 'FL', zone: 'core', lat: 30.49, lng: -87.32 },
  '32533': { city: 'Cantonment', state: 'FL', zone: 'core', lat: 30.61, lng: -87.34 },

  // ── Surrounding: neighboring Pensacola-area communities ──────────────────
  '32530': { city: 'Bagdad', state: 'FL', zone: 'surrounding', lat: 30.61, lng: -87.03 },
  '32561': { city: 'Gulf Breeze / Pensacola Beach', state: 'FL', zone: 'surrounding', lat: 30.35, lng: -87.16 },
  '32563': { city: 'Gulf Breeze', state: 'FL', zone: 'surrounding', lat: 30.39, lng: -87.07 },
  '32565': { city: 'Jay', state: 'FL', zone: 'surrounding', lat: 30.95, lng: -87.15 },
  '32566': { city: 'Navarre', state: 'FL', zone: 'surrounding', lat: 30.42, lng: -86.89 },
  '32570': { city: 'Milton', state: 'FL', zone: 'surrounding', lat: 30.66, lng: -87.05 },
  '32571': { city: 'Pace', state: 'FL', zone: 'surrounding', lat: 30.62, lng: -87.16 },
  '32577': { city: 'Molino', state: 'FL', zone: 'surrounding', lat: 30.72, lng: -87.31 },
  '32583': { city: 'Milton', state: 'FL', zone: 'surrounding', lat: 30.58, lng: -86.98 },

  // ── Extended: select nearby Alabama communities (manual confirmation) ────
  '36426': { city: 'Brewton', state: 'AL', zone: 'extended', lat: 31.1, lng: -87.07 },
  '36502': { city: 'Atmore', state: 'AL', zone: 'extended', lat: 31.02, lng: -87.49 },
  '36507': { city: 'Bay Minette', state: 'AL', zone: 'extended', lat: 30.88, lng: -87.77 },
  '36526': { city: 'Daphne', state: 'AL', zone: 'extended', lat: 30.6, lng: -87.9 },
  '36527': { city: 'Spanish Fort', state: 'AL', zone: 'extended', lat: 30.67, lng: -87.91 },
  '36530': { city: 'Elberta', state: 'AL', zone: 'extended', lat: 30.42, lng: -87.6 },
  '36532': { city: 'Fairhope', state: 'AL', zone: 'extended', lat: 30.52, lng: -87.9 },
  '36535': { city: 'Foley', state: 'AL', zone: 'extended', lat: 30.41, lng: -87.68 },
  '36542': { city: 'Gulf Shores', state: 'AL', zone: 'extended', lat: 30.25, lng: -87.7 },
  '36551': { city: 'Loxley', state: 'AL', zone: 'extended', lat: 30.62, lng: -87.75 },
  '36561': { city: 'Orange Beach', state: 'AL', zone: 'extended', lat: 30.29, lng: -87.57 },
  '36567': { city: 'Robertsdale', state: 'AL', zone: 'extended', lat: 30.55, lng: -87.71 },
  '36580': { city: 'Summerdale', state: 'AL', zone: 'extended', lat: 30.49, lng: -87.7 },
};

/** Parses and normalizes a ZIP input. Returns null when malformed. */
export function normalizeZip(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const match = raw.trim().match(/^(\d{5})(?:-\d{4})?$/);
  return match ? (match[1] ?? null) : null;
}

export function zoneForZip(zip: string | undefined | null): ServiceZone {
  const normalized = normalizeZip(zip);
  if (!normalized) return 'unknown';
  return zipReference[normalized]?.zone ?? 'outside';
}

export function zipReferenceFor(zip: string | undefined | null): ZipReference | null {
  const normalized = normalizeZip(zip);
  if (!normalized) return null;
  return zipReference[normalized] ?? null;
}

// ── Zone policy (provisional — see header) ───────────────────────────────────
export const zonePolicy: Record<
  ServiceZone,
  { label: string; instantEstimate: boolean; manualReason?: string }
> = {
  core: {
    label: 'Core service area',
    instantEstimate: true,
  },
  surrounding: {
    label: 'Surrounding communities',
    instantEstimate: true,
  },
  extended: {
    label: 'Select nearby Alabama communities',
    instantEstimate: false,
    manualReason:
      'Extended-area jobs are confirmed personally so travel and scheduling are handled honestly.',
  },
  outside: {
    label: 'Outside the current service area',
    instantEstimate: false,
    manualReason: 'This ZIP is outside the current service area. Send a request and we will tell you honestly whether we can help.',
  },
  unknown: {
    label: 'ZIP not recognized',
    instantEstimate: false,
    manualReason: 'We could not read that ZIP — send a request or call and we will check coverage with you.',
  },
};

// ── Approved public service-area copy (do not extend without owner approval) ─
export const serviceAreaCopy = {
  summary:
    'Serving Pensacola, Cantonment and surrounding communities, with select nearby service into Alabama.',
  futurePagesNote:
    'Additional approved service-area pages can be added later from this configuration. No city pages are generated until the owner approves genuine locality-specific content (directive §45).',
} as const;
