// GET /api/pricing — the active published pricing snapshot.
//
// The estimator and the server verification paths both read the same snapshot
// so a published price change applies immediately without a redeploy. When no
// version has been published, the source-controlled baseline is returned with
// `source: true`; the site behaves exactly as it did before pricing control.

import type { AdminDbEnv } from '../../src/lib/admin/d1.ts';
import { getPublishedPricing } from '../../src/lib/pricing/store.ts';
import { pricingSnapshotVersion, sourcePricingSnapshot } from '../../src/lib/pricing/snapshot.ts';

interface Env extends AdminDbEnv {}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  if (!context.env.DB) {
    const snapshot = sourcePricingSnapshot();
    return json({
      ok: true,
      source: true,
      version: null,
      fingerprint: pricingSnapshotVersion(snapshot),
      publishedAt: null,
      snapshot,
    });
  }
  try {
    const published = await getPublishedPricing(context.env.DB);
    if (!published) {
      const snapshot = sourcePricingSnapshot();
      return json({
        ok: true,
        source: true,
        version: null,
        fingerprint: pricingSnapshotVersion(snapshot),
        publishedAt: null,
        snapshot,
      });
    }
    return json({
      ok: true,
      source: false,
      version: published.version,
      fingerprint: published.fingerprint,
      publishedAt: published.publishedAt,
      snapshot: published.snapshot,
    });
  } catch {
    // A corrupt or unavailable pricing row must never take the public site
    // down. Fall back to the source configuration; quotes built on it will
    // carry the source fingerprint and the server will flag any mismatch.
    const snapshot = sourcePricingSnapshot();
    return json({
      ok: true,
      source: true,
      version: null,
      fingerprint: pricingSnapshotVersion(snapshot),
      publishedAt: null,
      degraded: true,
      snapshot,
    });
  }
}
