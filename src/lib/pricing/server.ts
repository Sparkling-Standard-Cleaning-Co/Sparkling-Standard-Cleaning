// Request-scoped published pricing for Cloudflare Functions.
//
// Functions never mutate the module-level pricing singleton: a request gets an
// explicit `PricingConfig` built from the published snapshot and passes it into
// the shared calculators. This keeps concurrent requests isolated even if a
// publish happens while a request is in flight.

import type { D1Database } from '../admin/d1.ts';
import { buildPricingConfig, pricing, type PricingConfig } from '../../config/pricing.ts';
import { getPublishedPricing } from './store.ts';
import { sourcePricingSnapshot } from './snapshot.ts';

/**
 * Loads the published snapshot from D1. A missing database/row or a corrupt
 * row falls back to the source-controlled baseline; the returned
 * `configVersion` then honestly differs from a browser quote built on a
 * published version, producing a preliminary/mismatch verdict rather than
 * trusting an unverified price.
 */
export async function requestPricingConfig(db?: D1Database | null): Promise<PricingConfig> {
  if (db) {
    try {
      const published = await getPublishedPricing(db);
      if (published) {
        return buildPricingConfig(published.snapshot.owner, published.snapshot.travel);
      }
    } catch {
      // Fall through to the source baseline. The quote is still independently
      // recalculated; a config-version difference is surfaced honestly.
    }
  }
  const source = sourcePricingSnapshot();
  return buildPricingConfig(source.owner, source.travel);
}

/** Convenience for code paths that need the active source config. */
export function sourcePricingConfig(): PricingConfig {
  return pricing;
}
