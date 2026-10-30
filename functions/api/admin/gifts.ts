import { AdminAuthError, requireActor } from '../../../src/lib/admin/operations.ts';
import type { AdminDbEnv } from '../../../src/lib/admin/d1.ts';
import { giftBucket, remainingCents, type GiftCertificateRecord, type GiftStorageEnv } from '../../../src/lib/gift/ledger.ts';
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
