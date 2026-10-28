/**
 * Durable gift-certificate ledger. A purchased certificate is a financial
 * liability until redeemed, so every value change is recorded and protected
 * by an ETag-guarded update. R2 is used through the existing private bucket.
 */
import {
  createLedgerJson,
  readLedgerJson,
  type LedgerBucket,
  type PaymentStorageEnv,
} from '../payments/ledger.ts';

export interface GiftRedemption {
  at: string;
  amountCents: number;
  note: string;
  reference: string;
}

export interface GiftAdjustment {
  at: string;
  kind: 'refund' | 'void';
  amountCents: number;
  note: string;
  reference: string;
  stripeRefundId?: string;
}

export interface GiftCertificateRecord {
  version: 1;
  code: string;
  status: 'active' | 'fully_redeemed' | 'refunded' | 'void';
  valueCents: number;
  redeemedCents: number;
  recipientName: string;
  purchaserName: string;
  purchaserEmail: string;
  recipientEmail?: string;
  message?: string;
  deliveryDate?: string;
  stripeEventId: string;
  stripeSessionId: string;
  issuedAt: string;
  history: GiftRedemption[];
  adjustments?: GiftAdjustment[];
}

export interface GiftStorageEnv extends PaymentStorageEnv {
  GIFT_LEDGER?: LedgerBucket;
}

export function giftBucket(env: GiftStorageEnv): LedgerBucket | null {
  return env.GIFT_LEDGER ?? env.PAYMENT_LEDGER ?? env.PHOTOS_BUCKET ?? null;
}

export function giftKey(code: string): string {
  return `gifts/certificates/${code.trim().toUpperCase()}.json`;
}

export function remainingCents(record: GiftCertificateRecord): number {
  if (record.status === 'refunded' || record.status === 'void') return 0;
  return Math.max(0, record.valueCents - record.redeemedCents);
}

export async function issueGiftCertificate(
  bucket: LedgerBucket,
  record: GiftCertificateRecord,
): Promise<{ record: GiftCertificateRecord; created: boolean }> {
  const created = await createLedgerJson(bucket, giftKey(record.code), record);
  if (created) return { record, created: true };
  const existing = await readLedgerJson<GiftCertificateRecord>(bucket, giftKey(record.code));
  if (!existing) throw new Error('gift_issue_conflict');
  return { record: existing.value, created: false };
}

export async function lookupGiftCertificate(
  bucket: LedgerBucket,
  code: string,
): Promise<GiftCertificateRecord | null> {
  const stored = await readLedgerJson<GiftCertificateRecord>(bucket, giftKey(code));
  return stored?.value ?? null;
}

export async function redeemGiftCertificate(
  bucket: LedgerBucket,
  code: string,
  amountCents: number,
  note: string,
  reference: string,
  now = new Date(),
): Promise<
  | { ok: true; record: GiftCertificateRecord; redeemedCents: number }
  | { ok: false; error: 'not_found' | 'inactive' | 'invalid_amount' | 'insufficient_balance' | 'conflict' }
> {
  if (!Number.isInteger(amountCents) || amountCents <= 0) return { ok: false, error: 'invalid_amount' };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const stored = await readLedgerJson<GiftCertificateRecord>(bucket, giftKey(code));
    if (!stored) return { ok: false, error: 'not_found' };
    const record = stored.value;
    if (record.status !== 'active') return { ok: false, error: 'inactive' };
    if (amountCents > remainingCents(record)) return { ok: false, error: 'insufficient_balance' };
    const redeemedCents = record.redeemedCents + amountCents;
    const updated: GiftCertificateRecord = {
      ...record,
      redeemedCents,
      status: redeemedCents >= record.valueCents ? 'fully_redeemed' : 'active',
      history: [
        ...record.history,
        {
          at: now.toISOString(),
          amountCents,
          note: note.trim().slice(0, 500),
          reference: reference.trim().slice(0, 120),
        },
      ],
    };
    if (!stored.etag) {
      // A provider without ETags cannot guarantee a safe concurrent update.
      return { ok: false, error: 'conflict' };
    }
    try {
      const result = await bucket.put(giftKey(code), JSON.stringify(updated), {
        onlyIf: new Headers({ 'If-Match': stored.etag }),
      });
      if (result !== null && result !== undefined) return { ok: true, record: updated, redeemedCents };
    } catch {
      // Retry from a fresh read.
    }
  }
  return { ok: false, error: 'conflict' };
}

export type GiftAdjustmentError = 'not_found' | 'inactive' | 'redeemed' | 'conflict';

async function adjustGiftCertificate(
  bucket: LedgerBucket,
  code: string,
  kind: 'refund' | 'void',
  note: string,
  reference: string,
  stripeRefundId: string | undefined,
  now: Date,
): Promise<
  | { ok: true; record: GiftCertificateRecord; already: boolean }
  | { ok: false; error: GiftAdjustmentError }
> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const stored = await readLedgerJson<GiftCertificateRecord>(bucket, giftKey(code));
    if (!stored) return { ok: false, error: 'not_found' };
    const record = stored.value;
    if (record.status === (kind === 'refund' ? 'refunded' : 'void')) {
      return { ok: true, record, already: true };
    }
    if (record.status !== 'active') return { ok: false, error: 'inactive' };
    if (record.redeemedCents > 0) return { ok: false, error: 'redeemed' };
    const updated: GiftCertificateRecord = {
      ...record,
      status: kind === 'refund' ? 'refunded' : 'void',
      adjustments: [
        ...(record.adjustments ?? []),
        {
          at: now.toISOString(),
          kind,
          amountCents: record.valueCents,
          note: note.trim().slice(0, 500),
          reference: reference.trim().slice(0, 120),
          ...(stripeRefundId ? { stripeRefundId: stripeRefundId.slice(0, 120) } : {}),
        },
      ],
    };
    if (!stored.etag) return { ok: false, error: 'conflict' };
    try {
      const result = await bucket.put(giftKey(code), JSON.stringify(updated), {
        onlyIf: new Headers({ 'If-Match': stored.etag }),
      });
      if (result !== null && result !== undefined) return { ok: true, record: updated, already: false };
    } catch {
      // Retry from a fresh read.
    }
  }
  return { ok: false, error: 'conflict' };
}

export async function refundGiftCertificate(
  bucket: LedgerBucket,
  code: string,
  note: string,
  reference: string,
  stripeRefundId: string,
  now = new Date(),
): Promise<
  | { ok: true; record: GiftCertificateRecord; already: boolean }
  | { ok: false; error: GiftAdjustmentError }
> {
  return adjustGiftCertificate(bucket, code, 'refund', note, reference, stripeRefundId, now);
}

export async function voidGiftCertificate(
  bucket: LedgerBucket,
  code: string,
  note: string,
  reference: string,
  now = new Date(),
): Promise<
  | { ok: true; record: GiftCertificateRecord; already: boolean }
  | { ok: false; error: GiftAdjustmentError }
> {
  return adjustGiftCertificate(bucket, code, 'void', note, reference, undefined, now);
}
