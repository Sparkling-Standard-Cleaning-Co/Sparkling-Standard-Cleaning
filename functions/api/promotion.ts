// POST /api/promotion - validate a customer promo code against current rules.
// Returns only the eligible discount and public name; never internal IDs.

import { adminDb, type AdminDbEnv } from '../../src/lib/admin/d1.ts';
import { evaluatePromotionForQuote } from '../../src/lib/promotions/service.ts';

interface Env extends AdminDbEnv {}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const db = adminDb(context.env);
  if (!db) return json({ ok: false, error: 'promotion_unavailable' }, 503);
  const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
  const cleaningAmount = Math.max(0, Math.round(Number(body.cleaningAmountCents) || 0));
  if (cleaningAmount <= 0) return json({ ok: false, error: 'promotion_quote_required' }, 400);
  const result = await evaluatePromotionForQuote(db, {
    code: String(body.code ?? ''),
    cleaningAmountCents: cleaningAmount,
    serviceType: String(body.serviceType ?? ''),
    branchId: String(body.branchId ?? 'branch_pensacola'),
    frequency: String(body.frequency ?? ''),
    quoteReference: String(body.quoteReference ?? ''),
    holdId: String(body.holdId ?? ''),
    hasExistingDiscount: body.hasExistingDiscount === true,
  });
  if (!result.ok) return json({ ok: false, error: result.reason }, 409);
  return json({
    ok: true,
    code: result.promotion?.code,
    name: result.promotion?.name,
    discountCents: result.discountCents,
  });
}

export async function onRequestGet(): Promise<Response> {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
