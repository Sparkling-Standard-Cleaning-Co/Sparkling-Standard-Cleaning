import { AdminAuthError, audit, requireActor, requireCsrf } from '../../../src/lib/admin/operations.ts';
import { verifyPassword } from '../../../src/lib/admin/auth.ts';
import type { AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { giftBucket, lookupGiftCertificate, redeemGiftCertificate, remainingCents, voidGiftCertificate, type GiftCertificateRecord, type GiftStorageEnv } from '../../../src/lib/gift/ledger.ts';
import { isGiftActive, activationDateFor } from '../../../src/lib/gift/activation.ts';
import { readLedgerJson } from '../../../src/lib/payments/ledger.ts';

interface Env extends GiftStorageEnv, AdminDbEnv {}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  try {
    if (!context.env.DB) return json({ ok: false, error: 'database_not_configured' }, 503);
    await requireActor(context.env.DB, context.request, 'finance.read');
    const bucket = giftBucket(context.env);
    if (!bucket) return json({ ok: true, configured: false, records: [], summary: null });
    const listed = bucket.list ? await bucket.list({ prefix: 'gifts/certificates/' }) : { objects: [] };
    const records: Array<Record<string, unknown>> = [];
    let issued = 0;
    let active = 0;
    let value = 0;
    let redeemed = 0;
    let outstanding = 0;
    let refunded = 0;
    let voided = 0;
    for (const item of listed.objects.slice(0, 500)) {
      const stored = await readLedgerJson<GiftCertificateRecord>(bucket, item.key).catch(() => null);
      if (!stored?.value) continue;
      const record = stored.value;
      issued += 1;
      value += Number(record.valueCents) || 0;
      redeemed += Number(record.redeemedCents) || 0;
      outstanding += remainingCents(record);
      if (record.status === 'active' && isGiftActive(record)) active += 1;
      if (record.status === 'refunded') refunded += 1;
      if (record.status === 'void') voided += 1;
      records.push({
        code: record.code,
        status: record.status,
        active: isGiftActive(record),
        valueCents: record.valueCents,
        redeemedCents: record.redeemedCents,
        remainingCents: remainingCents(record),
        recipientName: record.recipientName,
        purchaserName: record.purchaserName,
        validFromDate: activationDateFor(record),
        issuedAt: record.issuedAt,
      });
    }
    records.sort((a, b) => String(b.issuedAt).localeCompare(String(a.issuedAt)));
    return json({
      ok: true,
      configured: true,
      summary: { issuedCount: issued, activeCount: active, valueCents: value, redeemedCents: redeemed, outstandingCents: outstanding, refundedCount: refunded, voidedCount: voided },
      records: records.slice(0, 200),
    });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'gifts_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  try {
    if (!context.env.DB) return json({ ok: false, error: 'database_not_configured' }, 503);
    const actor = await requireActor(context.env.DB, context.request, 'finance.write');
    requireCsrf(context.request, actor);
    const body = (await context.request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action !== 'redeem' && action !== 'void') {
      return json({ ok: false, error: 'invalid_action' }, 400);
    }
    const code = String(body.code ?? '').trim().toUpperCase();
    if (!/^SSGC-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) return json({ ok: false, error: 'invalid_code' }, 400);
    const password = String(body.password ?? '');
    const stored = await context.env.DB
      .prepare('SELECT password_hash FROM admin_users WHERE id = ? LIMIT 1')
      .bind(actor.id)
      .first<{ password_hash: string }>();
    if (!stored || !(await verifyPassword(password, stored.password_hash))) {
      await audit(context.env.DB, { actorUserId: actor.id, action: 'gift.step_up_failed', success: false });
      return json({ ok: false, error: 'reauth_failed' }, 401);
    }
    const bucket = giftBucket(context.env);
    if (!bucket) return json({ ok: false, error: 'gift_storage_not_configured' }, 503);
    if (action === 'redeem') {
      const amountCents = Math.round(Number(body.amountCents) || 0);
      if (amountCents <= 0) return json({ ok: false, error: 'amount_invalid' }, 400);
      const result = await redeemGiftCertificate(
        bucket,
        code,
        amountCents,
        String(body.note ?? ''),
        String(body.reference ?? ''),
      );
      if (!result.ok) return json({ ok: false, error: result.error }, 409);
      await audit(context.env.DB, {
        actorUserId: actor.id,
        action: 'gift.redeemed',
        entityType: 'gift_certificate',
        entityId: code,
        detail: String(amountCents),
      });
      return json({
        ok: true,
        redeemedCents: result.redeemedCents,
        certificate: {
          code: result.record.code,
          status: result.record.status,
          remainingCents: remainingCents(result.record),
          valueCents: result.record.valueCents,
        },
      });
    }
    const existing = await lookupGiftCertificate(bucket, code);
    if (!existing) return json({ ok: false, error: 'not_found' }, 404);
    const result = await voidGiftCertificate(
      bucket,
      code,
      String(body.note ?? ''),
      String(body.reference ?? ''),
    );
    if (!result.ok) return json({ ok: false, error: result.error }, 409);
    await audit(context.env.DB, {
      actorUserId: actor.id,
      action: 'gift.voided',
      entityType: 'gift_certificate',
      entityId: code,
    });
    return json({ ok: true, already: result.already, certificate: { code: result.record.code, status: result.record.status } });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof AdminAuthError ? error.code : 'gift_action_failed' },
      error instanceof AdminAuthError ? error.status : 500,
    );
  }
}