// Admin Pricing & Estimator Control API.
//
// Every mutation requires the owner-level settings.write permission and a CSRF
// token. Drafts never affect customer prices; publishing is the only action
// that makes new estimates use a snapshot. Simulations are side-effect free.

import { adminDb, type AdminDbEnv, type D1Database } from '../../../src/lib/admin/d1.ts';
import {
  AdminAuthError,
  audit,
  requireActor,
  requireCsrf,
  type AdminActor,
} from '../../../src/lib/admin/operations.ts';
import {
  createPricingDraft,
  discardPricingDraft,
  getLatestDraft,
  getPublishedPricing,
  getPricingVersion,
  listPricingVersions,
  PricingStoreError,
  publishPricingVersion,
  rollbackPricingVersion,
  updatePricingDraft,
} from '../../../src/lib/pricing/store.ts';
import {
  normalizePricingSnapshot,
  pricingSnapshotVersion,
  sourcePricingSnapshot,
  snapshotSummary,
  type PricingSnapshot,
} from '../../../src/lib/pricing/snapshot.ts';
import { pricingCatalog } from '../../../src/lib/pricing/catalog.ts';
import { simulatePricing, type SimulatorInput } from '../../../src/lib/pricing/simulate.ts';

interface Env extends AdminDbEnv {}

const MAX_BODY_BYTES = 300_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function versionPayload(record: Awaited<ReturnType<typeof getPricingVersion>>): Record<string, unknown> | null {
  if (!record) return null;
  return {
    id: record.id,
    version: record.version,
    status: record.status,
    fingerprint: record.fingerprint,
    note: record.note,
    basedOnVersion: record.basedOnVersion,
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    createdByEmail: record.createdByEmail,
    updatedAt: record.updatedAt,
    publishedAt: record.publishedAt,
    publishedBy: record.publishedBy,
    publishedByEmail: record.publishedByEmail,
    snapshot: record.snapshot,
  };
}

async function baseline() {
  const snapshot = sourcePricingSnapshot();
  return {
    fingerprint: pricingSnapshotVersion(snapshot),
    summary: snapshotSummary(snapshot),
    snapshot,
  };
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  let actor: AdminActor;
  try {
    actor = await requireActor(db, context.request, 'settings.write');
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'unauthorized' },
      error instanceof AdminAuthError ? error.status : 401,
    );
  }

  try {
    const url = new URL(context.request.url);
    const view = url.searchParams.get('view');
    if (view === 'version') {
      const id = url.searchParams.get('id') ?? '';
      const record = id ? await getPricingVersion(db, id) : null;
      if (!record) return json({ ok: false, error: 'pricing_version_not_found' }, 404);
      return json({ ok: true, version: versionPayload(record) });
    }

    const [published, draft, versions, source] = await Promise.all([
      getPublishedPricing(db),
      getLatestDraft(db),
      listPricingVersions(db),
      baseline(),
    ]);
    return json({
      ok: true,
      actor: { name: actor.name, role: actor.role },
      published: versionPayload(published),
      draft: versionPayload(draft),
      versions,
      baseline: {
        fingerprint: source.fingerprint,
        summary: source.summary,
        snapshot: source.snapshot,
      },
      catalog: pricingCatalog,
    });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof PricingStoreError ? error.code : 'pricing_load_failed' },
      error instanceof PricingStoreError ? error.status : 500,
    );
  }
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function snapshotFrom(value: unknown): PricingSnapshot {
  const normalized = normalizePricingSnapshot(value, { strict: true });
  if (!normalized.ok) {
    throw new PricingStoreError('pricing_validation_failed', 400, normalized.errors.join(' '));
  }
  return normalized.snapshot;
}

async function simulate(db: D1Database, body: Record<string, unknown>): Promise<Response> {
  const input = body.input as SimulatorInput | undefined;
  if (!input || typeof input !== 'object' || !['residential', 'str', 'commercial', 'church'].includes(String(input.engine))) {
    return json({ ok: false, error: 'simulator_input_required' }, 400);
  }
  const publishedRecord = await getPublishedPricing(db);
  const published = publishedRecord?.snapshot ?? sourcePricingSnapshot();
  let draft = published;
  if (typeof body.draftId === 'string' && body.draftId.trim()) {
    const record = await getPricingVersion(db, body.draftId.trim());
    if (!record || record.status !== 'draft') return json({ ok: false, error: 'pricing_draft_not_found' }, 404);
    draft = record.snapshot;
  } else if (body.draftSnapshot !== undefined) {
    draft = snapshotFrom(body.draftSnapshot);
  } else {
    const latest = await getLatestDraft(db);
    draft = latest?.snapshot ?? published;
  }
  const comparison = simulatePricing(published, draft, input);
  return json({
    ok: true,
    comparison,
    publishedVersion: publishedRecord?.version ?? null,
    draftVersion: draft === published ? publishedRecord?.version ?? null : null,
    fingerprint: pricingSnapshotVersion(draft),
  });
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);

  let actor: AdminActor;
  try {
    actor = await requireActor(db, context.request, 'settings.write');
    requireCsrf(context.request, actor);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'unauthorized' },
      error instanceof AdminAuthError ? error.status : 401,
    );
  }

  const length = Number(context.request.headers.get('Content-Length') ?? 0);
  if (length > MAX_BODY_BYTES) return json({ ok: false, error: 'request_too_large' }, 413);

  try {
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = text(body.action, 40);
    const pricingActor = { id: actor.id, email: actor.email };

    if (action === 'simulate') return simulate(db, body);

    if (action === 'create_draft') {
      const snapshot = body.snapshot === undefined ? undefined : snapshotFrom(body.snapshot);
      const draft = await createPricingDraft(db, {
        ...(snapshot ? { snapshot } : {}),
        note: text(body.note),
        actor: pricingActor,
      });
      await audit(db, {
        actorUserId: actor.id,
        action: 'pricing.draft_created',
        entityType: 'pricing_version',
        entityId: draft.id,
        detail: `version ${draft.version} fingerprint ${draft.fingerprint}`,
      });
      return json({ ok: true, draft: versionPayload(draft) });
    }

    if (action === 'save_draft') {
      const id = text(body.id, 120);
      if (!id) return json({ ok: false, error: 'pricing_draft_required' }, 400);
      const draft = await updatePricingDraft(db, {
        id,
        snapshot: snapshotFrom(body.snapshot),
        note: text(body.note),
        ...(text(body.expectedUpdatedAt, 40) ? { expectedUpdatedAt: text(body.expectedUpdatedAt, 40) } : {}),
        actor: pricingActor,
      });
      await audit(db, {
        actorUserId: actor.id,
        action: 'pricing.draft_saved',
        entityType: 'pricing_version',
        entityId: draft.id,
        detail: `version ${draft.version} fingerprint ${draft.fingerprint}`,
      });
      return json({ ok: true, draft: versionPayload(draft) });
    }

    if (action === 'publish') {
      const id = text(body.id, 120);
      if (!id) return json({ ok: false, error: 'pricing_draft_required' }, 400);
      const published = await publishPricingVersion(db, {
        id,
        note: text(body.note),
        ...(text(body.expectedUpdatedAt, 40) ? { expectedUpdatedAt: text(body.expectedUpdatedAt, 40) } : {}),
        actor: pricingActor,
      });
      await audit(db, {
        actorUserId: actor.id,
        action: 'pricing.published',
        entityType: 'pricing_version',
        entityId: published.id,
        detail: `version ${published.version} fingerprint ${published.fingerprint}`,
      });
      return json({ ok: true, published: versionPayload(published) });
    }

    if (action === 'rollback') {
      const id = text(body.id, 120);
      if (!id) return json({ ok: false, error: 'pricing_version_required' }, 400);
      const published = await rollbackPricingVersion(db, { id, note: text(body.note), actor: pricingActor });
      await audit(db, {
        actorUserId: actor.id,
        action: 'pricing.rolled_back',
        entityType: 'pricing_version',
        entityId: published.id,
        detail: `restored from ${id}; new version ${published.version} fingerprint ${published.fingerprint}`,
      });
      return json({ ok: true, published: versionPayload(published) });
    }

    if (action === 'discard_draft') {
      const id = text(body.id, 120);
      if (!id) return json({ ok: false, error: 'pricing_draft_required' }, 400);
      await discardPricingDraft(db, { id, actor: pricingActor });
      await audit(db, {
        actorUserId: actor.id,
        action: 'pricing.draft_discarded',
        entityType: 'pricing_version',
        entityId: id,
      });
      return json({ ok: true });
    }

    return json({ ok: false, error: 'unknown_action' }, 400);
  } catch (error) {
    const status =
      error instanceof PricingStoreError ? error.status : error instanceof AdminAuthError ? error.status : 500;
    const code =
      error instanceof PricingStoreError ? error.code : error instanceof AdminAuthError ? error.code : 'pricing_action_failed';
    return json({ ok: false, error: code, message: error instanceof Error ? error.message.slice(0, 500) : undefined }, status);
  }
}
