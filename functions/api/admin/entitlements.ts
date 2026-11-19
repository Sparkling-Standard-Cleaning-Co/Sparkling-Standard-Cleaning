import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, requireActor, requireCsrf } from '../../../src/lib/admin/operations.ts';
import {
  applyCustomerEntitlement,
  listCustomerEntitlements,
  previewCustomerEntitlement,
  removeCustomerEntitlement,
  FRIENDS15_CODE,
} from '../../../src/lib/promotions/entitlements.ts';

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
    const actor = await requireActor(db, context.request, 'customer.read');
    if (actor.role !== 'owner') return json({ ok: false, error: 'owner_required' }, 403);
    const url = new URL(context.request.url);
    const customerId = url.searchParams.get('customerId') ?? '';
    if (!customerId) return json({ ok: false, error: 'customer_required' }, 400);
    if (url.searchParams.get('view') === 'preview') {
      return json({
        ok: true,
        preview: await previewCustomerEntitlement(
          db,
          actor,
          customerId,
          url.searchParams.get('code') || FRIENDS15_CODE,
        ),
      });
    }
    return json({ ok: true, ...(await listCustomerEntitlements(db, actor, customerId)) });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'entitlements_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'customer.write');
    if (actor.role !== 'owner') return json({ ok: false, error: 'owner_required' }, 403);
    requireCsrf(context.request, actor);
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? '');
    const customerId = String(body.customerId ?? '');
    if (!customerId) return json({ ok: false, error: 'customer_required' }, 400);
    if (action === 'apply') {
      return json({
        ok: true,
        ...(await applyCustomerEntitlement(db, actor, {
          customerId,
          code: String(body.code ?? FRIENDS15_CODE),
          previewToken: String(body.previewToken ?? ''),
        })),
      });
    }
    if (action === 'remove') {
      return json({
        ok: true,
        ...(await removeCustomerEntitlement(db, actor, {
          customerId,
          entitlementId: String(body.entitlementId ?? ''),
          reason: String(body.reason ?? ''),
        })),
      });
    }
    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'entitlement_update_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
