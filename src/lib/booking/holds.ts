/**
 * Durable, expiring booking holds. A hold is a TEMPORARY capacity reservation,
 * not a confirmed appointment. All writes for one day are serialized with an
 * R2 conditional lock so two customers cannot hold overlapping time.
 */
import { activeBookingResources, bookingConfig, validResourceIds } from '../../config/booking.ts';
import {
  createLedgerJson,
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
  /** Assigned cleaning resources. Absent on legacy holds, which block all. */
  resourceIds?: string[];
  crewSize?: number;
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
  let activeToken = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = crypto.randomUUID();
    const created = await createLedgerJson(bucket, key, {
      token,
      expiresAt: new Date(Date.now() + 8_000).toISOString(),
    });
    if (created) {
      acquired = true;
      activeToken = token;
      break;
    }
    const existing = await readLedgerJson<{ expiresAt?: string }>(bucket, key).catch(() => null);
    const expiresAt = existing?.value.expiresAt ? Date.parse(existing.value.expiresAt) : 0;
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
      if (existing?.etag) {
        try {
          const nextToken = crypto.randomUUID();
          const stolen = await bucket.put(
            key,
            JSON.stringify({
              token: nextToken,
              expiresAt: new Date(Date.now() + 8_000).toISOString(),
            }),
            { onlyIf: new Headers({ 'If-Match': existing.etag }) },
          );
          if (stolen !== null && stolen !== undefined) {
            acquired = true;
            activeToken = nextToken;
            break;
          }
        } catch {
          // Another request won the stale-lock takeover.
        }
      }
      continue;
    }
    await sleep(120);
  }
  if (!acquired) return { ok: false, error: 'busy' };
  try {
    return { ok: true, value: await run() };
  } finally {
    const current = await readLedgerJson<{ token?: string }>(bucket, key).catch(() => null);
    if (current?.etag && current.value.token === activeToken) {
      await bucket.put(
        key,
        JSON.stringify({ token: activeToken, expiresAt: new Date(0).toISOString() }),
        { onlyIf: new Headers({ 'If-Match': current.etag }) },
      ).catch(() => undefined);
    }
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

/** Resources a hold blocks. A legacy hold without ids conservatively blocks all. */
export function holdResourceIds(hold: BookingHold): string[] {
  if (hold.resourceIds && hold.resourceIds.length > 0) return hold.resourceIds;
  return activeBookingResources().map((resource) => resource.id);
}

function resourceSetsOverlap(a: BookingHold, b: BookingHold): boolean {
  const aIds = holdResourceIds(a);
  const bIds = holdResourceIds(b);
  return aIds.some((id) => bIds.includes(id));
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
    resourceIds: ReadonlyArray<string>;
    crewSize?: number;
  },
): Promise<{ ok: true; hold: BookingHold } | { ok: false; error: 'busy' | 'overlap' | 'invalid' }> {
  const start = new Date(input.start);
  const end = new Date(input.end);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    end <= start ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
    !validResourceIds(input.resourceIds)
  ) {
    return { ok: false, error: 'invalid' };
  }
  const resourceIds = [...new Set(input.resourceIds)];
  const crewSize = Math.min(
    bookingConfig.maxCrewSize,
    Math.max(1, Math.round(input.crewSize ?? resourceIds.length)),
  );
  if (crewSize !== resourceIds.length) return { ok: false, error: 'invalid' };
  const expiresAt = new Date(Date.now() + bookingConfig.holdMinutes * 60_000).toISOString();
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
    resourceIds,
    crewSize,
  };
  return withDayLock(bucket, input.date, async () => {
    const existing = await listActiveHolds(bucket, input.date);
    const overlap = existing.some(
      (candidate) =>
        start < new Date(candidate.end) &&
        new Date(candidate.start) < end &&
        resourceSetsOverlap(hold, candidate),
    );
    if (overlap) return { ok: false as const, error: 'overlap' as const };
    await writeLedgerJson(bucket, holdKey(id), hold);
    return { ok: true as const, hold };
  }).then((locked) => {
    if (!locked.ok) return locked;
    return locked.value;
  });
}
