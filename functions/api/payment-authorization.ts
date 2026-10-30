import { adminDb, type AdminDbEnv } from '../../src/lib/admin/d1.ts';
import { getPaymentAuthorization, signPaymentAuthorization } from '../../src/lib/admin/payment-authorization.ts';
import { createSavedCardSetupSession, type StripeBillingEnv } from '../../src/lib/admin/stripe-billing.ts';

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
  const token = new URL(context.request.url).searchParams.get('token') ?? '';
  const authorization = await getPaymentAuthorization(db, token);
  if (!authorization) return json({ ok: false, error: 'authorization_not_found' }, 404);
  return json({
    ok: true,
    authorization: {
      ...authorization,
      content: authorization.content,
    },
  });
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
  const token = String(body.token ?? '');
  if (String(body.action ?? '') !== 'sign') return json({ ok: false, error: 'invalid_action' }, 400);
  try {
    const result = await signPaymentAuthorization(db, token, {
      signerName: String(body.signerName ?? ''),
      consent: body.consent === true,
    }, context.request);
    let setupUrl: string | null = null;
    if (context.env.ADMIN_STRIPE_SAVED_CARDS_ENABLED === 'true') {
      const setup = await createSavedCardSetupSession(db, null, result.authorizationId, context.env);
      setupUrl = setup.url;
    }
    return json({ ok: true, ...result, setupUrl });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'signature_failed';
    return json({ ok: false, error: code }, 400);
  }
}
