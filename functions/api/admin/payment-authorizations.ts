import { adminDb, type AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { AdminAuthError, requireActor, requireCsrf } from '../../../src/lib/admin/operations.ts';
import { verifyPassword } from '../../../src/lib/admin/auth.ts';
import { createPaymentAuthorization, listPaymentAuthorizations } from '../../../src/lib/admin/payment-authorization.ts';
import { chargeInvoiceWithAuthorization, type StripeBillingEnv } from '../../../src/lib/admin/stripe-billing.ts';

interface Env extends AdminDbEnv, StripeBillingEnv {}

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
    await requireActor(db, context.request, 'finance.read');
    const customerId = new URL(context.request.url).searchParams.get('customerId') ?? '';
    if (!customerId) return json({ ok: false, error: 'customer_required' }, 400);
    return json({ ok: true, authorizations: await listPaymentAuthorizations(db, customerId) });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'authorizations_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  try {
    const actor = await requireActor(db, context.request, 'finance.write');
    requireCsrf(context.request, actor);
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action === 'create') {
      const result = await createPaymentAuthorization(db, actor, {
        customerId: String(body.customerId ?? ''),
        ...(body.propertyId ? { propertyId: String(body.propertyId) } : {}),
        serviceCode: String(body.serviceCode ?? 'residential-cleaning'),
        amountCents: Number(body.amountCents) || 0,
        maxAmountCents: Number(body.maxAmountCents) || 0,
        chargeAfterService: body.chargeAfterService !== false,
      });
      const origin = (context.env.PUBLIC_SITE_URL?.trim() || new URL(context.request.url).origin).replace(/\/+$/, '');
      const link = `${origin}/payment-authorization/?token=${encodeURIComponent(result.token)}`;
      return json({ ok: true, ...result, link });
    }
    if (action === 'charge_invoice') {
      const stored = await db.prepare('SELECT password_hash FROM admin_users WHERE id = ? LIMIT 1').bind(actor.id).first<{ password_hash: string }>();
      if (!stored || !(await verifyPassword(String(body.password ?? ''), stored.password_hash))) {
        return json({ ok: false, error: 'reauth_failed' }, 401);
      }
      const charge = await chargeInvoiceWithAuthorization(
        db,
        actor,
        String(body.invoiceId ?? ''),
        String(body.authorizationId ?? ''),
        context.env,
      );
      return json({ ok: true, ...charge });
    }
    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'authorization_update_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}
