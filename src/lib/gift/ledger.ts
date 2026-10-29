/**
 * Durable gift-certificate ledger. A purchased certificate is a financial
 * liability until redeemed, so every value change is recorded and protected
 * by an ETag-guarded update. R2 is used through the existing private bucket.
 */
import { isGiftActive } from './activation.ts';
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

export interface GiftReservation {
  id: string;
  amountCents: number;
  reference: string;
  createdAt: string;
  expiresAt: string;
  status: 'reserved' | 'committed' | 'released';
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
  validFromDate?: string;
  activatesAt?: string;
  activationTimezone?: string;
  stripeEventId: string;
  stripeSessionId: string;
  issuedAt: string;
  history: GiftRedemption[];
  adjustments?: GiftAdjustment[];
  /** Temporary checkout reservations reduce available value until committed/released. */
  reservations?: GiftReservation[];
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

export function remainingCents(record: GiftCertificateRecord, now = new Date()): number {
  if (record.status === 'refunded' || record.status === 'void') return 0;
  const reserved = (record.reservations ?? [])
    .filter(
      (reservation) =>
        reservation.status === 'reserved' && Date.parse(reservation.expiresAt) > now.getTime(),
    )
    .reduce((sum, reservation) => sum + reservation.amountCents, 0);
  return Math.max(0, record.valueCents - record.redeemedCents - reserved);
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

export type GiftReservationError =
  | 'not_found'
  | 'inactive'
  | 'not_active_yet'
  | 'invalid_amount'
  | 'insufficient_balance'
  | 'conflict'
  | 'not_reserved'
  | 'already_committed'
  | 'released';

export async function reserveGiftCredit(
  bucket: LedgerBucket,
  code: string,
  amountCents: number,
  reference: string,
  options: { ttlMinutes?: number; now?: Date } = {},
): Promise<
  | { ok: true; record: GiftCertificateRecord; reservation: GiftReservation }
  | { ok: false; error: GiftReservationError }
> {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, error: 'invalid_amount' };
  }
  const now = options.now ?? new Date();
  const ttlMinutes = Math.min(120, Math.max(5, Math.round(options.ttlMinutes ?? 30)));
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const stored = await readLedgerJson<GiftCertificateRecord>(bucket, giftKey(code));
    if (!stored) return { ok: false, error: 'not_found' };
    const record = stored.value;
    if (record.status !== 'active') return { ok: false, error: 'inactive' };
    if (!isGiftActive(record, now)) return { ok: false, error: 'not_active_yet' };
    if (amountCents > remainingCents(record, now)) {
      return { ok: false, error: 'insufficient_balance' };
    }
    const reservation: GiftReservation = {
      id: `GR-${crypto.randomUUID()}`,
      amountCents,
      reference: reference.trim().slice(0, 120),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
      status: 'reserved',
    };
    const updated: GiftCertificateRecord = {
      ...record,
      reservations: [...(record.reservations ?? []), reservation],
    };
    if (!stored.etag) return { ok: false, error: 'conflict' };
    try {
      const result = await bucket.put(giftKey(code), JSON.stringify(updated), {
        onlyIf: new Headers({ 'If-Match': stored.etag }),
      });
      if (result !== null && result !== undefined) {
        return { ok: true, record: updated, reservation };
      }
    } catch {
      // Retry from a fresh read.
    }
  }
  return { ok: false, error: 'conflict' };
}

export async function commitGiftReservation(
  bucket: LedgerBucket,
  code: string,
  reservationId: string,
  note: string,
  now = new Date(),
): Promise<
  | { ok: true; record: GiftCertificateRecord; already: boolean }
  | { ok: false; error: GiftReservationError }
> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const stored = await readLedgerJson<GiftCertificateRecord>(bucket, giftKey(code));
    if (!stored) return { ok: false, error: 'not_found' };
    const record = stored.value;
    const reservation = (record.reservations ?? []).find((entry) => entry.id === reservationId);
    if (!reservation) return { ok: false, error: 'not_reserved' };
    if (record.status === 'refunded' || record.status === 'void') return { ok: false, error: 'inactive' };
    if (reservation.status === 'committed') return { ok: true, record, already: true };
    if (reservation.status === 'released') return { ok: false, error: 'released' };
    const otherReservedCents = (record.reservations ?? [])
      .filter(
        (entry) =>
          entry.id !== reservationId &&
          entry.status === 'reserved' &&
          Date.parse(entry.expiresAt) > now.getTime(),
      )
      .reduce((sum, entry) => sum + entry.amountCents, 0);
    const redeemedCents = record.redeemedCents + reservation.amountCents;
    if (redeemedCents + otherReservedCents > record.valueCents) {
      return { ok: false, error: 'insufficient_balance' };
    }
    const updated: GiftCertificateRecord = {
      ...record,
      redeemedCents,
      status: redeemedCents >= record.valueCents ? 'fully_redeemed' : 'active',
      reservations: (record.reservations ?? []).map((entry) =>
        entry.id === reservationId ? { ...entry, status: 'committed' as const } : entry,
      ),
      history: [
        ...record.history,
        {
          at: now.toISOString(),
          amountCents: reservation.amountCents,
          note: note.trim().slice(0, 500),
          reference: reservation.reference,
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

export async function releaseGiftReservation(
  bucket: LedgerBucket,
  code: string,
  reservationId: string,
): Promise<{ ok: true; record: GiftCertificateRecord } | { ok: false; error: GiftReservationError }> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const stored = await readLedgerJson<GiftCertificateRecord>(bucket, giftKey(code));
    if (!stored) return { ok: false, error: 'not_found' };
    const record = stored.value;
    const reservation = (record.reservations ?? []).find((entry) => entry.id === reservationId);
    if (!reservation) return { ok: false, error: 'not_reserved' };
    if (reservation.status === 'committed') return { ok: false, error: 'already_committed' };
    if (reservation.status === 'released') return { ok: true, record };
    const updated: GiftCertificateRecord = {
      ...record,
      reservations: (record.reservations ?? []).map((entry) =>
        entry.id === reservationId ? { ...entry, status: 'released' as const } : entry,
      ),
    };
    if (!stored.etag) return { ok: false, error: 'conflict' };
    try {
      const result = await bucket.put(giftKey(code), JSON.stringify(updated), {
        onlyIf: new Headers({ 'If-Match': stored.etag }),
      });
      if (result !== null && result !== undefined) return { ok: true, record: updated };
    } catch {
      // Retry from a fresh read.
    }
  }
  return { ok: false, error: 'conflict' };
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
  | { ok: false; error: 'not_found' | 'inactive' | 'not_active_yet' | 'invalid_amount' | 'insufficient_balance' | 'conflict' }
> {
  if (!Number.isInteger(amountCents) || amountCents <= 0) return { ok: false, error: 'invalid_amount' };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const stored = await readLedgerJson<GiftCertificateRecord>(bucket, giftKey(code));
    if (!stored) return { ok: false, error: 'not_found' };
    const record = stored.value;
    if (record.status !== 'active') return { ok: false, error: 'inactive' };
    if (!isGiftActive(record, now)) return { ok: false, error: 'not_active_yet' };
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

export type GiftAdjustmentError = 'not_found' | 'inactive' | 'redeemed' | 'reserved' | 'conflict';

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
    if ((record.reservations ?? []).some((entry) => entry.status === 'reserved' && Date.parse(entry.expiresAt) > now.getTime())) {
      return { ok: false, error: 'reserved' };
    }
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
