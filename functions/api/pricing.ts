// GET /api/pricing - the active published pricing snapshot for a live branch.
//
// The estimator and the server verification paths both read the same snapshot
// so a published price change applies immediately without a redeploy. When no
// version has been published, the source-controlled baseline is returned with
// `source: true`; the site behaves exactly as it did before pricing control.
//
// Only a live, publicly bookable branch may expose pricing. Tampa Bay remains
// prelaunch and cannot serve a public quote configuration.

import type { AdminDbEnv } from '../../src/lib/admin/d1.ts';
import { getPublishedPricing } from '../../src/lib/pricing/store.ts';
import { pricingSnapshotVersion, sourcePricingSnapshot } from '../../src/lib/pricing/snapshot.ts';
import { effectiveBranch } from '../../src/lib/branches/registry.ts';
import { BRANCH_PENSACOLA } from '../../src/config/branches.ts';

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
  const url = new URL(context.request.url);
  const requested = url.searchParams.get('branch')?.trim() || BRANCH_PENSACOLA;
  const branch = await effectiveBranch(context.env.DB ?? null, requested);
  if (!branch || !branch.bookable) {
    return json({ ok: false, error: 'branch_not_bookable' }, 404);
  }

  if (!context.env.DB) {
    const snapshot = sourcePricingSnapshot();
    return json({
      ok: true,
      source: true,
      branch: branch.id,
      version: null,
      fingerprint: pricingSnapshotVersion(snapshot),
      publishedAt: null,
      snapshot,
    });
  }
  try {
    const published = await getPublishedPricing(context.env.DB, branch.id);
    if (!published) {
      const snapshot = sourcePricingSnapshot();
      return json({
        ok: true,
        source: true,
        branch: branch.id,
        version: null,
        fingerprint: pricingSnapshotVersion(snapshot),
        publishedAt: null,
        snapshot,
      });
    }
    return json({
      ok: true,
      source: false,
      branch: branch.id,
      version: published.version,
      fingerprint: published.fingerprint,
      publishedAt: published.publishedAt,
      snapshot: published.snapshot,
    });
  } catch {
    const snapshot = sourcePricingSnapshot();
    return json({
      ok: true,
      source: true,
      branch: branch.id,
      version: null,
      fingerprint: pricingSnapshotVersion(snapshot),
      publishedAt: null,
      degraded: true,
      snapshot,
    });
  }
}
