/**
 * Persistent pending booking requests. A 20-minute hold only protects the slot
 * during checkout; after it expires the request survives for owner review.
 * Pending requests are NON-GUARANTEED and do not block availability. Owner
 * confirmation revalidates the slot before creating one calendar event.
 */
import {
  createLedgerJson,
  readLedgerJson,
  writeLedgerJson,
  type LedgerBucket,
} from '../payments/ledger.ts';
import type { BookingHold } from './holds.ts';

export interface PendingBookingRequest {
  version: 1;
  id: string;
  holdId: string;
  date: string;
  start: string;
  end: string;
  durationMinutes: number;
  destination: { lat: number; lng: number };
  locationText: string;
  reference: string;
  status: 'pending' | 'confirmed' | 'declined' | 'released';
  createdAt: string;
  updatedAt: string;
  calendarEventId?: string;
  /** Assigned cleaning resources (absent on legacy requests: blocks all). */
  resourceIds?: string[];
  crewSize?: number;
}

export function requestIdForHold(holdId: string): string {
  return `BR-${holdId}`;
}

export function requestKey(id: string): string {
  return `booking/requests/${id}.json`;
}

export async function getPendingBookingRequest(
  bucket: LedgerBucket,
  id: string,
): Promise<PendingBookingRequest | null> {
  if (!/^BR-[0-9]{4}-[0-9]{2}-[0-9]{2}__[a-f0-9-]{36}$/.test(id)) return null;
  const stored = await readLedgerJson<PendingBookingRequest>(bucket, requestKey(id));
  return stored?.value ?? null;
}

export async function createPendingBookingRequest(
  bucket: LedgerBucket,
  hold: BookingHold,
): Promise<PendingBookingRequest> {
  const id = requestIdForHold(hold.id);
  const existing = await getPendingBookingRequest(bucket, id);
  if (existing) return existing;
  const now = new Date().toISOString();
  const request: PendingBookingRequest = {
    version: 1,
    id,
    holdId: hold.id,
    date: hold.date,
    start: hold.start,
    end: hold.end,
    durationMinutes: hold.durationMinutes,
    destination: hold.destination,
    locationText: hold.locationText,
    reference: hold.reference,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...(hold.resourceIds && hold.resourceIds.length > 0 ? { resourceIds: hold.resourceIds } : {}),
    ...(hold.crewSize ? { crewSize: hold.crewSize } : {}),
  };
  const created = await createLedgerJson(bucket, requestKey(id), request);
  if (created) return request;
  const raced = await getPendingBookingRequest(bucket, id);
  if (!raced) throw new Error('booking_request_claim_failed');
  return raced;
}

export async function updatePendingBookingRequest(
  bucket: LedgerBucket,
  request: PendingBookingRequest,
  patch: Partial<
    Pick<
      PendingBookingRequest,
      | 'status'
      | 'calendarEventId'
      | 'date'
      | 'start'
      | 'end'
      | 'durationMinutes'
      | 'resourceIds'
      | 'crewSize'
    >
  >,
): Promise<PendingBookingRequest> {
  const updated: PendingBookingRequest = {
    ...request,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeLedgerJson(bucket, requestKey(request.id), updated);
  return updated;
}
