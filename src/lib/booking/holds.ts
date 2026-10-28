/**
 * Durable, expiring booking holds. A hold is a TEMPORARY capacity reservation,
 * not a confirmed appointment. All writes for one day are serialized with an
 * R2 conditional lock so two customers cannot hold overlapping time.
 */
import {
  createLedgerJson,
  deleteLedgerKey,
  paymentLedger,
  readLedgerJson,
  writeLedgerJson,
  type LedgerBucket,
  type PaymentStorageEnv,
} from '../payments/ledger.ts';

export interface BookingHold {
  version: 1;
  id: string;
  date: string;
  start: string;
  end: string;
  durationMinutes: number;
  destination: { lat: number; lng: number };
  locationText: string;
  reference: string;
  createdAt: string;
  expiresAt: string;
  status: 'held' | 'released' | 'confirmed';
  calendarEventId?: string;
}

export type BookingStorageEnv = PaymentStorageEnv;

export function bookingStore(env: BookingStorageEnv): LedgerBucket | null {
  return paymentLedger(env);
}

function holdPrefix(date: string): string {
  return `booking/holds/${date}__`;
}

export function holdKey(id: string): string {
  return `booking/holds/${id}.json`;
}

function lockKey(date: string): string {
  return `booking/locks/${date}.json`;
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withDayLock<T>(
  bucket: LedgerBucket,
  date: string,
  run: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: 'busy' }> {
  const key = lockKey(date);
  let acquired = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = crypto.randomUUID();
    const created = await createLedgerJson(bucket, key, {
      token,
      expiresAt: new Date(Date.now() + 8_000).toISOString(),
    });
    if (created) {
      acquired = true;
      break;
    }
    const existing = await readLedgerJson<{ expiresAt?: string }>(bucket, key).catch(() => null);
    const expiresAt = existing?.value.expiresAt ? Date.parse(existing.value.expiresAt) : 0;
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
      await bucket.delete?.(key);
      continue;
    }
    await sleep(120);
  }
  if (!acquired) return { ok: false, error: 'busy' };
  try {
    return { ok: true, value: await run() };
  } finally {
    await deleteLedgerKey(bucket, key).catch(() => undefined);
  }
}

export async function listActiveHolds(bucket: LedgerBucket, date: string): Promise<BookingHold[]> {
  if (!bucket.list) return [];
  const listed = await bucket.list({ prefix: holdPrefix(date) });
  const holds: BookingHold[] = [];
  for (const item of listed.objects) {
    const stored = await readLedgerJson<BookingHold>(bucket, item.key).catch(() => null);
    if (!stored) continue;
    const hold = stored.value;
    if (hold.status !== 'held') continue;
    if (Date.parse(hold.expiresAt) <= Date.now()) continue;
    holds.push(hold);
  }
  return holds;
}

export async function getBookingHold(
  bucket: LedgerBucket,
  id: string,
): Promise<BookingHold | null> {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}__[a-f0-9-]{36}$/.test(id)) return null;
  const stored = await readLedgerJson<BookingHold>(bucket, holdKey(id));
  return stored?.value ?? null;
}

export function holdIsActive(hold: BookingHold | null): boolean {
  return Boolean(
    hold &&
      hold.status === 'held' &&
      Date.parse(hold.expiresAt) > Date.now(),
  );
}

export async function createBookingHold(
  bucket: LedgerBucket,
  input: {
    date: string;
    start: string;
    end: string;
    durationMinutes: number;
    destination: { lat: number; lng: number };
    locationText: string;
    reference: string;
  },
): Promise<{ ok: true; hold: BookingHold } | { ok: false; error: 'busy' | 'overlap' | 'invalid' }> {
  const start = new Date(input.start);
  const end = new Date(input.end);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    end <= start ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date)
  ) {
    return { ok: false, error: 'invalid' };
  }
  const expiresAt = new Date(Date.now() + 20 * 60_000).toISOString();
  const id = `${input.date}__${crypto.randomUUID()}`;
  const hold: BookingHold = {
    version: 1,
    id,
    date: input.date,
    start: start.toISOString(),
    end: end.toISOString(),
    durationMinutes: input.durationMinutes,
    destination: input.destination,
    locationText: input.locationText.trim().slice(0, 300),
    reference: input.reference.trim().slice(0, 120),
    createdAt: new Date().toISOString(),
    expiresAt,
    status: 'held',
  };
  return withDayLock(bucket, input.date, async () => {
    const existing = await listActiveHolds(bucket, input.date);
    const overlap = existing.some(
      (candidate) => start < new Date(candidate.end) && new Date(candidate.start) < end,
    );
    if (overlap) return { ok: false as const, error: 'overlap' as const };
    await writeLedgerJson(bucket, holdKey(id), hold);
    return { ok: true as const, hold };
  }).then((locked) => {
    if (!locked.ok) return locked;
    return locked.value;
  });
}
