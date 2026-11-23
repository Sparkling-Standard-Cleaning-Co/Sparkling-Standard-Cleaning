import { adminDb, type AdminDbEnv } from '../../src/lib/admin/d1.ts';
import { createInvoiceCheckoutSession, type StripeBillingEnv } from '../../src/lib/admin/stripe-billing.ts';
import { checkPublicRateLimit, clientIp, consumePublicRateLimit, PUBLIC_RATE_LIMITS } from '../../src/lib/public-rate-limit.ts';
import { loadInvoiceTipView } from '../../src/lib/tips/service.ts';
import { tipLinkSecretConfigured, verifyInvoicePayToken, type TipLinkEnv } from '../../src/lib/tips/token.ts';
import { tipsEnabled } from '../../src/config/tips.ts';

interface Env extends AdminDbEnv, StripeBillingEnv, TipLinkEnv {}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  if (!tipsEnabled(context.env)) return json({ ok: false, error: 'tips_disabled' }, 503);
  const url = new URL(context.request.url);
  const token = (url.searchParams.get('token') ?? '').slice(0, 2000);
  if (!tipLinkSecretConfigured(context.env)) {
    return json({ ok: false, error: 'tips_not_configured' }, 503);
  }
  const verified = await verifyInvoicePayToken(context.env, token);
  if (!verified) return json({ ok: false, error: 'payment_link_invalid' }, 404);
  const view = await loadInvoiceTipView(db, verified.invoiceId);
  if (!view) return json({ ok: false, error: 'invoice_not_found' }, 404);
  if (verified.mode === 'tip' && !view.tipOnly) {
    return json({ ok: false, error: 'invoice_balance_outstanding' }, 409);
  }
  if (
    view.appointmentStatus &&
    String(view.appointmentStatus) !== 'completed' &&
    (verified.mode === 'tip' || view.tipOnly)
  ) {
    return json({ ok: false, error: 'service_not_completed' }, 409);
  }
  return json({ ok: true, mode: verified.mode, expiresAt: verified.expiresAt, invoice: view });
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'database_not_configured' }, 503);
  if (!tipsEnabled(context.env)) return json({ ok: false, error: 'tips_disabled' }, 503);
  if (!sameOrigin(context.request)) return json({ ok: false, error: 'origin_invalid' }, 403);
  if (!tipLinkSecretConfigured(context.env)) {
    return json({ ok: false, error: 'tips_not_configured' }, 503);
  }
  const ip = clientIp(context.request);
  const status = await checkPublicRateLimit(db, 'invoice-pay-ip', ip, PUBLIC_RATE_LIMITS.portalActionIp);
  if (status.limited) {
    return json({ ok: false, error: 'rate_limited', retryAfterSeconds: status.retryAfterSeconds }, 429);
  }
  await consumePublicRateLimit(db, 'invoice-pay-ip', ip, PUBLIC_RATE_LIMITS.portalActionIp);
  const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
  const token = String(body.token ?? '').slice(0, 2000);
  const verified = await verifyInvoicePayToken(context.env, token);
  if (!verified) return json({ ok: false, error: 'payment_link_invalid' }, 404);
  const tipCents = Math.round(Number(body.tipCents) || 0);
  try {
    const result = await createInvoiceCheckoutSession(db, verified.invoiceId, context.env, {
      tipCents,
      mode: verified.mode,
      token,
    });
    return json({ ok: true, ...result });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'payment_session_failed';
    return json({ ok: false, error: code }, code === 'invoice_not_found' ? 404 : 409);
  }
}
