import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, requireActor, requireCsrf } from '../../../src/lib/admin/operations.ts';
import { pricing } from '../../../src/config/pricing.ts';
import {
  createPromotion,
  duplicatePromotion,
  getPromotion,
  listPromotions,
  setPromotionStatus,
  updatePromotion,
  type PromotionStatus,
} from '../../../src/lib/promotions/service.ts';

interface Env extends AdminDbEnv {}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request);
    if (actor.role !== 'owner') return json({ ok: false, error: 'owner_required' }, 403);
    const id = new URL(context.request.url).searchParams.get('id') ?? '';
    if (id) {
      const promotion = await getPromotion(db, id);
      if (!promotion) return json({ ok: false, error: 'promotion_not_found' }, 404);
      return json({ ok: true, promotion });
    }
    const campaign = pricing.promotions.campaign.value;
    const legacy = [
      ...(campaign
        ? [
            {
              id: `legacy-${campaign.code}`,
              name: 'SPARKLE15 welcome campaign',
              code: campaign.code,
              kind: campaign.kind,
              percent: campaign.kind === 'percent' ? campaign.value : 0,
              valueCents: campaign.kind === 'fixed' ? Math.round((campaign.value ?? 0) * 100) : 0,
              services: campaign.services,
              branches: ['branch_pensacola'],
              startsAt: null,
              expiresAt: campaign.expiresOn,
              maxRedemptions: 0,
              perCustomerLimit: 1,
              combinable: false,
              status: campaign.enabled ? 'active' : 'disabled',
              displayStatus: campaign.enabled ? 'active' : 'disabled',
              scope: 'cleaning',
              source: 'legacy_static',
              editable: false,
              redeemedCount: null,
              note: 'Claim-only welcome campaign; redemption eligibility is confirmed by the owner.',
            },
            ...(campaign.legacy ?? []).map((entry) => ({
              id: `legacy-${entry.code}`,
              name: entry.label,
              code: entry.code,
              kind: 'fixed',
              percent: 0,
              valueCents: Math.round(entry.value * 100),
              services: campaign.services,
              branches: ['branch_pensacola'],
              startsAt: null,
              expiresAt: campaign.expiresOn,
              maxRedemptions: 0,
              perCustomerLimit: 1,
              combinable: false,
              status: campaign.enabled ? 'legacy' : 'disabled',
              displayStatus: campaign.enabled ? 'legacy' : 'disabled',
              scope: 'cleaning',
              source: 'legacy_static',
              editable: false,
              redeemedCount: null,
              note: 'Historical claim code retained for existing customers; not promoted.',
            })),
          ]
        : []),
      ...pricing.promotions.addonBundles.map((bundle) => ({
        id: `bundle-${bundle.id}`,
        name: bundle.label,
        code: bundle.id,
        kind: bundle.kind,
        percent: bundle.kind === 'percent' ? Math.round((bundle.value ?? 0) * 100) : 0,
        valueCents: bundle.kind === 'fixed' ? Math.round((bundle.value ?? 0) * 100) : 0,
        services: ['residential'],
        branches: ['branch_pensacola'],
        startsAt: null,
        expiresAt: bundle.expiresOn,
        maxRedemptions: 0,
        perCustomerLimit: 0,
        combinable: false,
        status: bundle.enabled ? 'active' : 'disabled',
        displayStatus: bundle.enabled ? 'active' : 'disabled',
        scope: 'cleaning',
        source: 'legacy_bundle',
        editable: false,
        redeemedCount: null,
        note: 'Automatic add-on bundle; managed in pricing configuration.',
      })),
      {
        id: 'legacy-community-support',
        name: 'Community Support Cleaning',
        code: 'COMMUNITY10',
        kind: 'percent',
        percent: pricing.supportiveHomeDiscount.percent.value,
        valueCents: 0,
        services: pricing.supportiveHomeDiscount.eligibleServices.value,
        branches: ['branch_pensacola'],
        startsAt: null,
        expiresAt: null,
        maxRedemptions: 0,
        perCustomerLimit: 1,
        combinable: false,
        status: pricing.supportiveHomeDiscount.enabled.value ? 'active' : 'disabled',
        displayStatus: pricing.supportiveHomeDiscount.enabled.value ? 'active' : 'disabled',
        scope: 'cleaning',
        source: 'legacy_eligibility',
        editable: false,
        redeemedCount: null,
        note: 'Eligibility discount; owner confirms eligibility.',
      },
      {
        id: 'legacy-church-discount',
        name: 'Church Cleaning Discount',
        code: 'CHURCH10',
        kind: 'percent',
        percent: pricing.churchDiscount.percent.value,
        valueCents: 0,
        services: ['church_cleaning'],
        branches: ['branch_pensacola'],
        startsAt: null,
        expiresAt: null,
        maxRedemptions: 0,
        perCustomerLimit: 0,
        combinable: false,
        status: pricing.churchDiscount.enabled.value ? 'active' : 'disabled',
        displayStatus: pricing.churchDiscount.enabled.value ? 'active' : 'disabled',
        scope: 'cleaning',
        source: 'legacy_eligibility',
        editable: false,
        redeemedCount: null,
        note: 'Owner-directed church discount; applied after the minimum.',
      },
    ];
    return json({ ok: true, promotions: await listPromotions(db), legacyPromotions: legacy });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'promotions_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request);
    if (actor.role !== 'owner') return json({ ok: false, error: 'owner_required' }, 403);
    requireCsrf(context.request, actor);
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action === 'create') return json({ ok: true, ...(await createPromotion(db, actor.id, body)) });
    if (action === 'update') {
      return json({
        ok: true,
        ...(await updatePromotion(db, actor.id, String(body.id ?? ''), body)),
      });
    }
    if (action === 'status') {
      const status = String(body.status ?? 'draft');
      if (!['draft', 'active', 'disabled', 'expired'].includes(status)) {
        return json({ ok: false, error: 'promotion_status_invalid' }, 400);
      }
      await setPromotionStatus(db, String(body.id ?? ''), status as PromotionStatus);
      return json({ ok: true });
    }
    if (action === 'duplicate') {
      return json({ ok: true, ...(await duplicatePromotion(db, actor.id, String(body.id ?? ''))) });
    }
    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : (error as Error).message || 'promotion_update_failed' },
      error instanceof AdminAuthError ? error.status : 400,
    );
  }
}
