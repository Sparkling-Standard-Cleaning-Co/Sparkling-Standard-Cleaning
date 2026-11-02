// Browser-side activation of the published pricing snapshot.
//
// The estimator pages fetch /api/pricing once before their first calculation.
// If the endpoint is unavailable (local preview, static-only mode) the source
// configuration remains active, which preserves the previous behavior.

import { activatePricingConfig } from '../../config/pricing.ts';
import { normalizePricingSnapshot } from './snapshot.ts';

let pending: Promise<boolean> | null = null;

export interface ActivePricingInfo {
  active: boolean;
  source: boolean;
  version: number | null;
  fingerprint: string | null;
}

export async function loadPublishedPricing(): Promise<ActivePricingInfo> {
  if (typeof fetch !== 'function') {
    return { active: false, source: true, version: null, fingerprint: null };
  }
  try {
    const response = await fetch('/api/pricing', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return { active: false, source: true, version: null, fingerprint: null };
    const data = (await response.json()) as {
      ok?: boolean;
      source?: boolean;
      version?: number | null;
      fingerprint?: string | null;
      snapshot?: unknown;
    };
    if (data.ok !== true || !data.snapshot) {
      return { active: false, source: true, version: null, fingerprint: null };
    }
    const normalized = normalizePricingSnapshot(data.snapshot);
    if (!normalized.ok) {
      return { active: false, source: true, version: null, fingerprint: null };
    }
    activatePricingConfig(normalized.snapshot.owner, normalized.snapshot.travel);
    return {
      active: true,
      source: data.source === true,
      version: data.version ?? null,
      fingerprint: data.fingerprint ?? null,
    };
  } catch {
    return { active: false, source: true, version: null, fingerprint: null };
  }
}

/** Deduplicates concurrent page initializers. */
export function loadPublishedPricingOnce(): Promise<boolean> {
  if (!pending) {
    pending = loadPublishedPricing().then((result) => result.active);
  }
  return pending;
}
