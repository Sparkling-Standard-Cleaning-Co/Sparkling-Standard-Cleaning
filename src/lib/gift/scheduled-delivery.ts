// Durable scheduled gift-certificate delivery records. A paid scheduled gift
// must survive isolate/function restarts even when no email is sent at
// purchase time. The owner-authenticated processor is the delivery trigger.
import {
  createLedgerJson,
  readLedgerJson,
  writeLedgerJson,
  type LedgerBucket,
} from '../payments/ledger.ts';

export type ScheduledDeliveryStatus = 'pending' | 'sent' | 'failed' | 'cancelled';

export interface ScheduledGiftDelivery {
  version: 1;
  code: string;
  valueUsd: number;
  recipientName: string;
  recipientEmail: string;
  purchaserName: string;
  purchaserEmail: string;
  message?: string;
  deliveryDate: string;
  deliveryMethod: 'recipient_email';
  deliveryTiming: 'scheduled';
  paidAtIso: string;
  stripeEventId: string;
  stripeSessionId: string;
  status: ScheduledDeliveryStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  lastError?: string;
}

export function scheduledDeliveryKey(code: string): string {
  return `gifts/deliveries/${code.trim().toUpperCase()}.json`;
}

export async function createScheduledGiftDelivery(
  bucket: LedgerBucket,
  delivery: ScheduledGiftDelivery,
): Promise<{ delivery: ScheduledGiftDelivery; created: boolean }> {
  const key = scheduledDeliveryKey(delivery.code);
  const created = await createLedgerJson(bucket, key, delivery);
  if (created) return { delivery, created: true };
  const existing = await readLedgerJson<ScheduledGiftDelivery>(bucket, key);
  if (!existing) throw new Error('scheduled_gift_delivery_conflict');
  return { delivery: existing.value, created: false };
}

export async function listScheduledGiftDeliveries(
  bucket: LedgerBucket,
  options: { dueOnOrBefore?: string } = {},
): Promise<ScheduledGiftDelivery[]> {
  if (!bucket.list) return [];
  const listed = await bucket.list({ prefix: 'gifts/deliveries/' });
  const deliveries: ScheduledGiftDelivery[] = [];
  for (const item of listed.objects) {
    const stored = await readLedgerJson<ScheduledGiftDelivery>(bucket, item.key).catch(() => null);
    if (!stored?.value) continue;
    if (stored.value.status !== 'pending') continue;
    if (options.dueOnOrBefore && stored.value.deliveryDate > options.dueOnOrBefore) continue;
    deliveries.push(stored.value);
  }
  return deliveries.sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
}

export async function markScheduledGiftDelivery(
  bucket: LedgerBucket,
  delivery: ScheduledGiftDelivery,
  status: ScheduledDeliveryStatus,
  error?: string,
): Promise<ScheduledGiftDelivery> {
  const updated: ScheduledGiftDelivery = {
    ...delivery,
    status,
    attempts: delivery.attempts + 1,
    updatedAt: new Date().toISOString(),
    ...(status === 'sent' ? { sentAt: new Date().toISOString() } : {}),
    ...(error ? { lastError: error.slice(0, 300) } : {}),
  };
  await writeLedgerJson(bucket, scheduledDeliveryKey(delivery.code), updated);
  return updated;
}

export async function cancelScheduledGiftDelivery(
  bucket: LedgerBucket,
  code: string,
): Promise<boolean> {
  const key = scheduledDeliveryKey(code);
  const stored = await readLedgerJson<ScheduledGiftDelivery>(bucket, key);
  if (!stored || stored.value.status !== 'pending') return false;
  const updated: ScheduledGiftDelivery = {
    ...stored.value,
    status: 'cancelled',
    updatedAt: new Date().toISOString(),
  };
  await writeLedgerJson(bucket, key, updated);
  return true;
}
