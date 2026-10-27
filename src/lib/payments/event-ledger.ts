// Durable idempotency records for Stripe webhook events.
//
// Cloudflare Functions may run in independent isolates. Process memory is not
// a financial ledger. The event id is claimed in the private R2 ledger before
// the owner notification is attempted; duplicate deliveries then find the
// record and do not fulfill twice.

import {
  createLedgerJson,
  ledgerKey,
  readLedgerJson,
  writeLedgerJson,
  type LedgerBucket,
} from './ledger.ts';

export type PaymentEventKind = 'estimate' | 'gift';
export type PaymentEventStatus = 'processing' | 'notified' | 'failed' | 'incomplete';

const PROCESSING_STALE_MS = 2 * 60_000;

export interface PaymentEventRecord {
  version: 1;
  eventId: string;
  kind: PaymentEventKind;
  status: PaymentEventStatus;
  attempts: number;
  firstSeenAt: string;
  updatedAt: string;
  sessionId: string;
  amountCents: number | null;
  reference: string;
  serviceType: string;
  customerName?: string;
  customerEmail?: string;
  lastError?: string;
  /** Gift details, only when kind is gift. */
  gift?: {
    valueUsd: number;
    recipientName: string;
    purchaserName: string;
    purchaserEmail: string;
    recipientEmail?: string;
    message?: string;
    deliveryDate?: string;
  };
}

export type EventClaimResult =
  | { action: 'process'; record: PaymentEventRecord }
  | { action: 'duplicate' }
  | { action: 'busy' };

function eventKey(eventId: string): string {
  return ledgerKey('events', eventId);
}

export async function claimPaymentEvent(
  bucket: LedgerBucket,
  eventId: string,
  seed: Omit<
    PaymentEventRecord,
    'version' | 'status' | 'attempts' | 'firstSeenAt' | 'updatedAt'
  >,
): Promise<EventClaimResult> {
  const key = eventKey(eventId);
  const now = new Date().toISOString();
  const existing = await readLedgerJson<PaymentEventRecord>(bucket, key);
  if (existing) {
    if (existing.value.status === 'notified' || existing.value.status === 'incomplete') {
      return { action: 'duplicate' };
    }
    const age = Date.now() - Date.parse(existing.value.updatedAt);
    if (existing.value.status === 'processing' && Number.isFinite(age) && age < PROCESSING_STALE_MS) {
      return { action: 'busy' };
    }
    const record: PaymentEventRecord = {
      ...existing.value,
      ...seed,
      status: 'processing',
      attempts: existing.value.attempts + 1,
      updatedAt: now,
    };
    await writeLedgerJson(bucket, key, record);
    return { action: 'process', record };
  }

  const record: PaymentEventRecord = {
    ...seed,
    version: 1,
    status: 'processing',
    attempts: 1,
    firstSeenAt: now,
    updatedAt: now,
  };
  const claimed = await createLedgerJson(bucket, key, record);
  if (claimed) return { action: 'process', record };

  const current = await readLedgerJson<PaymentEventRecord>(bucket, key);
  if (!current) return { action: 'busy' };
  if (current.value.status === 'notified' || current.value.status === 'incomplete') {
    return { action: 'duplicate' };
  }
  return { action: 'busy' };
}

export async function completePaymentEvent(
  bucket: LedgerBucket,
  eventId: string,
  record: PaymentEventRecord,
): Promise<void> {
  await writeLedgerJson(bucket, eventKey(eventId), {
    ...record,
    status: 'notified',
    updatedAt: new Date().toISOString(),
  });
}

export async function failPaymentEvent(
  bucket: LedgerBucket,
  eventId: string,
  record: PaymentEventRecord,
  reason: string,
): Promise<void> {
  await writeLedgerJson(bucket, eventKey(eventId), {
    ...record,
    status: 'failed',
    lastError: reason.slice(0, 80),
    updatedAt: new Date().toISOString(),
  });
}

export async function incompletePaymentEvent(
  bucket: LedgerBucket,
  eventId: string,
  record: PaymentEventRecord,
  reason: string,
): Promise<void> {
  await writeLedgerJson(bucket, eventKey(eventId), {
    ...record,
    status: 'incomplete',
    lastError: reason.slice(0, 80),
    updatedAt: new Date().toISOString(),
  });
}
